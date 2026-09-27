// Two decisions the webhook makes before it spends a model call, and the wording they produce.
//
// Both are string matches rather than model calls (the reasoning is in intent.ts and next to
// `wantsHuman`), which means the failure mode that matters is not "the pattern is imprecise" but
// "the pattern dismissed a real guest". So the cases below are deliberately split into the ones
// that must fire and the ordinary-looking enquiries that must NOT.
import { describe, it, expect } from "vitest";
import { classifyEnquiry } from "../src/intent.js";
import { stalledHandoffReply } from "../src/questions.js";
import type { Trip } from "../src/schema.js";

describe("classifyEnquiry — a person is needed because of what the message is", () => {
  const escalating = [
    "Please cancel my booking for next week",
    "I would like a refund for the deposit",
    "This is a complaint about the transfer",
    "we are already at the resort, can someone help us",
    "I want to dispute the charge",
    "请帮我取消预订",
    "我要退款",
  ];

  for (const text of escalating) {
    it(`escalates: ${JSON.stringify(text)}`, () => {
      expect(classifyEnquiry(text)).toBe("escalate_now");
    });
  }
});

describe("classifyEnquiry — not an enquiry for this channel", () => {
  const notBooking = [
    "hey what is the wifi password?",
    "how much is a beer at the bar?",
    "do you have parking?",
    "can I have the exact address?",
    "check out our seo services https://spam.example",
    "we offer backlink packages",
  ];

  for (const text of notBooking) {
    it(`declines politely: ${JSON.stringify(text)}`, () => {
      expect(classifyEnquiry(text)).toBe("not_booking");
    });
  }
});

describe("classifyEnquiry — everything else belongs to the extractor", () => {
  // The list of "not a booking" patterns is short on purpose. Each of these is a real enquiry a
  // guest would send, and dismissing one costs a customer; the cost of the other mistake is one
  // turn of questions.
  const booking = [
    "",
    "hi",
    "hello?",
    "do you have a room for two on Saturday?",
    "how much is a room for 2 nights?",
    "we'd like to book 3 nights in November",
    "can we dive without staying overnight?",
    "do you do day trips for divers?",
    "my wife and I, 2 kids, arriving Friday",
  ];

  for (const text of booking) {
    it(`treats as an enquiry: ${JSON.stringify(text)}`, () => {
      expect(classifyEnquiry(text)).toBe("booking");
    });
  }

  it("reads a cancellation word inside a sentence, not only a bare command", () => {
    // The whole point of a pattern over a keyword list: "cancel" is what carries the meaning
    // wherever it sits in the message.
    expect(classifyEnquiry("quick question about cancelling — is it free?")).toBe("escalate_now");
  });
});

describe("stalledHandoffReply", () => {
  const fields: Array<keyof Trip> = ["checkIn", "guests"];

  it("names what was still missing, so the guest knows the human is not starting over", () => {
    const text = stalledHandoffReply(fields, "en");
    expect(text).toContain("Rather than ask you the same things again");
    expect(text).toContain("your check-in date and how many guests");
    expect(text).toContain("Casa team");
  });

  it("writes the same sentence in Chinese, naming the gaps the same way", () => {
    const text = stalledHandoffReply(fields, "zh");
    expect(text).toContain("Casa 团队");
    expect(text).toContain("入住日期");
    expect(text).toContain("客人人数");
  });

  it("still reads as a handoff when there is no field list to name", () => {
    const text = stalledHandoffReply([], "en");
    expect(text).toContain("passed your enquiry");
    expect(text).not.toContain("still needed");
  });

  it("caps the list rather than reading out a whole questionnaire", () => {
    const many: Array<keyof Trip> = ["checkIn", "checkOut", "nights", "guests", "rooms", "meals"];
    const text = stalledHandoffReply(many, "en");
    expect(text).toContain("your check-in date");
    expect(text).not.toContain("how many rooms");
  });

  it("ignores a field it has no wording for instead of printing an internal name", () => {
    // `specialRequests` is a real Trip key with no guest-facing phrase. Printing "specialRequests"
    // at a guest would be worse than saying nothing.
    const text = stalledHandoffReply(["specialRequests", "guests"] as Array<keyof Trip>, "en");
    expect(text).not.toContain("specialRequests");
    expect(text).toContain("how many guests");
  });
});
