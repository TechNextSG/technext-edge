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
import { createApp } from "../src/app.js";
import { listQuotations, saveQuotationDraft } from "../src/stores/quotationStore.js";

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
 * a demo walks through three of them in a row. `bff/src/theme.ts` is the single source
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
    // review step: it stores the guest's details and sends the trip to the engine — and it is the
    // wizard's Next button, so the screen in front of the person holds no competing primary action.
    expect(html).toContain('id="trip-review"');
    expect(html).toContain("saveStudio()");
    expect(html).toContain("wizardNext()");
    expect(html).toContain('id="btn-next"');
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

  it("shows no extractor scorecard in the queue sidebar", async () => {
    const app = createApp();
    const quotations = await listQuotations();
    const html = await (await app.request(`/quotes/${quotations[0]!.quoteId}?token=${STAFF_TOKEN}`)).text();

    // Removed on 2026-09-29. "N of M needed no correction" counted quotations nobody had opened as
    // unchanged and counted test records, so it measured nothing a receptionist could act on — and it
    // sat above the working list, pushing it below the fold. The corrections themselves are still
    // recorded per save (see the staffEdits tests); only the on-screen tally is gone.
    expect(html).not.toContain("AI reading check");
    expect(html).not.toContain("needed no correction");
    expect(html).not.toContain("Field names only, never guest details");
    // A card is not allowed to come back hidden either: a number nobody can see measures nothing.
    expect(html).not.toContain('aria-hidden="true"');
  });

  it("shortens a check-in date for the queue card without ever hiding a malformed one", async () => {
    const app = createApp();
    const quotations = await listQuotations();
    const html = await (await app.request(`/quotes/${quotations[0]!.quoteId}?token=${STAFF_TOKEN}`)).text();

    // Run the page's own function rather than a copy of it: the card's second line has room for about
    // thirty characters, and a full ISO date pushed the id off the end (it was cut to "#735DA7…").
    const start = html.indexOf("function shortDate(iso)");
    expect(start).toBeGreaterThan(-1);
    const end = html.indexOf("\n    }\n", start);
    const shortDate = new Function(`${html.slice(start, end + 6)}; return shortDate;`)() as (iso: string) => string;

    const thisYear = new Date().getUTCFullYear();
    expect(shortDate(`${thisYear}-11-20`)).toBe("Nov 20");
    expect(shortDate(`${thisYear}-01-05`)).toBe("Jan 5"); // no leading zero, no timezone drift to Jan 4
    expect(shortDate("2031-03-09")).toBe("Mar 9 '31"); // another year keeps the year, two digits
    // Anything that is not an ISO date stays visible instead of turning into a blank or "Invalid Date".
    expect(shortDate("garbage")).toBe("garbage");
    expect(shortDate("")).toBe("");
  });

  // The queue's sort and filters are plain functions on the page. These tests take the page's own source
  // for them (by name, out of the rendered HTML) and run it, so what is tested is what ships.
  function pageFunctions(html: string, names: string[], opts: { preamble?: string; params?: string[]; exports?: string[] } = {}) {
    const take = (name: string) => {
      const start = html.indexOf(`function ${name}(`);
      expect(start, `function ${name} is on the page`).toBeGreaterThan(-1);
      let i = html.indexOf("{", start);
      let depth = 0;
      for (; i < html.length; i++) {
        if (html[i] === "{") depth++;
        else if (html[i] === "}" && --depth === 0) break;
      }
      return html.slice(start, i + 1);
    };
    const exported = [...names, ...(opts.exports ?? [])].join(", ");
    // `preamble` declares the page-level variables the functions read (`var queueView = …`).
    return (...args: unknown[]) =>
      new Function(...(opts.params ?? []), `${opts.preamble ?? ""}\n${names.map(take).join("\n")}\nreturn { ${exported} };`)(...args) as Record<string, any>;
  }

  async function studioHtml() {
    const app = createApp();
    const quotations = await listQuotations();
    return (await app.request(`/quotes/${quotations[0]!.quoteId}?token=${STAFF_TOKEN}`)).text();
  }

  const q = (id: string, over: Record<string, unknown> = {}) => ({
    quoteId: id,
    guestName: id,
    checkIn: "2026-11-20",
    nights: 2,
    engineRevenue: null,
    sentToGuestAt: null,
    updatedAt: "2026-09-01T00:00:00Z",
    ...over,
  });

  it("sorts the queue by what a receptionist would ask for", async () => {
    const { sortQuotes } = pageFunctions(await studioHtml(), ["activityTime", "checkInTime", "sortQuotes"])();
    // A fixed "today" (29 Sep, midday, local time) so the check-in order does not depend on the clock.
    const NOW = new Date(2026, 8, 29, 12, 0, 0).getTime();
    const ids = (mode: string, list: unknown[]) => sortQuotes!(list, mode, NOW).map((x: { quoteId: string }) => x.quoteId);

    // Latest first: the time it was SENT if it was sent, otherwise the last time anyone touched it.
    const timeline = [
      q("A", { sentToGuestAt: "2026-09-28T10:00:00Z" }),
      q("B", { sentToGuestAt: "2026-09-29T08:00:00Z" }),
      q("C", { updatedAt: "2026-09-29T09:00:00Z" }), // not sent: falls back to updatedAt
      q("D", { updatedAt: "2026-09-20T00:00:00Z" }),
    ];
    expect(ids("latest", timeline)).toEqual(["C", "B", "A", "D"]);
    expect(ids("oldest", timeline)).toEqual(["D", "A", "B", "C"]);
    // A quotation with no usable time sorts as the oldest instead of throwing.
    expect(ids("latest", [q("X", { updatedAt: null }), q("Y", { updatedAt: "2026-09-02T00:00:00Z" })])).toEqual(["Y", "X"]);

    // Equal keys keep a fixed order, so the list cannot shuffle between two renders.
    const tie = [q("Q2", { updatedAt: "2026-09-05T00:00:00Z" }), q("Q1", { updatedAt: "2026-09-05T00:00:00Z" })];
    expect(ids("latest", tie)).toEqual(["Q1", "Q2"]);

    // Check-in: guests still to arrive first, soonest first (arriving today counts as still to arrive);
    // guests whose date has passed after them, most recent first; a missing or malformed date last.
    // Plain date order would put someone who arrived last week at the top of the front desk's list.
    expect(
      ids("checkin", [
        q("past-old", { checkIn: "2026-09-20" }),
        q("late", { checkIn: "2026-12-01" }),
        q("bad", { checkIn: "soon" }),
        q("past-new", { checkIn: "2026-09-27" }),
        q("soon", { checkIn: "2026-10-02" }),
        q("none", { checkIn: "" }),
        q("today", { checkIn: "2026-09-29" }),
      ]),
    ).toEqual(["today", "soon", "late", "past-new", "past-old", "bad", "none"]);

    // Guest name A-Z ignoring case; a blank name goes last.
    expect(ids("name", [q("1", { guestName: "miguel" }), q("2", { guestName: "" }), q("3", { guestName: "Ana" }), q("4", { guestName: "Ben" })])).toEqual(["3", "4", "1", "2"]);

    // Highest total first; nothing priced yet goes last (it is not a total of zero).
    expect(ids("total", [q("p", { engineRevenue: 31200 }), q("n", { engineRevenue: null }), q("h", { engineRevenue: 52400 }), q("z", { engineRevenue: 0 })])).toEqual(["h", "p", "z", "n"]);

    // An unknown mode is the default order, not an error.
    expect(ids("nonsense", timeline)).toEqual(["C", "B", "A", "D"]);
    // The caller's list is never reordered in place.
    const original = [q("b", { updatedAt: "2026-09-01T00:00:00Z" }), q("a", { updatedAt: "2026-09-09T00:00:00Z" })];
    sortQuotes(original, "latest");
    expect(original.map((x) => x.quoteId)).toEqual(["b", "a"]);
  });

  it("filters the queue by when it was sent, when the guest arrives, and whether it is priced", async () => {
    const { matchesViewFilters } = pageFunctions(await studioHtml(), ["checkInTime", "matchesViewFilters"])();
    // Built from local time parts, because the page reads "today" in the receptionist's own time zone.
    const now = new Date(2026, 8, 29, 12, 0, 0).getTime();
    const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h, 0, 0).toISOString();
    const any = { sent: "any", checkin: "any", price: "any" };
    const pass = (over: Record<string, string>, quote: Record<string, unknown>) => matchesViewFilters(quote, { ...any, ...over }, now);

    expect(pass({}, q("everything"))).toBe(true);

    // Sent
    expect(pass({ sent: "unsent" }, q("u"))).toBe(true);
    expect(pass({ sent: "unsent" }, q("s", { sentToGuestAt: at(2026, 9, 29, 8) }))).toBe(false);
    expect(pass({ sent: "today" }, q("t", { sentToGuestAt: at(2026, 9, 29, 8) }))).toBe(true);
    expect(pass({ sent: "today" }, q("y", { sentToGuestAt: at(2026, 9, 28, 23) }))).toBe(false); // an hour before midnight
    expect(pass({ sent: "today" }, q("never"))).toBe(false);
    expect(pass({ sent: "7d" }, q("w", { sentToGuestAt: at(2026, 9, 23, 13) }))).toBe(true);
    expect(pass({ sent: "7d" }, q("old", { sentToGuestAt: at(2026, 9, 20, 12) }))).toBe(false);

    // Check-in, counted from today's date (29 Sep): both ends of each window are inclusive.
    expect(pass({ checkin: "next7" }, q("a", { checkIn: "2026-09-29" }))).toBe(true); // arriving today
    expect(pass({ checkin: "next7" }, q("b", { checkIn: "2026-10-06" }))).toBe(true);
    expect(pass({ checkin: "next7" }, q("c", { checkIn: "2026-10-07" }))).toBe(false);
    expect(pass({ checkin: "next30" }, q("d", { checkIn: "2026-10-29" }))).toBe(true);
    expect(pass({ checkin: "next30" }, q("e", { checkIn: "2026-10-30" }))).toBe(false);
    expect(pass({ checkin: "past" }, q("f", { checkIn: "2026-09-28" }))).toBe(true);
    expect(pass({ checkin: "past" }, q("g", { checkIn: "2026-09-29" }))).toBe(false); // today is not past
    // A quotation with no readable date cannot match a date window, rather than matching all of them.
    expect(pass({ checkin: "next30" }, q("h", { checkIn: "" }))).toBe(false);

    // Price: "not priced" is the absence of an engine figure, never a figure of zero.
    expect(pass({ price: "priced" }, q("p", { engineRevenue: 31200 }))).toBe(true);
    expect(pass({ price: "priced" }, q("p0", { engineRevenue: 0 }))).toBe(true);
    expect(pass({ price: "priced" }, q("np"))).toBe(false);
    expect(pass({ price: "unpriced" }, q("np"))).toBe(true);
    expect(pass({ price: "unpriced" }, q("p", { engineRevenue: 31200 }))).toBe(false);

    // Filters combine: every one of them has to hold.
    expect(pass({ sent: "unsent", price: "priced" }, q("k", { engineRevenue: 1 }))).toBe(true);
    expect(pass({ sent: "unsent", price: "priced" }, q("k2", { engineRevenue: 1, sentToGuestAt: at(2026, 9, 29, 8) }))).toBe(false);
  });

  it("opens the filter panel whenever a filter is on, so a hidden filter is never why the list is short", async () => {
    const html = await studioHtml();
    const el = (extra: Record<string, unknown> = {}) => ({
      value: "",
      textContent: "",
      hidden: false,
      attrs: {} as Record<string, string>,
      on: false,
      classList: { toggle(this: any, _c: string, force: boolean) { (this.owner as any).on = force; }, owner: null as unknown },
      setAttribute(k: string, v: string) { this.attrs[k] = v; },
      ...extra,
    });
    const nodes: Record<string, ReturnType<typeof el>> = {};
    for (const id of ["queue-sort", "qf-sent", "qf-checkin", "qf-price", "queue-filter-count", "queue-filter-toggle", "queue-filters", "queue-clear"]) {
      nodes[id] = el();
      nodes[id]!.classList.owner = nodes[id];
    }
    nodes["queue-filters"]!.hidden = true; // as the page ships it: folded away
    const fakeDocument = { getElementById: (id: string) => nodes[id] ?? null };

    // The page's own functions, with the page's own default view and a stand-in for `document`.
    const run = pageFunctions(html, ["activeFilterCount", "syncQueueControls"], {
      preamble: "var queueView = { sort: 'latest', sent: 'any', checkin: 'any', price: 'any' };",
      params: ["document"],
      exports: ["queueView"],
    })(fakeDocument) as { queueView: Record<string, string>; syncQueueControls: () => void };

    // Nothing on: the panel stays folded, no badge, nothing to clear.
    run.syncQueueControls();
    expect(nodes["queue-filters"]!.hidden).toBe(true);
    expect(nodes["queue-filter-count"]!.textContent).toBe("");
    expect(nodes["queue-clear"]!.hidden).toBe(true);
    expect(nodes["queue-filter-toggle"]!.on).toBe(false);

    // One filter on: the panel opens itself, the button says how many, and there is a way out.
    run.queueView.price = "priced";
    run.syncQueueControls();
    expect(nodes["queue-filters"]!.hidden).toBe(false);
    expect(nodes["queue-filter-count"]!.textContent).toBe("1");
    expect(nodes["queue-clear"]!.hidden).toBe(false);
    expect(nodes["queue-filter-toggle"]!.on).toBe(true);
    expect(nodes["queue-filter-toggle"]!.attrs["aria-expanded"]).toBe("true");
    expect(nodes["qf-price"]!.value).toBe("priced");

    run.queueView.sent = "unsent";
    run.syncQueueControls();
    expect(nodes["queue-filter-count"]!.textContent).toBe("2");
  });

  it("offers the five sorts and three filters, and does not let a grid hide the folded panel", async () => {
    const html = await studioHtml();
    // Short on purpose: the box is about 170px wide and has to show its whole current choice — an
    // earlier "Check-in soonest" rendered as "Check-in soo" in the studio and told nobody anything.
    for (const label of ["Latest first", "Oldest first", "Check-in date", "Name A–Z", "Highest total"]) {
      expect(html).toContain(`>${label}</option>`);
      expect(label.length, `"${label}" has to fit the sort box`).toBeLessThanOrEqual(14);
    }
    for (const id of ["qf-sent", "qf-checkin", "qf-price", "queue-sort", "queue-clear"]) {
      expect(html).toContain(`id="${id}"`);
    }
    // The panel ships folded (hidden attribute), and `display:grid` would silently override that.
    expect(html).toContain('id="queue-filters" class="queue-filters" hidden');
    expect(html).toContain(".queue-filters[hidden] { display: none; }");
    // The search box says what it actually matches — the old placeholder promised phone numbers.
    expect(html).toContain("Search name, quote ID or date");
    expect(html).not.toContain("Search guest, phone, quote ID");
  });

  it("draws each queue card on two lines, with the id shortened", async () => {
    const app = createApp();
    const quotations = await listQuotations();
    const html = await (await app.request(`/quotes/${quotations[0]!.quoteId}?token=${STAFF_TOKEN}`)).text();

    // A card used to be about 160px tall (id, status and trip on three lines, wrapping in a narrow
    // sidebar), which left a laptop screen showing barely one and a half quotations. Name + status
    // on the first line, the trip on the second.
    expect(html).toContain('class="ql-name"');
    expect(html).toContain('class="ql-meta"');
    expect(html).toContain('class="ql-id"');
    // The full id is still reachable — as the link's title, and as what the search box matches.
    expect(html).toContain('title="${escHtml(q.quoteId)}"');
    // The old three-line layout put the whole id in bold accent type on the first line.
    expect(html).not.toContain('<strong style="font-size:15px;color:var(--accent);">${q.quoteId}</strong>');
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

    // A quotation the ENGINE has priced and nobody has approved — the state staff meet between steps
    // 2 and 3. (`estimator.id` is what says the engine owns it; a figure from the built-in sample
    // engine has no scenario to freeze, and the page says so instead — see `studioWorkflow`.)
    const pricedByEngine = await saveQuotationDraft({
      ...quotations[0]!,
      estimator: { id: "sim-render", cookie: "ubg_sid=sim-render", seq: null, guestUrl: null, sharedAt: null },
    });
    const pending = await (await app.request(`/quotes/${pricedByEngine.quoteId}?token=${STAFF_TOKEN}`)).text();
    expect(markupOnly(pending)).toContain("Priced — needs approval");

    const confirmed = await saveQuotationDraft({ ...pricedByEngine, status: "confirmed_by_hono" });
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
