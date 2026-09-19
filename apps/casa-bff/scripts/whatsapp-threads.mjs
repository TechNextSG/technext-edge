#!/usr/bin/env node
// What a person has to answer — and how to hand a thread back to the bot.
//
// The webhook parks a thread in three cases: a turn failed (the guest got a static
// apology), the guest asked for a human, or asking stopped being progress. While a
// thread is parked the bot makes no model call at all, which is the point — and it
// also means a parked thread is nobody's until a human looks. This is that look.
//
// It is equally the escape hatch during a test session: without --resume, a guest
// parked by one provider hiccup stays parked for the rest of the 24h window.
//
//   npm run whatsapp:threads --workspace apps/casa-bff
//   npm run whatsapp:threads --workspace apps/casa-bff -- --resume 84359386414
//   npm run whatsapp:threads --workspace apps/casa-bff -- --url https://technext-edge-casa-bff.vercel.app
//
// Flags: --url --verify-token --resume <phone> --json
// Env:   WHATSAPP_VERIFY_TOKEN, PORT (flags win)
try { process.loadEnvFile(".env.local"); } catch {}
try { process.loadEnvFile("../../.env.local"); } catch {}

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const base = flag("url", `http://localhost:${process.env.PORT ?? "8787"}`);
// The same token Meta echoes back on the subscription handshake, so there is no
// second secret to keep anywhere: see the guard in src/app.ts.
const token = flag("verify-token", process.env.WHATSAPP_VERIFY_TOKEN);
const resume = flag("resume");
const asJson = argv.includes("--json");

if (!token) {
  console.error("Missing WHATSAPP_VERIFY_TOKEN (env or --verify-token).");
  console.error("It is the same string that is in the Meta app's webhook config and in .env.local.");
  process.exit(2);
}

const headers = { "x-verify-token": token };

// Every reason the channel parks a thread, with what it means for whoever is
// reading this list. A reason nobody can act on is worse than no list at all.
const REASONS = {
  turn_failed: "the model call failed — the guest was sent the apology, and never got an answer",
  guest_asked_for_human: "the guest asked for a person — answer them in WhatsApp",
  asking_limit: "the bot asked as often as it may and the enquiry is still incomplete — finish it by hand",
};

function age(ms) {
  const minutes = Math.floor((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}

async function call(path, init = {}) {
  let res;
  try {
    res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  } catch (err) {
    console.error(`Cannot reach ${base}${path}: ${err.message}`);
    console.error("Is the server running? Locally: npm run dev:bff — in production, check the URL.");
    process.exit(2);
  }
  if (res.status === 401) {
    console.error(`401 from ${base} — the x-verify-token header did not match WHATSAPP_VERIFY_TOKEN`);
    console.error("on that deployment. Local runs fall back to the .env.local token.");
    process.exit(1);
  }
  return res;
}

if (resume) {
  const res = await call(`/v1/channels/whatsapp/threads/${resume}/resume`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Resume refused: HTTP ${res.status} ${JSON.stringify(body)}`);
    process.exit(1);
  }
  console.log(`${resume} is the bot's thread again (${JSON.stringify(body)}).`);
  console.log("The next message from that number is answered by the model, not by the holding reply.");
  process.exit(0);
}

const res = await call("/v1/channels/whatsapp/threads");
const body = await res.json().catch(() => null);
if (!res.ok || !body) {
  console.error(`Could not read the handoff list: HTTP ${res.status}`);
  process.exit(1);
}

const paused = Array.isArray(body.paused) ? body.paused : [];
if (asJson) {
  console.log(JSON.stringify(paused, null, 2));
  process.exit(0);
}

if (paused.length === 0) {
  console.log("No thread is waiting on a person: every enquiry is still the bot's.");
  console.log("(A parked thread shows up here until someone resumes it, or until its 24h record expires.)");
  process.exit(0);
}

console.log(`${paused.length} thread(s) waiting for a person, oldest first:\n`);
for (const thread of paused) {
  console.log(`${thread.phone}`);
  console.log(`  waiting since : ${age(thread.since)}${thread.toldAt ? ` · guest last told ${age(thread.toldAt)}` : " · guest never told"}`);
  console.log(`  why           : ${thread.reason} — ${REASONS[thread.reason] ?? "unknown reason"}`);
  console.log(`  hand back     : npm run whatsapp:threads --workspace apps/casa-bff -- --resume ${thread.phone}\n`);
}
console.log("Nothing here is a substitute for answering the guest in WhatsApp: the bot already");
console.log("told them a person is coming, and only a person can confirm availability or a price.");
