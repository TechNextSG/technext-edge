#!/usr/bin/env node
// Pre-flight check of the WhatsApp credentials against the real Graph API — run it
// before pointing a Meta app at this service, and again whenever a reply stops
// arriving.
//
// It exists because all three ways this breaks look identical from the chat (no
// reply ever appears) and two of them stay invisible until a guest is waiting:
//   - WHATSAPP_ACCESS_TOKEN expired: the dashboard hands out a 24h temporary token
//     first, and its only symptom is Meta's code 190 in the server log
//   - the token was generated *before* the WhatsApp account was assigned to the
//     system user, so the first send fails with code 200
//   - WHATSAPP_PHONE_NUMBER_ID holds the phone number instead of its ID
//   - the phone number was never registered for Cloud API (code 133010): every send
//     answers "Account not registered", and no credential fix helps, because the number
//     can only be registered by calling the API — there is no button for it anywhere
//
// Green here does not cover the two failures that only a send can reveal: the recipient
// being off the test number's allowed list (131030), and the 24h window having closed
// (131047). This tool cannot see either of them, so neither is a reason to distrust it.
//
//   npm run whatsapp:check --workspace apps/casa-bff
//   npm run whatsapp:check --workspace apps/casa-bff -- --app-id 1234 --app-secret <32 hex>
//
// --app-id/--app-secret are optional, but they are what turns "this token works
// today" into "this is a system user token that never expires and is scoped to this
// WhatsApp account" — debug_token reports both.
//
// Flags: --token --phone-number-id --app-id --app-secret --api-version
//        --exchange-token (trade the 24h token for a ~60 day one, written to the
//        env file — never printed), --env-file <path> (where that write goes)
//        --register --pin <6 digits> (register the number for Cloud API — the only
//        call in this file that changes anything at Meta)
//        --waba-id <id> (read back whether this app is subscribed to that WhatsApp
//        Business Account — the inbound half, which a green run otherwise says
//        nothing about)
// Env:   WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET,
//        WHATSAPP_APP_ID, WHATSAPP_API_VERSION
// Exit:  0 all green, 1 a real problem, 2 credentials missing
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

try { process.loadEnvFile(".env.local"); } catch {}
try { process.loadEnvFile("../../.env.local"); } catch {}

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

// Mirrors whatsAppConfig() in src/whatsapp.ts, including the API version default:
// a checker that talks to a different Graph version than the service is not a check.
const apiVersion = flag("api-version", process.env.WHATSAPP_API_VERSION ?? "v21.0");
// `let`, not `const`: --exchange-token swaps it for the long-lived one mid-run.
let accessToken = flag("token", process.env.WHATSAPP_ACCESS_TOKEN);
const phoneNumberId = flag("phone-number-id", process.env.WHATSAPP_PHONE_NUMBER_ID);
const appId = flag("app-id", process.env.WHATSAPP_APP_ID);
const appSecret = flag("app-secret", process.env.WHATSAPP_APP_SECRET);

const GRAPH = "https://graph.facebook.com";
// Never print a credential, not even a working one: the length plus a few
// characters is enough to tell two tokens apart in a transcript or a screenshot.
const fingerprint = (s) => `${s.slice(0, 6)}…(${s.length} chars)`;

const checks = [];
function check(label, ok, detail) {
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` (${detail})` : ""}`);
}
// Skips are not failures: they cover the optional half of this tool.
function skip(label, why) {
  console.log(`SKIP  ${label} (${why})`);
}

async function graph(path, params = {}) {
  const res = await fetch(`${GRAPH}/${apiVersion}/${path}?${new URLSearchParams(params)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}
// The register call below is the one thing here that writes to the Meta account, so it
// gets a POST helper of its own instead of turning graph() into something that can do
// both — a GET helper cannot mutate anything by accident.
async function graphPost(path, body) {
  const res = await fetch(`${GRAPH}/${apiVersion}/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}

// Meta's numeric error code is the only part of a failure worth reading; the raw
// message sends people to the wrong doc page, so decode the ones we can hit here.
// The 131xxx codes are the ones a demo actually hits: they are not auth failures,
// they mean the *conversation* is not in a state that allows a free-form reply.
const HINTS = {
  1: "unknown error, usually a malformed request",
  3: "the app cannot make this call yet",
  4: "rate limit reached, retry later",
  10: "the token is missing the permission this call needs",
  100: "a parameter is wrong, most often an ID that is not the one you think",
  101: "the App ID and app secret do not belong together, or come from another app",
  102: "the session expired — generate a new token",
  104: "that is not a usable token (a placeholder or a truncated paste)",
  190: "the access token is invalid or has expired",
  200: "permission denied, usually the system user was never assigned the WhatsApp account",
  368: "temporarily blocked by Meta",
  131026: "the recipient cannot receive this message — not on the test recipient list, or has not opted in",
  131047: "more than 24h since the guest's last message — only a template message can reopen the window",
  131030: "the recipient is not on the test recipient list — add it in API Setup, then retry",
  133010: "the business number was never registered for Cloud API — POST /<phone-number-id>/register with a 6-digit pin",
};
const describe = (json, fallback) =>
  json?.error
    ? `code ${json.error.code}: ${json.error.message}${HINTS[json.error.code] ? ` — ${HINTS[json.error.code]}` : ""}`
    : fallback;

console.log(`checking WhatsApp credentials against ${GRAPH}/${apiVersion}\n`);

// `--exchange-token`: trade the temporary 24h token from API Setup for a
// long-lived one (~60 days) with the documented call
// (oauth/access_token?grant_type=fb_exchange_token), then write the result into
// the env file rather than echoing it — a token in a terminal scrollback or a
// screenshot is a token that has to be rotated.
//
// It cannot revive an expired token: Meta rejects that (code 190) and the fix is a
// fresh short-lived token from the dashboard, not a retry.
if (argv.includes("--exchange-token")) {
  if (!appId || !appSecret) {
    console.error("--exchange-token needs the App ID and app secret (App settings > Basic):");
    console.error("  --app-id <id> --app-secret <32 hex>, or WHATSAPP_APP_ID / WHATSAPP_APP_SECRET in .env.local.");
    process.exit(2);
  }
  if (!accessToken) {
    console.error("--exchange-token needs a token to exchange: --token <the short-lived one>, or WHATSAPP_ACCESS_TOKEN.");
    process.exit(2);
  }

  const exchanged = await graph("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: accessToken,
  });
  if (exchanged.status !== 200 || !exchanged.json?.access_token) {
    check(
      "exchange the short-lived token for a long-lived one",
      false,
      describe(exchanged.json, `HTTP ${exchanged.status} ${exchanged.text.slice(0, 120)}`),
    );
    console.error("\nNothing was written. Generate a fresh short-lived token (API Setup, or the Graph");
    console.error("API Explorer with whatsapp_business_messaging) and run this again.");
    process.exit(1);
  }

  const days = Math.round((exchanged.json.expires_in ?? 0) / 86_400);
  const written = writeToken(exchanged.json.access_token);
  check(
    "exchange the short-lived token for a long-lived one",
    true,
    `was ${fingerprint(accessToken)}, now ${fingerprint(exchanged.json.access_token)}, ~${days} days`,
  );
  console.log(`      ${written.replaced ? "replaced" : "appended"} WHATSAPP_ACCESS_TOKEN in ${written.file} — restart the dev server to pick it up`);
  accessToken = exchanged.json.access_token;
  console.log("");
}

// The env file the service actually reads, in the order src/dev.ts reads it: the
// app's own .env.local first, then the repo root. Prefer whichever one already
// holds the key, so the token lands next to the other WHATSAPP_* values. Only the
// one line is rewritten — the rest of the file (other keys, comments) is untouched.
// The callbacks below are wrapped in an arrow instead of passed by reference on
// purpose: Array.map/find call back with (value, index, array), and path.resolve
// takes *every* argument as a path segment, so `.map(resolve)` hands it an index
// and an array and throws ERR_INVALID_ARG_TYPE before anything is written.
function writeToken(token) {
  const explicit = flag("env-file");
  const candidates = ["../../.env.local", ".env.local"].map((p) => resolve(p));
  const holds = (p) => existsSync(p) && /^\s*WHATSAPP_ACCESS_TOKEN\s*=/m.test(readFileSync(p, "utf8"));
  const target = explicit ? resolve(explicit) : candidates.find(holds) ?? candidates.find((p) => existsSync(p)) ?? candidates[0];
  const raw = existsSync(target) ? readFileSync(target, "utf8") : "";
  const key = /^(\s*)WHATSAPP_ACCESS_TOKEN\s*=(.*)$/m;
  const found = raw.match(key);
  // Keep whatever trailing comment the line carried: that is where the note about
  // it having to be a system user token lives.
  const note = found?.[2].includes("#") ? `  #${found[2].split("#").slice(1).join("#")}` : "";
  const next = found
    ? raw.replace(key, (_match, indent) => `${indent}WHATSAPP_ACCESS_TOKEN="${token}"${note}`)
    : `${raw.replace(/\s*$/, "")}${raw.trim() ? "\n" : ""}WHATSAPP_ACCESS_TOKEN="${token}"\n`;
  writeFileSync(target, next, "utf8");
  return { file: relative(process.cwd(), target) || target, replaced: !!found };
}

if (!accessToken || !phoneNumberId) {
  const missing = [!accessToken && "WHATSAPP_ACCESS_TOKEN", !phoneNumberId && "WHATSAPP_PHONE_NUMBER_ID"]
    .filter(Boolean)
    .join(" and ");
  console.error(`Missing ${missing} (env or flags).`);
  console.error("These come from the Meta dashboard: WhatsApp > API Setup (Generate access token,");
  console.error("and the ID shown next to the \"From\" picker). See .env.example.");
  process.exit(2);
}

console.log(`token            ${fingerprint(accessToken)}`);
console.log(`phone number id  ${phoneNumberId}`);
console.log(`app id           ${appId ?? "(not given, debug_token will be skipped)"}\n`);

// Shape first: catching a pasted phone number needs no network call at all. This
// is a heuristic, not the verdict — Meta phone number IDs run 15-17 digits while an
// E.164 number tops out at 15, so a 12-digit "849359386414" is the number, not its
// ID. The call below is what actually decides.
check(
  "WHATSAPP_PHONE_NUMBER_ID has the shape of an ID (15-17 digits), not a phone number",
  /^\d{15,17}$/.test(phoneNumberId),
  `${phoneNumberId} is ${phoneNumberId.length} digits` +
    (/^\d{15,17}$/.test(phoneNumberId) ? "" : " — copy the ID shown next to the \"From\" picker, not the number"),
);

// The webhook 500s without this, so a green run that skipped it would be a lie.
check(
  "WHATSAPP_APP_SECRET is a 32-character hex app secret",
  /^[0-9a-f]{32}$/i.test(appSecret ?? ""),
  appSecret ? `${appSecret.length} chars` : "not set — the inbound webhook 500s until it is",
);

// 1. Can the token see the number it is going to send from?
// The token has to be passed explicitly: without it Meta answers code 104 ("an
// access token is required"), which reads exactly like a broken credential and
// would fail this check no matter how good the token is.
const phone = await graph(phoneNumberId, {
  fields: "display_phone_number,verified_name,quality_rating",
  access_token: accessToken,
});
check(
  "token can read the sender phone number",
  phone.status === 200 && !!phone.json?.display_phone_number,
  phone.status === 200
    ? `${phone.json.display_phone_number} "${phone.json.verified_name}" quality ${phone.json.quality_rating ?? "n/a"}`
    : describe(phone.json, `HTTP ${phone.status} ${phone.text.slice(0, 120)}`),
);

// Registration first, and only when asked for by name: it is the one call here that
// changes the Meta account. It is also the failure that most looks like a credentials
// problem — Meta answers 400 #133010 "Account not registered" on every send while every
// credential above checks out. The PIN is the number's 6-digit two-step verification
// PIN (an existing one, or the one this call sets); Meta allows 10 attempts per number
// per 72h and then locks it with 133016, which is why this is not folded into the
// default run.
if (argv.includes("--register")) {
  const pin = flag("pin");
  if (!/^\d{6}$/.test(pin ?? "")) {
    console.error("--register needs the number's 6-digit two-step verification PIN: --pin 123456");
    process.exit(2);
  }
  const registered = await graphPost(`${phoneNumberId}/register`, { messaging_product: "whatsapp", pin });
  check(
    "register the number for Cloud API (--register)",
    registered.status === 200 && registered.json?.success === true,
    registered.status === 200 ? "success" : describe(registered.json, `HTTP ${registered.status} ${registered.text.slice(0, 120)}`),
  );
}

// Read the registration state back instead of assuming it: a registered number reports
// platform_type CLOUD_API and an unregistered one NOT_APPLICABLE. Asked for on its own
// so a Graph version that does not know the field cannot take the check above down
// with it.
if (/^\d{15,17}$/.test(phoneNumberId ?? "")) {
  const platform = await graph(phoneNumberId, { fields: "platform_type", access_token: accessToken });
  const type = platform.json?.platform_type;
  check(
    "the number is registered for Cloud API (platform_type CLOUD_API)",
    type === "CLOUD_API",
    platform.status !== 200
      ? describe(platform.json, `HTTP ${platform.status} ${platform.text.slice(0, 120)}`)
      : type === "CLOUD_API"
        ? "CLOUD_API"
        : `${type} — run --register --pin <6 digits>, then retry`,
  );
} else {
  skip("the number is registered for Cloud API", "no usable WHATSAPP_PHONE_NUMBER_ID to read it from");
}

// The two halves of this channel fail independently, and everything above is the
// outbound one: none of it says whether Meta can reach this server at all. A green run
// with a dead callback URL is the same class of lie as 8/8 with failed: 1 in the sim.
if (appId && appSecret) {
  const subs = await graph(`${appId}/subscriptions`, { access_token: `${appId}|${appSecret}` });
  const entry = (Array.isArray(subs.json?.data) ? subs.json.data : []).find(
    (s) => s?.object === "whatsapp_business_account",
  );
  // v21 answers with fields as [{ name, version }]; older responses used bare strings.
  const fields = (entry?.fields ?? []).map((f) => (typeof f === "string" ? f : f?.name));
  check(
    "the app has a whatsapp_business_account webhook subscription",
    subs.status === 200 && !!entry && fields.includes("messages"),
    subs.status !== 200
      ? describe(subs.json, `HTTP ${subs.status} ${subs.text.slice(0, 120)}`)
      : entry
        ? `${entry.callback_url ?? "no callback URL"} fields ${fields.join(", ") || "none"}` +
          (fields.includes("messages") ? "" : " — subscribe the messages field, or Meta sends nothing")
        : "nothing configured: paste the callback URL and verify token in Webhooks, with" +
          " client credentials attached, because this server answers 401 without the signature",
  );
} else {
  skip(
    "the app has a whatsapp_business_account webhook subscription",
    "pass --app-id and --app-secret (App settings > Basic) to read it",
  );
}

// The other half, and not the same thing: an app can hold the webhook config above and
// still not be subscribed to the account whose events are wanted. Nothing in src/ reads a
// WABA id, so this stays opt-in by flag rather than adding a key that only this check
// would want.
const wabaId = flag("waba-id");
if (/^\d{15,17}$/.test(wabaId ?? "")) {
  const apps = await graph(`${wabaId}/subscribed_apps`, { access_token: accessToken });
  const ids = (Array.isArray(apps.json?.data) ? apps.json.data : []).map(
    (a) => a?.whatsapp_business_api_data?.id ?? a?.id,
  );
  check(
    `the app is subscribed to WABA ${wabaId} (inbound messages reach this server)`,
    apps.status === 200 && ids.includes(appId),
    apps.status !== 200
      ? describe(apps.json, `HTTP ${apps.status} ${apps.text.slice(0, 120)}`)
      : ids.includes(appId)
        ? `${ids.length} app(s) subscribed, including ${appId}`
        : `${ids.join(", ") || "no apps"} — POST /${wabaId}/subscribed_apps with an app token`,
  );
} else {
  skip(
    "the app is subscribed to the WABA",
    "pass --waba-id <id> (WhatsApp > API Setup shows it) to read the subscription list",
  );
}

// 2. Who is this token, and when does it die? debug_token against an app access
//    token is the only way to read expiry and asset scoping instead of waiting for
//    the first send to fail.
if (appId && appSecret) {
  const debug = await graph("debug_token", { input_token: accessToken, access_token: `${appId}|${appSecret}` });
  if (debug.status !== 200 || !debug.json?.data) {
    check("debug_token reports the token", false, describe(debug.json, `HTTP ${debug.status} ${debug.text.slice(0, 120)}`));
  } else {
    const data = debug.json.data;
    const expiresAt = data.expires_at;
    const never = expiresAt === 0;
    check(
      "token never expires (system user token)",
      never,
      never
        ? `expires_at=0, type ${data.type}`
        : `expires_at=${expiresAt ?? "missing"}${expiresAt ? ` -> ${new Date(expiresAt * 1000).toISOString()}` : ""}` +
          (data.type === "USER" && expiresAt
            ? " — a long-lived user token still sends, it just has to be refreshed before that date"
            : ""),
    );

    const scopes = data.scopes ?? [];
    check(
      "token carries whatsapp_business_messaging",
      scopes.includes("whatsapp_business_messaging"),
      `scopes: ${scopes.join(", ") || "none"}`,
    );

    const targets = (data.granular_scopes ?? [])
      .filter((s) => (s.scope ?? "").includes("whatsapp"))
      .flatMap((s) => s.target_ids ?? []);
    check(
      "token is scoped to a WhatsApp account (asset assigned to the system user)",
      targets.length > 0,
      targets.length
        ? `whatsapp targets: ${targets.join(", ")}`
        : "no whatsapp target ids — assign the WhatsApp account to the system user, then regenerate the token",
    );
  }
} else {
  skip("token expiry, scopes and asset scoping", "pass --app-id and --app-secret (App settings > Basic) to enable debug_token");
}

const failed = checks.filter((ok) => !ok).length;
console.log("");
if (failed === 0) {
  console.log("All green: replies will leave the building.");
  console.log("Inbound is a separate half: Webhooks needs the callback URL + verify token, with client");
  console.log("credentials attached (this server answers 401 without the signature), and the app has");
  console.log("to be subscribed to the WABA — --waba-id reads that back.");
} else {
  console.log(`${failed} problem(s) above — fix them before testing; each failure carries its own hint.`);
}
console.log(`${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
