// Publishing is the moment a price becomes a guest's. It is the replacement for the bot appending
// its own link, so these tests are about what it refuses at least as much as what it does.
//
// Their API is also session-scoped — `POST /api/estimates` sets `ubg_sid` and the later calls only
// answer for the session that owns the scenario — so the cookie's capture and replay are pinned
// here too. Getting that wrong is a 404 for a draft that exists, which is the failure the customer's
// own `docs/integration/schema.md` §4 warns about.
import { buildBffTrip } from "../../ai/src/index.ts";
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { createApp } from "../src/app.ts";
import { createEstimatorClient } from "../src/services/estimatorClient.ts";
import { createSimulatedEstimator } from "../src/services/simulatedEstimator.ts";
import { buildHonoQuotationDraft } from "../../quotation/src/index.ts";
import { saveQuotationDraft } from "../src/store/quotationStore.ts";

import type { Trip } from "../../ai/src/index.ts";
import { ensureSampleQuotation } from "./helpers/sampleQuotation.ts";

// The app no longer seeds a cold-start record; this file reads the sample one.
beforeAll(async () => {
  await ensureSampleQuotation();
});

const VERIFY_TOKEN = "publish-token";
const STAFF = `?token=${VERIFY_TOKEN}`;

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
    diver: f(false),
    diveNotes: f(null, "missing"),
    specialRequests: f(null, "missing"),
    guestNames: f([]),
  } as Trip;
}

/** A stored quotation with a trip and a recorded scenario, as `sync-estimate` would leave it. */
async function pricedQuote(id: string, status: "pending_hono_review" | "confirmed_by_hono" = "confirmed_by_hono") {
  const draft = buildHonoQuotationDraft(sampleTrip(), "https://example.test", id);
  return saveQuotationDraft({
    ...draft,
    status,
    bffTrip: buildBffTrip(sampleTrip()),
    pricing: {
      source: "simulated",
      sample: true,
      mode: "fixture",
      role: "guest",
      computedAt: new Date().toISOString(),
      guests: [],
      catRev: {},
      kpis: { revenue: null, guests: null, nights: null, discounts: null, rpgn: null },
      warnings: [],
      retail: null,
      ops: null,
    },
    estimator: { id: `sim-${id}`, cookie: `ubg_sid=sim-${id}`, seq: null, guestUrl: null, sharedAt: null },
  });
}

function publish(app: ReturnType<typeof createApp>, id: string, body: unknown = {}, token = VERIFY_TOKEN) {
  return app.request(`/v1/quotes/${id}/publish?token=${token}`, {
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

describe("publishing a guest link", () => {
  it("needs a session", async () => {
    const draft = await pricedQuote("QT-PUB-1");
    const app = createApp();
    expect((await app.request(`/v1/quotes/${draft.quoteId}/publish`, { method: "POST" })).status).toBe(401);
  });

  it("refuses a quotation staff have not approved", async () => {
    const draft = await pricedQuote("QT-PUB-2", "pending_hono_review");
    const res = await publish(createApp(), draft.quoteId);

    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("not_approved");
  });

  it("refuses to publish a sample price until a person says they checked it", async () => {
    const draft = await pricedQuote("QT-PUB-3");
    const app = createApp();

    const refused = await publish(app, draft.quoteId);
    expect(refused.status).toBe(409);
    expect((await refused.json()).reason).toBe("sample_not_acknowledged");

    // Acknowledged: a human has looked at a captured price and is publishing it deliberately.
    const allowed = await publish(app, draft.quoteId, { acknowledgeSample: true });
    expect(allowed.status).toBe(200);
    const body = await allowed.json();
    expect(body.ok).toBe(true);
    expect(body.seq).toBe(1);
    expect(body.sample).toBe(true);
  });

  it("refuses a quotation nobody has priced", async () => {
    const draft = buildHonoQuotationDraft(sampleTrip(), "https://example.test", "QT-PUB-4");
    const stored = await saveQuotationDraft({
      ...draft,
      status: "confirmed_by_hono",
      bffTrip: buildBffTrip(sampleTrip()),
      estimator: null,
    });

    const res = await publish(createApp(), stored.quoteId, { acknowledgeSample: true });
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("not_priced");
  });

  it("refuses to publish the studio's cold-start fixture", async () => {
    // Measured twice on production: the fixture gets published during a test, the customer's demo app
    // loses the token, and a cold start then opens on "send the message again" over a dead link. The
    // version bump that rebuilt it was a fix nobody re-runs, so this is the guard.
    const app = createApp();
    const seed = (await (await app.request(`/v1/quotes?token=${VERIFY_TOKEN}`)).json()).quotations.find(
      (q: { seedVersion?: number }) => typeof q.seedVersion === "number",
    );
    expect(seed, "the fixture seeds itself on first read").toBeTruthy();

    const res = await publish(app, seed.quoteId, { acknowledgeSample: true });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.reason).toBe("seeded_fixture");
    expect(body.detail).toContain("cold-start example");

    const stored = await (await app.request(`/v1/quotes/${seed.quoteId}${STAFF}`)).json();
    expect(stored.quotation.estimator?.sharedAt ?? null).toBeNull();
  });

  it("publishes once, and refuses the second attempt", async () => {
    const draft = await pricedQuote("QT-PUB-5");
    const app = createApp();

    const first = await publish(app, draft.quoteId, { acknowledgeSample: true });
    expect(first.status).toBe(200);

    // Their link always resolves to the newest saved revision, so a second publish would silently
    // change what a guest is already holding. Their Q-005.
    const second = await publish(app, draft.quoteId, { acknowledgeSample: true });
    expect(second.status).toBe(409);
    expect((await second.json()).reason).toBe("already_shared");
  });

  it("refuses to re-price a quotation a guest is already holding a link to", async () => {
    const draft = await pricedQuote("QT-PUB-10");
    const app = createApp();
    await publish(app, draft.quoteId, { acknowledgeSample: true });

    // The trip-edit route already refuses this; pricing is the other way to change what a published
    // quotation says. Found while setting up a second, `simulated` deployment for the demo, where a
    // shared KV store means the other tab can reach the same record — but the same is true of anyone
    // who reopens a published quotation and clicks Price.
    const res = await app.request(`/v1/quotes/${draft.quoteId}/sync-estimate${STAFF}`, { method: "POST" });

    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("already_shared");
  });

  it("records the frozen revision and the share time on the quotation", async () => {
    const draft = await pricedQuote("QT-PUB-6");
    const app = createApp();
    await publish(app, draft.quoteId, { acknowledgeSample: true });

    const stored = await (await app.request(`/v1/quotes/${draft.quoteId}${STAFF}`)).json();
    expect(stored.quotation.estimator.seq).toBe(1);
    expect(stored.quotation.estimator.sharedAt).toEqual(expect.any(String));
    // Their cookie is recorded but must never reach a page.
    expect(stored.quotation.estimator.cookie).toContain("ubg_sid=");
  });

  /**
   * The failure this guard exists for, measured on the customer's own fixture deployment: a token
   * their app had just minted answered 200 seventeen times and 404 seven times in one run of 24
   * parallel requests. A guest who opens the link on a bad draw reads "this quote link is not valid
   * or has expired", and staff have no way to know that from the studio.
   *
   * So the guest does not get that link. They get OUR copy of the same frozen revision, and the
   * record keeps both — their link, and the copy with the reason it was needed.
   */
  /**
   * A failed commit or share is a failed publish — not a success with our own copy stapled to it.
   *
   * Measured before this: either failure answered `ok: true`, set `sharedAt` (which freezes the record
   * for good: no edits, and the cleanup route refuses it), invented `seq: 1` and let the guest page
   * print "version 1" for a revision their app never froze. Thirty seconds of an unreachable engine
   * left a quotation that could be neither sent nor edited nor cleaned up.
   */
  it("reports a failed commit as a failure, and leaves the record usable", async () => {
    const draft = await pricedQuote("QT-PUB-COMMIT-FAIL");
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/commit")) {
        return new Response(JSON.stringify({ error: "engine is unwell" }), { status: 500 });
      }
      return new Response(JSON.stringify({ url: "/quote/tok", expiresAt: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const app = createApp({
      estimator: createEstimatorClient({ baseUrl: "https://quotes.customer.test", fetchImpl: fetchImpl as never }),
    });

    const res = await publish(app, draft.quoteId, { acknowledgeSample: true });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.reason).toBeTruthy();
    // No link, and nothing frozen.
    expect(body.guestUrl ?? null).toBeNull();
    expect(body.mirrorUrl ?? null).toBeNull();
    const stored = await (await app.request(`/v1/quotes/${draft.quoteId}${STAFF}`)).json();
    expect(stored.quotation.estimator?.sharedAt ?? null).toBeNull();
    expect(stored.quotation.estimator?.seq ?? null).toBeNull();

    // …and the quotation can still be worked on: the trip route refuses a *published* record, so a
    // record that answers 200 there is a record nobody froze.
    const trip = await app.request(`/v1/quotes/${draft.quoteId}/sync-estimate${STAFF}`, { method: "POST" });
    expect(trip.status).not.toBe(409);
  });

  it("reports a failed share as a failure, rather than minting a link of our own", async () => {
    const draft = await pricedQuote("QT-PUB-SHARE-FAIL");
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/commit")) {
        return new Response(JSON.stringify({ seq: 3 }), { status: 200, headers: { "content-type": "application/json" } });
      }
      // A share that is refused outright — not a link that fails to open, which is the case the copy
      // is for. `rejected` is their engine saying no.
      return new Response(JSON.stringify({ error: "cannot share this scenario" }), { status: 403 });
    });
    const app = createApp({
      estimator: createEstimatorClient({ baseUrl: "https://quotes.customer.test", fetchImpl: fetchImpl as never }),
    });

    const res = await publish(app, draft.quoteId, { acknowledgeSample: true });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.guestLink ?? null).toBeNull();
    expect(body.mirrorUrl ?? null).toBeNull();
    const stored = await (await app.request(`/v1/quotes/${draft.quoteId}${STAFF}`)).json();
    expect(stored.quotation.estimator?.sharedAt ?? null).toBeNull();
  });

  it("falls back to our own copy when the guest's app does not open the link it just issued", async () => {
    const draft = await pricedQuote("QT-PUB-UNVERIFIED");
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/commit")) {
        return new Response(JSON.stringify({ seq: 1 }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (String(url).includes("/api/share/")) {
        // The token their own `share` call just returned, which their app then cannot find.
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      return new Response(JSON.stringify({ url: "/quote/tok-dead", expiresAt: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const app = createApp({
      estimator: createEstimatorClient({ baseUrl: "https://quotes.customer.test", fetchImpl: fetchImpl as never }),
    });

    const res = await publish(app, draft.quoteId, { acknowledgeSample: true });
    const body = await res.json();

    expect(res.status).toBe(200);
    // Their link is kept (it is what their app said), and the copy is what the guest is sent.
    expect(body.guestUrl).toBe("https://quotes.customer.test/quote/tok-dead");
    expect(body.mirrorUrl).toContain(`/q/${draft.slug}`);
    expect(body.guestLink).toBe(body.mirrorUrl);
    expect(body.mirrorReason).toContain("did not recognise the link");

    const stored = await (await app.request(`/v1/quotes/${draft.quoteId}${STAFF}`)).json();
    expect(stored.quotation.estimator.mirrorUrl).toBe(body.mirrorUrl);
    expect(stored.quotation.estimator.sharedAt).toEqual(expect.any(String));

    // The copy is a page of ours and it opens: `/q/:slug` renders the engine's stored answer.
    const copy = await app.request(`/q/${draft.slug}`, { headers: { accept: "text/html" } });
    expect(copy.status).toBe(200);
    const html = await copy.text();
    expect(html).toContain("here is your quotation");
    expect(html).toContain("Ana");
    expect(html).toContain("2026-11-20");
    // No revenue on this fixture's pricing: the page must show NO figure rather than invent one. A
    // page that filled the gap with our own arithmetic is the page this whole flow retired.
    expect(html).not.toContain("₱");

    // With the engine's own figure on the record, the copy shows that figure and says where it is from.
    await saveQuotationDraft({
      ...stored.quotation,
      pricing: { ...stored.quotation.pricing, kpis: { ...stored.quotation.pricing.kpis, revenue: 31_200 } },
    });
    const withTotal = await (await app.request(`/q/${draft.slug}`, { headers: { accept: "text/html" } })).text();
    expect(withTotal).toContain("₱31,200");
    expect(withTotal).toContain("Total, from the resort's booking engine");
    // The engine's figure is the ONLY money on the page. This assertion is the one this test was
    // missing: it used to stop at "₱31,200" while the page also printed a ₱15,600 deposit and a
    // ₱15,600 balance that this service had computed by halving the total.
    expect(withTotal).not.toContain("15,600");
    expect(withTotal).not.toContain("Deposit Due");
    expect(withTotal).not.toContain("Balance Remaining");
  });

  it("keeps their link, and no copy, when their app opens what it issued", async () => {
    const draft = await pricedQuote("QT-PUB-VERIFIED");
    const asked: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      asked.push(String(url));
      if (String(url).endsWith("/commit")) {
        return new Response(JSON.stringify({ seq: 2 }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (String(url).includes("/api/share/")) {
        return new Response(JSON.stringify({ seq: 2 }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ url: "/quote/tok-live", expiresAt: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const app = createApp({
      estimator: createEstimatorClient({ baseUrl: "https://quotes.customer.test", fetchImpl: fetchImpl as never }),
    });

    const body = await (await publish(app, draft.quoteId, { acknowledgeSample: true })).json();

    expect(body.guestUrl).toBe("https://quotes.customer.test/quote/tok-live");
    expect(body.guestLink).toBe(body.guestUrl);
    expect(body.mirrorUrl).toBeNull();
    // The check is the guest's own request: their `/api/share/<token>`, not their share endpoint.
    expect(asked.some((u) => u.endsWith("/api/share/tok-live"))).toBe(true);
  });

  it("gives the guest our own copy when the engine has no guest app to link to", async () => {
    // The simulated engine answers `share` with a relative `/quote/sim-…`, and a deployment in that
    // mode has no app host to resolve it against — so before this, publishing left `guestUrl: null`
    // and `mirrorUrl: null`, and the Send step could only refuse for a reason nobody could act on. The
    // rehearsal deployment could not finish the flow it exists to rehearse.
    const draft = await pricedQuote("QT-PUB-SIM-COPY");
    const body = await (await publish(createApp(), draft.quoteId, { acknowledgeSample: true })).json();

    expect(body.guestUrl).toBeNull();
    expect(body.mirrorUrl).toContain(`/q/${draft.slug}`);
    expect(body.guestLink).toBe(body.mirrorUrl);
    expect(body.mirrorReason).toContain("no guest app");

    // And the copy is a page that opens, showing the engine's own answer for this revision.
    const copy = await createApp().request(`/q/${draft.slug}`, { headers: { accept: "text/html" } });
    expect(copy.status).toBe(200);
  });

  it("sends our copy even when their link works, when this deployment is set to", async () => {
    // GUEST_LINK_MODE=copy: for a demo on a deployment whose links are not durable, where a guest
    // page that may 404 at random in front of an audience is the thing to avoid.
    const draft = await pricedQuote("QT-PUB-FORCE-COPY");
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).endsWith("/commit")
        ? new Response(JSON.stringify({ seq: 1 }), { status: 200, headers: { "content-type": "application/json" } })
        : String(url).includes("/api/share/")
          ? new Response(JSON.stringify({ seq: 1 }), { status: 200, headers: { "content-type": "application/json" } })
          : new Response(JSON.stringify({ url: "/quote/tok-fine", expiresAt: null }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
    );
    const app = createApp({
      estimator: createEstimatorClient({ baseUrl: "https://quotes.customer.test", fetchImpl: fetchImpl as never }),
    });
    vi.stubEnv("GUEST_LINK_MODE", "copy");
    try {
      const body = await (await publish(app, draft.quoteId, { acknowledgeSample: true })).json();
      expect(body.mirrorUrl).toContain(`/q/${draft.slug}`);
      expect(body.guestLink).toBe(body.mirrorUrl);
      expect(body.mirrorReason).toContain("set to send our own copy");
      // Their link is still recorded — the copy is an addition, not a replacement of the record.
      expect(body.guestUrl).toBe("https://quotes.customer.test/quote/tok-fine");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("joins the guest link to the APP host when their app is not on the API host", async () => {    // Their local dev setup splits them (`npm run dev -w bff` → API on :8787, `dev:app` → the app on
    // :5173). Joining a guest link to the API host there produces a URL that 404s while the token
    // behind it is valid — measured against their own BFF, which is why the host is configurable.
    const draft = await pricedQuote("QT-PUB-8");
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/commit")) {
        return new Response(JSON.stringify({ seq: 1 }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ url: "/quote/tok-split" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const app = createApp({
      estimator: createEstimatorClient({
        baseUrl: "http://api.test:8787",
        appUrl: "http://app.test:5173",
        fetchImpl: fetchImpl as never,
      }),
    });

    const body = await (await publish(app, draft.quoteId, { acknowledgeSample: true })).json();
    expect(body.guestUrl).toBe("http://app.test:5173/quote/tok-split");
  });

  it("falls back to the API host, which is what production is", async () => {
    const draft = await pricedQuote("QT-PUB-9");
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).endsWith("/commit")
        ? new Response(JSON.stringify({ seq: 1 }), { status: 200, headers: { "content-type": "application/json" } })
        : new Response(JSON.stringify({ url: "/quote/tok-same" }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const app = createApp({
      estimator: createEstimatorClient({ baseUrl: "https://quotes.customer.test", fetchImpl: fetchImpl as never }),
    });

    const body = await (await publish(app, draft.quoteId, { acknowledgeSample: true })).json();
    expect(body.guestUrl).toBe("https://quotes.customer.test/quote/tok-same");
  });

  it("joins their relative link to the host we called, and does not invent one when there is none", async () => {
    const draft = await pricedQuote("QT-PUB-7");
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/commit")) {
        return new Response(JSON.stringify({ seq: 3 }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ url: "/quote/tok-abc", expiresAt: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const app = createApp({
      estimator: createEstimatorClient({ baseUrl: "https://quotes.customer.test", fetchImpl: fetchImpl as never }),
    });

    const res = await publish(app, draft.quoteId, { acknowledgeSample: true });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.guestUrl).toBe("https://quotes.customer.test/quote/tok-abc");
    expect(body.seq).toBe(3);
  });
});

describe("the estimated session cookie", () => {
  it("is captured from the response and replayed on every later call about that quotation", async () => {
    const seen: Array<{ url: string; cookie: string | null }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      seen.push({ url: String(url), cookie: headers.cookie ?? null });
      if (String(url).endsWith("/commit")) {
        return new Response(JSON.stringify({ seq: 1 }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (String(url).endsWith("/share")) {
        return new Response(JSON.stringify({ url: "/quote/tok" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ id: "sc-1", model: {}, issues: [] }), {
        status: 201,
        headers: { "content-type": "application/json", "set-cookie": "ubg_sid=sc-1; Path=/; HttpOnly" },
      });
    });

    const client = createEstimatorClient({ baseUrl: "https://quotes.customer.test", fetchImpl: fetchImpl as never });
    const trip = buildBffTrip(sampleTrip());

    const first = await client.sendEstimate(trip);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // Attributes are stripped: replaying `Path=…; HttpOnly` would send them as part of the value.
    expect(first.sessionCookie).toBe("ubg_sid=sc-1");

    const session = { id: first.id ?? "sc-1", cookie: first.sessionCookie };
    await client.commit(session, trip);
    const shared = await client.share(session);

    // Found by URL, not by position: `sendEstimate` also probes their `/api/health` for the sample
    // label, so the calls are not one-per-line in the mock's log.
    const estimateCall = seen.find((s) => s.url.endsWith("/api/estimates"));
    const commitCall = seen.find((s) => s.url.endsWith("/commit"));
    const shareCall = seen.find((s) => s.url.endsWith("/share"));

    // The first call is a new session and must not carry a cookie; the next two must.
    expect(estimateCall!.cookie).toBeNull();
    expect(commitCall!.cookie).toBe("ubg_sid=sc-1");
    expect(shareCall!.cookie).toBe("ubg_sid=sc-1");

    expect(shared.ok).toBe(true);
    if (!shared.ok) return;
    // Their `url` is kept relative: only the caller knows which host the guest should be sent to.
    expect(shared.url).toBe("/quote/tok");
  });

  it("maps their 409 on share to the refusal it is, rather than minting a link of our own", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "save first", reason: "no-snapshot" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createEstimatorClient({ baseUrl: "https://quotes.customer.test", fetchImpl: fetchImpl as never });

    const res = await client.share({ id: "sc-1", cookie: "ubg_sid=sc-1" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("no_snapshot");
  });

  it("will not call their commit or share without a scenario id", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = createEstimatorClient({ baseUrl: "https://quotes.customer.test", fetchImpl: fetchImpl as never });

    const commit = await client.commit({ id: null, cookie: null }, buildBffTrip(sampleTrip()));
    expect(commit.ok).toBe(false);
    const share = await client.share({ id: null, cookie: null });
    expect(share.ok).toBe(false);
    // Nothing left the process — there is no scenario to address.
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the simulated engine's publish sequence", () => {
  it("refuses to share before anything is committed, the way their route does", async () => {
    const port = createSimulatedEstimator();
    const trip = buildBffTrip(sampleTrip());
    const priced = await port.sendEstimate(trip);
    expect(priced.ok).toBe(true);
    if (!priced.ok) return;
    const session = { id: priced.id, cookie: priced.sessionCookie };

    const early = await port.share(session);
    expect(early.ok).toBe(false);
    if (early.ok) return;
    expect(early.reason).toBe("no_snapshot");

    const committed = await port.commit(session, trip);
    expect(committed.ok).toBe(true);
    const shared = await port.share(session);
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;
    expect(shared.url).toContain("/quote/sim-");
  });

  it("re-pricing keeps the scenario and the session, rather than starting a second one", async () => {
    const port = createSimulatedEstimator();
    const trip = buildBffTrip(sampleTrip());
    const first = await port.sendEstimate(trip);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await port.sendEstimate(trip, { id: first.id, cookie: first.sessionCookie });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.id).toBe(first.id);
    expect(second.sessionCookie).toBe(first.sessionCookie);
  });
});
