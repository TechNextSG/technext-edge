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
      id: string | null;
      role: string | null;
      issues: unknown[];
      computedAt: string | null;
      /** Their computed model. Shape is theirs; we pass it through untouched. */
      model: unknown;
      /** True when their BFF answered from captured data rather than Odoo. */
      sample: boolean;
      /** Set-Cookie ubg_sid value when returned by POST /api/estimates. */
      cookie?: string | null;
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

export type ShareLinkResult =
  | {
      ok: true;
      id: string;
      revision: number | null;
      quoteUrl: string;
      fullQuoteUrl: string;
      expiresAt: string | null;
      model: unknown;
      issues: unknown[];
      sample: boolean;
      computedAt: string | null;
    }
  | {
      ok: false;
      reason:
        | "not_configured"
        | "no_validated_trip"
        | "unreachable"
        | "timeout"
        | "rejected"
        | "sanity_gate_blocked"
        | "missing_session_cookie"
        | "commit_failed"
        | "share_failed"
        | "unexpected";
      status: number | null;
      detail: string;
      fields: string[];
      issues?: unknown[];
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

function extractUbgSidCookie(res: Response): string | null {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = /ubg_sid=([^;]+)/.exec(setCookie);
  return match?.[1] ? `ubg_sid=${match[1]}` : null;
}

export function createEstimatorClient(options: EstimatorClientOptions = {}) {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function sendEstimate(trip: BffTrip | null | undefined): Promise<EstimateSendResult> {
    if (!trip) {
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

    if (res.status === 200 || res.status === 201) {
      return {
        ok: true,
        status: res.status,
        id: typeof parsed.id === "string" ? parsed.id : null,
        role: typeof parsed.role === "string" ? parsed.role : null,
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        computedAt: typeof parsed.computedAt === "string" ? parsed.computedAt : null,
        model: parsed.model,
        sample: parsed.sample === true,
        cookie: extractUbgSidCookie(res),
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

  /**
   * Executes the full P5 Direction A sequence (`schema.md` §4 & §5):
   *   1. `POST /api/estimates { trip }` (receives `201 { id, model, issues }` + `Set-Cookie: ubg_sid=...`)
   *   2. Enforces the Post-Compute Sanity Gate (`issues.length === 0`)
   *   3. `POST /api/estimates/:id/commit` (freezes revision)
   *   4. `POST /api/estimates/:id/share` (mints `/quote/<token>`)
   */
  async function createShareLink(trip: BffTrip | null | undefined): Promise<ShareLinkResult> {
    const baseUrl = options.baseUrl?.replace(/\/+$/, "") ?? estimatorBaseUrl();
    const est = await sendEstimate(trip);
    if (!est.ok) return est;

    if (est.issues.length > 0) {
      return {
        ok: false,
        reason: "sanity_gate_blocked",
        status: est.status,
        detail: "Post-compute sanity check reported issues; refusing to issue guest share link",
        fields: [],
        issues: est.issues,
      };
    }

    if (!est.id || !est.cookie || !baseUrl) {
      return {
        ok: false,
        reason: "missing_session_cookie",
        status: est.status,
        detail: "Estimate response did not include scenario id or ubg_sid session cookie",
        fields: [],
      };
    }

    const commitRes = await doFetch(`${baseUrl}/api/estimates/${est.id}/commit`, {
      method: "POST",
      headers: { cookie: est.cookie },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (commitRes.status !== 200 && commitRes.status !== 201) {
      return {
        ok: false,
        reason: "commit_failed",
        status: commitRes.status,
        detail: `POST /api/estimates/${est.id}/commit returned HTTP ${commitRes.status}`,
        fields: [],
      };
    }
    const commitBody = (await commitRes.json().catch(() => ({}))) as Record<string, unknown>;
    const revision = typeof commitBody.revision === "number" ? commitBody.revision : null;

    const shareRes = await doFetch(`${baseUrl}/api/estimates/${est.id}/share`, {
      method: "POST",
      headers: { cookie: est.cookie },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (shareRes.status !== 200 && shareRes.status !== 201) {
      return {
        ok: false,
        reason: "share_failed",
        status: shareRes.status,
        detail: `POST /api/estimates/${est.id}/share returned HTTP ${shareRes.status}`,
        fields: [],
      };
    }
    const shareBody = (await shareRes.json().catch(() => ({}))) as Record<string, unknown>;
    const quoteUrl = typeof shareBody.url === "string" ? shareBody.url : "";

    return {
      ok: true,
      id: est.id,
      revision,
      quoteUrl,
      fullQuoteUrl: `${baseUrl}${quoteUrl}`,
      expiresAt: typeof shareBody.expiresAt === "string" ? shareBody.expiresAt : null,
      model: est.model,
      issues: est.issues,
      sample: est.sample,
      computedAt: est.computedAt,
    };
  }

  return { sendEstimate, createShareLink, baseUrl: options.baseUrl ?? estimatorBaseUrl() };
}
