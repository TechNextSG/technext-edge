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
import { describe, it, expect } from "vitest";
import { createContext, runInContext } from "node:vm";
import { createApp } from "../../../apps/casa-bff/src/app.js";
import { listQuotations } from "../../../apps/casa-bff/src/quotationStore.js";

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
  /** The bodies of the PUTs the page made, so a test can say what a save may contain. */
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
  const html = await (await app.request(`/quotes/${seed.quoteId}?token=${STAFF_TOKEN}`)).text();

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
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

  const fetchCalls: string[] = [];
  const putBodies: string[] = [];
  const context: Record<string, unknown> = {
    document: {
      getElementById: element,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { setAttribute: () => {}, getAttribute: () => "light" },
    },
    window: {
      location: { search: "", reload: () => { throw new Error("RELOAD"); } },
      prompt: () => "x",
      confirm: () => true,
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    sessionStorage: { getItem: () => STAFF_TOKEN, setItem: () => {}, removeItem: () => {} },
    navigator: { clipboard: { writeText: () => {} } },
    fetch: async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      fetchCalls.push(`${method} ${url}`);
      if (method === "PUT") putBodies.push(String(init?.body ?? ""));
      // What each route answers, as the page expects it. A save and an approval echo the record,
      // because the page re-reads its state from the answer; publishing answers with the link it
      // minted; the two pricing routes answer with the engine's own `ok`.
      const echo = () => runInContext("state", context) as Record<string, unknown>;
      let body: Record<string, unknown> = {};
      if (method === "PUT" || url.includes("/confirm")) {
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

  return {
    // `let state = …` at the top of a script lives in the context's lexical scope, not on its global
    // object, so it is read back by evaluating the name rather than by property access.
    get state() {
      return runInContext("state", context) as Record<string, unknown>;
    },
    fetchCalls,
    putBodies,
    element,
    notice: () => element("studio-notice").textContent,
    hint: () => element("save-hint").textContent,
    sendHint: () => element("send-hint").textContent,
    ...(context as unknown as Omit<Studio, "state" | "fetchCalls" | "element" | "notice" | "hint" | "putBodies" | "sendHint">),
  };
}

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
    expect((studio.state.estimator as { id?: string } | null)?.id ?? null).toBeNull();
    // Something about the trip changed, so the save has to reach the engine.
    studio.addRoom();

    await studio.saveStudio();

    // The details go to the record first, and the trip only through the route that prices it. No
    // scenario exists on their side yet, so `/trip` (which re-prices an existing scenario) would
    // have been a 409 — the button asks for a price instead.
    const putAt = studio.fetchCalls.findIndex((c) => c.startsWith("PUT "));
    const priceAt = studio.fetchCalls.findIndex((c) => c.includes("/sync-estimate"));
    expect(studio.fetchCalls[putAt]).toContain("PUT ");
    expect(priceAt).toBeGreaterThan(putAt);
    expect(studio.fetchCalls.some((c) => c.includes("/trip?"))).toBe(false);
  });

  it("re-prices on the existing scenario when the trip is edited and one already exists", async () => {
    const studio = await loadStudio();
    studio.state.estimator = { id: "sim-1", cookie: "ubg_sid=1", seq: null, guestUrl: null, sharedAt: null };
    studio.setRoomType(0, "suite");

    await studio.saveStudio();

    expect(studio.fetchCalls.some((c) => c.includes("/trip?"))).toBe(true);
    expect(studio.fetchCalls.some((c) => c.includes("/sync-estimate"))).toBe(false);
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
    // Found by using it: the tick box sat in the Send card while a second publish button lived in
    // "More actions", so that button answered "Tick the sample-price box before sending" — true,
    // unhelpful, and about a box the person had not seen. Both buttons now live beside the box, and
    // until it is ticked they are disabled with the reason on screen.
    const studio = await loadStudio();

    studio.element("ack-sample").checked = false;
    studio.updateSendControls();
    expect(studio.element("btn-send-guest").disabled).toBe(true);
    expect(studio.element("btn-publish-quote").disabled).toBe(true);
    expect(studio.sendHint()).toContain("Tick");

    studio.element("ack-sample").checked = true;
    studio.updateSendControls();
    // Approved and ticked: sending is available; the link-only button too.
    expect(studio.element("btn-publish-quote").disabled).toBe(false);
    expect(studio.sendHint()).toContain("carries the guest");
  });

  it("approves the quotation and says what happens next", async () => {
    const studio = await loadStudio();

    await studio.confirmAndSendToAI();

    expect(studio.fetchCalls.some((c) => c.includes("/confirm"))).toBe(true);
    expect(studio.notice()).toContain("Approved");
  });
});
