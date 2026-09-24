import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadHtmlFile(filename: string): string {
  const paths = [
    resolve(__dirname, `../../../public/${filename}`),
    resolve(__dirname, `../../public/${filename}`),
    resolve(__dirname, `../../../docs/${filename}`),
    resolve(__dirname, `../../docs/${filename}`),
    resolve(process.cwd(), `public/${filename}`),
    resolve(process.cwd(), `docs/${filename}`),
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
  return loadHtmlFile("index.html");
}

export function getBenchmarkHtml(): string {
  return loadHtmlFile("benchmark-report.html");
}

export function getScenariosHtml(): string {
  return loadHtmlFile("casa-anilao-test-scenarios.html");
}

export function getStatusHtml(): string {
  return loadHtmlFile("extractor-pod-status.html");
}

export function getRoadmapHtml(): string {
  return loadHtmlFile("roadmap-next.html");
}

export function getChecklistHtml(): string {
  return loadHtmlFile("demo-checklist.html");
}

export function getTeamGuideHtml(): string {
  return loadHtmlFile("team-guide.html");
}

export function getDiagramHtml(): string {
  return loadHtmlFile("diagrams/extractor-pod.html");
}

export function getDiagramViewerHtml(): string {
  return loadHtmlFile("diagrams/extractor-pod.viewer.html");
}

export function getDiagramViHtml(): string {
  return loadHtmlFile("diagrams/extractor-pod.vi.html");
}

export function getPlanShowcaseHtml(): string {
  return loadHtmlFile("casa-escondida-plan-showcase.html");
}

export function getExtractorShowcaseHtml(): string {
  return loadHtmlFile("extractor-pod-showcase.html");
}

export function getConversationFlowHtml(): string {
  return loadHtmlFile("diagrams/conversation-flow-plain.html");
}

export function getProjectArchitectureHtml(): string {
  return loadHtmlFile("diagrams/casa-project-architecture.html");
}

export function getInboundMessageFlowHtml(): string {
  return loadHtmlFile("diagrams/casa-inbound-message-flow.html");
}

export function getDemoTheatreHtml(): string {
  return loadHtmlFile("demo-theatre.html");
}



