// The studio's own script, run outside a browser.
//
// Why this exists: the studio's controls are drawn and wired by a large inline script inside a
// TypeScript template literal, and nothing else in this suite executes it. The parse test in
// `renderedPages.test.ts` proves it is valid JavaScript; it does not prove that a button's handler
// still exists after the section around it was rewritten, that adding a room really adds one, or
// that "send to the guest" creates the link before it sends. Every one of those failures looks the
// same in a demo — a button that does nothing — and none of them is visible in the markup.
//
// So: a deliberately small DOM stub, and the page's real script run against it. It is not a browser
// and does not pretend to be one; it is the cheapest thing that fails when the wiring breaks.
import { describe, it, expect, beforeAll } from "vitest";
import { createContext, runInContext } from "node:vm";
import { createApp } from "../../src/app.ts";
import { listQuotations, saveQuotationDraft } from "../../src/store/quotationStore.ts";
import { ensureSampleQuotation } from "../helpers/sampleQuotation.ts";

// The app no longer seeds a cold-start record; this file reads the sample one.
beforeAll(async () => {
  await ensureSampleQuotation();
});

const STAFF_TOKEN = "studio-script-token";

interface StubElement {
  id: string;
  style: Record<string, string>;
  className: string;
  textContent: string;
  innerHTML: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  scrollIntoView: () => void;
}

interface Studio {
  state: Record<string, unknown>;
  fetchCalls: string[];
  element: (id: string) => StubElement;
  notice: () => string;
  // The page's functions, as the buttons call them.
  renderTripReview: () => void;
  renderStatus: () => void;
  addRoom: () => void;
  removeRoom: (index: number) => void;
  setRoomType: (index: number, type: string) => void;
  setGuestDay: (guestId: string, date: string, kind: string, on: boolean) => void;
  setDayForAll: (date: string, kind: string, on: boolean) => void;
  saveStudio: () => Promise<void>;
  confirmAndSendToAI: () => Promise<void>;
  sendToGuest: () => Promise<void>;
  syncEstimate: () => Promise<void>;
  updateSendControls: () => void;
  // The wizard.
  goStep: (n: number) => void;
  wizardNext: () => Promise<void> | void;
  step: () => number;
  stepButtons: Array<{ disabled: boolean }>;
  /** How many times the page asked to reload. */
  reloads: () => number;
  /** The bodies of the PUTs the page made, so a test can say what a save may contain. */
  /** The step kept for the next load. */
  rememberedStep: () => number;
  putBodies: string[];
  /** What the page says next to its one save button. */
  hint: () => string;
  /** What the page says under the send/publish buttons. */
  sendHint: () => string;
}

/** The page's last inline script — the studio's own — with a DOM stub around it. */
async function loadStudio(): Promise<Studio> {
  process.env.WHATSAPP_VERIFY_TOKEN = STAFF_TOKEN;
  const app = createApp();
  const all = await listQuotations();
  const seed = all.find((q) => q.quoteId === "QT-1010-SKY")!;
  // A quotation the ENGINE has priced: the seeded fixture's own figure comes from the built-in sample
  // engine, so it has no scenario on theirs and the wizard (correctly) stops at step 2 for it.
  const priced = await saveQuotationDraft({
    ...seed,
    seedVersion: undefined,
    quoteId: "QT-SCRIPT-PRICED",
    slug: "slug-script-priced",
    estimator: { id: "sim-script", cookie: "ubg_sid=sim-script", seq: null, guestUrl: null, sharedAt: null },
  });
  const html = await (await app.request(`/quotes/${priced.quoteId}?token=${STAFF_TOKEN}`)).text();

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script\s*>/gi)];
  const code = scripts[scripts.length - 1]![1]!;

  const elements = new Map<string, StubElement>();
  const element = (id: string): StubElement => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        style: {},
        className: "",
        textContent: "",
        innerHTML: "",
        value: "",
        checked: false,
        disabled: false,
        scrollIntoView: () => {},
      });
    }
    return elements.get(id)!;
  };

  // The wizard works on `<main data-step>` and on the four step buttons, so the stub has to have
  // them. The starting value comes from the markup the server rendered, which is the point: the
  // script is not what decides which screen opens.
  const serverStep = /<main data-step="(\d)"/.exec(html)?.[1] ?? "1";
  const main = {
    attrs: { "data-step": serverStep } as Record<string, string>,
    getAttribute(name: string) {
      return this.attrs[name] ?? null;
    },
    setAttribute(name: string, value: string) {
      this.attrs[name] = value;
    },
    scrollIntoView: () => {},
  };
  const stepButtons = [1, 2, 3, 4].map((n) => ({
    attrs: { "data-step": String(n) } as Record<string, string>,
    disabled: false,
    classes: new Set<string>(),
    getAttribute(name: string) {
      return this.attrs[name] ?? null;
    },
    classList: {
      toggle: () => {},
      add: () => {},
      remove: () => {},
    },
  }));

  const fetchCalls: string[] = [];
  const putBodies: string[] = [];
  /** Every POST, with its body: the trip a save sends is the thing worth asserting on. */
  const postBodies: Array<{ url: string; body: string }> = [];
  /**
   * The trip the SERVER holds — which is not the same thing as the page's copy of it.
   *
   * The stub used to answer the details save with the page's own state, including an edit made in the
   * memory of the page. A real server cannot do that: the trip is not one of the fields that route
   * accepts (it may only arrive through a route that re-prices it), so it answers with the trip it
   * already had. Modelling that is what makes this file able to see a save that sends the wrong trip —
   * the bug it missed twice, found by hand in a browser on 2026-09-28.
   */
  let serverTrip: unknown = null;
  let reloads = 0;
  const context: Record<string, unknown> = {
    document: {
      getElementById: element,
      querySelector: (sel: string) => (sel === "main" ? main : null),
      querySelectorAll: (sel: string) => (sel === ".pstep" ? stepButtons : []),
      documentElement: { setAttribute: () => {}, getAttribute: () => "light" },
    },
    window: {
      // A reload is recorded rather than thrown: the wizard reloads after every action that finishes
      // a step (the record is the truth about what to draw next), and a stub that threw would turn
      // each successful action into a caught "failure".
      location: { search: "", reload: () => { reloads += 1; } },
      prompt: () => "x",
      confirm: () => true,
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    // A real store, keyed by name: the wizard keeps its step here across the reload that follows every
    // action, and the staff token lives here too.
    sessionStorage: (() => {
      const store = new Map<string, string>([["casa_staff_token", STAFF_TOKEN]]);
      return {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
        removeItem: (k: string) => { store.delete(k); },
      };
    })(),
    navigator: { clipboard: { writeText: () => {} } },
    fetch: async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      fetchCalls.push(`${method} ${url}`);
      if (method === "POST") postBodies.push({ url, body: String(init?.body ?? "") });
      // What each route answers, as the page expects it. A save and an approval echo the record,
      // because the page re-reads its state from the answer; publishing answers with the link it
      // minted; the two pricing routes answer with the engine's own `ok`.
      const echo = () => runInContext("state", context) as Record<string, unknown>;
      let body: Record<string, unknown> = {};
      if (method === "PUT") {
        putBodies.push(String(init?.body ?? ""));
        // The details it accepted, over the record as stored — the trip included, unchanged. Deep-copied,
        // because the page keeps a reference to its own trip and mutates it in place when the grid is
        // clicked: handing back the same object would let the server's copy follow an edit it never saw.
        body = { ok: true, quotation: { ...echo(), bffTrip: serverTrip === null ? null : JSON.parse(JSON.stringify(serverTrip)) } };
      } else if (url.includes("/confirm")) {
        body = { ok: true, quotation: echo(), aiReply: "ready" };
      } else if (url.includes("/publish")) {
        body = {
          ok: true,
          seq: 7,
          guestUrl: "https://their-app.test/quote/tok",
          quotation: {
            ...echo(),
            estimator: { id: "sim-1", cookie: "ubg_sid=1", seq: 7, guestUrl: "https://their-app.test/quote/tok", sharedAt: "2026-09-28T00:00:00.000Z" },
          },
        };
      } else if (url.includes("/sync-estimate") || url.includes("/trip?")) {
        // Both routes price a trip and STORE it: `/trip` re-prices an existing scenario, and
        // `/sync-estimate` now accepts the trip a first save posts rather than ignoring it.
        const posted = JSON.parse(String(init?.body ?? "{}")) as { trip?: unknown };
        if (posted.trip) serverTrip = posted.trip;
        body = { ok: true, sample: false, issues: [] };
      } else if (url.includes("/send-whatsapp")) {
        body = { ok: true, phone: "639171234567" };
      }
      return { ok: true, json: async () => body };
    },
    console: { log: () => {}, error: () => {}, warn: () => {} },
    setTimeout,
    clearTimeout,
    alert: () => {},
    // A vm context gets its own built-ins, but not the host's web-ish globals; the page uses this
    // one to read its own `?token=`.
    URLSearchParams,
  };

  createContext(context);
  runInContext(code, context, { filename: "studio.js" });
  // The page script declares `state`, so the server's copy of the trip can only be read once it has
  // run. The fetch stub above closes over this variable, so it is live for every call a test makes.
  // Deep-copied out of the page on purpose: it stands for the server's own record, which cannot change
  // because somebody clicked a checkbox in the browser.
  const initialTrip = (runInContext("state", context) as { bffTrip?: unknown }).bffTrip;
  serverTrip = initialTrip === undefined ? null : JSON.parse(JSON.stringify(initialTrip));

  return {
    // `let state = …` at the top of a script lives in the context's lexical scope, not on its global
    // object, so it is read back by evaluating the name rather than by property access.
    get state() {
      return runInContext("state", context) as Record<string, unknown>;
    },
    fetchCalls,
    putBodies,
    postBodies,
    /** The trip as the server holds it now, after whatever the page sent. */
    serverTrip: () => serverTrip,
    stepButtons,
    step: () => runInContext("stepNumber()", context) as number,
    reloads: () => reloads,
    /** The step the page will open on next time (the reload that follows each action). */
    rememberedStep: () => Number(runInContext("sessionStorage.getItem(STEP_KEY)", context) || 0),
    element,
    notice: () => element("studio-notice").textContent,
    hint: () => element("save-hint").textContent,
    sendHint: () => element("send-hint").textContent,
    ...(context as unknown as Omit<Studio, "state" | "fetchCalls" | "element" | "notice" | "hint" | "putBodies" | "sendHint">),
  };
}

describe("the wizard's own script", () => {
  it("opens on the step the server rendered, and moves when asked", async () => {
    const studio = await loadStudio();
    // The fixture is priced and unapproved, so the server opened on step 3.
    expect(studio.step()).toBe(3);

    studio.goStep(1);
    expect(studio.step()).toBe(1);
    studio.goStep(4);
    // Step 4 needs an approval the record does not have: the bar and the script both refuse to
    // offer a screen whose prerequisites are missing.
    expect(studio.step()).toBe(3);
  });

  it("runs the action that finishes the screen in front of the person", async () => {
    const studio = await loadStudio();
    expect(studio.step()).toBe(3);

    // Step 3, unapproved: the button approves.
    await studio.wizardNext();
    expect(studio.fetchCalls.some((c) => c.includes("/confirm"))).toBe(true);
    expect(studio.fetchCalls.some((c) => c.includes("/send-whatsapp"))).toBe(false);
  });

  it("asks for the price from step 2 when there is none", async () => {
    const studio = await loadStudio();
    studio.state.pricing = null;
    studio.goStep(2);

    await studio.wizardNext();

    expect(studio.fetchCalls.some((c) => c.includes("/sync-estimate"))).toBe(true);
  });

  it("advances without touching the network when the screen has nothing left to do", async () => {
    const studio = await loadStudio();
    // Priced, so step 2 has nothing to run: Next moves to step 3.
    studio.goStep(2);
    const before = studio.fetchCalls.length;

    await studio.wizardNext();

    expect(studio.step()).toBe(3);
    expect(studio.fetchCalls.length).toBe(before);
  });

  it("sends from step 4, which is the end of the wizard", async () => {
    const studio = await loadStudio();
    studio.state.status = "confirmed_by_hono";
    studio.element("ack-sample").checked = true;
    studio.goStep(4);

    await studio.wizardNext();

    expect(studio.fetchCalls.some((c) => c.includes("/publish"))).toBe(true);
    expect(studio.fetchCalls.some((c) => c.includes("/send-whatsapp"))).toBe(true);
  });
});

describe("the studio's own script", () => {
  it("adds a room with a fresh id, and removes an empty one", async () => {
    const studio = await loadStudio();
    const trip = studio.state.bffTrip as { rooms: Array<{ id: string; type: string }> };
    const before = trip.rooms.length;
    const idsBefore = trip.rooms.map((r) => r.id);

    studio.addRoom();
    expect(trip.rooms).toHaveLength(before + 1);
    const added = trip.rooms[trip.rooms.length - 1]!;
    expect(idsBefore).not.toContain(added.id);
    expect(added.type).toBe("standard");
    // A new room changes what the engine would be asked to price, so the page says the price on
    // screen is stale rather than letting it be read as the new trip's.
    expect(studio.hint()).toContain("Unsaved changes. The price below still belongs to the previous trip.");

    studio.removeRoom(trip.rooms.length - 1);
    expect(trip.rooms).toHaveLength(before);
  });

  it("refuses to remove a room with guests in it, and names them", async () => {
    const studio = await loadStudio();
    const trip = studio.state.bffTrip as { rooms: Array<{ id: string; type: string }>; guests: Array<{ name: string; roomId: string }> };
    const occupied = trip.rooms.findIndex((room) => trip.guests.some((g) => g.roomId === room.id));
    expect(occupied, "the fixture has guests in its rooms").toBeGreaterThanOrEqual(0);
    const names = trip.guests.filter((g) => g.roomId === trip.rooms[occupied]!.id).map((g) => g.name);
    const before = trip.rooms.length;

    studio.removeRoom(occupied);

    expect(trip.rooms).toHaveLength(before);
    expect(studio.notice()).toContain("Move " + names.join(", "));
    expect(studio.notice()).toContain(trip.rooms[occupied]!.id);
  });

  it("sets a whole day for everyone, and marks the trip unsaved", async () => {
    const studio = await loadStudio();
    const trip = studio.state.bffTrip as {
      checkIn: string;
      guests: Array<{ days: Record<string, { dive?: boolean; third?: boolean; night?: boolean }> }>;
    };
    const date = trip.checkIn;
    trip.guests.forEach((g) => { g.days = {}; });

    studio.setDayForAll(date, "dive", true);
    expect(trip.guests.every((g) => g.days[date]?.dive === true)).toBe(true);
    expect(studio.hint()).toContain("Unsaved changes. The price below still belongs to the previous trip.");

    studio.setDayForAll(date, "dive", false);
    expect(trip.guests.every((g) => g.days[date]?.dive === false)).toBe(true);
  });

  it("saves the details and prices the trip, in that order, with one button", async () => {
    const studio = await loadStudio();
    // No scenario on their side yet (a quotation only the built-in sample engine has priced), so the
    // save has to ASK for a price rather than re-price an existing scenario.
    studio.state.estimator = null;
    studio.addRoom();

    await studio.saveStudio();

    // The details go to the record first, and the trip only through the route that prices it. `/trip`
    // (which re-prices an existing scenario) would have been a 409 here.
    const putAt = studio.fetchCalls.findIndex((c) => c.startsWith("PUT "));
    const priceAt = studio.fetchCalls.findIndex((c) => c.includes("/sync-estimate"));
    expect(studio.fetchCalls[putAt]).toContain("PUT ");
    expect(priceAt).toBeGreaterThan(putAt);
    expect(studio.fetchCalls.some((c) => c.includes("/trip?"))).toBe(false);
  });

  it("prices the trip the person edited, not the one the details save handed back", async () => {
    // The bug this pins was found by hand in a browser, after the route had already been fixed: the
    // save is two calls, and the record the PUT answers with carries the trip the server already had —
    // because the trip is not a field that route accepts. Assigning that answer to state discarded the
    // edit, and the second call then sent the old trip. The screen said "Saved and priced" and the
    // record never moved.
    //
    // The assertion is on the trip that was POSTed, compared with the trip the grid holds — not on the
    // ending state. An earlier version of this test checked the ending state and passed against the
    // broken code, because the stub happened to answer with the page's own copy.
    const studio = await loadStudio();
    studio.state.estimator = null;
    const trip = studio.state.bffTrip as {
      guests: Array<{ id: string; days: Record<string, { dive?: boolean }> }>;
    };
    const date = Object.keys(trip.guests[0]!.days)[0]!;

    // Exactly what the review grid does when a person moves a dive day to the other guest.
    studio.setGuestDay(trip.guests[0]!.id, date, "dive", false);
    studio.setGuestDay(trip.guests[1]!.id, date, "dive", true);
    const asEdited = JSON.parse(JSON.stringify(studio.state.bffTrip)) as typeof trip;

    await studio.saveStudio();

    const pricing = studio.postBodies.find((c) => c.url.includes("/sync-estimate") || c.url.includes("/trip?"));
    expect(pricing, "the save asked for a price").toBeTruthy();
    const posted = (JSON.parse(pricing!.body) as { trip: typeof trip }).trip;

    expect(posted.guests[0]!.days[date]?.dive ?? false).toBe(false);
    expect(posted.guests[1]!.days[date]?.dive).toBe(true);
    expect(posted).toEqual(asEdited);
  });

  it("re-prices on the existing scenario when the trip is edited and one already exists", async () => {
    const studio = await loadStudio();
    expect((studio.state.estimator as { id?: string } | null)?.id).toBe("sim-script");
    studio.state.estimator = { id: "sim-1", cookie: "ubg_sid=1", seq: null, guestUrl: null, sharedAt: null };
    studio.setRoomType(0, "suite");

    await studio.saveStudio();

    expect(studio.fetchCalls.some((c) => c.includes("/trip?"))).toBe(true);
    expect(studio.fetchCalls.some((c) => c.includes("/sync-estimate"))).toBe(false);
  });

  it("asks the engine for a price when the record carries one the engine never gave", async () => {
    // Production, walking step 1: the fixture had 52,400 on it from the built-in sample engine and no
    // scenario anywhere, and Save said "Saved." and walked on without asking for a price. "Priced"
    // means `estimator.id`, not "a figure is on the record".
    const studio = await loadStudio();
    studio.state.estimator = null;                 // no scenario, but the figure is still on the record
    expect((studio.state.pricing as unknown) ?? null).not.toBeNull();

    await studio.saveStudio();

    expect(studio.fetchCalls.some((c) => c.includes("/sync-estimate"))).toBe(true);
  });

  it("does not disturb a price when only the guest's details changed", async () => {
    const studio = await loadStudio();
    // The fixture is priced; nothing about the trip was touched.
    expect((studio.state.pricing as unknown) ?? null).not.toBeNull();
    studio.element("meta-guestName").value = "Ana Reyes";

    await studio.saveStudio();

    expect(studio.fetchCalls.some((c) => c.startsWith("PUT "))).toBe(true);
    expect(studio.fetchCalls.some((c) => c.includes("/trip?"))).toBe(false);
    expect(studio.fetchCalls.some((c) => c.includes("/sync-estimate"))).toBe(false);
  });

  it("never puts the trip through the plain save, because that route does not price it", async () => {
    const studio = await loadStudio();
    await studio.saveStudio();

    // The body of the PUT is the contact fields only. Sending the trip there is what wrote an
    // unpriced trip in the old page, and what `/confirm` refuses.
    expect(studio.putBodies).toHaveLength(1);
    const body = JSON.parse(studio.putBodies[0]!) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["checkIn", "checkOut", "guestName", "phone", "staffNotes"]);
  });

  it("creates the guest link before it sends, because the message carries that link", async () => {
    const studio = await loadStudio();
    studio.element("ack-sample").checked = true;

    await studio.sendToGuest();

    const publishAt = studio.fetchCalls.findIndex((c) => c.includes("/publish"));
    const sendAt = studio.fetchCalls.findIndex((c) => c.includes("/send-whatsapp"));
    expect(publishAt, "the link was never created").toBeGreaterThanOrEqual(0);
    expect(sendAt, "the message was never sent").toBeGreaterThan(publishAt);
  });

  it("will not send a sample price the person has not acknowledged", async () => {
    const studio = await loadStudio();
    studio.element("ack-sample").checked = false;

    await studio.sendToGuest();

    expect(studio.fetchCalls.some((c) => c.includes("/send-whatsapp"))).toBe(false);
    expect(studio.notice()).toContain("sample-price box");
  });

  it("disables every action that publishes until the sample price is acknowledged", async () => {
    // Found by using it: the tick box sat in one card while a second publish button lived in
    // "More actions", so that button answered "Tick the sample-price box before sending" — true,
    // unhelpful, and about a box the person had not seen. Both controls that publish are now on the
    // Send screen beside the box, and until it is ticked they are disabled with the reason on screen.
    const studio = await loadStudio();
    studio.state.status = "confirmed_by_hono";
    studio.goStep(4);

    studio.element("ack-sample").checked = false;
    studio.updateSendControls();
    expect(studio.element("btn-next").disabled).toBe(true);
    expect(studio.element("btn-publish-quote").disabled).toBe(true);
    expect(studio.sendHint()).toContain("Tick");

    studio.element("ack-sample").checked = true;
    studio.updateSendControls();
    expect(studio.element("btn-publish-quote").disabled).toBe(false);
    expect(studio.sendHint()).toContain("carries the guest");
    // And on the OTHER screens the wizard button is not gated by a sample-price tick: its action
    // there is to approve, or to price the trip, and neither publishes anything.
    studio.goStep(3);
    studio.element("ack-sample").checked = false;
    studio.updateSendControls();
    expect(studio.element("btn-next").disabled).toBe(false);
  });

  it("approves the quotation, and moves to the screen that sends it", async () => {
    const studio = await loadStudio();

    await studio.confirmAndSendToAI();

    expect(studio.fetchCalls.some((c) => c.includes("/confirm"))).toBe(true);
    // Approving finishes screen 3, so the wizard advances and the page is rebuilt from the record —
    // which is where the guest's message comes from.
    expect(studio.reloads()).toBe(1);
    expect(studio.rememberedStep()).toBe(4);
  });
});
