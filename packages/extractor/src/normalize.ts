// Playbook: "mask emails and phone numbers before logging" — note this masks
// what gets written to logs, not what gets sent to the model provider. The
// open question ("do we mask before sending too?") is still unresolved; see
// docs/adr/ADR-005a-extractor-model.md.
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/g;

export function maskForLogging(text: string): string {
  return text.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[phone]");
}

// Heuristic only — good enough to route a demo, not a real language classifier.
// Playbook's v2 plan is a dedicated haiku-tier "is this an enquiry" classifier;
// language detection can ride along with it then.
export function detectLanguage(text: string): "vi" | "en" | "zh" {
  if (/[一-鿿]/.test(text)) return "zh";
  if (/[àáảãạăâđêôơưÀÁẢÃẠĂÂĐÊÔƠƯ]/i.test(text)) return "vi";
  return "en";
}

export function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}
