/**
 * The quotation routes, in seven small modules. Registration order is part of the contract: Hono matches in the
 * order routes were added, and `GET /v1/quotes/estimator-status` must be added before `GET /v1/quotes/:id`.
 */
import type { Hono } from "hono";
import { registerPagesRoutes } from "./pages.ts";
import { registerGuestPageRoutes } from "./guestPage.ts";
import { registerListRoutes } from "./list.ts";
import { registerRecordRoutes } from "./record.ts";
import { registerPricingRoutes } from "./pricing.ts";
import { registerPublishRoutes } from "./publish.ts";
import { registerBookingRoutes } from "./booking.ts";
import type { QuotesRouteDeps } from "./shared.ts";

export type { QuotesRouteDeps } from "./shared.ts";

export function registerQuotesRoutes(app: Hono, deps: QuotesRouteDeps): void {
  registerPagesRoutes(app, deps);
  registerGuestPageRoutes(app, deps);
  registerListRoutes(app, deps);
  registerRecordRoutes(app, deps);
  registerPricingRoutes(app, deps);
  registerPublishRoutes(app, deps);
  registerBookingRoutes(app, deps);
}
