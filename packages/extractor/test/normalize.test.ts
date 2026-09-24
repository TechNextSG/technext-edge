import { describe, it, expect } from "vitest";
import { detectLanguage, guestTextOf } from "../src/normalize.js";

// Both functions only ever see one side of the conversation: the guest's. That is
// the whole point of them, so the tests read like the two failure modes they were
// written for — a guest answered in a language they did not write, and the bot's
// own reply coming back as a guest-stated fact on the next turn.
//
// Vietnamese was removed on 2026-09-24 (see src/normalize.ts): the resort receives
// English and Chinese enquiries, so the only question left for detectLanguage is
// whether the message carries Han characters.

describe("detectLanguage", () => {
  it("reads Latin-script text as English, typos and all", () => {
    // Nothing is left to mistake here: a message with no Han character is English,
    // however badly it is typed.
    expect(detectLanguage("i dont ned airport")).toBe("en");
    expect(detectLanguage("I need a room for 2 nights please")).toBe("en");
    expect(detectLanguage("email me the invoice")).toBe("en");
    expect(detectLanguage("Thursday the demo was fine")).toBe("en");
  });

  it("leaves a plain English enquiry in English", () => {
    expect(detectLanguage("2 rooms for 3 nights, thanks")).toBe("en");
  });

  it("keeps Chinese as Chinese", () => {
    expect(detectLanguage("我们26/09/2026入住，3晚")).toBe("zh");
  });
});

describe("guestTextOf", () => {
  it("keeps only the guest's turns out of a transcript, so the bot cannot evidence itself", () => {
    const transcript =
      "Guest: hi, 2 of us Assistant: Thanks! I've noted down 2 guests. Guest: 1 room please";

    const guestText = guestTextOf(transcript);

    expect(guestText).toBe("hi, 2 of us\n1 room please");
    expect(guestText).not.toContain("noted down"); // the bot's own sentence is not evidence
  });

  it("treats a bare message as guest text, which is what POST /v1/extract sends", () => {
    expect(guestTextOf("Hi, 2 rooms please")).toBe("Hi, 2 rooms please");
  });

  it("does not choke on a guest who quotes the assistant back", () => {
    const transcript = "Guest: you said Assistant: Thanks! Guest: ok, next Saturday then";
    expect(guestTextOf(transcript)).toBe("you said\nok, next Saturday then");
  });
});
