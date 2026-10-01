import { Hono, type Context } from "hono";
import { TEST_PAGE_HTML } from "../views/testPage.ts";
import type { StaffRole } from "../auth/session.ts";

export interface PageRouteDeps {
  staffSession: (c: Context) => { ok: boolean; role: StaffRole | null };
}

/**
 * The two pages that are not the studio: the front door, and the extractor test console.
 *
 * The documentation and showcase pages that used to hang off `/` are gone — the repo's `docs/` is where that lives.
 * `/` sends everyone to the studio (which sends a signed-out visitor to sign in), and the test console is a staff
 * tool like the rest: it calls `/v1/extract` and `/v1/converse`, both of which need a staff session anyway, so a
 * signed-out visitor is sent to sign in rather than shown a page that cannot work.
 */
export function pageRoutes(deps: PageRouteDeps): Hono {
  const app = new Hono();
  app.get("/", (c) => c.redirect("/quotes"));

  const testConsole = (c: Context) => (deps.staffSession(c).ok ? c.html(TEST_PAGE_HTML) : c.redirect("/login"));
  app.get("/test", testConsole);
  app.get("/test-console", testConsole);
  app.get("/console", testConsole);

  return app;
}
