// The staff editor page, byte for byte. It is one 2,600-line template whose output is the whole product for
// staff, so a refactor of how it is built (model / markup / styles / client) must change none of it: every
// state a quotation can be in is rendered here and compared with the file written before the split.
//
// To update on purpose: `npx vitest run test/views/editorSnapshot -u`, then read the diff of bff/test/views/__snapshots__/editor/.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHonoQuotationEditorHtml } from "../../src/views/quotationEditorPage.ts";
import { sampleQuotation } from "../helpers/sampleQuotation.ts";
import type { HonoQuotationDraft } from "../../src/quote/index.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: false });
  vi.setSystemTime(new Date("2026-09-30T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const FIXED = { createdAt: "2026-09-29T01:00:00.000Z", updatedAt: "2026-09-29T02:00:00.000Z" };

function base(over: Partial<HonoQuotationDraft> = {}): HonoQuotationDraft {
  const draft = sampleQuotation();
  const slug = "00000000-0000-4000-8000-000000000001";
  return { ...draft, slug, quotationUrl: `https://studio.example/q/${slug}`, ...FIXED, ...over };
}
const engine = { id: "scn-1", cookie: "ubg_sid=1", seq: 1, guestUrl: null, sharedAt: null } as const;
const published = {
  ...engine,
  guestUrl: "https://team.example/quote/tok-1",
  mirrorUrl: null,
  sharedAt: "2026-09-29T03:00:00.000Z",
} as unknown as NonNullable<HonoQuotationDraft["estimator"]>;

type Case = { draft: HonoQuotationDraft; role?: "staff" | "admin"; kind?: "simulated" | "remote" };

/** Built inside each test, under the frozen clock: a record made at import time would carry the real time. */
const makeCases = (): Record<string, Case> => ({
  "sample-unpriced-by-engine": { draft: base() },
  "no-trip-yet": { draft: base({ bffTrip: undefined, pricing: undefined }) },
  "engine-priced": { draft: base({ quoteId: "QT-A", estimator: engine as never }) },
  "approved": { draft: base({ quoteId: "QT-B", estimator: engine as never, status: "confirmed_by_hono", confirmedAt: "2026-09-29T02:30:00.000Z" }) },
  "published-not-sent": { draft: base({ quoteId: "QT-C", estimator: published, status: "confirmed_by_hono" }) },
  "sent-quiet": { draft: base({ quoteId: "QT-D", estimator: published, status: "confirmed_by_hono", sentToGuestAt: "2026-09-30T00:00:00.000Z" }) },
  "sent-nudge": { draft: base({ quoteId: "QT-E", estimator: published, status: "confirmed_by_hono", sentToGuestAt: "2026-09-27T20:00:00.000Z" }) },
  "sent-stale": { draft: base({ quoteId: "QT-F", estimator: published, status: "confirmed_by_hono", sentToGuestAt: "2026-09-20T00:00:00.000Z" }) },
  "archived": { draft: base({ quoteId: "QT-G", status: "cancelled" }) },
  "remote-engine": { draft: base({ quoteId: "QT-H", estimator: engine as never }), kind: "remote" },
  "admin-role": { draft: base({ quoteId: "QT-I", estimator: engine as never }), role: "admin" },
  "hostile-guest-name": {
    draft: base({ quoteId: "QT-J", guestName: `<script>alert("x")</script> \`${"${"}1}\` O'Neil & Sons` }),
  },
});

const others = (): HonoQuotationDraft[] => [
  base({ quoteId: "QT-OTHER-1", guestName: "Other One", updatedAt: "2026-09-28T02:00:00.000Z", slug: "00000000-0000-4000-8000-000000000002" }),
  base({ quoteId: "QT-OTHER-2", guestName: "Other Two", status: "cancelled", updatedAt: "2026-09-27T02:00:00.000Z", slug: "00000000-0000-4000-8000-000000000003" }),
];

describe("the staff editor renders exactly what it rendered before", () => {
  for (const name of Object.keys(makeCases())) {
    it(name, async () => {
      const c = makeCases()[name]!;
      const html = renderHonoQuotationEditorHtml(c.draft, [c.draft, ...others()], c.role ?? "staff", c.kind ?? "simulated");
      await expect(html).toMatchFileSnapshot(`./__snapshots__/editor/${name}.html`);
    });
  }

  it("is deterministic: the same record renders to the same bytes twice", () => {
    const { draft } = makeCases()["sent-nudge"]!;
    const once = renderHonoQuotationEditorHtml(draft, [draft, ...others()]);
    expect(renderHonoQuotationEditorHtml(draft, [draft, ...others()])).toBe(once);
  });
});
