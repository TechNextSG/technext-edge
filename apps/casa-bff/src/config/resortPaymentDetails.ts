/**
 * The resort's bank and e-wallet details — as configuration, never as a constant.
 *
 * The studio used to draw a "Casa Escondida · Bank & Payment Details" card with numbers baked into
 * this repository: `BDO Unibank … Acct: 0012-3456-7890` and `GCash / Maya: 0917-123-4567`. Nobody at
 * Casa Escondida gave us those numbers. They are the shape of a bank account and the shape of a
 * mobile number, which is what makes them dangerous: a receptionist can read them to a guest, a
 * screenshot can survive a demo, and a guest who transfers money to them has paid a stranger. The
 * customer's own terms were the one thing every other part of this system refuses to invent (see
 * `bookingPolicyLines`), and payment instructions matter more than the rest, not less.
 *
 * So the card exists only when this deployment has been told the real details, and it says exactly
 * what it was told. Unset — which is the state of both deployments today — it does not render at
 * all, and the copy button goes with it, because there is nothing to copy.
 *
 * Configuration (all three required together; `RESORT_EWALLET` is optional):
 *
 *   RESORT_BANK_ACCOUNT_NAME    e.g. the name on the account, as the resort writes it
 *   RESORT_BANK_NAME            e.g. "BDO Unibank (Pesos)"
 *   RESORT_BANK_ACCOUNT_NUMBER  as the resort writes it, punctuation included
 *   RESORT_EWALLET              e.g. "0917 000 0000 (Casa Front Desk)"
 */
export interface ResortPaymentDetails {
  /** The name the account is held in, written the way the resort writes it. */
  accountName: string;
  /** The bank, as the guest will see it named. */
  bankName: string;
  /** The account number, verbatim: punctuation is the resort's, not ours to normalise. */
  accountNumber: string;
  /** One e-wallet line, or null when the resort has not given one. */
  ewallet: string | null;
}

/** The details this deployment was configured with, or null when it was told none. */
export function resortPaymentDetailsFromEnv(env: NodeJS.ProcessEnv = process.env): ResortPaymentDetails | null {
  const read = (key: string) => (env[key] ?? "").trim();
  const accountName = read("RESORT_BANK_ACCOUNT_NAME");
  const bankName = read("RESORT_BANK_NAME");
  const accountNumber = read("RESORT_BANK_ACCOUNT_NUMBER");
  // All three or nothing. A card that names a bank but no account number is a dead end for a guest
  // who is trying to pay, and half a set of details invites the other half to be filled in by guess.
  if (!accountName || !bankName || !accountNumber) return null;
  return { accountName, bankName, accountNumber, ewallet: read("RESORT_EWALLET") || null };
}

/** The card's two lines, in the order the studio shows them. */
export function paymentDetailLines(details: ResortPaymentDetails): string[] {
  return [
    `${details.bankName}: ${details.accountName} · Acct: ${details.accountNumber}`,
    ...(details.ewallet ? [`GCash / Maya: ${details.ewallet}`] : []),
  ];
}

/**
 * What the studio's "Copy Bank Details" button puts on the clipboard.
 *
 * Built here rather than in the page so the button cannot carry a number the server did not
 * configure — the same reason the follow-up message is built server-side.
 */
export function paymentDetailsText(
  details: ResortPaymentDetails,
  resortName = "Casa Escondida Anilao",
): string {
  const lines = [
    `${resortName} - Bank Payment Details:`,
    `1. ${details.bankName}\n   Account Name: ${details.accountName}\n   Account Number: ${details.accountNumber}`,
  ];
  if (details.ewallet) lines.push(`2. GCash / Maya:\n   Mobile: ${details.ewallet}`);
  lines.push("Please send a screenshot or reference number once transfer is complete.");
  return lines.join("\n\n");
}
