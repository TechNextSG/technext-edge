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
import { listQuotations, saveQuotationDraft } from "../../../apps/casa-bff/src/quotationStore.js";

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
  it("keeps escaped newlines inside the studio's own messages", async () => {
    const app = createApp();
    const quotations = await listQuotations();
    const html = await (await app.request(`/quotes/${quotations[0]!.quoteId}?token=${STAFF_TOKEN}`)).text();

    // The emitted page must carry the two characters `\` `n`, never a raw line break mid-string.
    // The anchor is the shared notice box: every failure message is assembled with `join('\n')`, so
    // if the escaping regresses, the whole studio's error reporting does too.
    expect(html).toContain("lines.join('\\n')");
    expect(html).not.toContain("lines.join('\n')");
  });
});

/**
 * One palette across every page staff and guests walk through.
 *
 * Each page used to carry its own `:root` block with *nearly* the same colours, which is worse than
 * two obviously different ones: the drift only shows when the pages are seen one after another, and
 * a demo walks through three of them in a row. `apps/casa-bff/src/theme.ts` is the single source
 * now, and this is what keeps it that way.
 */
describe("every page draws from one set of colour tokens", () => {
  const LIGHT_BG = "--bg: #f8fafc;";
  const LIGHT_ACCENT = "--accent: #0284c7;";
  const DARK_ACCENT = "--accent: #38bdf8;";

  it("carries the shared tokens on the studio, the 410 page, sign-in, handoff and ops", async () => {
    const app = createApp();
    const quotations = await listQuotations();
    const id = quotations[0]!.quoteId;

    const pages: Array<[string, string]> = [
      ["studio", await (await app.request(`/quotes/${id}?token=${STAFF_TOKEN}`)).text()],
      // `/q/:slug` answers JSON or HTML depending on `Accept`, and a guest arrives from a browser —
      // so the page under test is the one a browser gets.
      [
        "410",
        await (
          await app.request(`/q/${quotations[0]!.slug}`, { headers: { accept: "text/html" } })
        ).text(),
      ],
      ["sign-in", await (await app.request("/login")).text()],
      ["handoff", await (await app.request(`/handoff?token=${STAFF_TOKEN}`)).text()],
      ["ops", await (await app.request(`/quotes/${id}/ops?token=${STAFF_TOKEN}`)).text()],
    ];

    for (const [name, html] of pages) {
      // The same three values on every page, in both themes: one background, one accent, and the
      // dark counterpart — the three a viewer sees change when they click the theme toggle.
      expect(html, `${name} is missing the shared light background`).toContain(LIGHT_BG);
      expect(html, `${name} is missing the shared light accent`).toContain(LIGHT_ACCENT);
      expect(html, `${name} is missing the shared dark accent`).toContain(DARK_ACCENT);
    }
  });

  it("gives the retired /q page a way forward instead of a dead end", async () => {
    const app = createApp();
    const quotations = await listQuotations();
    const html = await (
      await app.request(`/q/${quotations[0]!.slug}`, { headers: { accept: "text/html" } })
    ).text();

    // A guest who followed an old link has a question this page cannot answer, and the honest
    // action is the channel they already reached us on. Staff land here too, from a link pasted
    // into a chat, and the studio is where the quotation actually is.
    expect(html).toContain("Reply on WhatsApp instead of waiting");
    expect(html).toContain("wa.me");
    expect(html).toContain('href="/login"');
    expect(html).toContain("What happens next?");
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

    // The panel, its save action, and the per-day dive grid's own legend. ONE save for the whole
    // review step: it stores the guest's details and sends the trip to the engine.
    expect(html).toContain('id="trip-review"');
    expect(html).toContain("saveStudio()");
    expect(html).toContain('id="btn-save-all"');
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
    expect(html).toContain("No discount field");
  });

  it("counts how often staff had to correct the bot, without naming a guest", async () => {
    const app = createApp();
    const quotations = await listQuotations();
    const html = await (await app.request(`/quotes/${quotations[0]!.quoteId}?token=${STAFF_TOKEN}`)).text();

    // The scorecard is the extractor's only real measure: a quotation that flowed end to end says
    // the flow worked, not that the bot's payload was already right. It is now one plain sentence in
    // the sidebar rather than a card hidden behind `display:none` — a number nobody can see measures
    // nothing, and the previous version rendered it into the HTML while hiding it.
    expect(html).toContain("AI reading check");
    expect(html).toContain("needed no correction after the bot read them");
    expect(html).toContain("Field names only, never guest details");
    expect(html).not.toContain('aria-hidden="true"');
  });

  // Found on a real quotation in production: the page hard-coded "Waiting for Staff Approval" and
  // let its own script correct it, so a quotation staff had already approved read as unapproved
  // until the JavaScript ran — and said that forever if the script failed or was blocked.
  //
  // It also carried the state twice, in two cards that disagreed ("Ready to Send" beside a link box
  // saying no link existed). One status now, derived once, still rendered server-side.
  it("states the approval in the server-rendered page, not only after the script runs", async () => {
    const app = createApp();
    const quotations = await listQuotations();
    const id = quotations[0]!.quoteId;

    // The markup BEFORE the script, which is what a browser shows if the script never runs. The
    // script necessarily contains the same words (it re-draws the status after an action), so
    // asserting on the whole document would prove nothing about the server-rendered state.
    const markupOnly = (html: string) => html.slice(0, html.indexOf("<script>"));

    const pending = await (await app.request(`/quotes/${id}?token=${STAFF_TOKEN}`)).text();
    // The seeded fixture is priced and unapproved, which is the state staff actually meet.
    expect(markupOnly(pending)).toContain("Priced — needs approval");

    const confirmed = await saveQuotationDraft({ ...quotations[0]!, status: "confirmed_by_hono" });
    const html = await (await app.request(`/quotes/${confirmed.quoteId}?token=${STAFF_TOKEN}`)).text();
    expect(markupOnly(html)).toContain("Approved — not sent yet");
    expect(markupOnly(html)).not.toContain("Priced — needs approval");
  });

  // The queue's price must be the engine's or nothing. `totalAmount` is the draft builder's own
  // arithmetic, and on a real production quotation the two disagreed by ₱7,200 — a number no engine
  // produced, sitting beside the dates in the queue.
  it("shows no price in the queue for a quotation nobody has priced", async () => {
    const app = createApp();
    const quotations = await listQuotations();
    const html = await (await app.request(`/quotes/${quotations[0]!.quoteId}?token=${STAFF_TOKEN}`)).text();
    const start = html.indexOf("allQuotes = ");
    const sidebar = html.slice(start, start + 4000);

    expect(sidebar).toContain("engineRevenue");
    expect(sidebar).not.toContain("totalAmount:");
  });
});
