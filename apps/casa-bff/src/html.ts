/**
 * One HTML escaper, used by every page that prints anything a guest typed.
 *
 * Why it is a shared module rather than a local helper per page: this exact function had been
 * written three times (the handoff inbox, the ops sheet, and the studio's per-guest cards) and the
 * pages that did NOT have it were the ones printing a guest's own words into markup. A guest's name,
 * a note, or a description typed in WhatsApp is attacker-controlled text — `<script>` in a name is a
 * script on the studio page (where staff are signed in) and on the public guest page.
 *
 * Escapes the five characters that matter in both element and quoted-attribute context. It does not
 * escape `'`: every attribute this codebase writes is double-quoted, and escaping a character that
 * cannot terminate the attribute only makes the output harder to read.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
