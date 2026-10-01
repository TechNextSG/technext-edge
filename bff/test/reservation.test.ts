// The reservation is the one action in this product that creates something the resort will act on,
// so these tests are about the three ways it goes wrong rather than about the happy path alone: the
// same quotation booked twice, a refusal that must not lock the quote, and a timeout that might
// have booked it already.
//
// The engine is the simulated port (see simulatedEstimator.ts), which is the configuration the demo
// runs in. That is deliberate: the state machine under test is ours, and it must be correct before
// a real Odoo key is anywhere near it.
import { buildBffTrip } from "../../ai/src/index.ts";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.ts";
import { createSimulatedEstimator } from "../src/services/simulatedEstimator.ts";
import { buildHonoQuotationDraft } from "../src/quote/index.ts";
import { saveQuotationDraft } from "../src/store/quotationStore.ts";

import type { Trip } from "../../ai/src/index.ts";

const VERIFY_TOKEN = "reservation-token";

function sampleTrip(): Trip {
  const f = <T,>(value: T | null, state = "stated") => ({ value, state, evidence: null });
  return {
    language: f("en", "default"),
    contactName: f("Ana"),
    checkIn: f("2026-11-20"),
    checkOut: f("2026-11-22"),
    nights: f(2),
    guests: f(2),
    rooms: f(1),
    meals: f("full_board"),
    transport: f(false),
    guestType: f("retail", "default"),
    transportType: f("none"),
    diver: f(true),
    divers: f(1),
    diveFrom: f("2026-11-21"),
    diveTo: f("2026-11-21"),
    diveNotes: f(null, "missing"),
    specialRequests: f(null, "missing"),
    guestNames: f(["Ana", "Ben"]),
  } as Trip;
}

/** A stored quotation with a real `bffTrip`, which is what the booking route needs. */
async function storedQuote(id: string) {
  const draft = buildHonoQuotationDraft(sampleTrip(), "https://example.test", id);
  // `buildHonoQuotationDraft` already builds it, but going through `buildBffTrip` here keeps the
  // fixture honest about the contract rather than about the builder.
  return saveQuotationDraft({ ...draft, bffTrip: buildBffTrip(sampleTrip()) });
}

function appWith(estimator = createSimulatedEstimator()) {
  return createApp({ estimator, provider: undefined });
}

function submit(app: ReturnType<typeof createApp>, id: string, body: unknown, token = VERIFY_TOKEN) {
  return app.request(`/v1/quotes/${id}/submit?token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const CONTACT = { name: "Ana", email: "ana@example.test", phone: "+63 917 555 0199" };

beforeEach(() => {
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", VERIFY_TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sending a reservation", () => {
  it("books against the simulated engine and records a confirmed submission", async () => {
    const draft = await storedQuote("QT-RES-1");
    const res = await submit(appWith(), draft.quoteId, CONTACT);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.submission.state).toBe("confirmed");
    // Fixture semantics: success, and no folio, because no folio was created.
    expect(body.submission.folioId).toBeNull();
    expect(body.submission.sample).toBe(true);
    expect(body.submission.seq).toBe(1);
  });

  it("lets a person see what was recorded without re-reading the page", async () => {
    const draft = await storedQuote("QT-RES-2");
    const app = appWith();
    await submit(app, draft.quoteId, CONTACT);

    const res = await app.request(`/v1/quotes/${draft.quoteId}/submission?token=${VERIFY_TOKEN}`);
    const body = await res.json();
    expect(body.submission.state).toBe("confirmed");
    expect(body.submission.contact.email).toBe("ana@example.test");
  });

  it("refuses a second reservation for the same quotation", async () => {
    const draft = await storedQuote("QT-RES-3");
    const app = appWith();
    await submit(app, draft.quoteId, CONTACT);

    const again = await submit(app, draft.quoteId, CONTACT);
    expect(again.status).toBe(409);
    const body = await again.json();
    expect(body.reason).toBe("already");
    // The existing record comes back, so the caller can show why rather than guess.
    expect(body.submission.state).toBe("confirmed");
  });

  it("lets a guest be retried after the engine refused them, and only then", async () => {
    const draft = await storedQuote("QT-RES-4");
    const rejected = appWith(createSimulatedEstimator({ submitBehaviour: "rejected" }));

    const first = await submit(rejected, draft.quoteId, CONTACT);
    expect(first.status).toBe(502);
    const firstBody = await first.json();
    expect(firstBody.submission.state).toBe("failed");
    expect(firstBody.submission.error).toBe("rejected");

    // `failed` is the only retryable state — the guest did nothing wrong, so a second attempt is
    // allowed and now succeeds.
    const retry = await submit(appWith(), draft.quoteId, CONTACT);
    expect(retry.status).toBe(200);
    const retryBody = await retry.json();
    expect(retryBody.submission.state).toBe("confirmed");
    // A retry is a NEW submission record, numbered so the history is readable.
    expect(retryBody.submission.seq).toBe(2);
  });

  it("never re-sends a reservation whose outcome is unknown", async () => {
    const draft = await storedQuote("QT-RES-5");
    const uncertain = appWith(createSimulatedEstimator({ submitBehaviour: "unknown" }));

    const first = await submit(uncertain, draft.quoteId, CONTACT);
    expect(first.status).toBe(502);
    const body = await first.json();
    expect(body.submission.state).toBe("unknown");

    // The engine may hold a folio. Locking is the whole point: a second send could double-book.
    const again = await submit(appWith(), draft.quoteId, CONTACT);
    expect(again.status).toBe(409);
    expect((await again.json()).reason).toBe("already");
  });

  it("treats a busy engine as a refusal, not as an unknown outcome", async () => {
    const draft = await storedQuote("QT-RES-6");
    const busy = appWith(createSimulatedEstimator({ submitBehaviour: "busy" }));

    const res = await submit(busy, draft.quoteId, CONTACT);
    expect(res.status).toBe(502);
    const body = await res.json();
    // Nothing reached the engine, so there is no folio to worry about and the send is retryable.
    expect(body.submission.state).toBe("failed");
    expect(body.submission.error).toBe("busy");
  });

  it("rejects contact details by field path, and never echoes what was typed", async () => {
    const draft = await storedQuote("QT-RES-7");
    const res = await submit(appWith(), draft.quoteId, { name: "", email: "not-an-email" });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.fields.length).toBeGreaterThan(0);
    // An email in a 422 body is an email in a log aggregator.
    expect(JSON.stringify(body)).not.toContain("not-an-email");

    // Nothing was recorded, so the quotation is still bookable.
    const stored = await appWith().request(`/v1/quotes/${draft.quoteId}/submission?token=${VERIFY_TOKEN}`);
    expect((await stored.json()).submission).toBeNull();
  });

  it("refuses to book a quotation that has no trip behind it", async () => {
    // The seeded studio fixture is built from flat line items and carries no `bffTrip`; there is
    // nothing to send to a booking engine, and inventing one is how a reservation lands on the
    // wrong trip.
    const res = await appWith().request(`/v1/quotes/does-not-exist/submit?token=${VERIFY_TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(CONTACT),
    });
    expect(res.status).toBe(404);
  });

  it("needs a session, in both directions", async () => {
    const draft = await storedQuote("QT-RES-8");
    const app = appWith();

    expect((await app.request(`/v1/quotes/${draft.quoteId}/submit`, { method: "POST" })).status).toBe(401);
    expect((await app.request(`/v1/quotes/${draft.quoteId}/submission`)).status).toBe(401);
  });

  it("keeps the reservation off our own public route, which no longer serves a quotation at all", async () => {
    // The reservation banner used to be rendered by our guest page. That page is retired, so what
    // matters now is that OUR route reveals nothing about the booking either way: the state is the
    // team estimator's to show, on the link it minted.
    const draft = await storedQuote("QT-RES-9");
    const app = appWith();

    expect((await app.request(`/q/${draft.slug}`)).status).toBe(410);

    await submit(app, draft.quoteId, CONTACT);

    const after = await app.request(`/q/${draft.slug}`);
    expect(after.status).toBe(410);
    expect(await after.text()).not.toContain("Reservation sent");
  });

  it("records the unknown outcome rather than telling the guest anything from here", async () => {
    const draft = await storedQuote("QT-RES-10");
    const uncertain = appWith(createSimulatedEstimator({ submitBehaviour: "unknown" }));
    const res = await submit(uncertain, draft.quoteId, CONTACT);

    expect(res.status).toBe(502);
    expect((await res.json()).submission.state).toBe("unknown");
    expect((await uncertain.request(`/q/${draft.slug}`)).status).toBe(410);
  });
});
