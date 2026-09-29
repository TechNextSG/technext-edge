// Payment instructions on the studio's Send screen.
//
// The card that used to be there carried numbers baked into this repository: a BDO account number
// and a GCash/Maya mobile number that nobody at Casa Escondida has ever confirmed. That is the one
// class of wrong answer a guest can act on — they can transfer money to it — and it is the same
// standard the rest of the system holds itself to: the customer's terms come from the customer, or
// they are not shown (see `bookingPolicyLines`, and the guest page's own tests).
//
// So these tests pin both directions: with no configuration the card, its button and its clipboard
// text are absent — and the invented numbers appear nowhere on any page — and with configuration the
// card says exactly what the deployment was told.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../../../apps/casa-bff/src/app.js";
import { listQuotations } from "../../../apps/casa-bff/src/quotationStore.js";
import {
  paymentDetailLines,
  paymentDetailsText,
  resortPaymentDetailsFromEnv,
} from "../../../apps/casa-bff/src/resortPaymentDetails.js";

const STAFF_TOKEN = "test-staff-token";

/** The two strings that were in the source. Neither may reach a screen ever again. */
const INVENTED = ["0012-3456-7890", "0917-123-4567"];

beforeEach(() => {
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", STAFF_TOKEN);
  vi.stubEnv("RESORT_BANK_ACCOUNT_NAME", "");
  vi.stubEnv("RESORT_BANK_NAME", "");
  vi.stubEnv("RESORT_BANK_ACCOUNT_NUMBER", "");
  vi.stubEnv("RESORT_EWALLET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function studioPage(): Promise<string> {
  const app = createApp();
  const quotations = await listQuotations();
  return (await app.request(`/quotes/${quotations[0]!.quoteId}?token=${STAFF_TOKEN}`)).text();
}

describe("the resort's payment details are configuration, not constants", () => {
  it("reports nothing when this deployment has been told nothing", () => {
    expect(resortPaymentDetailsFromEnv({})).toBeNull();
  });

  it("refuses half a set of details rather than showing what it has", () => {
    // A bank with no account number is a dead end for a guest trying to pay, and an account number
    // with no bank name is worse: it invites the missing half to be filled in by guess.
    expect(resortPaymentDetailsFromEnv({ RESORT_BANK_NAME: "BDO Unibank (Pesos)" })).toBeNull();
    expect(
      resortPaymentDetailsFromEnv({ RESORT_BANK_NAME: "BDO Unibank (Pesos)", RESORT_BANK_ACCOUNT_NUMBER: "1234" }),
    ).toBeNull();
    expect(
      resortPaymentDetailsFromEnv({
        RESORT_BANK_ACCOUNT_NAME: "Casa Escondida Anilao Resort Inc.",
        RESORT_BANK_NAME: "BDO Unibank (Pesos)",
      }),
    ).toBeNull();
  });

  it("uses the configured details verbatim, e-wallet optional", () => {
    const details = resortPaymentDetailsFromEnv({
      RESORT_BANK_ACCOUNT_NAME: "Casa Escondida Anilao Resort Inc.",
      RESORT_BANK_NAME: "BDO Unibank (Pesos)",
      RESORT_BANK_ACCOUNT_NUMBER: "0099 8877 6655",
    });
    expect(details).not.toBeNull();
    expect(paymentDetailLines(details!)).toEqual([
      "BDO Unibank (Pesos): Casa Escondida Anilao Resort Inc. · Acct: 0099 8877 6655",
    ]);
    // The bank's punctuation survives: it is the resort's number, not ours to normalise.
    expect(paymentDetailsText(details!)).toContain("Account Number: 0099 8877 6655");

    const withWallet = resortPaymentDetailsFromEnv({
      RESORT_BANK_ACCOUNT_NAME: "Casa Escondida Anilao Resort Inc.",
      RESORT_BANK_NAME: "BDO Unibank (Pesos)",
      RESORT_BANK_ACCOUNT_NUMBER: "0099 8877 6655",
      RESORT_EWALLET: "0917 000 0000 (Casa Front Desk)",
    });
    expect(paymentDetailLines(withWallet!)).toHaveLength(2);
    expect(paymentDetailsText(withWallet!)).toContain("GCash / Maya");
  });

  it("leaves the card and the copy button off the Send screen, and the invented numbers nowhere", async () => {
    const html = await studioPage();

    // The block and its button are gone…
    expect(html).not.toContain("Bank &amp; Payment Details");
    expect(html).not.toContain("Copy Bank Details");
    // …the clipboard constant is empty, so a stale tab copies nothing…
    expect(html).toContain("const BANK_PAYMENT_TEXT = \"\";");
    // …and the numbers that used to be in the source are not on the page in any form.
    for (const invented of INVENTED) expect(html).not.toContain(invented);
  });

  it("draws the card from the configuration when there is one", async () => {
    vi.stubEnv("RESORT_BANK_ACCOUNT_NAME", "Casa Escondida Anilao Resort Inc.");
    vi.stubEnv("RESORT_BANK_NAME", "BDO Unibank (Pesos)");
    vi.stubEnv("RESORT_BANK_ACCOUNT_NUMBER", "0099 8877 6655");
    vi.stubEnv("RESORT_EWALLET", "0917 000 0000 (Casa Front Desk)");

    const html = await studioPage();

    expect(html).toContain("Bank &amp; Payment Details");
    expect(html).toContain("Copy Bank Details");
    expect(html).toContain("BDO Unibank (Pesos): Casa Escondida Anilao Resort Inc.");
    expect(html).toContain("0099 8877 6655");
    expect(html).toContain('const BANK_PAYMENT_TEXT = "Casa Escondida Anilao - Bank Payment Details:');
    // Whatever is configured, the invented numbers stay out of the page.
    for (const invented of INVENTED) expect(html).not.toContain(invented);
  });

  it("never puts payment details on the guest's page", async () => {
    vi.stubEnv("RESORT_BANK_ACCOUNT_NAME", "Casa Escondida Anilao Resort Inc.");
    vi.stubEnv("RESORT_BANK_NAME", "BDO Unibank (Pesos)");
    vi.stubEnv("RESORT_BANK_ACCOUNT_NUMBER", "0099 8877 6655");

    const app = createApp();
    const quotations = await listQuotations();
    const html = await (await app.request(`/q/${quotations[0]!.slug}`)).text();

    // A guest's page carries the price and the resort's terms; where to send money is a conversation
    // with the front desk. Nothing here may learn to render it by accident.
    expect(html).not.toContain("0099 8877 6655");
    for (const invented of INVENTED) expect(html).not.toContain(invented);
  });
});
