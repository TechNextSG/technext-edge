/**
 * Client for the real estimator BFF — the only path from this service to Odoo.
 *
 * The edge spec is explicit (`docs/specs/06-p5-bff-schema-contract.md` §1): *"Mọi lời gọi đi qua BFF
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
 * `fillTrip` on the team estimator's side is the authority on the contract — our own
 * `validateBffTripPrecheck()` is only a mirror of it, and a mirror is what disagrees silently.
 *
 * It does **not** commit, share or submit. Those are separate BFF endpoints that belong to a
 * signed-in staff member clicking a button (spec §13: `submit` is "Không bao giờ … Từ AI"), and
 * this service has no session to click with. The commit/share sequence that mints their real
 * `/quote/<token>` link is noted at the bottom of this file; it is deliberately not implemented
 * because those endpoints are not on their `main`.
 */
import { loadEnv, type Env } from "../env.ts";
import type { BffTrip } from "../../../ai/src/index.ts";
import { describeRefusal, refusalCode, refusalIssues } from "./refusalCopy.ts";
import type {
  CommitResult,
  EstimateSendResult,
  EstimatorFailure,
  EstimatorHealth,
  EstimatorSession,
  GuestLinkCheck,
  ShareResult,
  SubmitInput,
  SubmitResult,
} from "./port.ts";

// Re-exported so existing importers keep working. This type was defined here until the simulated
// port needed the same definition; one type with two implementations is what keeps them honest.
export type { EstimateSendResult };

/** Path of the estimate endpoint on the estimator BFF. */
export const ESTIMATE_PATH = "/api/estimates";

/**
 * Default to the local fixture-mode BFF that the team estimator's own docs describe (`npm run dev -w bff`,
 * `FIXTURE_MODE=1`, port 8787). Deliberately NOT a production hostname: this constant is what
 * a misconfigured deploy falls back to, and a fallback that silently points at production is
 * worse than one that obviously points at a laptop.
 */
export const DEFAULT_ESTIMATOR_BASE_URL = "http://127.0.0.1:8787";

/** One compute is synchronous on the team estimator's side; fixture mode answers in ~1ms, Odoo in ~8s. */
const DEFAULT_TIMEOUT_MS = Number(loadEnv().ESTIMATOR_TIMEOUT_MS ?? 12_000);

/**
 * What to tell a person when the team estimator's engine refuses.
 *
 * The team estimator's BFF is only one of the things that can answer on that hostname. A Vercel preview behind
 * SSO answers with an HTML sign-in page, a proxy answers with its own error document, and a wrong
 * path answers with a 404 page. Pasting 300 characters of any of those into the studio puts markup
 * and vendor jargon in front of a receptionist who is taking a booking — and it was measured, not
 * imagined: a preview deployment answering its SSO page made the studio look like the *quotation*
 * was broken.
 *
 * So the rule is: **a sentence they wrote travels; a document they did not, does not.** The raw body
 * is still logged, because whoever debugs the integration needs it — just not on the screen of the
 * person selling the room. A refusal without an explanation is still a refusal, so it never throws.
 */
function refusalDetail(parsed: Record<string, unknown>, text: string, status: number): string {
  // Their `error` sentence is in Vietnamese, but their `code` and `issues` are stable: say those in English first.
  const translated = describeRefusal(parsed);
  if (translated) return translated;

  const said = typeof parsed.error === "string" ? parsed.error.trim() : "";
  // Their own error sentence, as long as it is a sentence: no markup, no JSON, nothing huge.
  if (said && said.length <= 300 && !/[<>{}]/.test(said)) return said;

  const fields = Array.isArray(parsed.fields) ? parsed.fields.map(String).filter(Boolean) : [];
  if (fields.length > 0) return `their engine refused this trip — check: ${fields.join(", ")}`;

  // eslint-disable-next-line no-console
  console.error("estimator refused", status, text.slice(0, 300));
  if (/<!doctype|<html|<\?xml/i.test(text)) {
    return `their engine answered HTTP ${status} with a web page instead of a price — the address is likely behind a sign-in, or is not the estimation API`;
  }
  return `their engine answered HTTP ${status} without saying why`;
}

/**
 * A transport failure, as one sentence for the studio, with the raw cause left in the log.
 *
 * The counterpart of `refusalDetail` for the case where nothing answered at all. `err.message` from a
 * failed `fetch` is the runtime's own text — "fetch failed", "getaddrinfo ENOTFOUND their-host" — which
 * is occasionally useful to us, never a sentence for the person selling the room, and it can carry the
 * hostname of a deployment. So it goes to the log and the caller gets what to check instead.
 */
function transportDetail(err: unknown, what: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`estimator ${what} failed`, raw);
  return `could not reach the booking engine to ${what} — check the estimator address in the deployment settings`;
}

/** The headers for one call about one quotation: JSON, plus their session cookie when we hold one. */
function sessionHeaders(session?: EstimatorSession | null): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (session?.cookie) headers.cookie = session.cookie;
  return headers;
}

/**
 * The `name=value` half of the first `Set-Cookie` on a response, or null.
 *
 * The attributes are stripped because we replay this with `fetch`, which runs no cookie jar:
 * sending `Path`, `HttpOnly`, `Expires` or `SameSite` back would send them as part of the value.
 * `getSetCookie()` is the multi-cookie accessor; `get("set-cookie")` is the fallback for a runtime
 * that does not have it.
 */
function readSetCookie(res: Response): string | null {
  const all = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const raw = all[0] ?? res.headers.get("set-cookie") ?? "";
  const pair = raw.split(";")[0]?.trim() ?? "";
  return pair.includes("=") ? pair : null;
}

export interface EstimatorClientOptions {
  baseUrl?: string;
  /** The host their guest pages are served from, when it is not `baseUrl`. See `estimatorAppUrl`. */
  appUrl?: string;
  /** Test seam. Injectable so tests never touch the network, and never mock our own logic. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function estimatorBaseUrl(env: Env = loadEnv()): string | undefined {
  // Read lazily rather than at module load: tests set this per case, and on Vercel env vars are
  // not guaranteed to exist when the module is first evaluated.
  const raw = env.ESTIMATOR_BASE_URL;
  return raw && raw.trim() !== "" ? raw.replace(/\/+$/, "") : undefined;
}

/**
 * The host their guest pages are served from, when it is not the API host.
 *
 * Their local dev setup needs it: `npm run dev -w bff` puts the API on :8787 and
 * `npm run dev:app -w bff` puts the app on :5173, so a guest link joined to the API host 404s even
 * though the token is valid. In production it is one Vercel project and this stays unset.
 */
export function estimatorAppUrl(env: Env = loadEnv()): string | undefined {
  const raw = env.ESTIMATOR_APP_URL;
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
 * What mode is the team estimator's BFF in — fixture (captured data) or odoo (real pricing)?
 *
 * Exists because the team estimator's fixture does not set the `sample` flag their own `schema.md` §7 says it
 * should: on their `main`, the string `sample` appears nowhere in `bff/src`, so a captured price
 * comes back looking exactly like a real one. Verified against the team estimator's BFF at `4c48918`: a
 * fixture-mode response carried `sample: false` because nothing sets it.
 *
 * Their health endpoint does report the mode, so this asks it once and remembers the answer
 * briefly. It is deliberately best-effort: an unreachable `/api/health` returns null and never
 * fails a pricing call — this is a safety label, not a gate.
 */
const HEALTH_PATH = "/api/health";
const MODE_CACHE_MS = 60_000;

/**
 * Where a guest's page resolves the token in its link — the request the team estimator's app makes the moment
 * somebody opens `/quote/<token>`. Checking the link means making that request ourselves.
 */
const SHARE_PATH = "/api/share";

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

  async function sendEstimate(
    trip: BffTrip | null | undefined,
    session?: EstimatorSession,
  ): Promise<EstimateSendResult> {
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
        headers: sessionHeaders(session),
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
          : transportDetail(err, "price this trip"),
        fields: [],
      };
    }

    return interpretEstimate(res, baseUrl, session);
  }

  /**
   * The body of an estimate call, read the same way for both verbs.
   *
   * Their `PATCH /api/estimates/:id` answers the same shape as their `POST`
   * (`{id, role, model, retail_model, issues, computedAt, sample}`), and the studio must not care
   * which verb produced a price. Reading it in one place is what stops the two from drifting into
   * "an edited trip shows a cost but no per-guest cards", which is the kind of difference nobody
   * notices until a demo.
   */
  async function interpretEstimate(
    res: Response,
    baseUrl: string,
    session?: EstimatorSession,
  ): Promise<EstimateSendResult> {
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
        // Their name for it. Null is a real answer — a retail session gets no comparison model.
        retailModel: parsed.retail_model,
        // Captured on the way through, because it is the only moment the team estimator's BFF hands it over. A
        // call that carries an existing session gets it echoed back, so this is never null once a
        // quotation has been priced at least once against a reachable BFF.
        sessionCookie: readSetCookie(res) ?? session?.cookie ?? null,
        sample: parsed.sample === true || mode === "fixture",
        mode,
      };
    }

    const fields = Array.isArray(parsed.fields) ? parsed.fields.map(String) : [];
    const detail = refusalDetail(parsed, text, res.status);

    return {
      ok: false,
      reason: res.status === 422 ? "rejected" : "unexpected",
      status: res.status,
      detail,
      fields,
      code: refusalCode(parsed),
      issues: refusalIssues(parsed),
    };
  }

  /**
   * Re-price an edited trip on the scenario it already belongs to.
   *
   * `save: true` because the whole point of the call is that staff corrected the trip and want the
   * engine's answer for the corrected trip — a `save: false` preview would price it and drop it,
   * so the next commit would freeze the OLD trip and the guest's link would disagree with the
   * screen the approver was looking at.
   */
  async function updateEstimate(session: EstimatorSession, trip: BffTrip): Promise<EstimateSendResult> {
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
    if (!session.id) {
      return {
        ok: false,
        reason: "no_validated_trip",
        status: null,
        detail: "this quotation has no scenario to edit — price it first",
        fields: [],
      };
    }

    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${ESTIMATE_PATH}/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: sessionHeaders(session),
        body: JSON.stringify({ trip, save: true }),
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
          : transportDetail(err, "re-price the edited trip"),
        fields: [],
      };
    }

    return interpretEstimate(res, baseUrl, session);
  }

  /**
   * One authenticated POST about an existing scenario, with the failure mapping shared by `commit`
   * and `share`.
   *
   * Their two refusals mean different things and are kept apart: `409` is "there is nothing saved
   * to point at yet" (a state the caller can fix by committing), while `422` means we sent
   * something their `fillTrip` rejected, which is a defect on this side.
   */
  async function postToScenario(
    session: EstimatorSession,
    suffix: string,
    body: string,
  ): Promise<
    | { ok: true; parsed: Record<string, unknown> }
    | { ok: false; reason: EstimatorFailure; detail: string }
  > {
    const baseUrl = options.baseUrl?.replace(/\/+$/, "") ?? estimatorBaseUrl();
    if (!baseUrl) return { ok: false, reason: "not_configured", detail: "ESTIMATOR_BASE_URL is not set" };
    if (!session.id) {
      return { ok: false, reason: "not_configured", detail: "this quotation has no scenario id yet — price it first" };
    }

    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${ESTIMATE_PATH}/${encodeURIComponent(session.id)}${suffix}`, {
        method: "POST",
        headers: sessionHeaders(session),
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const aborted = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return {
        ok: false,
        reason: aborted ? "timeout" : "unreachable",
        detail: aborted
          ? `their BFF did not answer within ${timeoutMs}ms`
          : transportDetail(err, "freeze the quotation on their side"),
      };
    }

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Leave `parsed` empty; `refusalDetail` decides what a person is told about the body.
    }
    if (res.status === 200 || res.status === 201) return { ok: true, parsed };
    const detail = refusalDetail(parsed, text, res.status);
    if (res.status === 409) return { ok: false, reason: "no_snapshot", detail };
    if (res.status === 422) return { ok: false, reason: "rejected", detail };
    return { ok: false, reason: "unexpected", detail };
  }

  /** Freeze this quotation as a revision. Their `POST /api/estimates/:id/commit`. */
  async function commit(session: EstimatorSession, _trip: BffTrip): Promise<CommitResult> {
    const out = await postToScenario(session, "/commit", "{}");
    if (!out.ok) return out;
    return {
      ok: true,
      seq: typeof out.parsed.seq === "number" ? out.parsed.seq : 0,
      computedAt: typeof out.parsed.computedAt === "string" ? out.parsed.computedAt : null,
    };
  }

  /** Mint the guest link for a committed revision. Their `POST /api/estimates/:id/share`. */
  async function share(session: EstimatorSession): Promise<ShareResult> {
    const out = await postToScenario(session, "/share", "{}");
    if (!out.ok) return out;
    const url = typeof out.parsed.url === "string" ? out.parsed.url : null;
    // Their route answers `{url}` and nothing else useful; a 200 without one is a contract change,
    // and guessing a link shape here would send a guest somewhere invented.
    if (!url) return { ok: false, reason: "unexpected", detail: "their share answered without a url" };
    return { ok: true, url, expiresAt: typeof out.parsed.expiresAt === "string" ? out.parsed.expiresAt : null };
  }

  /**
   * Is the team estimator's BFF answering, and in which mode? Used by the studio's pre-flight badge so staff do
   * not discover a missing/incorrect `ESTIMATOR_BASE_URL` by clicking a button and reading a 503.
   *
   * Never throws: an unreachable BFF is an answer (`reachable: false`), not an error.
   */
  async function checkHealth(): Promise<EstimatorHealth> {
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

  /**
   * Would this link open for the guest?
   *
   * The guest's page resolves a token through `GET /api/share/:token`, which is the request a browser
   * makes the moment somebody opens the link — so that is what is asked here, rather than trusting
   * the `share` call that minted it. See `verifyGuestLink` on the port for the measurement that made
   * this necessary: the team estimator's fixture deployment answered 200 and 404 to the SAME token in one run of 24
   * parallel requests, because its store lives in one serverless instance's memory.
   */
  async function verifyGuestLink(guestUrl: string): Promise<GuestLinkCheck> {
    const baseUrl = options.baseUrl?.replace(/\/+$/, "") ?? estimatorBaseUrl();
    if (!baseUrl) {
      return { ok: false, reason: "not_configured", detail: "ESTIMATOR_BASE_URL is not set, so the link cannot be checked" };
    }
    // The token is whatever their `share` put after `/quote/`; the path is theirs to shape, so a link
    // that does not look like theirs is reported rather than guessed at.
    const token = guestUrl.split("/quote/")[1]?.split(/[?#]/)[0] ?? "";
    if (!token) {
      return { ok: false, reason: "unexpected", detail: "that link carries no share token to check" };
    }
    try {
      const res = await doFetch(`${baseUrl}${SHARE_PATH}/${encodeURIComponent(token)}`, {
        signal: AbortSignal.timeout(Math.min(timeoutMs, 8_000)),
      });
      if (res.ok) return { ok: true };
      if (res.status === 404) {
        return {
          ok: false,
          reason: "not_found",
          detail: "their app does not recognise the link it just issued",
        };
      }
      return { ok: false, reason: "unexpected", detail: `their app answered HTTP ${res.status} for that link` };
    } catch (err) {
      const aborted = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return {
        ok: false,
        reason: "unreachable",
        detail: aborted ? "their app did not answer while checking the link" : transportDetail(err, "check the guest's link"),
      };
    }
  }

  /**
   * Ask the team estimator's BFF to turn a frozen revision into a booking.
   *
   * Their route is `POST /api/estimates/:id/submit {seq, contact}` and it is the one call in the
   * whole integration that creates something real (a folio), which is why the caller — not this
   * client — owns the gate that decides whether it may be made at all. This function only reports
   * what the engine said, in the four categories the route above already has to tell apart:
   * `closed` (they refuse), `rejected` (they answered no — safe to retry), `busy` (we never got
   * through), `unknown` (it may exist; never retry blindly).
   *
   * Two prerequisites are the caller's: `estimatorId` (the team estimator's scenario) and `estimatorSeq` (the
   * frozen revision). Without both there is nothing to address, and guessing either is how a
   * reservation lands on the wrong trip — so this refuses instead.
   */
  async function submit(input: SubmitInput): Promise<SubmitResult> {
    const baseUrl = options.baseUrl?.replace(/\/+$/, "") ?? estimatorBaseUrl();
    if (!baseUrl) {
      return { ok: false, reason: "not_configured", detail: "ESTIMATOR_BASE_URL is not set" };
    }
    if (!input.estimatorId || input.estimatorSeq == null) {
      return {
        ok: false,
        reason: "not_configured",
        detail:
          "the remote booking engine is addressed by their scenario id + frozen revision; neither is on this quotation yet",
      };
    }

    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${ESTIMATE_PATH}/${encodeURIComponent(input.estimatorId)}/submit`, {
        method: "POST",
        headers: sessionHeaders({ id: input.estimatorId, cookie: input.estimatorCookie ?? null }),
        body: JSON.stringify({ seq: input.estimatorSeq, contact: input.contact }),
        // Their own contract: 20s and no retries (spec §8). A retried booking is a second folio.
        signal: AbortSignal.timeout(Math.max(timeoutMs, 20_000)),
      });
    } catch (err) {
      const aborted = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      // They may have created the folio and failed to answer. `unknown` is the whole point of
      // this branch: it forbids the retry that would double-book.
      return {
        ok: false,
        reason: "unknown",
        detail: aborted ? "the booking engine did not answer in time" : transportDetail(err, "create the booking"),
      };
    }

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Non-JSON body: fall through to the status mapping below.
    }

    if (res.status === 200 && parsed.success !== false) {
      const mode = (parsed.mode === "fixture" || parsed.mode === "odoo" ? parsed.mode : null) ?? (await probeMode(baseUrl));
      return {
        ok: true,
        sample: parsed.sample === true || mode === "fixture",
        folioId: typeof parsed.folio_id === "number" ? parsed.folio_id : null,
        orderIds: Array.isArray(parsed.order_ids) ? (parsed.order_ids as number[]) : null,
        mode,
      };
    }

    const reason = typeof parsed.reason === "string" ? parsed.reason : "";
    const detail = refusalDetail(parsed, text, res.status);
    if (res.status === 503) {
      return { ok: false, reason: reason === "busy" ? "busy" : "closed", detail };
    }
    if (res.status === 502 && reason === "unknown") {
      return { ok: false, reason: "unknown", detail };
    }
    return { ok: false, reason: "rejected", detail };
  }

  // Still deliberately absent: our own `/q/:slug` guest page was removed in favour of the
  // the team estimator's `/quote/<token>`, so `commit`/`share` above ARE the guest-link path now. What
  // remains unwired is only their `/revisions` reads, which nothing here needs.
  return {
    kind: "remote" as const,
    sendEstimate,
    updateEstimate,
    commit,
    share,
    verifyGuestLink,
    submit,
    checkHealth,
    baseUrl: options.baseUrl ?? estimatorBaseUrl(),
    // Falls back to the API host, which is what production is.
    appBaseUrl: options.appUrl ?? estimatorAppUrl() ?? options.baseUrl ?? estimatorBaseUrl(),
  };
}
