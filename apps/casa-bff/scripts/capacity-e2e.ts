/**
 * Hand-run check of the room-capacity chain against a real or simulated engine.
 *
 *   npx tsx apps/casa-bff/scripts/capacity-e2e.ts sim
 *   npx tsx apps/casa-bff/scripts/capacity-e2e.ts remote        # needs ESTIMATOR_BASE_URL (from .env.prod.local)
 *
 * The app runs in-process with the in-memory quotation store, so nothing is written to our KV / studio
 * queue. In `remote` mode the only thing touched is the customer's fixture engine (RAM, no Odoo, no
 * money). The record is named "TEST capacity 3pax" and archived at the end.
 *
 * Chain: Save & get price (POST) -> edit dates -> Save & get price again (PATCH) -> Approve ->
 * Create link (commit + share) -> archive. Then the negative path: an over-full room sent straight to
 * the engine's PATCH, which is what a stale stored trip used to do.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const mode = process.argv[2] === "remote" ? "remote" : "sim";
if (mode === "remote") {
  // Only the two estimator settings — never the KV/Redis ones, so the store stays in memory.
  const raw = readFileSync(new URL("../../../.env.prod.local", import.meta.url), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = /^(ESTIMATOR_BASE_URL)=(.*)$/.exec(line);
    if (m) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
  }
  process.env.ESTIMATOR_MODE = "remote";
} else {
  process.env.ESTIMATOR_MODE = "simulated";
}
const TOKEN = "local-e2e-token";
process.env.WHATSAPP_VERIFY_TOKEN = TOKEN;
process.env.STAFF_ACCESS_KEY = TOKEN;
for (const k of ["REDIS_URL", "KV_URL", "KV_REST_API_URL", "KV_REST_API_TOKEN"]) delete process.env[k];

const { createApp } = await import("../src/app.js");
const { getQuotationByIdOrSlug, saveQuotationDraft } = await import("../src/stores/quotationStore.js");
const { createEstimatorPortFromEnv } = await import("../src/services/estimatorPort.js");
const { buildHonoQuotationDraft } = await import("../../../packages/extractor/src/application/quotationTool.js");

const f = (value: unknown, state = "stated") => ({ value, state, evidence: null });
function trip(rooms?: number) {
  return {
    language: f("en", "default"), contactName: f("TEST capacity 3pax"),
    checkIn: f("2026-11-20"), checkOut: f("2026-11-22"), nights: f(2), guests: f(3),
    rooms: rooms ? f(rooms) : f(1, "default"), meals: f("full_board"), transport: f(false),
    guestType: f("retail", "default"), transportType: f("none"), diver: f(false),
    divers: f(null, "missing"), diveFrom: f(null, "missing"), diveTo: f(null, "missing"),
    diveNotes: f(null, "missing"), specialRequests: f(null, "missing"), guestNames: f([]),
  } as never;
}

const app = createApp();
const auth = { "x-verify-token": TOKEN, "content-type": "application/json" };
async function call(step: string, method: string, path: string, body?: unknown) {
  const res = await app.request(path, { method, headers: auth, body: body ? JSON.stringify(body) : undefined });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const summary = json.ok === false || res.status >= 400
    ? `reason=${String(json.reason ?? json.error)} detail=${String(json.detail ?? "")} code=${String(json.code ?? "")} fields=${JSON.stringify(json.fields ?? [])}`
    : "ok";
  console.log(`${res.status} ${step.padEnd(26)} ${summary}`);
  return { status: res.status, json };
}

console.log(`engine: ${mode}\n-- happy path: 3 guests, standard, room count not stated`);
const draft = await saveQuotationDraft(buildHonoQuotationDraft(trip(), undefined, undefined, "639000000001"));
const id = draft.quoteId;
console.log(`rooms in stored trip: ${draft.bffTrip!.rooms.map((r) => r.id).join(",")}  guests -> ${draft.bffTrip!.guests.map((g) => g.roomId).join(",")}`);

let failed = 0;
const expect = (ok: boolean, what: string) => { if (!ok) { failed += 1; console.log(`   !! expected: ${what}`); } };

expect((await call("Save & get price (POST)", "POST", `/v1/quotes/${id}/sync-estimate`)).status < 300, "POST ok");

const stored = (await getQuotationByIdOrSlug(id))!;
const shift = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const edited = { ...stored.bffTrip!, checkIn: shift(stored.bffTrip!.checkIn!), checkOut: shift(stored.bffTrip!.checkOut!) };
expect((await call("edit dates + Save (PATCH)", "POST", `/v1/quotes/${id}/trip`, { trip: edited })).status < 300, "PATCH ok, no 422");
expect((await call("Approve", "POST", `/v1/quotes/${id}/confirm`, {})).status < 300, "approve ok");
expect((await call("Create link (commit+share)", "POST", `/v1/quotes/${id}/publish`, { acknowledgeSample: true })).status < 300, "publish ok");
await call("archive", "POST", `/v1/quotes/${id}/cancel`, {});

console.log("\n-- negative path A: guest said '1 room' for 3 people (stated)");
const bad = await saveQuotationDraft(buildHonoQuotationDraft(trip(1), undefined, undefined, "639000000002"));
const pre = await call("Save & get price", "POST", `/v1/quotes/${bad.quoteId}/sync-estimate`);
console.log(`   precheck says: ${JSON.stringify((pre.json as { estimatePreview?: { validationIssues?: unknown } }).estimatePreview?.validationIssues)}`);
await call("archive", "POST", `/v1/quotes/${bad.quoteId}/cancel`, {});

console.log("\n-- negative path B: over-full room straight to the engine's PATCH (a stale stored trip)");
const port = createEstimatorPortFromEnv(process.env);
const good = buildHonoQuotationDraft(trip(), undefined, undefined, "639000000003").bffTrip!;
const first = await port.sendEstimate(good);
if (!first.ok) throw new Error(`setup POST failed: ${first.detail}`);
const overfull = { ...good, rooms: [good.rooms[0]!], guests: good.guests.map((g) => ({ ...g, roomId: good.rooms[0]!.id })) };
const patched = await port.updateEstimate({ id: first.id, cookie: first.sessionCookie }, overfull);
console.log(patched.ok ? "PATCH accepted (engine has no capacity rule)" : `PATCH ${patched.status} ${patched.reason}: ${patched.detail}  code=${patched.code ?? "-"}`);
expect(!patched.ok && patched.reason === "rejected", "engine refuses the over-full PATCH with 422");

console.log(failed === 0 ? "\nALL EXPECTATIONS MET" : `\n${failed} EXPECTATION(S) FAILED`);
void randomUUID;
process.exit(failed === 0 ? 0 : 1);
