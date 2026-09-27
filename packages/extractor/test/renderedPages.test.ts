// Every page this service renders is HTML with an inline <script>. Those scripts live inside
// TypeScript template literals, where a single `\n` is a REAL newline by the time it reaches the
// browser — so `'\n⚠️ …'` inside the studio's script shipped an unterminated string literal and the
// browser threw `SyntaxError: Invalid or unexpected token`. One bad character killed the whole
// script block: the quotation sidebar and the editable line-item table both rendered empty, and
// nothing in the HTML looked broken.
//
// Found 2026-09-25 by opening the studio in a real browser and reading the console — every
// server-side check (markers, string matching, even the archify visual pass) was green, because
// none of them execute the page's JavaScript. This file does: it parses each rendered script.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../../../apps/casa-bff/src/app.js";
import { listQuotations } from "../../../apps/casa-bff/src/quotationStore.js";

const STAFF_TOKEN = "test-staff-token";
const savedToken = process.env.WHATSAPP_VERIFY_TOKEN;

beforeAll(() => {
  process.env.WHATSAPP_VERIFY_TOKEN = STAFF_TOKEN;
});
afterAll(() => {
  if (savedToken === undefined) delete process.env.WHATSAPP_VERIFY_TOKEN;
  else process.env.WHATSAPP_VERIFY_TOKEN = savedToken;
});

/** Every inline script body on a page. */
function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1] ?? "")
    .filter((code) => code.trim() !== "");
}

/** `new Function` compiles the body without running it — a SyntaxError here is what the browser hit. */
function firstSyntaxError(code: string): string | null {
  try {
    // eslint-disable-next-line no-new-func
    new Function(code);
    return null;
  } catch (err) {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
}

describe("the JavaScript on every rendered page parses", () => {
  it("the staff studio page", async () => {
    const app = createApp();
    const quotations = await listQuotations();
    const html = await (await app.request(`/quotes/${quotations[0]!.quoteId}?token=${STAFF_TOKEN}`)).text();

    const scripts = inlineScripts(html);
    expect(scripts.length).toBeGreaterThan(0);
    for (const [i, code] of scripts.entries()) {
      expect(firstSyntaxError(code), `studio script #${i + 1} does not parse`).toBeNull();
    }
  });

  it("the guest quotation page", async () => {
    const app = createApp();
    const quotations = await listQuotations();
    const html = await (await app.request(`/q/${quotations[0]!.slug}`)).text();

    for (const [i, code] of inlineScripts(html).entries()) {
      expect(firstSyntaxError(code), `guest script #${i + 1} does not parse`).toBeNull();
    }
  });

  it("the sign-in page", async () => {
    const app = createApp();
    const html = await (await app.request("/login")).text();

    for (const [i, code] of inlineScripts(html).entries()) {
      expect(firstSyntaxError(code), `login script #${i + 1} does not parse`).toBeNull();
    }
  });

  it("the handoff inbox", async () => {
    const app = createApp();
    const html = await (await app.request(`/handoff?token=${STAFF_TOKEN}`)).text();

    for (const [i, code] of inlineScripts(html).entries()) {
      expect(firstSyntaxError(code), `handoff script #${i + 1} does not parse`).toBeNull();
    }
  });

  // The specific shape that broke: a template literal that should emit `\n` inside a JS string.
  // A single backslash becomes a real newline and terminates the string early.
  it("keeps escaped newlines inside the studio's estimator output", async () => {
    const app = createApp();
    const quotations = await listQuotations();
    const html = await (await app.request(`/quotes/${quotations[0]!.quoteId}?token=${STAFF_TOKEN}`)).text();

    // The emitted page must carry the two characters `\` `n`, never a raw line break mid-string.
    expect(html).toContain("'\\n⚠️ SAMPLE DATA");
    expect(html).not.toContain("'\n⚠️ SAMPLE DATA");
  });
});

/**
 * The studio prices from the engine and nothing else.
 *
 * It used to carry a hand-editable line-item table with its own subtotal/discount arithmetic, which
 * is a second price for the same trip: staff could type 42,400 into the table while the engine's
 * answer, the per-guest cards and the guest's link all said something else. The trip review panel
 * replaced it — corrections go back to the engine as a corrected TRIP.
 *
 * This is a guard against the table growing back, because it is the kind of thing that looks
 * convenient in a demo and is exactly what the customer's own flow exists to stop.
 */
describe("the studio has one price, and it is the engine's", () => {
  it("offers the trip review panel, and no hand-typed price table", async () => {
    const app = createApp();
    const quotations = await listQuotations();
    const html = await (await app.request(`/quotes/${quotations[0]!.quoteId}?token=${STAFF_TOKEN}`)).text();

    // The panel, its save action, and the per-day dive grid's own legend.
    expect(html).toContain('id="trip-review"');
    expect(html).toContain("saveTripAndReprice()");
    expect(html).toContain("D = boat dive, 3 = third dive, N = night dive");

    // The manual table and its arithmetic are gone, elements and handlers alike.
    expect(html).not.toContain("line-items-tbody");
    expect(html).not.toContain("input-discount");
    expect(html).not.toContain("select-currency");
    expect(html).not.toContain("addLineItem");
    expect(html).not.toContain("GRAND TOTAL");
  });

  it("shows the engine's total and says so, sample label included", async () => {
    const app = createApp();
    const quotations = await listQuotations();
    const html = await (await app.request(`/quotes/${quotations[0]!.quoteId}?token=${STAFF_TOKEN}`)).text();

    expect(html).toContain("Engine total");
    expect(html).toContain("There is no discount field here on purpose");
  });

  it("counts how often staff had to correct the bot, without naming a guest", async () => {
    const app = createApp();
    const quotations = await listQuotations();
    const html = await (await app.request(`/quotes/${quotations[0]!.quoteId}?token=${STAFF_TOKEN}`)).text();

    // The scorecard is the extractor's only real measure: a quotation that flowed end to end says
    // the flow worked, not that the bot's payload was already right.
    expect(html).toContain("Extractor scorecard");
    expect(html).toContain("unchanged");
    expect(html).toContain("Field names only");
  });
});
