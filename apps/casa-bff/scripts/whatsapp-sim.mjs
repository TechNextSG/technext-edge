#!/usr/bin/env node
// Simulates the Meta Cloud API side of the WhatsApp channel against a locally
// running casa-bff, so the whole inbound path can be exercised without a Meta
// app, a public URL or a real guest.
//
// Why a script and not just curl: the signature covers the raw request bytes, so
// any manual test has to reproduce Meta's HMAC exactly. Getting that subtly wrong
// (or testing with no header at all) silently exercises the 401 branch and tells
// you nothing about the path you meant to test.
//
//   npm run whatsapp:sim --workspace apps/casa-bff
//   npm run whatsapp:sim --workspace apps/casa-bff -- --port 8791 --from 84359386414
//
// Flags: --url --port --secret --verify-token --from --text --text2 --verbose
// Env:   WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, PORT (flags win)
import { createHmac } from "node:crypto";

try { process.loadEnvFile(".env.local"); } catch {}
try { process.loadEnvFile("../../.env.local"); } catch {}

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const verbose = argv.includes("--verbose");

const port = flag("port", process.env.PORT ?? "8787");
const webhook = `${flag("url", `http://localhost:${port}`)}/v1/channels/whatsapp/webhook`;
const secret = flag("secret", process.env.WHATSAPP_APP_SECRET);
const verifyToken = flag("verify-token", process.env.WHATSAPP_VERIFY_TOKEN);
// A fake guest by default: set --from to your own number (country code, no "+")
// and the assistant's replies land on your real phone, which is the fastest way
// to read the reply text without wiring a Meta callback URL.
const from = flag("from", "639171234567");
const firstText = flag("text", "Hi, next Saturday for 3 nights please");
const secondText = flag("text2", "2 adults, full board and the airport transfer");

if (!secret || !verifyToken) {
  console.error("Missing WHATSAPP_APP_SECRET and/or WHATSAPP_VERIFY_TOKEN (env or flags).");
  console.error("For local runs start the server with, e.g.:");
  console.error("  $env:WHATSAPP_APP_SECRET='local-app-secret'; $env:WHATSAPP_VERIFY_TOKEN='local-verify-token'; npm run dev:bff");
  process.exit(2);
}

// Distinct per run so a re-run is never mistaken for a redelivery of the previous
// one; the dedupe map is per server process anyway.
const run = Date.now().toString(36);
const wamid = (n) => `wamid.SIM${run}.${n}`;
const sign = (body) => `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;

const textEvent = (id, text) => JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{
    id: "0",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "15550001111", phone_number_id: "0" },
        contacts: [{ profile: { name: "Sim Guest" }, wa_id: from }],
        messages: [{ id, from, timestamp: Math.floor(Date.now() / 1000).toString(), type: "text", text: { body: text } }],
      },
    }],
  }],
});

// What Meta sends when the guest reads our reply — the shape most likely to be
// mistaken for a message and answered twice.
const receiptEvent = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{
    id: "0",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "15550001111", phone_number_id: "0" },
        statuses: [{ id: wamid(7), status: "read", timestamp: Math.floor(Date.now() / 1000).toString(), recipient_id: from }],
      },
    }],
  }],
});


const checks = [];
function check(label, ok, detail) {
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` (${detail})` : ""}`);
}

const get = (query) => fetch(`${webhook}?${new URLSearchParams(query)}`, { signal: AbortSignal.timeout(60_000) });

async function post(body, signature) {
  const headers = { "content-type": "application/json" };
  if (signature) headers["x-hub-signature-256"] = signature;
  const res = await fetch(webhook, { method: "POST", headers, body, signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  if (verbose) console.log(`      -> ${res.status} ${text}`);
  return { status: res.status, text, json: () => JSON.parse(text) };
}

console.log(`simulating Meta -> ${webhook}`);
console.log(`guest ${from}: "${firstText}"\n`);

// 1. The handshake Meta runs when the callback URL is saved or the token changes.
let res = await get({ "hub.mode": "subscribe", "hub.verify_token": "definitely-wrong", "hub.challenge": "x" });
check("GET handshake rejects a wrong verify token", res.status === 403, `status ${res.status}`);

const challenge = `sim-${run}`;
res = await get({ "hub.mode": "subscribe", "hub.verify_token": verifyToken, "hub.challenge": challenge });
const echoed = await res.text();
check("GET handshake echoes the challenge verbatim as plain text", res.status === 200 && echoed === challenge, `status ${res.status} body ${JSON.stringify(echoed)}`);

// 2. Signature: the only thing between a public URL and anyone on the internet
//    extracting and replying as Casa.
res = await post(textEvent(wamid(9), firstText), undefined);
check("POST with no X-Hub-Signature-256 is rejected", res.status === 401, `status ${res.status}`);

const tampered = textEvent(wamid(8), firstText);
res = await post(tampered, sign(`${tampered} `));
check("POST whose body does not match its signature is rejected", res.status === 401, `status ${res.status}`);

// 3. Receipts carry no text: ack, never reply.
res = await post(receiptEvent, sign(receiptEvent));
const outReceipt = res.json();
check("POST of a read receipt acks without replying", res.status === 200 && outReceipt.received === 0, `status ${res.status} ${res.text}`);

// 4. The real delivery: a guest text message.
const body1 = textEvent(wamid(1), firstText);
res = await post(body1, sign(body1));
const out1 = res.json();
check("POST of a guest text message is accepted", res.status === 200 && out1.received === 1, `status ${res.status} ${res.text}`);

// 5. Meta retries anything that is not a timely 2xx. A retry must not become a
//    second reply in the guest's chat, so the wamid is claimed once.
res = await post(body1, sign(body1));
const out2 = res.json();
check("redelivery of the same wamid is deduped", res.status === 200 && out2.duplicates === 1, `status ${res.status} ${res.text}`);

// 6. A follow-up on the same thread, which is what the conversation store is for:
//    the second reply should be able to build on what the first message said.
const body3 = textEvent(wamid(2), secondText);
res = await post(body3, sign(body3));
const out3 = res.json();
check("a follow-up message on the same thread is accepted", res.status === 200 && out3.received === 1, `status ${res.status} ${res.text}`);

const noToken = [out1, out2, out3].some((o) => o.error === "server_misconfigured");
console.log("");
if (out1.replied + out3.replied >= 2) {
  // Deliberately not "the replies are on your phone": a send that graph.facebook.com
  // accepts (200 + wamid) can still be refused afterwards — Meta reports that as a
  // `statuses` webhook with status=failed and errors[0].code 131047, which is what a
  // closed 24h window looks like. This script cannot see that webhook, so it reports
  // only what it actually proved.
  console.log(`Both turns reached graph.facebook.com and were accepted there (200 + wamid) for ${from}.`);
  console.log("Accepted is not delivered: Meta's verdict arrives later as a statuses webhook —");
  console.log("sent, then delivered, then read, or failed with errors[0].code 131047 once the");
  console.log("24h window has closed. Read that webhook, or the phone, before trusting this run.");
  console.log("The guest messages it sent were:");
  console.log(`  1. "${firstText}"\n  2. "${secondText}"`);
} else if (noToken) {
  console.log("The server has no WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID, so it refused");
  console.log("before extracting anything. Put both in the repo-root .env.local, restart the dev");
  console.log("server (tsx reads that file once, at boot), then run this again.");
} else {
  console.log("No reply left the building (replied=0, failed>0): extraction and converse ran, the");
  console.log("send to graph.facebook.com did not. Expected with a dummy WHATSAPP_ACCESS_TOKEN — the");
  console.log("server log shows Meta's own error, and the webhook still answered 200 by design.");
}

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
