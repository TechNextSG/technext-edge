#!/usr/bin/env node
/**
 * Runs the manual script (docs/whatsapp-manual-test.md) against a local casa-bff, and reads the
 * replies the GUEST would have received.
 *
 * Why this exists rather than "click through it by hand": the webhook answers `{replied: 1}` whether
 * the message said the right thing or not, and with the real Graph host a test either messages a
 * real phone or fails on a dummy token — so the one artefact that matters, the text on the guest's
 * screen, was the one thing no check looked at. This script points the sender at a local capture
 * server (`WHATSAPP_GRAPH_BASE_URL`), drives the scenarios over the *signed* webhook exactly as Meta
 * would, and asserts on what was captured.
 *
 * It is not a unit test and does not pretend to be one: it talks to a running server, it uses the
 * real provider if the env has a key, and its assertions are about meaning ("no link", "does not
 * re-ask") rather than exact strings, because a model writes the reply. It is the rehearsal for a
 * demo and the reproduction for a bug report.
 *
 *   # terminal 1
 *   $env:PORT=8799; $env:WHATSAPP_GRAPH_BASE_URL="http://127.0.0.1:8899"; npx tsx apps/casa-bff/src/dev.ts
 *   # terminal 2
 *   node apps/casa-bff/scripts/whatsapp-manual-run.mjs --port 8799 --capture 8899
 *
 * Flags: --port --capture --from --only <kb> --verbose
 * Env:   WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN
 */
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";

try { process.loadEnvFile(".env.local"); } catch {}
try { process.loadEnvFile("../../.env.local"); } catch {}

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const verbose = argv.includes("--verbose");
const only = flag("only");

const port = flag("port", process.env.PORT ?? "8787");
const capturePort = Number(flag("capture", "8899"));
// The free Gemini tier allows 15 requests/minute and one turn costs several (extract, check-in,
// guests, dive window, synthesis), so a full run has to pace itself or it measures the quota.
const delayMs = Number(flag("delay", "2500"));
const base = `http://127.0.0.1:${port}`;
const webhook = `${base}/v1/channels/whatsapp/webhook`;
const secret = flag("secret", process.env.WHATSAPP_APP_SECRET);
const verifyToken = flag("verify-token", process.env.WHATSAPP_VERIFY_TOKEN);
const from = flag("from", "639170000042");

if (!secret || !verifyToken) {
  console.error("Missing WHATSAPP_APP_SECRET and/or WHATSAPP_VERIFY_TOKEN (env or flags).");
  process.exit(2);
}

// ---- the capture server: what Meta would have been asked to deliver ----------
const captured = [];
createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    let text = null;
    try {
      const parsed = JSON.parse(body);
      text = parsed?.text?.body ?? null;
    } catch {}
    captured.push({ at: new Date().toISOString(), path: req.url, text, raw: body });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: `wamid.SENT.${randomUUID()}` }] }));
  });
}).listen(capturePort, "127.0.0.1");

// ---- driving the webhook the way Meta does ----------------------------------
function signed(body) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

let messageSeq = 0;
async function send(text) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: "WABA",
      changes: [{ field: "messages", value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "15550000000", phone_number_id: "PN" },
        contacts: [{ profile: { name: "Manual Test" }, wa_id: from }],
        // A UNIQUE id per message, exactly as Meta does. A per-run counter looks equivalent and is
        // not: the server dedupes on this id for the life of the process, so the second scenario
        // would replay ids the first one already used and every message would be dropped as a
        // redelivery — which reads as "the bot said nothing", the most misleading failure there is.
        messages: [{ from, id: `wamid.MANUAL.${randomUUID()}`, timestamp: `${Math.floor(Date.now() / 1000)}`, type: "text", text: { body: text } }],
      } }],
    }],
  });
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signed(body) },
    body,
  });
  const json = await res.json().catch(() => ({}));
  // Give the turn a moment to reach the capture server before the next assertion reads it.
  await new Promise((r) => setTimeout(r, 300));
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  return { status: res.status, ...json };
}

async function reset() {
  await fetch(`${base}/v1/channels/whatsapp/threads/${from}/reset`, {
    method: "POST",
    headers: { "x-verify-token": verifyToken },
  });
  captured.length = 0;
  messageSeq = 0;
}

function lastReply() {
  const withText = captured.filter((c) => typeof c.text === "string");
  return withText.length ? withText[withText.length - 1].text : "";
}

// ---- the checks -------------------------------------------------------------
let pass = 0;
let fail = 0;
let skipped = 0;
const failures = [];

/**
 * The reply the channel sends when the model call failed — its own words, from `fallbackReply`.
 *
 * A turn that never reached the model cannot tell us anything about the product, and reporting it
 * as a failed content assertion is the most misleading result this script could produce: it looks
 * like a regression in the bot. Measured while building it: the free Gemini tier allows 15
 * requests/minute and one turn costs several, so a full run without pacing ends in 429s, the
 * fallback provider's key in `.env.local` was dead (404), and nine "failures" were entirely the
 * harness's own pacing. Infrastructure is reported as infrastructure.
 */
const TURN_FAILED = /something went wrong on our side|flagged this for the casa team and a person will reply/i;

function check(name, condition, detail) {
  if (TURN_FAILED.test(lastReply())) {
    skipped += 1;
    console.log(`  ⊘ ${name} — skipped: the model call failed this turn (provider/quota), not the bot`);
    return;
  }
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}
const hasLink = (t) => /\/q\/|\/quote\/|🔗/.test(t);

async function scenario(kb, title, fn) {
  if (only && kb.toLowerCase() !== only.toLowerCase()) return;
  console.log(`\n${kb} — ${title}`);
  await reset();
  await fn();
}

// ---- the scenarios (mirroring docs/whatsapp-manual-test.md) -----------------
await scenario("KB1", "complete in one turn, and no link", async () => {
  // Deliberately the same SHAPE as their captured fixture (2 guests, 20–22 Nov 2026, 2 nights) —
  // see the note in docs/whatsapp-manual-test.md. In fixture mode their gateway does not compute a
  // price, it picks a captured response by trip shape, so a 4-guest chat would make the guest's link
  // show 2 strangers on other dates: the screen contradicting the conversation at the exact moment
  // the conversation is what is being demonstrated.
  const r = await send(
    "Hi, I'm Ana and I'm travelling with Ben. 2 guests, 1 deluxe room. Check in on 2026-11-20 and check out on 2026-11-22, so 2 nights. Full board please. No airport transfer. One of us will dive on 2026-11-21.",
  );
  const reply = lastReply();
  if (verbose) console.log(reply);
  check("the turn was answered", r.replied === 1, JSON.stringify(r));
  check("no link of any kind in the guest's message", !hasLink(reply), reply);
  // A model writes the reply, so these read for MEANING and permit either word order and markdown
  // emphasis. Learned twice: the first version failed on "Guests: 2" instead of "2 guests", and the
  // second on "**Guests:** 2" — the model may also fold the room type into the Rooms line rather
  // than printing a "Room type:" line of its own, which is fine as long as it names the right one.
  check(
    "names the couple's room type",
    /deluxe/i.test(reply) && /(?:2\s*guests|guests?\**\s*:\**\s*2)/i.test(reply),
    reply,
  );
  check("it does not re-ask how many are diving", !/how many of you will be diving/i.test(reply), reply);
  check("it says the quotation is being prepared", /preparing your quotation|quotation .*team|team will/i.test(reply), reply);
});

await scenario("KB2b", "the room-type question, then the answer", async () => {
  // The same dates and party shape as KB1's capture, so this scenario's price can be talked about
  // with the couple's real numbers (standard 7,600 → deluxe 11,200 a night).
  await send("Hi, 2 of us from Nov 20 to Nov 22, full board, no transfer, no diving, name is Ana.");
  const asked = lastReply();
  if (verbose) console.log(`asked: ${asked}`);
  check("asks for the room type", /standard, deluxe, or suite/i.test(asked), asked);
  check("does not ask for the nights again (a range was given)", !/how many nights/i.test(asked), asked);

  await send("Deluxe please");
  const answered = lastReply();
  if (verbose) console.log(`answered: ${answered}`);
  check("reads the room type back", /deluxe/i.test(answered), answered);
  check("still no link", !hasLink(answered), answered);
});

await scenario("KB3", "split-day diving is never re-asked", async () => {
  await send("We are 6 guests staying 3 nights from 2026-12-01 in 3 deluxe rooms, full board, no transfer. Diving: 1 person dives day 1, 5 people dive both days. Name is Ana.");
  const reply = lastReply();
  if (verbose) console.log(reply);
  check("does not re-ask how many are diving", !/how many of you will be diving/i.test(reply), reply);
  check("no internal vocabulary leaks to the guest", !/routed to staff|per-day quote calculation/i.test(reply), reply);
});

await scenario("KB5", "stalling stops asking and hands over", async () => {
  await send("Hi, we're thinking about a trip");
  for (const text of ["hmm", "not sure yet", "still thinking"]) {
    await send(text);
  }
  const r = await send("maybe later");
  const reply = lastReply();
  if (verbose) console.log(reply);
  check("the bot stops asking", r.handoffs >= 1 || /team is handling|someone from|person will|member of the casa team/i.test(reply), JSON.stringify(r) + " " + reply);
});

await scenario("KB6", "cancellation goes to a person immediately", async () => {
  const r = await send("Please cancel my booking for next week");
  const reply = lastReply();
  if (verbose) console.log(reply);
  check("handed to a person", r.handoffs >= 1, JSON.stringify(r));
  check("does not ask for a check-in date", !/what date would you like to check in/i.test(reply), reply);
});

await scenario("KB7", "not a booking enquiry", async () => {
  const r = await send("hey what is the wifi password?");
  const reply = lastReply();
  if (verbose) console.log(reply);
  check("handed to the team", r.handoffs >= 1, JSON.stringify(r));
  check("explains what this number is for", /booking|reservation|enquir/i.test(reply), reply);
});

await scenario("KB8", "no invented prices or confirmations", async () => {
  await send("Hi, 2 of us, 1 deluxe room, 2026-11-20 to 2026-11-22, full board, no transport, no diving, name is Miguel.");
  const reply = lastReply();
  if (verbose) console.log(reply);
  check("quotes no money", !/(₱|\$|PHP|USD)\s?\d/i.test(reply), reply);
  check("makes no confirmation promise", !/booking is confirmed|you're all set|reserved for you/i.test(reply), reply);
  check("says nothing is booked yet", /nothing is booked/i.test(reply), reply);
});

await scenario("KB9", "Chinese end to end", async () => {
  await send("我们4个人，11月20日入住，住2晚，要豪华房，全餐，不需要接送，我的名字是 Miguel。");
  const reply = lastReply();
  if (verbose) console.log(reply);
  check("replies in Chinese", /[\u4e00-\u9fff]/.test(reply), reply);
  check("no link", !hasLink(reply), reply);
});

await scenario("KB10", "reset starts a clean thread", async () => {
  await send("Hi, 2 of us next Saturday for 2 nights");
  await send("reset");
  const reply = lastReply();
  if (verbose) console.log(reply);
  check("greets again", /welcome to casa escondida/i.test(reply), reply);
});

console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped (provider unavailable).`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
console.log("\nEvery captured message is what Meta was asked to deliver. Read them with --verbose.");
process.exit(fail === 0 ? 0 : 1);
