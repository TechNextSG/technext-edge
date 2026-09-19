#!/usr/bin/env node
// Points Meta's webhook at a URL — read it back, set it, and subscribe the WhatsApp
// account — so a tunnel or a deployment can be wired up without the dashboard.
//
// Why it exists: the receiving half of this channel is three dashboard fields (see
// docs/01-team-guide.md §6) and the local one changes on every restart, because a
// free tunnel URL does. Redoing three fields by hand each session is how a demo
// morning dies. The calls below are the API behind those fields, and the POST makes
// Meta *call our callback URL's handshake* — so a rejected URL fails here, while the
// server is still up to fix it, instead of silently at the first guest.
//
//   npm run whatsapp:webhook --workspace apps/casa-bff
//   npm run whatsapp:webhook --workspace apps/casa-bff -- --url https://abc.trycloudflare.com
//   npm run whatsapp:webhook --workspace apps/casa-bff -- --url https://technext-edge-casa-bff.vercel.app
//
// Flags: --url --app-id --app-secret --waba-id --verify-token --api-version --json
// Env:   WHATSAPP_APP_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_WABA_ID
//
// Without --url it only reads: what Meta currently calls, and whether this app is
// subscribed to the WhatsApp account. That is the check to run when replies stop
// arriving, because a dead tunnel URL answers nothing and complains to no one.
try { process.loadEnvFile(".env.local"); } catch {}
try { process.loadEnvFile("../../.env.local"); } catch {}

const GRAPH = "https://graph.facebook.com";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const apiVersion = flag("api-version", process.env.WHATSAPP_API_VERSION ?? "v21.0");
const appId = flag("app-id", process.env.WHATSAPP_APP_ID);
const appSecret = flag("app-secret", process.env.WHATSAPP_APP_SECRET);
const wabaId = flag("waba-id", process.env.WHATSAPP_WABA_ID);
const verifyToken = flag("verify-token", process.env.WHATSAPP_VERIFY_TOKEN);
// A trailing slash would become a double slash in the callback URL, which Meta
// stores and then calls as-is.
const origin = (flag("url") ?? "").replace(/\/+$/, "");
const asJson = argv.includes("--json");

if (!/^\d{6,20}$/.test(appId ?? "") || !appSecret) {
  console.error("Missing WHATSAPP_APP_ID and/or WHATSAPP_APP_SECRET (env or flags).");
  console.error("App settings > Basic shows both. That pair is what authenticates every call here:");
  console.error("GET /<app id>/subscriptions with a Bearer token answers 400 (#190) Application Secret required.");
  process.exit(2);
}

if (origin && !/^https:\/\//.test(origin)) {
  console.error(`--url must be https (Meta refuses a plain-http callback): got "${origin}"`);
  process.exit(2);
}

const appToken = `${appId}|${appSecret}`;
const CALLBACK_PATH = "/v1/channels/whatsapp/webhook";
const callbackUrl = origin ? `${origin}${CALLBACK_PATH}` : null;

async function graph(path, params, method = "GET") {
  const url = new URL(`${GRAPH}/${apiVersion}/${path}`);
  // Always the query string, even for POST: POST /{app-id}/subscriptions rejects a
  // form-encoded body with "Unsupported post request. Object with ID ... does not
  // exist", which reads like a permissions problem and is not one — the same
  // parameters in the query string answer {"success":true} (2026-09-18).
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { method });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text };
}

function whatsappSubscriptions(json) {
  return (Array.isArray(json?.data) ? json.data : []).filter((entry) => entry.object === "whatsapp_business_account");
}

function describe(entry, fallback) {
  console.log(`callback_url : ${entry?.callback_url ?? fallback}`);
  console.log(`fields       : ${(entry?.fields ?? []).map((f) => f.name ?? f).join(", ") || "(none reported)"}`);
  console.log(`active       : ${entry?.active}`);
}

// Read before writing: POST /<app id>/subscriptions replaces the whole field list,
// so the existing one is sent back unchanged. Dropping fields this app does not
// handle but Meta still tracks (template quality, account updates) would otherwise
// be a silent side effect of "point the webhook at my tunnel".
const before = await graph(`${appId}/subscriptions`, { access_token: appToken });
if (before.status !== 200) {
  console.error(`Could not read the subscription back (HTTP ${before.status}): ${before.text.slice(0, 300)}`);
  process.exit(1);
}
const existing = whatsappSubscriptions(before.json)[0];
const fields = (existing?.fields ?? []).map((f) => f.name ?? f);
const fieldsCsv = (fields.length > 0 ? fields : ["messages"]).join(",");

if (callbackUrl) {
  if (!verifyToken) {
    // Meta only reports the mismatch as "the URL couldn't be validated", which reads
    // like a network problem and is not one.
    console.error("Missing WHATSAPP_VERIFY_TOKEN — Meta re-runs the handshake during this call.");
    process.exit(2);
  }
  const posted = await graph(
    `${appId}/subscriptions`,
    {
      access_token: appToken,
      object: "whatsapp_business_account",
      callback_url: callbackUrl,
      verify_token: verifyToken,
      fields: fieldsCsv,
    },
    "POST",
  );

  if (posted.status !== 200 || !posted.json?.success) {
    console.error(`Meta refused the callback URL (HTTP ${posted.status}):`);
    console.error(`  ${posted.json?.error?.message ?? posted.text.slice(0, 300)}`);
    console.error("");
    console.error("The usual three, in order:");
    console.error("  1. the server behind that URL was not running (Meta calls the handshake right now, once)");
    console.error(`  2. ${callbackUrl} does not answer the GET handshake with the raw hub.challenge`);
    console.error("  3. the token here is not the WHATSAPP_VERIFY_TOKEN that deployment holds");
    process.exit(1);
  }
  console.log(`Meta now calls ${callbackUrl} (object whatsapp_business_account, fields ${fieldsCsv}).`);
}

// Read back rather than trust the POST: this is the line to paste into a bug report,
// and the one that exposes a second, stale callback URL nobody meant to leave.
const after = callbackUrl ? await graph(`${appId}/subscriptions`, { access_token: appToken }) : before;
const current = whatsappSubscriptions(after.json);
if (asJson) console.log(JSON.stringify(current, null, 2));
else if (current.length === 0) console.log("No whatsapp_business_account subscription is configured on this app.");
else for (const entry of current) describe(entry, callbackUrl);

// The inbound half needs both: the callback URL above, and this app subscribed to
// the WhatsApp account the number belongs to. A saved URL routes nothing without it.
if (/^\d{10,20}$/.test(wabaId ?? "")) {
  const subscribe = await graph(`${wabaId}/subscribed_apps`, { access_token: appToken }, "POST");
  if (subscribe.status !== 200 || !subscribe.json?.success) {
    console.error(`Could not subscribe to WABA ${wabaId} (HTTP ${subscribe.status}): ${subscribe.text.slice(0, 200)}`);
    process.exit(1);
  }
  const apps = await graph(`${wabaId}/subscribed_apps`, { access_token: appToken });
  const ids = (Array.isArray(apps.json?.data) ? apps.json.data : []).map(
    (a) => a?.whatsapp_business_api_data?.id ?? a?.id,
  );
  console.log(`Subscribed to WABA ${wabaId}: app(s) ${ids.join(", ") || "none"} — inbound reaches this server.`);
} else {
  console.log("");
  console.log("Not checked: whether this app is subscribed to the WhatsApp account. Pass --waba-id <id>");
  console.log("(WhatsApp > API Setup shows it, or set WHATSAPP_WABA_ID) — without that subscription a");
  console.log("correct callback URL still routes nothing, which looks exactly like a broken webhook.");
}
