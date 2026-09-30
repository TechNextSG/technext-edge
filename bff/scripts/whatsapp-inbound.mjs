#!/usr/bin/env node
/**
 * Delivers a guest message to a *deployed* BFF by calling its webhook the way Meta does,
 * with the same HMAC signature and a fresh `wamid`.
 *
 * Why this exists next to whatsapp-manual-run.mjs: that script needs a local server and a
 * capture server, so it can read the replies. This one is for the opposite job — reproducing
 * something against the real deployment (production, or the sim preview), where the guest's
 * phone is the only place the reply text lives. The webhook answers `{replied: 1}` either way,
 * so what this prints is a *receipt*, not a transcript: use it to drive the server, and read
 * the record (`/v1/quotes/<id>`) or the phone for the text.
 *
 * Sending is real: the bot's answer goes out over the Cloud API to `--from`, so only drive
 * numbers on the app's test list (the one number a POC has).
 *
 *   node bff/scripts/whatsapp-inbound.mjs \
 *     --base https://technext-edge-casa-bff.vercel.app --from 84359386414 \
 *     --reset --text "Hi, 2 guests, 2 nights from 21/11/2026, deluxe room please"
 *
 * Flags: --base --from --name --text (repeatable, sent in order) --gap <ms> --reset
 *        --secret --verify-token
 * Env:   WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN
 */
import { createHmac, randomUUID } from "node:crypto";

try { process.loadEnvFile(".env.local"); } catch {}
try { process.loadEnvFile("../.env.local"); } catch {}

const argv = process.argv.slice(2);
const valuesOf = (name) => argv.reduce((acc, a, i) => (a === `--${name}` ? [...acc, argv[i + 1]] : acc), []);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const base = (flag("base", "http://127.0.0.1:8787")).replace(/\/$/, "");
const from = flag("from", "84359386414");
const name = flag("name", "Guest");
const texts = valuesOf("text");
const gapMs = Number(flag("gap", "2000"));
const secret = flag("secret", process.env.WHATSAPP_APP_SECRET);
const verifyToken = flag("verify-token", process.env.WHATSAPP_VERIFY_TOKEN);

if (!secret) {
  console.error("Missing WHATSAPP_APP_SECRET (env or --secret).");
  process.exit(2);
}
if (texts.length === 0 && !argv.includes("--reset")) {
  console.error("Nothing to do: pass --text at least once.");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resetThread() {
  if (!verifyToken) throw new Error("--reset needs WHATSAPP_VERIFY_TOKEN (env or --verify-token)");
  const res = await fetch(`${base}/v1/channels/whatsapp/threads/${from}/reset`, {
    method: "POST",
    headers: { "x-verify-token": verifyToken },
  });
  const body = await res.text();
  console.log(`reset  ${res.status}  ${body.slice(0, 300)}`);
}

async function send(text) {
  // One wamid per message, like Meta's. Reusing one is the dedupe path, not the send path.
  const wamid = `wamid.MANUAL.${randomUUID()}`;
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "0",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15551506595", phone_number_id: "1278878915314039" },
              contacts: [{ profile: { name }, wa_id: from }],
              messages: [
                {
                  from,
                  id: wamid,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const raw = JSON.stringify(payload);
  const signature = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const res = await fetch(`${base}/v1/channels/whatsapp/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    body: raw,
  });
  const body = await res.text();
  console.log(`guest  ${text}`);
  console.log(`  ->   ${res.status}  ${body.slice(0, 300)}`);
  return res.status;
}

if (argv.includes("--reset")) await resetThread();
for (const [i, text] of texts.entries()) {
  if (i > 0) await sleep(gapMs);
  await send(text);
}
