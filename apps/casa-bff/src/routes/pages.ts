import type { Hono } from "hono";
import { TEST_PAGE_HTML } from "../views/testPage.js";
import {
  getIndexHtml,
  getBenchmarkHtml,
  getScenariosHtml,
  getStatusHtml,
  getRoadmapHtml,
  getChecklistHtml,
  getTeamGuideHtml,
  getDiagramHtml,
  getDiagramViewerHtml,
  getDiagramViHtml,
  getPlanShowcaseHtml,
  getExtractorShowcaseHtml,
  getConversationFlowHtml,
  getProjectArchitectureHtml,
  getInboundMessageFlowHtml,
  getDemoTheatreHtml,
} from "../views/reportsHtml.js";

/**
 * The pages that are not the product: the test console, the reports, the diagrams and the
 * architecture hub.
 *
 * They are plain `GET`s that read a document and return it, which is exactly why they can
 * live here — nothing in this group touches a store, a session, the estimator or a model.
 * The routes that DO need the process's shared state stayed in app.ts beside the
 * composition root; this file exists so that a page route can never accidentally grow a
 * dependency on that state without someone noticing the import.
 *
 * The grouped and aliased paths (`/status` and `/extractor-pod-status.html`, `/docs` and
 * `/`) are intentional: the first is what Vercel serves for a static request, the second
 * is what a human types.
 */
export function registerPageRoutes(app: Hono): void {
  // Central documentation & architecture hub
  app.get("/", (c) => c.html(getIndexHtml()));
  app.get("/index.html", (c) => c.html(getIndexHtml()));
  app.get("/hub", (c) => c.html(getIndexHtml()));
  app.get("/docs", (c) => c.html(getIndexHtml()));

  // Interactive AI Extractor Test Console
  app.get("/test", (c) => c.html(TEST_PAGE_HTML));
  app.get("/test-console", (c) => c.html(TEST_PAGE_HTML));
  app.get("/console", (c) => c.html(TEST_PAGE_HTML));

  // Corporate reports, status briefing & test scenario matrix
  app.get("/benchmark-report.html", (c) => c.html(getBenchmarkHtml()));
  app.get("/benchmark", (c) => c.html(getBenchmarkHtml()));
  app.get("/casa-anilao-test-scenarios.html", (c) => c.html(getScenariosHtml()));
  app.get("/scenarios", (c) => c.html(getScenariosHtml()));
  app.get("/extractor-pod-status.html", (c) => c.html(getStatusHtml()));
  app.get("/status", (c) => c.html(getStatusHtml()));
  app.get("/roadmap-next.html", (c) => c.html(getRoadmapHtml()));
  app.get("/roadmap", (c) => c.html(getRoadmapHtml()));
  app.get("/demo-checklist.html", (c) => c.html(getChecklistHtml()));
  app.get("/checklist", (c) => c.html(getChecklistHtml()));
  app.get("/team-guide.html", (c) => c.html(getTeamGuideHtml()));
  app.get("/guide", (c) => c.html(getTeamGuideHtml()));

  // Architecture diagrams (Archify interactive view)
  app.get("/diagrams/extractor-pod.viewer.html", (c) => c.html(getDiagramViewerHtml()));
  app.get("/diagrams/extractor-pod.vi.html", (c) => c.html(getDiagramViHtml()));
  app.get("/diagrams/extractor-pod.html", (c) => c.html(getDiagramHtml()));
  app.get("/diagrams/extractor-pod", (c) => c.html(getDiagramViewerHtml()));
  app.get("/diagrams", (c) => c.html(getDiagramViewerHtml()));
  app.get("/architecture", (c) => c.html(getDiagramViewerHtml()));

  // Executive Showcase & 2-Slide Plan for Lead
  app.get("/casa-escondida-plan-showcase.html", (c) => c.html(getPlanShowcaseHtml()));
  app.get("/plan", (c) => c.html(getPlanShowcaseHtml()));
  app.get("/extractor-pod-showcase.html", (c) => c.html(getExtractorShowcaseHtml()));
  app.get("/showcase", (c) => c.html(getExtractorShowcaseHtml()));
  app.get("/diagrams/conversation-flow-plain.html", (c) => c.html(getConversationFlowHtml()));
  app.get("/conversation-flow-plain.html", (c) => c.html(getConversationFlowHtml()));
  app.get("/flow", (c) => c.html(getConversationFlowHtml()));
  app.get("/diagrams/casa-project-architecture.html", (c) => c.html(getProjectArchitectureHtml()));
  app.get("/project-architecture", (c) => c.html(getProjectArchitectureHtml()));
  app.get("/diagrams/casa-inbound-message-flow.html", (c) => c.html(getInboundMessageFlowHtml()));
  app.get("/message-flow", (c) => c.html(getInboundMessageFlowHtml()));
  app.get("/demo-theatre.html", (c) => c.html(getDemoTheatreHtml()));
  app.get("/demo", (c) => c.html(getDemoTheatreHtml()));
}
