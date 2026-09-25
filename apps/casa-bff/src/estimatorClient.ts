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
 * this service has no session to click with. The commit/share sequence that mints their real
 * `/quote/<token>` link is noted at the bottom of this file; it is deliberately not implemented
 * because those endpoints are not on their `main`.
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
      /**
       * True when the price came from captured data rather than Odoo.
       *
       * Two sources, because their fixture does not currently set the flag their own docs
       * promise: their response body when it says so, or our probe of `GET /api/health`
       * reporting `mode: 'fixture'` (see `fixtureMode`). Either one is enough.
       */
      sample: boolean;
      /** Their reported mode, when we could establish it. `null` means we could not. */
      mode: "fixture" | "odoo" | null;
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

/**
 * What mode is their BFF in — fixture (captured data) or odoo (real pricing)?
 *
 * Exists because their fixture does not set the `sample` flag their own `schema.md` §7 says it
 * should: on their `main`, the string `sample` appears nowhere in `bff/src`, so a captured price
 * comes back looking exactly like a real one. Verified against their BFF at `4c48918`: a
 * fixture-mode response carried `sample: false` because nothing sets it.
 *
 * Their health endpoint does report the mode, so this asks it once and remembers the answer
 * briefly. It is deliberately best-effort: an unreachable `/api/health` returns null and never
 * fails a pricing call — this is a safety label, not a gate.
 */
const HEALTH_PATH = "/api/health";
const MODE_CACHE_MS = 60_000;

export function createEstimatorClient(options: EstimatorClientOptions = {}) {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let cachedMode: { mode: "fixture" | "odoo"; at: number } | null = null;

  async function probeMode(baseUrl: string): Promise<"fixture" | "odoo" | null> {
    if (cachedMode && Date.now() - cachedMode.at < MODE_CACHE_MS) return cachedMode.mode;
    try {
      const res = await doFetch(`${baseUrl}${HEALTH_PATH}`, {
        signal: AbortSignal.timeout(Math.min(timeoutMs, 5_000)),
      });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => ({}))) as { mode?: unknown };
      const mode = body.mode === "fixture" ? "fixture" : body.mode === "odoo" ? "odoo" : null;
      if (mode) cachedMode = { mode, at: Date.now() };
      return mode;
    } catch {
      // A health probe must never break pricing. Nothing to label, so nothing is claimed.
      return null;
    }
  }

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
      // Their flag if they sent one, otherwise our own probe. `sample: true` from either source
      // is enough: the point is that a captured price is never presented as a real one.
      const mode = (parsed.mode === "fixture" || parsed.mode === "odoo" ? parsed.mode : null) ?? (await probeMode(baseUrl));
      return {
        ok: true,
        status: res.status,
        id: typeof parsed.id === "string" ? parsed.id : null,
        role: typeof parsed.role === "string" ? parsed.role : null,
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        computedAt: typeof parsed.computedAt === "string" ? parsed.computedAt : null,
        model: parsed.model,
        sample: parsed.sample === true || mode === "fixture",
        mode,
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
   * Is their BFF answering, and in which mode? Used by the studio's pre-flight badge so staff do
   * not discover a missing/incorrect `ESTIMATOR_BASE_URL` by clicking a button and reading a 503.
   *
   * Never throws: an unreachable BFF is an answer (`reachable: false`), not an error.
   */
  async function checkHealth(): Promise<{ reachable: boolean; mode: "fixture" | "odoo" | null }> {
    const baseUrl = options.baseUrl?.replace(/\/+$/, "") ?? estimatorBaseUrl();
    if (!baseUrl) return { reachable: false, mode: null };
    const mode = await probeMode(baseUrl);
    // probeMode returns null for both "answered, mode unstated" and "did not answer". Distinguish
    // them here, because the badge should say which — one is a config problem, the other is not.
    if (mode) return { reachable: true, mode };
    try {
      const res = await doFetch(`${baseUrl}${HEALTH_PATH}`, {
        signal: AbortSignal.timeout(Math.min(timeoutMs, 5_000)),
      });
      return { reachable: res.ok, mode: null };
    } catch {
      return { reachable: false, mode: null };
    }
  }

  // The next step in this integration is their commit/share sequence, which mints the real
  // `/quote/<token>` guest link:
  //
  //   POST /api/estimates            -> { id, model, issues } + Set-Cookie: ubg_sid=...
  //   POST /api/estimates/:id/commit -> freezes a revision
  //   POST /api/estimates/:id/share  -> { url: '/quote/<token>', expiresAt }
  //
  // It is NOT implemented here, on purpose. Those two endpoints do not exist on their `main`
  // (commit `4c48918`, which is the branch their docs describe as current) — they live on the
  // unmerged `feat/p2-booking`. A working client for them was written and tested here and then
  // removed: it was reachable from no route, and wiring it would have produced 404s against the
  // only BFF we can actually run. Re-add it from git history (commit `c00db6b`) when
  // `feat/p2-booking` merges. Until then the guest-facing link is our own `/q/:slug`, and this
  // client's job is to price — not to publish.
  return { sendEstimate, checkHealth, baseUrl: options.baseUrl ?? estimatorBaseUrl() };
}
