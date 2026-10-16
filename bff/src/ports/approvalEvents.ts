import type { EstimatorWebhookPayload } from "../../../contracts/src/index.ts";

/**
 * Inbound port for staff approval / archive events from tn-casa Estimator (Pattern 1 Ports & Adapters).
 * Invoked when staff clicks Save + Share or archives a draft quotation in Trips UI.
 */

export interface ApprovalEvent {
  event: "approved" | "archived";
  estimateId: string;
  seq?: number;
  url?: string;
  guestName?: string;
  guestPhone?: string;
  timestamp: number;
}

export interface ApprovalEventsPort {
  /**
   * Process a verified inbound approval event from tn-casa.
   */
  handleApprovalEvent(event: ApprovalEvent): Promise<{ ok: true; processed: boolean } | { ok: false; reason: string }>;
}
