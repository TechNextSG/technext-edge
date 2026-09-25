// The estimator client is the only path from this service to Odoo, so these tests pin the
// things that would otherwise be discovered by a 422 in production.
//
// `fetch` is the seam that gets faked, never our own serialization: `buildEstimateRequest()` is
// real code under test, and `sendEstimate()` runs its real body-parsing and status mapping. That
// is the difference between testing this layer and testing a mock of this layer.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildEstimateRequest,
  createEstimatorClient,
  estimatorBaseUrl,
  DEFAULT_ESTIMATOR_BASE_URL,
  ESTIMATE_PATH,
} from "../../../apps/casa-bff/src/estimatorClient.js";
import { buildBffTrip } from "../../../packages/extractor/src/odooHandoff.js";
import type { BffTrip, Trip } from "../../../packages/extractor/src/schema.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** A complete, valid trip, so the payload under test is one the contract accepts. */
function sampleTrip(): BffTrip {
  const f = <T,>(value: T | null, state = "stated") => ({ value, state, evidence: null });
  const trip = {
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
    divers: f(2),
    diveFrom: f("2026-11-21"),
    diveTo: f("2026-11-21"),
    diveNotes: f(null, "missing"),
    specialRequests: f(null, "missing"),
    guestNames: f([]),
  } as Trip;
  return buildBffTrip(trip);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("buildEstimateRequest", () => {
  it("wraps the trip in `{trip}`, which is the whole contract", () => {
    const trip = sampleTrip();
    const { body } = buildEstimateRequest(trip);
    expect(JSON.parse(body)).toEqual({ trip });
  });

  it("sends only `trip` — no amounts, no slug, no GAIS envelope", () => {
    // Pricing is Odoo's, reached through the BFF. A client that also shipped our own subtotal
    // would create a second source of pricing truth in the request.
    const parsed = JSON.parse(buildEstimateRequest(sampleTrip()).body) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["trip"]);
    expect(buildEstimateRequest(sampleTrip()).body).not.toContain("subtotal");
    expect(buildEstimateRequest(sampleTrip()).body).not.toContain("GAIS");
    expect(buildEstimateRequest(sampleTrip()).body).not.toContain("sale.order");
  });

  it("carries the per-guest facts the contract requires, not flattened counts", () => {
    const parsed = JSON.parse(buildEstimateRequest(sampleTrip()).body) as {
      trip: { guests: Array<Record<string, unknown>> };
    };
    expect(Array.isArray(parsed.trip.guests)).toBe(true);
    for (const g of parsed.trip.guests) {
      expect(g).toHaveProperty("roomId");
      expect(g).toHaveProperty("diver");
      expect(g).toHaveProperty("days");
    }
  });
});

describe("estimatorBaseUrl", () => {
  it("reads ESTIMATOR_BASE_URL and strips trailing slashes", () => {
    expect(estimatorBaseUrl({ ESTIMATOR_BASE_URL: "http://example.test:8787/" } as NodeJS.ProcessEnv)).toBe(
      "http://example.test:8787",
    );
  });

  it("treats empty and whitespace as unset, so a blank env var is not a URL", () => {
    expect(estimatorBaseUrl({ ESTIMATOR_BASE_URL: "" } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(estimatorBaseUrl({ ESTIMATOR_BASE_URL: "   " } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(estimatorBaseUrl({} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("does not default to a production hostname", () => {
    // A fallback that silently points at production is worse than one that points at a laptop.
    expect(DEFAULT_ESTIMATOR_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(DEFAULT_ESTIMATOR_BASE_URL).not.toContain("casaescondida");
    expect(ESTIMATE_PATH).toBe("/api/estimates");
  });
});

describe("sendEstimate", () => {
  it("POSTs the trip to {base}/api/estimates as JSON", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { role: "guest", issues: [], model: {}, computedAt: "now" }));
    const client = createEstimatorClient({ baseUrl: "http://bff.test", fetchImpl: fetchImpl as never });

    const res = await client.sendEstimate(sampleTrip());

    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://bff.test/api/estimates");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(String(init.body))).toHaveProperty("trip");
  });

  it("maps their 422 to `rejected` and keeps the field names", async () => {
    // This is the outcome that matters most: a 422 is a defect in what WE produce. Losing the
    // field names would turn a precise, fixable report into "it didn't work".
    const fetchImpl = vi.fn(async () =>
      jsonResponse(422, { error: "Thiếu field bắt buộc", fields: ["transportType", "guests[0].roomId"] }),
    );
    const client = createEstimatorClient({ baseUrl: "http://bff.test", fetchImpl: fetchImpl as never });

    const res = await client.sendEstimate(sampleTrip());

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("rejected");
    expect(res.status).toBe(422);
    expect(res.fields).toEqual(["transportType", "guests[0].roomId"]);
  });

  it("distinguishes unreachable from rejected — they mean different things", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const client = createEstimatorClient({ baseUrl: "http://bff.test", fetchImpl: fetchImpl as never });

    const res = await client.sendEstimate(sampleTrip());
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("unreachable");
    expect(res.status).toBeNull();
  });

  it("reports a timeout as a timeout, not as a generic failure", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    });
    const client = createEstimatorClient({ baseUrl: "http://bff.test", fetchImpl: fetchImpl as never });

    const res = await client.sendEstimate(sampleTrip());
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("timeout");
  });

  it("passes their pricing warnings through instead of swallowing them", async () => {
    const issues = [{ code: "transport-revenue-zero", text: "no van revenue" }];
    const fetchImpl = vi.fn(async () => jsonResponse(200, { role: "guest", issues, model: { total: 1 }, computedAt: "t" }));
    const client = createEstimatorClient({ baseUrl: "http://bff.test", fetchImpl: fetchImpl as never });

    const res = await client.sendEstimate(sampleTrip());
    if (!res.ok) throw new Error("expected ok");
    expect(res.issues).toEqual(issues);
    expect(res.sample).toBe(false);
  });

  it("flags `sample` when their BFF answered from captured data", async () => {
    // Fixture mode must be visible: a captured number shown to staff as a real price is the
    // failure mode their own docs call out.
    const fetchImpl = vi.fn(async () => jsonResponse(200, { role: "guest", issues: [], sample: true, model: {} }));
    const client = createEstimatorClient({ baseUrl: "http://bff.test", fetchImpl: fetchImpl as never });

    const res = await client.sendEstimate(sampleTrip());
    if (!res.ok) throw new Error("expected ok");
    expect(res.sample).toBe(true);
  });

  it("refuses to send when there is no validated trip, without touching the network", async () => {
    const fetchImpl = vi.fn();
    const client = createEstimatorClient({ baseUrl: "http://bff.test", fetchImpl: fetchImpl as never });

    for (const nothing of [null, undefined]) {
      const res = await client.sendEstimate(nothing);
      if (res.ok) throw new Error("unreachable");
      expect(res.reason).toBe("no_validated_trip");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses to send when no base URL is configured, without touching the network", async () => {
    const saved = process.env.ESTIMATOR_BASE_URL;
    delete process.env.ESTIMATOR_BASE_URL;
    const fetchImpl = vi.fn();
    try {
      const client = createEstimatorClient({ fetchImpl: fetchImpl as never });
      const res = await client.sendEstimate(sampleTrip());
      if (res.ok) throw new Error("unreachable");
      expect(res.reason).toBe("not_configured");
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (saved !== undefined) process.env.ESTIMATOR_BASE_URL = saved;
    }
  });

  it("survives a non-JSON error body rather than throwing on it", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>gateway exploded</html>", { status: 502 }));
    const client = createEstimatorClient({ baseUrl: "http://bff.test", fetchImpl: fetchImpl as never });

    const res = await client.sendEstimate(sampleTrip());
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("unexpected");
    expect(res.status).toBe(502);
    expect(res.detail).toContain("gateway exploded");
  });
});
