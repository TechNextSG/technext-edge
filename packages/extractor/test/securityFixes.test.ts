// Đợt 0 — the security items that had to land before anything was committed.
//
// Each of these was a real hole rather than a hardening idea: a guest's own name printed into
// markup unescaped on two pages, a write route with no credential at all, a "send to guest" button
// that would send a price nobody had approved, and a sign-in page that quietly dropped the handoff
// inbox's deep link. They are grouped here so the reason they exist is readable in one place.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp } from "../../../apps/casa-bff/src/app.js";
import { saveQuotationDraft, listQuotations } from "../../../apps/casa-bff/src/quotationStore.js";
import { buildHonoQuotationDraft } from "../../../packages/extractor/src/quotationTool.js";
import { renderLoginHtml } from "../../../apps/casa-bff/src/demoAuth.js";
import { escapeHtml } from "../../../apps/casa-bff/src/html.js";
import type { Trip } from "../../../packages/extractor/src/schema.js";

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

describe("the seeded store still works after the security changes", () => {
  it("lists quotations for staff", async () => {
    const app = createApp();
    const res = await app.request(`/v1/quotes${STAFF}`);
    expect(res.status).toBe(200);
    expect((await res.json()).quotations.length).toBeGreaterThan(0);
    expect(await listQuotations()).not.toHaveLength(0);
  });
});
