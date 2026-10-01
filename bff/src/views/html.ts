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

/**
 * A number with the symbol of the currency it is already in. Deliberately NOT a conversion.
 *
 * This page shows the engine's figures in the engine's own currency. The version this replaces had a
 * rate table typed into the file (USD 0.018, EUR 0.016, VND 440) and a currency dropdown that rewrote
 * the total, the deposit and the balance: arithmetic of ours, about money, at a rate that is stale the
 * day after it is typed — 0.018 implies about ₱55.6 to the dollar. Worse, the table assumed the base
 * was always PHP, so a quotation the engine priced in USD printed peso-sized numbers under a "$", and
 * choosing EUR multiplied those dollars by 0.016. A guest reading a total in a currency nobody quoted
 * is the one thing a quotation page must never do.
 */
const CURRENCY_SYMBOLS: Record<string, string> = { PHP: "₱", USD: "$", EUR: "€", VND: "₫" };

export function money(currency: string, amount: number): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  // No rounding of our own: whatever the engine said, to two decimals at most, is what is printed.
  return `${symbol}${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/**
 * Whole-currency figure for the staff studio: a peso sign unless the quotation is in dollars, rounded to the unit. The
 * guest's page uses `money` instead (the engine's own currency, two decimals at most); the two are different on purpose.
 */
export function wholeMoney(currency: string, amount: number): string {
  return `${currency === "USD" ? "$" : "₱"}${Math.round(amount).toLocaleString("en-US")}`;
}
