import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Every document this module can serve, in one place.
 *
 * The list is exported so a test can assert the rule the Phase 0 cleanup established:
 * each of these files exists in `public/`, and no second copy of it lingers in `docs/`.
 * That second copy is what actually went wrong — `roadmap-next.html` sat in both trees,
 * the docs/ one was edited a day longer, and the page guests saw was the older one.
 */
const DOCUMENTS = {
  index: "index.html",
  benchmark: "benchmark-report.html",
  scenarios: "casa-anilao-test-scenarios.html",
  status: "extractor-pod-status.html",
  roadmap: "roadmap-next.html",
  checklist: "demo-checklist.html",
  teamGuide: "team-guide.html",
  diagram: "diagrams/extractor-pod.html",
  diagramViewer: "diagrams/extractor-pod.viewer.html",
  diagramVi: "diagrams/extractor-pod.vi.html",
  planShowcase: "casa-escondida-plan-showcase.html",
  extractorShowcase: "extractor-pod-showcase.html",
  conversationFlow: "diagrams/conversation-flow-plain.html",
  projectArchitecture: "diagrams/casa-project-architecture.html",
  inboundMessageFlow: "diagrams/casa-inbound-message-flow.html",
  demoTheatre: "demo-theatre.html",
} as const;

export const SERVED_DOCUMENTS: readonly string[] = Object.values(DOCUMENTS);

/**
 * The `public/` directory the documents live in.
 *
 * Found by walking up from this file until a directory holding `public/` turns up, rather
 * than by counting `"../../../"`. The counting version is what broke: this module moved
 * from `src/` to `src/views/`, every `__dirname`-relative candidate silently stopped
 * resolving, and only the `process.cwd()` fallbacks kept it working — which is precisely
 * the failure a seven-entry path list used to hide. A depth that is discovered cannot go
 * stale; a depth that is written down can.
 *
 * The `process.cwd()` candidates stay as a last resort because the bundled function on
 * Vercel has its own layout, and there the repository root is not necessarily an ancestor
 * of this file.
 */
function documentRoot(): string {
  let dir = __dirname;
  for (let depth = 0; depth < 8; depth++) {
    const candidate = resolve(dir, "public");
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd(), "public");
}

function loadHtmlFile(filename: string): string {
  // `public/` is the only copy of these documents: the docs/ mirror was deleted in the
  // structure cleanup, so the candidates that used to point at `docs/` are gone rather
  // than merely broken.
  const paths = [
    resolve(documentRoot(), filename),
    resolve(process.cwd(), `public/${filename}`),
    resolve(process.cwd(), filename),
  ];
  for (const p of paths) {
    try {
      return readFileSync(p, "utf8");
    } catch {}
  }
  return `<!doctype html><html><body><h1>Document Not Found: ${filename}</h1><p>Checked paths: ${paths.join(", ")}</p></body></html>`;
}

export function getIndexHtml(): string {
  return loadHtmlFile(DOCUMENTS.index);
}

export function getBenchmarkHtml(): string {
  return loadHtmlFile(DOCUMENTS.benchmark);
}

export function getScenariosHtml(): string {
  return loadHtmlFile(DOCUMENTS.scenarios);
}

export function getStatusHtml(): string {
  return loadHtmlFile(DOCUMENTS.status);
}

export function getRoadmapHtml(): string {
  return loadHtmlFile(DOCUMENTS.roadmap);
}

export function getChecklistHtml(): string {
  return loadHtmlFile(DOCUMENTS.checklist);
}

export function getTeamGuideHtml(): string {
  return loadHtmlFile(DOCUMENTS.teamGuide);
}

export function getDiagramHtml(): string {
  return loadHtmlFile(DOCUMENTS.diagram);
}

export function getDiagramViewerHtml(): string {
  return loadHtmlFile(DOCUMENTS.diagramViewer);
}

export function getDiagramViHtml(): string {
  return loadHtmlFile(DOCUMENTS.diagramVi);
}

export function getPlanShowcaseHtml(): string {
  return loadHtmlFile(DOCUMENTS.planShowcase);
}

export function getExtractorShowcaseHtml(): string {
  return loadHtmlFile(DOCUMENTS.extractorShowcase);
}

export function getConversationFlowHtml(): string {
  return loadHtmlFile(DOCUMENTS.conversationFlow);
}

export function getProjectArchitectureHtml(): string {
  return loadHtmlFile(DOCUMENTS.projectArchitecture);
}

export function getInboundMessageFlowHtml(): string {
  return loadHtmlFile(DOCUMENTS.inboundMessageFlow);
}

export function getDemoTheatreHtml(): string {
  return loadHtmlFile(DOCUMENTS.demoTheatre);
}



