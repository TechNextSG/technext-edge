/**
 * The quotation routes, in seven small sub-apps mounted in this order. The order is part of the contract: Hono matches
 * in the order routes were added, and `GET /v1/quotes/estimator-status` must come before `GET /v1/quotes/:id`
 * (`bff/test/routeTable.test.ts` pins the whole table).
 */
import { Hono } from "hono";
import { studioRoutes } from "./pages.ts";
import { guestPageRoutes } from "./guestPage.ts";
import { listRoutes } from "./list.ts";
import { recordRoutes } from "./record.ts";
import { pricingRoutes } from "./pricing.ts";
import { publishRoutes } from "./publish.ts";
import { bookingRoutes } from "./booking.ts";
import type { QuotesRouteDeps } from "./shared.ts";

export type { QuotesRouteDeps } from "./shared.ts";

export function quotesRoutes(deps: QuotesRouteDeps): Hono {
  const app = new Hono();
  app.route("/", studioRoutes(deps));
  app.route("/", guestPageRoutes(deps));
  app.route("/", listRoutes(deps));
  app.route("/", recordRoutes(deps));
  app.route("/", pricingRoutes(deps));
  app.route("/", publishRoutes(deps));
  app.route("/", bookingRoutes(deps));
  return app;
}
