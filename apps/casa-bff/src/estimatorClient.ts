/**
 * Client for the real estimator BFF — the only path from this service to Odoo.
 *
 * The edge spec is explicit (`docs/06-p5-bff-schema-contract.md` §1): *"Mọi lời gọi đi qua BFF
 * (`/api/*`). Không gọi `/v1/*` của Odoo trực tiếp, không cầm `api-key` nào. Key Odoo chỉ sống
 * ở server."* This module is that rule, in code: it sends the validated `Trip` to
 * `POST {ESTIMATOR_BASE_URL}/api/estimates` and holds no Odoo credential of any kind.
 *
 * It replaces a hand-rolled "GAIS" envelope that signed an HMAC and pointed at
 * `https://erp.casaescondida.ph/api/v1/casa/quotations` — a direct call to Odoo, with a
 * fallback HMAC secret and a placeholder bearer token hardcoded in `app.ts`. That path was
 * built to a shape no one had agreed to, was never reachable in any environment we can
 * deploy, and every one of its consumers only ever read the `bffTrip` field out of it. It is
 * gone rather than kept alongside this one; two parallel paths to Odoo is precisely how the
 * two drift.
 *
 * ## What this does and does not do
 *
 * It prices. If the response says the payload would be rejected, that is a **bug in what this
 * service produces** and it is surfaced as a failure with the offending field names, because
 * `fillTrip` on their side is the authority on the contract — our own
 * `validateBffTripPrecheck()` is only a mirror of it, and a mirror is what disagrees silently.
 *
 * It does **not** commit, share or submit. Those are separate BFF endpoints that belong to a
 * signed-in staff member clicking a button (spec §13: `submit` is "Không bao giờ … Từ AI"), and
 * this service has no session to click with.
 */
import type { BffTrip } from "../../../packages/extractor/src/schema.js";

/** Path of the estimate endpoint on the estimator BFF. */
export const ESTIMATE_PATH = "/api/estimates";

/**
 * Default to the local fixture-mode BFF that their own docs describe (`npm run dev -w bff`,
 * `FIXTURE_MODE=1`, port 8787). Deliberately NOT a production hostname: this constant is what
 * a misconfigured deploy falls back to, and a fallback that silently points at production is
 * worse than one that obviously points at a laptop.
 */
export const DEFAULT_ESTIMATOR_BASE_URL = "http://127.0.0.1:8787";

/** One compute is synchronous on their side; fixture mode answers in ~1ms, Odoo in ~8s. */
const DEFAULT_TIMEOUT_MS = Number(process.env.ESTIMATOR_TIMEOUT_MS ?? 12_000);

export type EstimateSendResult =
  | {
      ok: true;
      status: number;
      role: string | null;
      issues: unknown[];
      computedAt: string | null;
      /** Their computed model. Shape is theirs; we pass it through untouched. */
      model: unknown;
      /** True when their BFF answered from captured data rather than Odoo. */
      sample: boolean;
    }
  | {
      ok: false;
      /** `rejected` is the one that means WE sent something wrong. */
      reason: "not_configured" | "no_validated_trip" | "unreachable" | "timeout" | "rejected" | "unexpected";
      status: number | null;
      detail: string;
      /** Field names their `fillTrip` named as missing or invalid, when it named any. */
      fields: string[];
    };

export interface EstimatorClientOptions {
  baseUrl?: string;
  /** Test seam. Injectable so tests never touch the network, and never mock our own logic. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function estimatorBaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  // Read lazily rather than at module load: tests set this per case, and on Vercel env vars are
  // not guaranteed to exist when the module is first evaluated.
  const raw = env.ESTIMATOR_BASE_URL;
  return raw && raw.trim() !== "" ? raw.replace(/\/+$/, "") : undefined;
}

/**
 * The request body. Split out from sending it so a test can assert the exact payload without a
 * server, and so the same builder can be diffed against `contracts/odoo/examples/requests/`.
 */
export function buildEstimateRequest(trip: BffTrip): { body: string } {
  // `{trip}` is the whole contract: `POST /api/estimates` takes `{trip, ui?}` and the `ui` half
  // is optional layout state we have no opinion about.
  return { body: JSON.stringify({ trip }) };
}

export function createEstimatorClient(options: EstimatorClientOptions = {}) {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function sendEstimate(trip: BffTrip | null | undefined): Promise<EstimateSendResult> {
    if (!trip) {
      // Refuse before touching the network. A draft that was never built from an extraction
      // `Trip` has no guest-level facts, and inventing a payload to satisfy the contract is the
      // failure mode this whole pipeline exists to prevent.
      return {
        ok: false,
        reason: "no_validated_trip",
        status: null,
        detail: "no validated BffTrip on this quotation, so there is nothing to send",
        fields: [],
      };
    }

    const baseUrl = options.baseUrl?.replace(/\/+$/, "") ?? estimatorBaseUrl();
    if (!baseUrl) {
      return {
        ok: false,
        reason: "not_configured",
        status: null,
        detail: "ESTIMATOR_BASE_URL is not set",
        fields: [],
      };
    }

    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${ESTIMATE_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: buildEstimateRequest(trip).body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const aborted = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return {
        ok: false,
        reason: aborted ? "timeout" : "unreachable",
        status: null,
        detail: aborted
          ? `estimator BFF did not answer within ${timeoutMs}ms`
          : err instanceof Error
            ? err.message
            : String(err),
        fields: [],
      };
    }

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Leave `parsed` empty; the raw text goes into `detail` below.
    }

    if (res.status === 200) {
      return {
        ok: true,
        status: res.status,
        role: typeof parsed.role === "string" ? parsed.role : null,
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        computedAt: typeof parsed.computedAt === "string" ? parsed.computedAt : null,
        model: parsed.model,
        sample: parsed.sample === true,
      };
    }

    const fields = Array.isArray(parsed.fields) ? parsed.fields.map(String) : [];
    const detail =
      typeof parsed.error === "string" ? parsed.error : text.slice(0, 300) || `HTTP ${res.status}`;

    return {
      ok: false,
      reason: res.status === 422 ? "rejected" : "unexpected",
      status: res.status,
      detail,
      fields,
    };
  }

  return { sendEstimate, baseUrl: options.baseUrl ?? estimatorBaseUrl() };
}
