import { describe, it, expect } from "vitest";
import { detectLanguage, guestTextOf } from "../src/normalize.js";

// Both functions only ever see one side of the conversation: the guest's. That is
// the whole point of them, so the tests read like the two failure modes they were
// written for — an English guest answered in Vietnamese, and the bot's own reply
// coming back as a guest-stated fact on the next turn.

describe("detectLanguage", () => {
  it("reads Vietnamese from Vietnamese words and letters", () => {
    expect(detectLanguage("Mình muốn đi lặn, nhóm mình có 4 người")).toBe("vi");
    expect(detectLanguage("2 người")).toBe("vi");
    expect(detectLanguage("đêm nay còn phòng không?")).toBe("vi");
    // Unmarked Vietnamese is still Vietnamese, as long as the message reads
    // Vietnamese rather than English.
    expect(detectLanguage("khach san 2 nguoi")).toBe("vi");
  });

  it("does not mistake an English typo for Vietnamese", () => {
    // The reported case: an English guest with a typo must not get a Vietnamese
    // reply because one accent or one shared word shape looked Vietnamese.
    expect(detectLanguage("i dont ned airport")).toBe("en");
    expect(detectLanguage("I need a room for 2 nights please")).toBe("en");
    // "em" lives inside "email", "thu" inside "Thursday", "dem" inside "demo" —
    // a substring is not language evidence.
    expect(detectLanguage("email me the invoice")).toBe("en");
    expect(detectLanguage("Thursday the demo was fine")).toBe("en");
  });

  it("prefers English when the text reads English, rather than guessing Vietnamese", () => {
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
