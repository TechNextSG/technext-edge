// Đợt 0 — the security items that had to land before anything was committed.
//
// Each of these was a real hole rather than a hardening idea: a guest's own name printed into
// markup unescaped on two pages, a write route with no credential at all, a "send to guest" button
// that would send a price nobody had approved, and a sign-in page that quietly dropped the handoff
// inbox's deep link. They are grouped here so the reason they exist is readable in one place.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { createEstimatorClient } from "../src/services/estimatorClient.js";
import { saveQuotationDraft, listQuotations } from "../src/stores/quotationStore.js";
import { buildHonoQuotationDraft } from "../../ai/src/application/quotationTool.js";
import { renderLoginHtml } from "../src/auth/demoAuth.js";
import { escapeHtml } from "../src/views/html.js";
import type { Trip } from "../../ai/src/domain/schema.js";

const VERIFY_TOKEN = "dot0-token";
const STAFF = `?token=${VERIFY_TOKEN}`;

/** A guest name that is not a name. Reachable: the name comes straight from a WhatsApp message. */
const NASTY_NAME = '<script>alert("xss")</script>';

function tripWith(name: string): Trip {
  const f = <T,>(value: T | null, state = "stated") => ({ value, state, evidence: null });
  return {
    language: f("en", "default"),
    contactName: f(name),
    checkIn: f("2026-11-20"),
    checkOut: f("2026-11-22"),
    nights: f(2),
    guests: f(2),
    rooms: f(1),
    meals: f("full_board"),
    transport: f(false),
    guestType: f("retail", "default"),
    transportType: f("none"),
    diver: f(false),
    diveNotes: f(`<img src=x onerror=alert(1)>`, "stated"),
    specialRequests: f(null, "missing"),
    guestNames: f([]),
  } as Trip;
}

async function storedNasty(id: string) {
  return saveQuotationDraft(buildHonoQuotationDraft(tripWith(NASTY_NAME), "https://example.test", id));
}

beforeEach(() => {
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", VERIFY_TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("escapeHtml", () => {
  it("escapes the characters that can leave an element or an attribute", () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot; &amp; 'y'&lt;/script&gt;",
    );
  });

  it("renders nothing for a value that is not there, rather than the word undefined", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(0)).toBe("0");
  });
});

describe("a guest's own words are never markup", () => {
  it("escapes the name on the staff studio page", async () => {
    const draft = await storedNasty("QT-SEC-1");
    const app = createApp();

    const html = await (await app.request(`/quotes/${draft.quoteId}${STAFF}`)).text();

    expect(html).not.toContain("<script>alert(");
    expect(html).toContain("&lt;script&gt;alert(");
  });

  it("keeps the guest page retired, so there is no public surface left to escape into", async () => {
    // This assertion used to check that the name was escaped on the public quotation page. That
    // page is gone (Đợt 1) — so the property is now the stronger one: our own route serves no
    // quotation at all, escaped or otherwise.
    const draft = await storedNasty("QT-SEC-2");
    const app = createApp();

    const res = await app.request(`/q/${draft.slug}`);
    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body).not.toContain(NASTY_NAME);
    expect(body).not.toContain("<script>");
  });

  it("escapes them on the ops sheet and in the handoff inbox too", async () => {
    const draft = await storedNasty("QT-SEC-3");
    const app = createApp();

    const ops = await (await app.request(`/quotes/${draft.quoteId}/ops${STAFF}`)).text();
    expect(ops).not.toContain("<script>alert(");

    const handoff = await (await app.request(`/handoff${STAFF}`)).text();
    expect(handoff).not.toContain("<script>alert(");
  });
});

describe("writes need a session", () => {
  it("refuses the AI submit route without one", async () => {
    const app = createApp();
    const res = await app.request("/v1/quotes/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: tripWith("Ana") }),
    });

    // This route creates and SAVES a quotation from a caller-supplied trip. Open, it was a way for
    // anyone who found the URL to write a guest's name, phone and dates into the store.
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("still accepts it with a session, so the tool path is not broken", async () => {
    const app = createApp();
    const res = await app.request(`/v1/quotes/submit${STAFF}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: tripWith("Ana") }),
    });

    expect(res.status).toBe(200);
  });
});

describe("the message a guest actually receives", () => {
  /**
   * Read from production on 2026-09-28: the send route returns the body it sent, and that body stated
   * the booking terms but said nothing about when the quotation lapses — because the deadline is
   * derived from `sentToGuestAt`, which is only written *after* the send. The page promised a deadline
   * the message never mentioned.
   */
  async function approvedPublished(id: string) {
    const draft = await storedNasty(id);
    const published = await saveQuotationDraft({
      ...draft,
      status: "confirmed_by_hono",
      pricing: {
        source: "remote",
        sample: true,
        mode: "fixture",
        role: "guest",
        computedAt: "2026-09-28T00:00:00.000Z",
        guests: [],
        catRev: {},
        kpis: { revenue: 31_200, guests: 2, nights: 2, discounts: null, rpgn: 15_600 },
        warnings: [],
        retail: null,
        ops: null,
      },
      estimator: {
        id: "sim-1",
        cookie: "ubg_sid=1",
        seq: 1,
        guestUrl: "https://their-app.test/quote/live-token",
        sharedAt: "2026-09-28T00:00:00.000Z",
      },
    });
    const sent: Array<{ to: string; body: string }> = [];
    const app = createApp({ sendWhatsApp: async (m) => void sent.push(m) });
    const res = await app.request(`/v1/quotes/${published.quoteId}/send-whatsapp${STAFF}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "639171234567" }),
    });
    return { res, sent, published };
  }

  it("states when the quotation lapses, and no price of ours", async () => {
    const { res, sent, published } = await approvedPublished("QT-MSG-1");
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    const body = sent[0]!.body;

    expect(body).toContain("valid until");
    expect(body).toContain("(Manila time)");
    // Nothing about money this service invented.
    // No deposit: the customer's own tool states none, so this service states none either.
    expect(body.toLowerCase()).not.toContain("down payment");
    expect(body).toContain("nothing is booked yet");
    expect(body).not.toContain("31,200");
    expect(body).not.toContain("15,600");
    expect(body.toLowerCase()).not.toContain("hold");

    // The deadline the guest is told is the record's own send window, not a sentence typed for the
    // occasion: it lands one window after the send that is being recorded right now.
    const stored = (await listQuotations()).find((q) => q.quoteId === published.quoteId)!;
    expect(stored.sentToGuestAt).toBeTruthy();
    const windowHours = Number(process.env.QUOTATION_VALID_HOURS ?? 72);
    const sentMs = new Date(stored.sentToGuestAt!).getTime();
    const stated = /valid until ([^)]+) \(Manila time\)/.exec(body)?.[1];
    expect(stated, "the message names a date").toBeTruthy();
    expect(sentMs).toBeGreaterThan(0);
    // 72 hours after the send, in Manila — asserted through the formatter so a timezone bug shows.
    const { formatManila } = await import("../../ai/src/domain/quotationValidity.js");
    expect(stated).toBe(formatManila(new Date(sentMs + windowHours * 3_600_000)));
  });
});

describe("only an approved quotation can be sent to a guest", () => {
  it("refuses an unapproved one, and never reaches WhatsApp", async () => {
    const draft = await storedNasty("QT-SEC-4");
    expect(draft.status).toBe("pending_hono_review");

    const sent: unknown[] = [];
    const app = createApp({ sendWhatsApp: async (m) => void sent.push(m) });

    const res = await app.request(`/v1/quotes/${draft.quoteId}/send-whatsapp${STAFF}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "639171234567" }),
    });

    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("not_approved");
    // The refusal has to happen *before* the send, not after it.
    expect(sent).toHaveLength(0);
  });

  it("refuses an approved but unpublished one too, because the link would be dead", async () => {
    // Approval says "the price is right". Publish is what mints the guest's link, and the message
    // carries that link — so sending before Publish is how a guest receives a dead URL. Measured on
    // production: the message fell back to our retired `/q/<slug>` page, which answers 410.
    const draft = await storedNasty("QT-SEC-6");
    await saveQuotationDraft({ ...draft, status: "confirmed_by_hono" });

    const sent: unknown[] = [];
    const app = createApp({ sendWhatsApp: async (m) => void sent.push(m) });

    const res = await app.request(`/v1/quotes/${draft.quoteId}/send-whatsapp${STAFF}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "639171234567" }),
    });

    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("not_published");
    expect(sent).toHaveLength(0);
  });

  it("sends once staff have approved AND published it, and the message carries no price of ours", async () => {
    const draft = await storedNasty("QT-SEC-5");
    await saveQuotationDraft({
      ...draft,
      status: "confirmed_by_hono",
      estimator: {
        id: "sim-1",
        cookie: "ubg_sid=sim-1",
        seq: 1,
        guestUrl: "https://their-app.test/quote/tok-real",
        sharedAt: new Date().toISOString(),
      },
    });

    const sent: Array<{ to: string; body: string }> = [];
    const app = createApp({ sendWhatsApp: async (m) => void sent.push(m) });

    const res = await app.request(`/v1/quotes/${draft.quoteId}/send-whatsapp${STAFF}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "639171234567" }),
    });

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    // WhatsApp bold is a single asterisk; `**` arrives as literal asterisks in the guest's chat.
    expect(sent[0]!.body).not.toContain("**");
    // The published link, and only that: our own `/q/<slug>` page is retired.
    expect(sent[0]!.body).toContain("https://their-app.test/quote/tok-real");
    expect(sent[0]!.body).not.toMatch(/\/q\//);
    // No money, and nothing that reads as a booking.
    expect(sent[0]!.body).not.toMatch(/(?:₱|\$|PHP|USD)\s?\d/);
    expect(sent[0]!.body.toLowerCase()).not.toContain("confirmed");
    expect(sent[0]!.body).toContain("nothing is booked yet");
  });

  it("refuses a number with no country code, and says what to do about it", async () => {
    const draft = await storedNasty("QT-SEC-7");
    // Published, so the only thing wrong with this attempt is the number itself.
    await saveQuotationDraft({
      ...draft,
      status: "confirmed_by_hono",
      estimator: {
        id: "sim-7",
        cookie: "ubg_sid=sim-7",
        seq: 1,
        guestUrl: "https://their-app.test/quote/tok-seven",
        sharedAt: new Date().toISOString(),
      },
    });

    const sent: unknown[] = [];
    const app = createApp({ sendWhatsApp: async (m) => void sent.push(m) });

    const res = await app.request(`/v1/quotes/${draft.quoteId}/send-whatsapp${STAFF}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "0359 123 456" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { reason: string; error: string };
    expect(body.reason).toBe("phone_invalid");
    expect(body.error).toContain("country code");
    // Never guessed: the resort is in the Philippines and the team's test numbers are Vietnamese, so
    // "0…" does not say which country the message should go to.
    expect(sent).toHaveLength(0);
  });
});

describe("the sign-in page keeps the page you came from", () => {
  it("keeps a handoff deep link, which is the one the inbox sends", async () => {
    expect(renderLoginHtml(false, "/handoff")).toContain('name="next" value="/handoff"');
  });

  it("keeps a studio deep link", () => {
    expect(renderLoginHtml(false, "/quotes/QT-1")).toContain('name="next" value="/quotes/QT-1"');
  });

  it("falls back to the studio for anything else, including another origin", () => {
    // `next` arrives from the query string, so echoing it back unchecked is an open redirect.
    for (const bad of ["https://evil.test", "//evil.test", "/etc/passwd", ""]) {
      expect(renderLoginHtml(false, bad)).toContain('name="next" value="/quotes"');
    }
  });

  it("accepts the handoff deep link through the POST, not only on the page", async () => {
    const app = createApp();
    const res = await app.request("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: VERIFY_TOKEN, role: "staff", next: "/handoff" }).toString(),
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/handoff");
  });
});

describe("a plain save edits the contact fields and nothing else", () => {
  // This route used to spread whatever body it was given over the record, so one PUT could approve a
  // quotation, set a price, or point a guest at a link — without `/confirm`, `/publish`, or the
  // engine. The studio's one Save button posts here, so the hole was one fetch away from the UI.
  it("cannot approve, price, publish or rewrite the trip through PUT", async () => {
    const app = createApp();
    const draft = await storedNasty("QT-PUT-1");

    const res = await app.request(`/v1/quotes/${draft.quoteId}${STAFF}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        guestName: "Ana Reyes",
        status: "confirmed_by_hono",
        confirmedBy: "Hono Reservation Studio",
        pricing: { kpis: { revenue: 99_999 }, source: "forged", sample: false },
        estimator: { id: "forged", cookie: null, seq: 9, guestUrl: "https://evil.test/quote/stolen", sharedAt: "2026-01-01T00:00:00.000Z" },
        bffTrip: { rooms: [], guests: [], guestType: "agent" },
      }),
    });

    const body = await res.json();
    // The fields it owns are saved…
    expect(body.quotation.guestName).toBe("Ana Reyes");
    // …and every one it does not is ignored, with the names reported so a caller is never left
    // believing a write happened.
    expect(body.quotation.status).toBe("pending_hono_review");
    expect(body.quotation.confirmedBy).toBeUndefined();
    expect(body.quotation.pricing ?? null).toBe(draft.pricing ?? null);
    expect(body.quotation.estimator?.guestUrl ?? null).toBeNull();
    expect(body.quotation.bffTrip?.guestType).toBe(draft.bffTrip?.guestType);
    for (const refused of ["status", "pricing", "estimator", "bffTrip", "confirmedBy"]) {
      expect(body.ignored, `${refused} was not reported as ignored`).toContain(refused);
    }
  });
});

describe("a published quotation is frozen", () => {
  // Measured on production, 2026-09-28: `PUT /v1/quotes/QT-1205-BEN-…` on a record whose link had
  // already been verified answered 200 and changed the guest's name and check-in date — underneath a
  // link the guest was holding. `/trip`, `/sync-estimate` and `/publish` all refused that write; the
  // contact-field route and `/confirm` did not.
  async function published(id: string) {
    const draft = await storedNasty(id);
    return saveQuotationDraft({
      ...draft,
      status: "confirmed_by_hono",
      confirmedAt: "2026-09-28T00:00:00.000Z",
      confirmedBy: "Hono Reservation Studio",
      phone: "639171234567",
      pricing: {
        source: "remote",
        sample: true,
        mode: "fixture",
        role: "guest",
        computedAt: "2026-09-28T00:00:00.000Z",
        guests: [],
        catRev: {},
        kpis: { revenue: 31_200, guests: 2, nights: 2, discounts: null, rpgn: 15_600 },
        warnings: [],
        retail: null,
        ops: null,
      },
      estimator: {
        id: "scenario-1",
        cookie: "ubg_sid=1",
        seq: 1,
        guestUrl: "https://their-app.test/quote/token",
        sharedAt: "2026-09-28T00:01:00.000Z",
      },
    });
  }

  it("refuses a contact-field save, and writes nothing", async () => {
    const draft = await published("QT-FROZEN-PUT");
    const app = createApp();

    const res = await app.request(`/v1/quotes/${draft.quoteId}${STAFF}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guestName: "Somebody Else", checkIn: "2027-01-01" }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.reason).toBe("already_shared");
    expect(body.detail).toContain("already published");
    expect(body.guestUrl).toBe("https://their-app.test/quote/token");
    const stored = (await listQuotations()).find((q) => q.quoteId === draft.quoteId)!;
    expect(stored.guestName).toBe(draft.guestName);
    expect(stored.checkIn).toBe(draft.checkIn);
  });

  it("refuses an approval that would re-approve it against a different trip", async () => {
    const draft = await published("QT-FROZEN-CONFIRM");
    const app = createApp();

    const res = await app.request(`/v1/quotes/${draft.quoteId}/confirm${STAFF}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guestName: "Somebody Else" }),
    });

    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("already_shared");
  });
});

describe("an approval cannot be forged through /confirm", () => {
  // `/confirm` spread the request body over the record, so the route that is supposed to *say yes* to
  // a price could also set one — plus `status`, `estimator` (the guest's link) and `submission`.
  it("writes the contact fields and refuses money, status and the link", async () => {
    const base = await storedNasty("QT-CONFIRM-1");
    const draft = await saveQuotationDraft({
      ...base,
      pricing: {
        source: "remote",
        sample: true,
        mode: "fixture",
        role: "guest",
        computedAt: "2026-09-28T00:00:00.000Z",
        guests: [],
        catRev: {},
        kpis: { revenue: 31_200, guests: 2, nights: 2, discounts: null, rpgn: 15_600 },
        warnings: [],
        retail: null,
        ops: null,
      },
      lineItems: [],
    });
    const app = createApp();

    const res = await app.request(`/v1/quotes/${draft.quoteId}/confirm${STAFF}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        guestName: "Ana Reyes",
        pricing: { source: "forged", sample: false, kpis: { revenue: 99_999 } },
        estimator: { id: "forged", cookie: null, seq: 9, guestUrl: "https://evil.test/quote/stolen", sharedAt: "2026-01-01T00:00:00.000Z" },
        submission: { folio: "forged" },
        staffAlerts: ["forged"],
      }),
    });

    const body = await res.json();
    expect(res.status).toBe(200);
    // The field it does own…
    expect(body.quotation.guestName).toBe("Ana Reyes");
    // …and none of the ones it does not.
    expect(body.quotation.pricing?.kpis.revenue).toBe(31_200);
    expect(body.quotation.estimator?.guestUrl ?? null).toBeNull();
    expect(body.quotation.submission ?? null).toBeNull();
    expect(body.quotation.staffAlerts ?? []).not.toContain("forged");
    for (const refused of ["pricing", "estimator", "submission", "staffAlerts"]) {
      expect(body.ignored, `${refused} was not reported as ignored`).toContain(refused);
    }
  });
});

describe("an anonymous caller cannot open a quotation", () => {
  // Measured on production, 2026-09-28: `POST /v1/converse` with no credential created
  // QT-1121-ANAR-7151DD9E and answered 200 with its `slug`, `quoteId`, `lineItems` and
  // `totalAmount` — an internal id, a guest-facing link and a price, for an unsigned request.
  function chatter() {
    return {
      id: "fake:converse",
      call: async () => ({
        raw: {
          language: { value: "en", state: "default", evidence: null },
          checkIn: { value: "2026-11-21", state: "stated", evidence: "21 Nov 2026" },
          checkOut: { value: "2026-11-23", state: "stated", evidence: "23 Nov 2026" },
          nights: { value: 2, state: "stated", evidence: "2 nights" },
          guests: { value: 2, state: "stated", evidence: "2 guests" },
          rooms: { value: 1, state: "stated", evidence: "1 room" },
          roomType: { value: "deluxe", state: "stated", evidence: "deluxe" },
          meals: { value: "full_board", state: "stated", evidence: "full board" },
          transport: { value: false, state: "stated", evidence: "no transport" },
          transportType: { value: "none", state: "stated", evidence: "no transport" },
          guestType: { value: "retail", state: "default", evidence: null },
          diver: { value: false, state: "stated", evidence: "no diving" },
          divers: { value: null, state: "missing", evidence: null },
          diveFrom: { value: null, state: "missing", evidence: null },
          diveTo: { value: null, state: "missing", evidence: null },
          diveNotes: { value: null, state: "missing", evidence: null },
          contactName: { value: "Ana", state: "stated", evidence: "Ana" },
        },
        tokensIn: 1,
        tokensOut: 1,
        cacheReadTokens: 0,
        ms: 1,
      }),
    };
  }

  const ENQUIRY =
    "Hi, we are Ana and Ben, 2 guests, 1 room, deluxe, 2 nights from 21 Nov 2026 to 23 Nov 2026, full board, no transport, no diving";

  it("creates no record and returns no id, link or price", async () => {
    vi.stubEnv("ENABLE_HONO_QUOTATION_TOOL", "true");
    const before = (await listQuotations()).length;
    const app = createApp({ provider: chatter() });

    const res = await app.request("/v1/converse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: ENQUIRY }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.quotationDraft ?? null).toBeNull();
    expect(body.slug ?? null).toBeNull();
    expect(body.quotationSaved).toBe(false);
    expect(String(body.quotationNote)).toContain("not created");
    // Nothing was written: the studio's queue is exactly as long as it was.
    expect((await listQuotations()).length).toBe(before);
  });

  it("still lets staff open one, which is what the console does when signed in", async () => {
    vi.stubEnv("ENABLE_HONO_QUOTATION_TOOL", "true");
    const app = createApp({ provider: chatter() });

    const res = await app.request(`/v1/converse${STAFF}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: ENQUIRY }),
    });
    const body = await res.json();

    expect(body.quotationSaved).toBe(true);
    expect(body.quotationDraft?.quoteId).toMatch(/^QT-/);
    const stored = (await listQuotations()).find((q) => q.quoteId === body.quotationDraft.quoteId);
    expect(stored, "the staff request really did create the record").toBeTruthy();
  });
});

describe("a link that stopped opening is replaced, not sent", () => {
  // The last moment before a guest holds the link. Measured on the customer's fixture deployment:
  // 200 six times, then 404 twelve times in a row for the same token minutes later.
  it("sends our copy of the same revision when their link has since died", async () => {
    const now = new Date().toISOString();
    const draft = await saveQuotationDraft({
      ...buildHonoQuotationDraft(tripWith("Ana"), "https://example.test", "QT-SEND-MIRROR"),
      status: "confirmed_by_hono",
      confirmedAt: now,
      confirmedBy: "Hono Reservation Studio",
      phone: "639171234567",
      estimator: {
        id: "scenario-1",
        cookie: "ubg_sid=1",
        seq: 1,
        guestUrl: "https://their-app.test/quote/dead-token",
        sharedAt: now,
      },
    });

    const sent: Array<{ to: string; body: string }> = [];
    const app = createApp({
      estimator: createEstimatorClient({
        baseUrl: "https://their-app.test",
        // Their share endpoint is not called again; the guest-link check is the one that answers 404.
        fetchImpl: (async (url: string) =>
          new Response(JSON.stringify({ error: "not found" }), { status: 404 })) as never,
      }),
      sendWhatsApp: async (message) => {
        sent.push(message);
      },
    });

    const res = await app.request(`/v1/quotes/${draft.quoteId}/send-whatsapp${STAFF}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "639171234567" }),
    });
    const body = await res.json();

    // Sent, not refused: the guest gets a link that opens.
    expect(res.status).toBe(200);
    expect(body.mirror).toBe(true);
    expect(body.guestLink).toContain(`/q/${draft.slug}`);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toContain(`/q/${draft.slug}`);
    // …and their link is not in the message, because it does not open.
    expect(sent[0]!.body).not.toContain("their-app.test/quote/dead-token");

    const stored = await (await app.request(`/v1/quotes/${draft.quoteId}${STAFF}`)).json();
    expect(stored.quotation.estimator.mirrorUrl).toContain(`/q/${draft.slug}`);
    expect(stored.quotation.estimator.guestUrl).toBe("https://their-app.test/quote/dead-token");
  });
});

describe("the seeded store still works after the security changes", () => {
  it("lists quotations for staff", async () => {
    const app = createApp();
    const res = await app.request(`/v1/quotes${STAFF}`);
    expect(res.status).toBe(200);
    expect((await res.json()).quotations.length).toBeGreaterThan(0);
    expect(await listQuotations()).not.toHaveLength(0);
  });
});
