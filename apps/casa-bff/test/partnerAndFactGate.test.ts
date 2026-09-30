// F08 (the customer's AI-channel flow) draws two lines the studio has to hold:
//   - a partner (agent / instructor) is quoted in the customer's own tool after signing in, so an
//     enquiry from one is never published or sent as a guest link;
//   - the message that carries the link goes through the same fact gate as a chat reply.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { buildHonoQuotationDraft } from "../../../packages/extractor/src/application/quotationTool.js";
import { buildBffTrip } from "../../../packages/extractor/src/application/odooHandoff.js";
import { saveQuotationDraft } from "../src/stores/quotationStore.js";
import type { Trip } from "../../../packages/extractor/src/domain/schema.js";

const TOKEN = "f08-token";
const STAFF = `?token=${TOKEN}`;
const f = (value: unknown, state = "stated") => ({ value, state, evidence: null });

function trip(overrides: Record<string, unknown> = {}): Trip {
  return {
    language: f("en", "default"), contactName: f("Ana"), checkIn: f("2026-11-20"), checkOut: f("2026-11-22"),
    nights: f(2), guests: f(2), rooms: f(1), meals: f("full_board"), transport: f(false),
    guestType: f("retail", "default"), transportType: f("none"), diver: f(false),
    diveNotes: f(null, "missing"), specialRequests: f(null, "missing"), guestNames: f([]),
    ...overrides,
  } as unknown as Trip;
}

/** Approved, priced and (optionally) already published — the state every send starts from. */
async function stored(id: string, t: Trip, extra: Record<string, unknown> = {}, published = false) {
  const draft = buildHonoQuotationDraft(t, "https://example.test", id);
  return saveQuotationDraft({
    ...draft,
    status: "confirmed_by_hono",
    bffTrip: buildBffTrip(t),
    pricing: {
      source: "simulated", sample: true, mode: "fixture", role: "guest", computedAt: new Date().toISOString(),
      guests: [], catRev: {}, kpis: { revenue: null, guests: null, nights: null, discounts: null, rpgn: null },
      warnings: [], retail: null, ops: null,
    },
    estimator: {
      id: `sim-${id}`, cookie: `ubg_sid=sim-${id}`, seq: published ? 1 : null,
      guestUrl: published ? "https://their-app.test/quote/tok" : null,
      sharedAt: published ? "2026-09-30T00:00:00.000Z" : null,
    },
    ...extra,
  } as never);
}

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown = {}) =>
  app.request(`${path}${STAFF}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => vi.stubEnv("WHATSAPP_VERIFY_TOKEN", TOKEN));
afterEach(() => vi.unstubAllEnvs());

describe("an enquiry from an agent is never published as a guest link", () => {
  for (const type of ["agent", "instructor"]) {
    it(`publish refuses ${type} with 409 partner_needs_own_login and freezes nothing`, async () => {
      const q = await stored(`QT-F08-${type}`, trip({ guestType: f(type) }));
      const res = await post(createApp(), `/v1/quotes/${q.quoteId}/publish`, { acknowledgeSample: true });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.reason).toBe("partner_needs_own_login");
      expect(body.detail).toContain("Reply to them instead of publishing");
    });
  }

  it("send-whatsapp refuses it too, and never reaches WhatsApp", async () => {
    const q = await stored("QT-F08-send-agent", trip({ guestType: f("agent") }), {}, true);
    const sent: unknown[] = [];
    const res = await post(createApp({ sendWhatsApp: async (m) => void sent.push(m) }), `/v1/quotes/${q.quoteId}/send-whatsapp`, {
      phone: "639171234567",
    });
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("partner_needs_own_login");
    expect(sent).toHaveLength(0);
  });

  it("a clean retail enquiry publishes as before", async () => {
    const q = await stored("QT-F08-retail", trip());
    const res = await post(createApp(), `/v1/quotes/${q.quoteId}/publish`, { acknowledgeSample: true });
    expect(res.status).toBe(200);
  });
});

describe("the message that carries the link goes through the fact gate", () => {
  it("stops a message that names a room type the trip does not have, and does not send it", async () => {
    // A suite booking whose staff note says "Standard Room": the wording that once reached a guest.
    const q = await stored("QT-F08-gate", trip({ roomType: f("suite") }), { staffNotes: "Your Standard Room is being prepared." }, true);
    const sent: unknown[] = [];
    const res = await post(createApp({ sendWhatsApp: async (m) => void sent.push(m) }), `/v1/quotes/${q.quoteId}/send-whatsapp`, {
      phone: "639171234567",
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.reason).toBe("guest_text_failed_fact_gate");
    expect(body.detail).toContain("mismatched_room_type");
    expect(sent).toHaveLength(0);
  });

  it("sends the same booking when the message matches the trip", async () => {
    const q = await stored("QT-F08-ok", trip({ roomType: f("suite") }), { staffNotes: "Your Suite Room is being prepared." }, true);
    const sent: Array<{ body: string }> = [];
    const res = await post(createApp({ sendWhatsApp: async (m) => void sent.push(m) }), `/v1/quotes/${q.quoteId}/send-whatsapp`, {
      phone: "639171234567",
    });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toContain("Sample data — not a live quote");
  });

  it("a plain message passes the gate untouched", async () => {
    const q = await stored("QT-F08-plain", trip(), {}, true);
    const sent: unknown[] = [];
    const res = await post(createApp({ sendWhatsApp: async (m) => void sent.push(m) }), `/v1/quotes/${q.quoteId}/send-whatsapp`, {
      phone: "639171234567",
    });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
  });
});
