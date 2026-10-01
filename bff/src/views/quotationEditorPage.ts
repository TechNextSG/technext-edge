/** The staff quotation editor page. Built from four parts that each answer one question (see `./editor/`). */
import { buildEditorModel } from "./editor/model.ts";
import { editorCss } from "./editor/styles.ts";
import { renderHead, renderBody } from "./editor/markup.ts";
import { editorScript } from "./editor/client.ts";
import { type HonoQuotationDraft } from "../quote/index.ts";
import { type StaffRole } from "../auth/session.ts";

export function renderHonoQuotationEditorHtml(
  draft: HonoQuotationDraft,
  allQuotes: HonoQuotationDraft[],
  role: StaffRole = "staff",
  estimatorKind: "simulated" | "remote" = "simulated",
): string {
  const m = buildEditorModel(draft, allQuotes, role, estimatorKind);
  return `${renderHead(m)}
  <style>
${editorCss()}
  </style>
</head>
${renderBody(m)}
  <script>
${editorScript(m)}
  </script>
</body>
</html>`;
}
