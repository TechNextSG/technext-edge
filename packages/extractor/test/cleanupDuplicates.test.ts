// The one route in this product that deletes a business record, so what it may delete is pinned
// here rather than left to a careful reading of the code at the moment somebody needs it.
//
// The backlog it clears is real: before `findOpenQuotationForPhone`, every message in a WhatsApp
// thread that had enough information minted a NEW quotation for the same phone. One manual test
// left thirteen (`QT-1120-MIGU-*`, four inside the same minute), and every row in the studio looked
// current.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../../../apps/casa-bff/src/app.js";
import { duplicateQuotationIds, saveQuotationDraft } from "../../../apps/casa-bff/src/quotationStore.js";
import { buildHonoQuotationDraft } from "../../../packages/extractor/src/quotationTool.js";
import { buildBffTrip } from "../../../packages/extractor/src/odooHandoff.js";
import type { HonoQuotationDraft } from "../../../packages/extractor/src/index.js";
import type { Trip } from "../../../packages/extractor/src/schema.js";

const VERIFY_TOKEN = "cleanup-token";

function trip(): Trip {
  const f = <T,>(value: T | null, state = "stated") => ({ value, state, evidence: null });
  return {
    language: f("en", "default"),
    contactName: f("Thirteen Times"),
    checkIn: f("2026-11-20"),
    checkOut: f("2026-11-22"),
    nights: f(2),
    guests: f(2),
    rooms: f(1),
    roomType: f("standard"),
    meals: f("full_board"),
    transport: f(false),
    guestType: f("retail", "default"),
    transportType: f("none"),
    diver: f(false),
    diveNotes: f(null, "missing"),
    specialRequests: f(null, "missing"),
    guestNames: f([]),
  } as Trip;
}

/** A stored quotation for one phone, at a given minute — the shape the bug left behind. */
async function stored(id: string, phone: string, updatedAt: string, extra: Partial<HonoQuotationDraft> = {}) {
  const draft = buildHonoQuotationDraft(trip(), "https://example.test", id);
  return saveQuotationDraft({
    ...draft,
    phone,
    updatedAt,
    bffTrip: buildBffTrip(trip()),
    estimator: { id: `sim-${id}`, cookie: `ubg_sid=sim-${id}`, seq: null, guestUrl: null, sharedAt: null },
    ...extra,
  });
}

function cleanup(app: ReturnType<typeof createApp>, body: unknown, token = VERIFY_TOKEN) {
  return app.request(`/v1/quotes/cleanup-duplicates?token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", VERIFY_TOKEN);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("cleaning up duplicate quotations", () => {
  it("needs a session — this deletes business records", async () => {
    const app = createApp();
    expect((await cleanup(app, { confirm: true }, "wrong-token")).status).toBe(401);
  });

  it("keeps the newest record per phone, and anything published, corrected or seeded", async () => {
    const all = [
      // Three records for one guest, newest last. Only the newest may survive.
      { quoteId: "A", phone: "639170000001", updatedAt: "2026-09-27T01:51:00Z" },
      { quoteId: "B", phone: "639170000001", updatedAt: "2026-09-27T01:52:00Z" },
      { quoteId: "C", phone: "639170000001", updatedAt: "2026-09-27T01:53:00Z" },
      // An older record a guest already holds a link to: never removed.
      { quoteId: "D", phone: "639170000002", updatedAt: "2026-09-27T01:00:00Z", estimator: { sharedAt: "2026-09-27T01:01:00Z" } },
      { quoteId: "E", phone: "639170000002", updatedAt: "2026-09-27T02:00:00Z" },
      // An older record staff corrected: somebody's work is in it, so it stays.
      { quoteId: "F", phone: "639170000003", updatedAt: "2026-09-27T01:00:00Z", staffEdits: [{ at: "x", fields: ["rooms[0].type"] }] },
      { quoteId: "G", phone: "639170000003", updatedAt: "2026-09-27T02:00:00Z" },
      // The seeded fixture, and a record with no phone (not a duplicate of anything).
      { quoteId: "QT-1010-SKY", phone: "639000000000", updatedAt: "2026-01-01T00:00:00Z", seedVersion: 2 },
      { quoteId: "H", updatedAt: "2026-01-01T00:00:00Z" },
    ] as unknown as HonoQuotationDraft[];

    expect(duplicateQuotationIds(all).map((q) => q.quoteId)).toEqual(["A", "B"]);
  });

  it("is a dry run by default, then removes exactly what it listed", async () => {
    // `saveQuotationDraft` stamps `updatedAt` itself (`recalculateQuotationTotals`), so the clock is
    // what decides which record is newest — the fake timer is the honest way to write three saves a
    // minute apart rather than hand-patching timestamps the real path would overwrite.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-27T01:51:00Z"));
      await stored("QT-DUP-1", "639170000009", "ignored");
      vi.setSystemTime(new Date("2026-09-27T01:52:00Z"));
      await stored("QT-DUP-2", "639170000009", "ignored");
      vi.setSystemTime(new Date("2026-09-27T01:53:00Z"));
      await stored("QT-DUP-3", "639170000009", "ignored");
    } finally {
      vi.useRealTimers();
    }
    const app = createApp();

    const preview = await (await cleanup(app, {})).json();
    expect(preview.dryRun).toBe(true);
    expect(preview.wouldRemove.map((q: { quoteId: string }) => q.quoteId).sort()).toEqual(["QT-DUP-1", "QT-DUP-2"]);
    // Nothing actually gone: a dry run that deletes is not a dry run.
    const stillThere = await (await app.request(`/v1/quotes/QT-DUP-1?token=${VERIFY_TOKEN}`)).json();
    expect(stillThere.quotation.quoteId).toBe("QT-DUP-1");

    const applied = await (await cleanup(app, { confirm: true })).json();
    expect(applied.dryRun).toBe(false);
    expect(applied.removed.sort()).toEqual(["QT-DUP-1", "QT-DUP-2"]);

    const gone = await app.request(`/v1/quotes/QT-DUP-1?token=${VERIFY_TOKEN}`);
    expect(gone.status).toBe(404);
    // ...and the newest one is untouched, which is the whole point of the rule.
    const kept = await (await app.request(`/v1/quotes/QT-DUP-3?token=${VERIFY_TOKEN}`)).json();
    expect(kept.quotation.quoteId).toBe("QT-DUP-3");
  });

  it("refuses to touch a published quotation, link and all", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-27T01:00:00Z"));
      const published = await stored("QT-DUP-PUB", "639170000010", "ignored", {
        estimator: { id: "sim-pub", cookie: "ubg_sid=sim-pub", seq: 1, guestUrl: "https://their.app/quote/tok", sharedAt: "2026-09-27T01:05:00Z" },
      });
      vi.setSystemTime(new Date("2026-09-27T02:00:00Z"));
      await stored("QT-DUP-PUB-2", "639170000010", "ignored");
      const app = createApp();

      const preview = await (await cleanup(app, {})).json();
      expect(preview.wouldRemove.map((q: { quoteId: string }) => q.quoteId)).not.toContain(published.quoteId);

      await cleanup(app, { confirm: true });
      const stillThere = await app.request(`/v1/quotes/${published.quoteId}?token=${VERIFY_TOKEN}`);
      expect(stillThere.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes the records it was named, and still refuses the protected ones", async () => {
    // Leftovers that are not duplicates of anything: probes, and drafts a manual test leaves for a
    // phone nobody will text from again. Naming them explicitly is the more dangerous form of the
    // one route that deletes business records, so the three protections have to hold here too.
    await stored("QT-LEFT-PLAIN", "639170000021", "2026-09-27T03:00:00Z");
    await stored("QT-LEFT-PUBLISHED", "639170000022", "2026-09-27T03:01:00Z", {
      estimator: { id: "sim-pub2", cookie: "ubg_sid=sim-pub2", seq: 1, guestUrl: "https://their.app/quote/tok2", sharedAt: "2026-09-27T03:02:00Z" },
    });
    await stored("QT-LEFT-CORRECTED", "639170000023", "2026-09-27T03:03:00Z", {
      staffEdits: [{ at: "2026-09-27T03:04:00Z", fields: ["rooms[0].type"] }],
    });
    const app = createApp();
    const ids = ["QT-LEFT-PLAIN", "QT-LEFT-PUBLISHED", "QT-LEFT-CORRECTED", "QT-LEFT-MISSING"];

    const preview = await (await cleanup(app, { ids })).json();
    expect(preview.dryRun).toBe(true);
    expect(preview.wouldRemove.map((q: { quoteId: string }) => q.quoteId)).toEqual(["QT-LEFT-PLAIN"]);
    expect(preview.refused.sort()).toEqual(["QT-LEFT-CORRECTED", "QT-LEFT-PUBLISHED"]);
    expect(preview.notFound).toEqual(["QT-LEFT-MISSING"]);
    // A dry run that deletes is not a dry run.
    expect((await app.request(`/v1/quotes/QT-LEFT-PLAIN?token=${VERIFY_TOKEN}`)).status).toBe(200);

    const applied = await (await cleanup(app, { ids, confirm: true })).json();
    expect(applied.removed).toEqual(["QT-LEFT-PLAIN"]);
    expect(applied.refused.sort()).toEqual(["QT-LEFT-CORRECTED", "QT-LEFT-PUBLISHED"]);
    expect((await app.request(`/v1/quotes/QT-LEFT-PLAIN?token=${VERIFY_TOKEN}`)).status).toBe(404);
    // The published link and the corrected record are exactly what the rule exists to keep.
    expect((await app.request(`/v1/quotes/QT-LEFT-PUBLISHED?token=${VERIFY_TOKEN}`)).status).toBe(200);
    const corrected = await (await app.request(`/v1/quotes/QT-LEFT-CORRECTED?token=${VERIFY_TOKEN}`)).json();
    expect(corrected.quotation.staffEdits).toHaveLength(1);
  });

  it("refuses the seeded fixture even when it is named explicitly", async () => {
    const app = createApp();
    const before = await (await app.request(`/v1/quotes?token=${VERIFY_TOKEN}`)).json();
    const seed = before.quotations.find((q: { seedVersion?: number }) => q.seedVersion !== undefined);
    expect(seed, "the fixture seeds itself on first read").toBeTruthy();

    const applied = await (await cleanup(app, { ids: [seed.quoteId], confirm: true })).json();
    expect(applied.removed).toEqual([]);
    expect(applied.refused).toContain(seed.quoteId);
    expect((await app.request(`/v1/quotes/${seed.quoteId}?token=${VERIFY_TOKEN}`)).status).toBe(200);
  });

  it("cancelling a quotation archives it and serves a polite 410 on its guest link", async () => {    const draft = await stored("QT-CANCEL-1", "639170000099", "2026-09-28T04:00:00Z");
    const app = createApp();

    // Cancel requires staff session
    const unauth = await app.request(`/v1/quotes/${draft.quoteId}/cancel`, { method: "POST" });
    expect(unauth.status).toBe(401);

    // Cancel successfully
    const res = await app.request(`/v1/quotes/${draft.quoteId}/cancel?token=${VERIFY_TOKEN}`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.quotation.status).toBe("cancelled");

    // Guest link serves cancelled notice
    const guestHtml = await (await app.request(`/q/${draft.slug}`, { headers: { accept: "text/html" } })).text();
    expect(guestHtml).toContain("Quotation Cancelled");
    expect(guestHtml).toContain("expired or was cancelled");

    // Studio shows cancelled banner and badge
    const studioHtml = await (await app.request(`/quotes/${draft.quoteId}?token=${VERIFY_TOKEN}`)).text();
    expect(studioHtml).toContain("This quotation has been CANCELLED / ARCHIVED");
    expect(studioHtml).toContain("Cancelled / Archived");
  });
});

