#!/usr/bin/env node
/**
 * One whole journey, played out role by role: GUEST on WhatsApp, then STAFF in the studio, then
 * GUEST again on the quotation link.
 *
 * Why a script and not a checklist. Every part of this journey is inspectable from one side only:
 * the guest's view exists at the Graph API boundary (the webhook answers `{replied: 1}` whether the
 * reply said the right thing or not), the staff's view is behind the token, and the final link lives
 * on the team estimator. Walking it by hand means holding three windows and remembering what the
 * last one said. This prints the whole thing in order, in the words each side actually sees, so a
 * mismatch between them is visible on one screen instead of in an argument afterwards.
 *
 * It is a rehearsal, not a test: it does not assert much, it SHOWS. Run it before a demo, and run it
 * after a change to anything on the path.
 *
 *   # terminal 1 — a BFF wired like the demo: their engine, our capture host for outbound WhatsApp
 *   $env:PORT=8799
 *   $env:ESTIMATOR_MODE="remote"
 *   $env:ESTIMATOR_BASE_URL="https://tn-casa-estimator-fixture.vercel.app"
 *   $env:WHATSAPP_GRAPH_BASE_URL="http://127.0.0.1:8899"
 *   npx tsx bff/src/dev.ts
 *   # terminal 2
 *   node bff/scripts/journey-walkthrough.mjs --port 8799 --capture 8899
 *
 * Flags: --port --capture --from --phone (the guest's number) --token (staff key)
 * Env:   WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN
 */
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";

try { process.loadEnvFile(".env.local"); } catch {}
try { process.loadEnvFile("../.env.local"); } catch {}

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const port = flag("port", process.env.PORT ?? "8787");
const capturePort = Number(flag("capture", "8899"));
const base = `http://127.0.0.1:${port}`;
const secret = flag("secret", process.env.WHATSAPP_APP_SECRET);
const staffToken = flag("token", process.env.WHATSAPP_VERIFY_TOKEN);
const from = flag("from", "639170000042");

if (!secret || !staffToken) {
  console.error("Missing WHATSAPP_APP_SECRET and/or WHATSAPP_VERIFY_TOKEN (env or flags).");
  process.exit(2);
}

const staffHeaders = { "x-verify-token": staffToken, "content-type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the guest's screen: every message Meta was asked to deliver -------------
const outbound = [];
const captureServer = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    let text = null;
    try { text = JSON.parse(body)?.text?.body ?? null; } catch {}
    if (text !== null) outbound.push(text);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: `wamid.SENT.${randomUUID()}` }] }));
  });
}).listen(capturePort, "127.0.0.1");

/**
 * The process must not outlive the walkthrough. The capture server keeps the event loop alive, so a
 * run that reached the end simply HUNG — which is how the first version of this script left a
 * process holding the capture port and made the next run fail with EADDRINUSE. A script that has to
 * be killed by hand is a script people stop trusting.
 */
function finish(code) {
  captureServer.close();
  process.exit(code);
}

function rule(title) {
  console.log(`\n${"─".repeat(78)}\n${title}\n${"─".repeat(78)}`);
}
function guestSays(text) {
  console.log(`\n📱 GUEST (WhatsApp) →\n   ${text}`);
}
function guestSees(text) {
  console.log(`\n📱 GUEST receives:\n${text.split("\n").map((l) => `   ${l}`).join("\n")}`);
}

async function guestSends(text) {
  const before = outbound.length;
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "15550000000", phone_number_id: "PN" },
      contacts: [{ profile: { name: "Guest" }, wa_id: from }],
      messages: [{ from, id: `wamid.WALK.${randomUUID()}`, timestamp: `${Math.floor(Date.now() / 1000)}`, type: "text", text: { body: text } }],
    } }] }],
  });
  const res = await fetch(`${base}/v1/channels/whatsapp/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` },
    body,
  });
  const json = await res.json().catch(() => ({}));
  await sleep(400);
  const replies = outbound.slice(before);
  guestSays(text);
  for (const r of replies) guestSees(r);
  if (replies.length === 0) console.log(`   (no reply — webhook said ${JSON.stringify(json)})`);
  return { json, reply: replies[replies.length - 1] ?? "" };
}

async function staff(path, init = {}) {
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...staffHeaders, ...(init.headers ?? {}) } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ---- the journey -------------------------------------------------------------
// The message deliberately leaves the room type out first, so the journey includes the ONE question
// this pipeline now asks that it did not ask before. Everything else is stated up front, including
// the shape of their captured fixture (2 guests, 20–22 Nov, Ana travelling with Ben) so that the
// guest's link later cannot disagree with what the guest just said.
rule("STEP 0 — clean thread, so this journey starts from nothing");
await fetch(`${base}/v1/channels/whatsapp/threads/${from}/reset`, { method: "POST", headers: staffHeaders });
outbound.length = 0;
const before = new Set(((await staff("/v1/quotes")).body.quotations ?? []).map((q) => q.quoteId));
console.log(`   thread reset for ${from}  ·  ${before.size} quotation(s) in the store before this journey`);

rule("STEP 1 — GUEST: an enquiry that is complete except for the room type");
await guestSends(
  "Hi, I'm Ana and I'm travelling with Ben. 2 guests, 1 room. Check in on 2026-11-20 and check out on 2026-11-22, so 2 nights. Full board please. No airport transfer. One of us will dive on 2026-11-21.",
);

rule("STEP 2 — GUEST: answers the room-type question");
const answered = await guestSends("Deluxe please");

rule("STEP 3 — STAFF: what the studio shows for this enquiry");
const list = await staff("/v1/quotes");
// A quotation this JOURNEY created, not merely the newest one in the store. The first version took
// the newest record and silently played the rest of the journey against the seeded fixture when the
// bot had failed to create anything — a walkthrough that cannot tell "the bot produced nothing" from
// "here is the bot's work" is worse than no walkthrough, because it reports success either way.
const created = (list.body.quotations ?? []).filter((q) => !before.has(q.quoteId));
if (created.length === 0) {
  console.error("\n   ✗ No quotation was created by this journey — the bot never reached `done`.");
  console.error("     That is the failure this script exists to show: the guest's last message did NOT");
  console.error("     complete the enquiry. Read the reply in STEP 2 for which question stayed open.");
  finish(1);
}
if (created.length > 1) {
  console.error(`\n   ✗ ${created.length} quotations were created for one enquiry (${created.map((q) => q.quoteId).join(", ")}).`);
  console.error("     One enquiry, one quotation — this is the duplicate bug coming back.");
  finish(1);
}
const id = created[0].quoteId;
const record = await staff(`/v1/quotes/${id}`);
const q = record.body.quotation;
console.log(`   quotation   : ${id}  (status: ${q.status})`);
console.log(`   guest       : ${q.guestName}  ·  ${q.phone ?? "no phone"}`);
console.log(`   stay        : ${q.checkIn} → ${q.checkOut}  (${q.nights} nights, ${q.rooms} room(s))`);
console.log(`   trip the bot built:`);
console.log(`     rooms    : ${q.bffTrip.rooms.map((r) => `${r.id}:${r.type}`).join(", ")}`);
console.log(`     guests   : ${q.bffTrip.guests.map((g) => `${g.name}${g.diver ? " (diver)" : ""}${g.days && Object.keys(g.days).length ? ` days=${Object.keys(g.days).join("/")}` : ""}`).join(", ")}`);
console.log(`   staff alerts: ${(q.staffAlerts ?? []).length ? "" : "(none)"}`);
for (const a of q.staffAlerts ?? []) console.log(`     · ${a}`);

rule("STEP 4 — STAFF: price it with the engine, then correct the trip and re-price");
const priced = await staff(`/v1/quotes/${id}/sync-estimate`, { method: "POST" });
if (!priced.body.ok) {
  console.log(`   pricing refused: ${priced.body.reason} — ${priced.body.detail}`);
} else {
  const p = priced.body.pricing;
  console.log(`   engine        : ${priced.body.endpoint}`);
  console.log(`   badge         : ${priced.body.sample ? "SAMPLE DATA (not a real quote)" : "live"}`);
  console.log(`   total         : ₱${(p.kpis.revenue ?? 0).toLocaleString("en-US")}   (room ₱${(p.catRev.room ?? 0).toLocaleString("en-US")})`);
  for (const g of p.guests ?? []) {
    console.log(`     ${g.name}: ${g.lines.map((l) => `${l.label} ₱${l.net}`).join(" | ")}  = ₱${g.total}`);
  }
}

const edited = JSON.parse(JSON.stringify(q.bffTrip));
edited.rooms[0].type = "suite";
const reprice = await staff(`/v1/quotes/${id}/trip`, { method: "POST", body: JSON.stringify({ trip: edited }) });
if (reprice.body.ok) {
  console.log(`\n   staff edited rooms[0].type → suite`);
  console.log(`   changedFields : ${reprice.body.changedFields.join(", ")}`);
  console.log(`   status now    : ${reprice.body.quotation.status}  (editing drops the approval, on purpose)`);
  console.log(`   engine total  : ₱${(reprice.body.pricing.kpis.revenue ?? 0).toLocaleString("en-US")}`);
} else {
  console.log(`\n   edit refused: ${reprice.body.reason} — ${reprice.body.detail}`);
}

rule("STEP 5 — STAFF: approve, then publish the guest link");
// Confirming with the WHOLE record, because that is what the studio's Approve button sends: its
// `gatherPayload()` posts the page's own `state`. Sending `{guestName}` alone (the first version of
// this script) is a client the product does not have, and it wrote an `undefined` into a business
// record — the route spreads whatever body it is given over the draft.
//
// And the record is RE-READ first, because the page's `state` is re-read too: `/trip` reloads the
// studio after re-pricing, so what Approve posts is the trip the server now holds. Posting this
// script's own older copy — which still said `standard` after the edit above — is a client that does
// not exist, and `/confirm` refuses it on purpose (409 `trip_changed`): an approval may not be given
// for one trip while the stored price describes another.
const fresh = (await staff(`/v1/quotes/${id}`)).body.quotation;
const confirmed = await staff(`/v1/quotes/${id}/confirm`, {
  method: "POST",
  body: JSON.stringify({ ...fresh, status: undefined, confirmedAt: undefined, confirmedBy: undefined }),
});
if (!confirmed.body.ok) {
  // Loud, because a rehearsal that cannot approve cannot rehearse the demo. This is local behaviour
  // (no call to their app), so it is a real failure of OUR path, not the environment's.
  console.log(`   approve → REFUSED  ${confirmed.body.reason}: ${confirmed.body.detail ?? confirmed.body.error ?? ""}`);
  finish(1);
}
console.log(`   approve → ${confirmed.body.quotation.status}  (trip the approver saw: ${fresh.bffTrip.rooms.map((r) => `${r.id}:${r.type}`).join(", ")})`);
const published = await staff(`/v1/quotes/${id}/publish`, { method: "POST", body: JSON.stringify({ acknowledgeSample: true }) });
console.log(`   publish → ${published.body.ok ? `version ${published.body.seq}` : `${published.body.reason}: ${published.body.detail}`}`);
console.log(`   guest link → ${published.body.guestUrl ?? "(none — no host for their app)"}`);

rule("STEP 6 — GUEST: opens the link staff just sent");
const link = published.body.guestUrl;
if (!link) {
  console.log("   nothing to open.");
} else {
  const page = await fetch(link);
  console.log(`   ${link}`);
  console.log(`   → HTTP ${page.status} (${(await page.text()).length} bytes — the customer's own quotation page)`);
  const token = link.split("/").pop();
  const shared = await fetch(link.replace(/\/quote\/.*$/, `/api/share/${token}`)).then((r) => r.json()).catch(() => null);
  if (shared) {
    const room = (shared.model?.quotes?.[0]?.lines ?? []).find((l) => l.cat === "room");
    console.log(`\n   What the guest reads on that page:`);
    console.log(`     label      : ${shared.trip?.label}`);
    console.log(`     guests     : ${(shared.trip?.guests ?? []).map((g) => g.name).join(" + ")}`);
    console.log(`     stay       : ${shared.trip?.checkIn} → ${shared.trip?.checkOut}`);
    console.log(`     room type  : ${(shared.trip?.rooms ?? []).map((r) => `${r.id}:${r.type}`).join(", ")}`);
    console.log(`     price line : ${room ? `"${room.label}" ₱${room.gross}` : "(no room line)"}`);
    console.log(`     total      : ₱${shared.model?.kpis?.revenue}`);
    console.log(`\n   The one line that can differ, and why: the REVISION carries the room type the guest`);
    console.log(`   asked for, because our payload says so. The PRICE line comes from the engine — and in`);
    console.log(`   fixture mode their gateway replays a capture instead of pricing, so it still reads the`);
    console.log(`   captured room. With real Odoo the two agree.`);
  }
}

rule("Done — the journey above is exactly what each side sees");
console.log("   Guest  : never a price, never a link, until staff publish.");
console.log("   Staff  : one source for the price (the engine), the trip editable, edits drop the approval.");
console.log("   Guest  : the link opens the CUSTOMER's own quotation page, with the frozen revision.\n");
finish(0);
