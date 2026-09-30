// One behavioural spec, run against EVERY QuotationStore adapter.
//
// This exists because the previous store was two module-level `Map`s, so there was nothing to
// contract-test: a guest link returned 200 before a redeploy and 404 after it, which is how the
// persistence gap surfaced. Now that the store is an interface with an in-memory and a Redis REST
// implementation, the two must provably agree — a divergence here is a guest link that works in
// local dev and dies in production.
//
// The fake KV is strict on purpose: an unknown command throws, so a new Redis command in
// quotationStoreClient.ts cannot pass unnoticed (the same discipline as conversationStore's
// contract test).
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createInMemoryQuotationStore,
  createRedisQuotationStore,
  type QuotationStore,
} from "../src/stores/quotationStoreClient.js";
import type { HonoQuotationDraft } from "../../quotation/src/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** A complete-enough draft for the store, which treats it as opaque JSON. */
function makeDraft(overrides: Partial<HonoQuotationDraft> = {}): HonoQuotationDraft {
  return {
    quoteId: "QT-0001-TEST",
    slug: "11111111-1111-4111-8111-111111111111",
    status: "pending_hono_review",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    guestName: "Test Guest",
    checkIn: "2026-10-10",
    checkOut: "2026-10-12",
    nights: 2,
    stayingGuests: 2,
    totalGroupSize: 2,
    rooms: 1,
    mealPlan: "full_board",
    diver: false,
    divers: null,
    diveNotes: null,
    guestType: null,
    currency: "PHP",
    discountPercent: 0,
    lineItems: [],
    subtotalAmount: 0,
    discountAmount: 0,
    totalAmount: 0,
    quotationUrl: "https://example/q/11111111-1111-4111-8111-111111111111",
    honoEditorUrl: "https://example/quotes/QT-0001-TEST",
    staffNotes: "",
    staffAlerts: [],
    ...overrides,
  };
}

function makeFakeKv() {
  const strings = new Map<string, string>();
  const sets = new Map<string, Set<string>>();

  const handlers: Record<string, (args: (string | number)[]) => unknown> = {
    GET: (a) => strings.get(String(a[1])) ?? null,
    // The list reads every record in one round trip (see `list()` in quotationStoreClient.ts), so the
    // fake speaks MGET as well as GET: the point of the fake is to be the protocol, and a command it
    // refuses is a command the real store would have received.
    MGET: (a) => a.slice(1).map((key) => strings.get(String(key)) ?? null),
    SET: (a) => {
      strings.set(String(a[1]), String(a[2]));
      return "OK";
    },
    SADD: (a) => {
      const key = String(a[1]);
      const s = sets.get(key) ?? new Set<string>();
      s.add(String(a[2]));
      sets.set(key, s);
      return 1;
    },
    SMEMBERS: (a) => [...(sets.get(String(a[1])) ?? new Set<string>())],
  };

  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const args = JSON.parse(init.body) as (string | number)[];
    const cmd = String(args[0]).toUpperCase();
    const handler = handlers[cmd];
    if (!handler) throw new Error(`fake KV received an unhandled command: ${cmd}`);
    return { ok: true, json: async () => ({ result: handler(args) }) };
  });

  return { fetchMock, strings, sets };
}

type MakeStore = () => { store: QuotationStore; kv: ReturnType<typeof makeFakeKv> };

const ADAPTERS: Array<{ name: string; make: MakeStore }> = [
  {
    name: "in-memory",
    make: () => {
      const kv = makeFakeKv();
      vi.stubGlobal("fetch", kv.fetchMock);
      return { store: createInMemoryQuotationStore(), kv };
    },
  },
  {
    name: "redis-rest",
    make: () => {
      const kv = makeFakeKv();
      vi.stubGlobal("fetch", kv.fetchMock);
      return { store: createRedisQuotationStore({ url: "https://fake.upstash.io", token: "t" }), kv };
    },
  },
];

for (const adapter of ADAPTERS) {
  describe(`QuotationStore contract — ${adapter.name}`, () => {
    it("returns undefined for an id or slug it has never seen", async () => {
      const { store } = adapter.make();
      expect(await store.get("QT-NOPE")).toBeUndefined();
      expect(await store.get("99999999-9999-4999-8999-999999999999")).toBeUndefined();
    });

    it("round-trips a draft by id and by slug, and the slug is case-insensitive", async () => {
      const { store } = adapter.make();
      const draft = makeDraft();
      await store.save(draft);

      expect(await store.get(draft.quoteId)).toEqual(draft);
      expect(await store.get(draft.slug)).toEqual(draft);
      expect(await store.get(draft.slug.toUpperCase())).toEqual(draft);
    });

    it("keeps two quotations apart by id and by slug", async () => {
      const { store } = adapter.make();
      const a = makeDraft();
      const b = makeDraft({
        quoteId: "QT-0002-TEST",
        slug: "22222222-2222-4222-8222-222222222222",
        guestName: "Other Guest",
      });
      await store.save(a);
      await store.save(b);

      expect((await store.get(a.slug))!.quoteId).toBe(a.quoteId);
      expect((await store.get(b.slug))!.quoteId).toBe(b.quoteId);
      expect((await store.get(b.quoteId))!.guestName).toBe("Other Guest");
    });

    it("lists everything saved, newest updatedAt first", async () => {
      const { store } = adapter.make();
      const older = makeDraft();
      const newer = makeDraft({
        quoteId: "QT-0003-TEST",
        slug: "33333333-3333-4333-8333-333333333333",
        updatedAt: "2026-10-05T00:00:00.000Z",
      });
      await store.save(older);
      await store.save(newer);

      const all = await store.list();
      expect(all.map((d) => d.quoteId)).toEqual([newer.quoteId, older.quoteId]);
    });

    it("overwrites on re-save rather than duplicating", async () => {
      const { store } = adapter.make();
      const draft = makeDraft();
      await store.save(draft);
      await store.save({ ...draft, totalAmount: 123456 });

      const all = await store.list();
      expect(all).toHaveLength(1);
      expect((await store.get(draft.quoteId))!.totalAmount).toBe(123456);
    });
  });
}

describe("createRedisQuotationStore speaks the Upstash REST protocol", () => {
  it("writes quote:<id>, quote_slug:<lower> and adds to quotes:all", async () => {
    const kv = makeFakeKv();
    vi.stubGlobal("fetch", kv.fetchMock);
    const store = createRedisQuotationStore({ url: "https://fake.upstash.io", token: "t" });
    const draft = makeDraft();

    await store.save(draft);

    expect(JSON.parse(kv.strings.get(`quote:${draft.quoteId}`)!)).toEqual(draft);
    expect(kv.strings.get(`quote_slug:${draft.slug.toLowerCase()}`)).toBe(draft.quoteId);
    expect(kv.sets.get("quotes:all")).toEqual(new Set([draft.quoteId]));
  });

  it("carries no TTL, so a quotation survives the WhatsApp window and any redeploy", async () => {
    const kv = makeFakeKv();
    vi.stubGlobal("fetch", kv.fetchMock);
    const store = createRedisQuotationStore({ url: "https://fake.upstash.io", token: "t" });
    const draft = makeDraft();

    await store.save(draft);
    const bodies = kv.fetchMock.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body) as (string | number)[]);

    // SET quote:<id> <json> — and nothing else. An EX/PX here would be the bug: the link is a
    // business record, not transient state.
    const setBody = bodies.find((b) => b[0] === "SET");
    expect(setBody).toBeTruthy();
    expect(setBody!.slice(2)).not.toContain("EX");
    expect(setBody!.slice(2)).not.toContain("PX");
  });
});
