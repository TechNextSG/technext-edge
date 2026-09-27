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
 * The simulated side deliberately answers in the **customer's own response shape**
 * (`contracts/odoo/examples/compute.*.json` — `quotes[]` per guest, `catRev`, `kpis.revenue`),
 * not in a shape of our own. That is what makes the swap free: the studio and the guest page
 * already read the customer's shape, so pointing `ESTIMATOR_MODE` at the real BFF changes where
 * the numbers come from and nothing about how they are displayed.
 *
 * Safety invariant, unchanged in both modes: nothing here holds an Odoo credential, and nothing
 * here calls Odoo directly. `remote` posts to a BFF; `simulated` does not leave the process.
 */
import type { BffTrip } from "../../../packages/extractor/src/schema.js";
import { createEstimatorClient, estimatorBaseUrl } from "./estimatorClient.js";
import { createSimulatedEstimator } from "./simulatedEstimator.js";

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
  sendEstimate(trip: BffTrip | null | undefined): Promise<EstimateSendResult>;
  submit(input: SubmitInput): Promise<SubmitResult>;
  checkHealth(): Promise<EstimatorHealth>;
}

/**
 * Which port to build. Defaults to `simulated`, and that default is the point: a deployment
 * that forgets to set `ESTIMATOR_MODE` must not accidentally try to reach an Odoo-backed host
 * with no credentials. Opting *in* to the real engine is the deliberate act.
 */
export function estimatorModeFromEnv(env: NodeJS.ProcessEnv = process.env): EstimatorMode {
  const raw = (env.ESTIMATOR_MODE ?? "").trim().toLowerCase();
  return raw === "remote" ? "remote" : "simulated";
}

export function createEstimatorPortFromEnv(env: NodeJS.ProcessEnv = process.env): EstimatorPort {
  if (estimatorModeFromEnv(env) === "remote") {
    // The URL is resolved from the SAME env object the mode came from, not from `process.env`
    // inside the client: a factory that reads half its configuration from its argument and half
    // from the ambient process is a factory that cannot be tested, and the mismatch shows up as a
    // client quietly pointed at the wrong host.
    return createEstimatorClient({ baseUrl: estimatorBaseUrl(env) });
  }
  return createSimulatedEstimator();
}
