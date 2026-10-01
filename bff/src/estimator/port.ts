/**
 * One port to the pricing/booking engine, two implementations.
 *
 * The reason this exists (lead decision, 2026-09-26): *"trước khi có key từ Phillip cứ dựng giả
 * lập, vì khi nào đảm bảo mới giao ra key được."* So the whole demo has to run end to end with
 * **no** Odoo credential at all, and the day the keys arrive the swap has to be a configuration
 * change rather than a rewrite.
 *
 *   `ESTIMATOR_MODE=simulated` (default)  -> `simulatedEstimator.ts`
 *   `ESTIMATOR_MODE=remote`               -> `estimatorClient.ts` (their BFF, which talks to Odoo)
 *
 * The simulated side deliberately answers in the **team estimator's own response shape**
 * (`contracts/odoo/examples/compute.*.json` — `quotes[]` per guest, `catRev`, `kpis.revenue`),
 * not in a shape of our own. That is what makes the swap free: the studio and the guest page
 * already read the customer's shape, so pointing `ESTIMATOR_MODE` at the real BFF changes where
 * the numbers come from and nothing about how they are displayed.
 *
 * Safety invariant, unchanged in both modes: nothing here holds an Odoo credential, and nothing
 * here calls Odoo directly. `remote` posts to a BFF; `simulated` does not leave the process.
 */
import { loadEnv, type Env } from "../env.ts";
import type { BffTrip } from "../../../ai/src/index.ts";
import type { RefusalIssue } from "./refusalCopy.ts";
import { createEstimatorClient, estimatorAppUrl, estimatorBaseUrl } from "./client.ts";
import { createSimulatedEstimator } from "./simulated.ts";

export type EstimatorMode = "simulated" | "remote";

/**
 * The result of asking the estimator to price a trip.
 *
 * `sample` is the load-bearing field, not a nicety: a price computed from captured or simulated
 * data must never be shown as a live one. It has two sources, because their fixture does not
 * currently set the flag their own docs promise — their response body when it says so, or our
 * probe of `GET /api/health` reporting `mode: 'fixture'`. Either one is enough. The simulated
 * port sets both, always.
 *
 * Lives here rather than in `estimatorClient.ts` so both implementations share one definition:
 * two structurally similar types is how the two sides drift.
 */
export type EstimateSendResult =
  | {
      ok: true;
      status: number;
      id: string | null;
      role: string | null;
      issues: unknown[];
      computedAt: string | null;
      /** Their computed model. Shape is theirs; every consumer passes it through untouched. */
      model: unknown;
      /**
       * The same trip priced as a retail guest, when the engine returns one. Their response calls
       * it `retail_model`; only an agent/instructor session gets one, and Agent View exists to put
       * the two side by side.
       */
      retailModel?: unknown;
      /**
       * The `ubg_sid` cookie their BFF set on this call, verbatim, or null when it set none.
       * Recorded on the quotation so `commit`/`share`/`submit` can be addressed to the same
       * session — see `EstimatorSession`.
       */
      sessionCookie: string | null;
      sample: boolean;
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
      /** Their top-level 422 `code` and `issues[]` (with `params`), kept rather than flattened into `detail`. */
      code?: string | null;
      issues?: RefusalIssue[];
    };

/** Who the reservation is for. Sent to the booking engine; never logged. */
export interface BookingContact {
  name: string;
  email: string;
  phone?: string | null;
}

/**
 * The booking engine's answer to a submit.
 *
 * The four `reason` values are the customer's own failure taxonomy (`docs/flows/F07-booking.md`
 * D1): `closed` = live submit is switched off, `rejected` = the engine answered and said no
 * (safe to retry), `busy` = the request never left us, `unknown` = it may have created a folio
 * and must not be retried blindly.
 */
export type SubmitResult =
  | {
      ok: true;
      sample: boolean;
      folioId: number | null;
      orderIds: number[] | null;
      mode: "fixture" | "odoo" | null;
    }
  | {
      ok: false;
      reason: "closed" | "rejected" | "busy" | "unknown" | "not_configured";
      detail: string;
    };

export interface EstimatorHealth {
  reachable: boolean;
  mode: "fixture" | "odoo" | null;
}

/**
 * One quotation's session with their BFF.
 *
 * Their flow keeps a guest draft behind an `ubg_sid` cookie: `POST /api/estimates` sets it, and
 * `commit`, `share` and `submit` only work for the session that owns the scenario. So the cookie is
 * not an optimisation — without it the second call about a quotation is a 404 for a draft that
 * exists, which is the chapter `docs/integration/schema.md` §4 spells out as the intended way for a
 * bot to use their API ("mỗi cuộc hội thoại giữ một cookie `ubg_sid` riêng").
 *
 * It lives on the quotation record, not in module state: a serverless instance is not a place to
 * keep a cookie between two messages, and keeping it beside the draft is what stops one quotation's
 * session from being replayed against another's.
 */
export interface EstimatorSession {
  /** Their scenario id, from `POST /api/estimates`. */
  id: string | null;
  /** The cookie they set, verbatim (`name=value`), replayed on every later call. */
  cookie: string | null;
}

/** Why a call to their BFF did not produce an answer. Mirrors `EstimateSendResult`'s failures. */
export type EstimatorFailure =
  | "not_configured"
  | "unreachable"
  | "timeout"
  | "rejected"
  | "no_snapshot"
  | "unexpected";

export type CommitResult =
  | { ok: true; seq: number; computedAt: string | null }
  | { ok: false; reason: EstimatorFailure; detail: string };

/**
 * `url` is RELATIVE (`/quote/<token>`), exactly as their API returns it.
 *
 * Joining it to a host is the caller's job, and that is deliberate: the same token is a working
 * link against their deployed app and a dead one against a local fixture, so only the caller knows
 * which host the guest should be sent to.
 */
export type ShareResult =
  | { ok: true; url: string; expiresAt: string | null }
  | { ok: false; reason: EstimatorFailure; detail: string };

/**
 * What a submit needs.
 *
 * `estimatorId` is their own scenario id, handed back by `POST /api/estimates`. It is optional
 * because the simulated port has no such id and does not need one; the remote port requires it,
 * because their `POST /api/estimates/:id/submit` is addressed by it. Keeping it in the call
 * rather than in module state is what stops a remote submit from silently reusing another
 * quotation's scenario.
 */
export interface SubmitInput {
  trip: BffTrip;
  contact: BookingContact;
  estimatorId?: string | null;
  /** The `ubg_sid` cookie for that scenario, when the caller has one. */
  estimatorCookie?: string | null;
  /**
   * The frozen revision they are being asked to book (`POST /api/estimates/:id/submit` takes
   * `{seq, contact}`). Their route answers `409 stale` when it is not the latest, so sending the
   * wrong one is a refusal rather than a wrong booking — but we still keep it explicit instead of
   * letting the remote client guess.
   */
  estimatorSeq?: number | null;
}

export interface EstimatorPort {
  /** Which side of the port this is. Surfaced so a page can label itself honestly. */
  readonly kind: EstimatorMode;
  /** Their BFF's base URL, when there is one. `undefined` for the simulated port. */
  readonly baseUrl?: string;
  /**
   * The host their GUEST pages are served from, when it differs from the API host.
   *
   * Their `/api/*` and their `/quote/:token` page are one Vercel project in production, so
   * `baseUrl` is normally both. Their own local dev setup splits them — API on :8787, app on :5173
   * — and joining a guest link to the API host there produces a URL that 404s while the token
   * behind it is perfectly valid. Hence a separate, optional host rather than one assumed one.
   */
  readonly appBaseUrl?: string;
  sendEstimate(trip: BffTrip | null | undefined, session?: EstimatorSession): Promise<EstimateSendResult>;
  /**
   * Re-price a trip staff have **edited** in the studio, on the same scenario.
   *
   * This is not `sendEstimate` again. Their `POST /api/estimates` always mints a NEW scenario, so
   * re-posting an edited trip would leave the quotation holding one scenario's price, another
   * scenario's `id`, and a `commit`/`share` addressed to whichever `id` won — two scenarios for one
   * enquiry, which is exactly the mess `findOpenQuotationForPhone` exists to prevent. Their own
   * `PATCH /api/estimates/:id` recomputes in place and answers in the same shape, so an edit keeps
   * one scenario from first price to published link.
   *
   * The simulated port just recomputes: it has no scenario to keep.
   */
  updateEstimate(session: EstimatorSession, trip: BffTrip): Promise<EstimateSendResult>;
  /**
   * Freeze the current draft as a revision. Their `POST /api/estimates/:id/commit`.
   *
   * Required before a share: their `share` answers `409 no-snapshot` for a quotation nobody has
   * saved, because a link to an unsaved draft is a link to nothing.
   */
  commit(session: EstimatorSession, trip: BffTrip): Promise<CommitResult>;
  /** Mint the guest link for a committed revision. Their `POST /api/estimates/:id/share`. */
  share(session: EstimatorSession): Promise<ShareResult>;
  /**
   * Can the guest actually OPEN the link we just minted?
   *
   * Not paranoia, and not a duplicate of `share` answering 200. Measured against the customer's
   * fixture deployment (2026-09-28): the same token, opened 24 times in parallel, answered **200
   * seventeen times and 404 seven times** — that deployment keeps scenarios and share tokens in the
   * memory of one serverless instance, so a token is known only to the instance that minted it.
   *
   * The consequence is the worst failure we can hand a guest: a WhatsApp message carrying a dead
   * link, sent by a studio that reported success. So the link is read back over the guest's own path
   * (`GET /api/share/:token`) before anyone is told it works.
   */
  verifyGuestLink(guestUrl: string): Promise<GuestLinkCheck>;
  submit(input: SubmitInput): Promise<SubmitResult>;
  checkHealth(): Promise<EstimatorHealth>;
}

/** The answer to "would this link open for the guest?" */
export type GuestLinkCheck =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_configured" | "unreachable" | "unexpected"; detail: string };

/**
 * Which port to build. Defaults to `simulated`, and that default is the point: a deployment
 * that forgets to set `ESTIMATOR_MODE` must not accidentally try to reach an Odoo-backed host
 * with no credentials. Opting *in* to the real engine is the deliberate act.
 */
export function estimatorModeFromEnv(env: Env = loadEnv()): EstimatorMode {
  const raw = (env.ESTIMATOR_MODE ?? "").trim().toLowerCase();
  return raw === "remote" ? "remote" : "simulated";
}

export function createEstimatorPortFromEnv(env: Env = loadEnv()): EstimatorPort {
  if (estimatorModeFromEnv(env) === "remote") {
    // The URL is resolved from the SAME env object the mode came from, not from `process.env`
    // inside the client: a factory that reads half its configuration from its argument and half
    // from the ambient process is a factory that cannot be tested, and the mismatch shows up as a
    // client quietly pointed at the wrong host.
    return createEstimatorClient({ baseUrl: estimatorBaseUrl(env), appUrl: estimatorAppUrl(env) });
  }
  return createSimulatedEstimator();
}
