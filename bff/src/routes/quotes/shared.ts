/** What every quotation route module shares: its dependencies, and the origin the guest's link is built on. */
import { loadEnv } from "../../env.ts";
import type { Context } from "hono";
import type { ExtractProvider } from "../../../../ai/src/index.ts";
import type { EstimatorPort } from "../../services/estimatorPort.ts";
import type { DemoRole } from "../../auth/demoAuth.ts";
import type { WhatsAppSendText } from "../../services/whatsapp.ts";

export function canonicalOrigin(c: Context): string {
  const envUrl = (loadEnv().PUBLIC_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (envUrl) return envUrl;
  return new URL(c.req.url).origin;
}

export interface QuotesRouteDeps {
  estimator: EstimatorPort;
  providerHolder: { get: () => Promise<ExtractProvider> };
  optionsProvider?: ExtractProvider;
  staffSession: (c: Context) => { ok: boolean; role: DemoRole | null };
  staffWriter: (c: Context) => boolean;
  sendWhatsApp?: WhatsAppSendText;
}
