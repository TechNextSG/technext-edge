/** What every quotation route module shares: its dependencies, and the origin the guest's link is built on. */
import { loadEnv } from "../../env.ts";
import type { Context } from "hono";
import type { ExtractProvider } from "../../../../ai/src/index.ts";
import type { EstimatorPort } from "../../estimator/index.ts";
import type { StaffRole } from "../../auth/session.ts";
import type { WhatsAppSendText } from "../../channels/whatsapp/index.ts";

export function canonicalOrigin(c: Context): string {
  const envUrl = (loadEnv().PUBLIC_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (envUrl) return envUrl;
  return new URL(c.req.url).origin;
}

export interface QuotesRouteDeps {
  estimator: EstimatorPort;
  providerHolder: { get: () => Promise<ExtractProvider> };
  optionsProvider?: ExtractProvider;
  staffSession: (c: Context) => { ok: boolean; role: StaffRole | null };
  staffWriter: (c: Context) => boolean;
  sendWhatsApp?: WhatsAppSendText;
}
