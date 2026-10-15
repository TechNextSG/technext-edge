import { describe, it, expect } from "vitest";
import {
  transitionConversationState,
  type ConversationState,
} from "../../src/domain/conversationState.ts";

describe("Conversation State Machine (Pattern 5)", () => {
  it("starts in collecting state and transitions to drafted when a draft is created", () => {
    const current: ConversationState = "collecting";
    const res = transitionConversationState(current, {
      type: "DRAFT_CREATED",
      quoteId: "QT-1010-ANA",
      estimateId: "est-123",
    });
    expect(res).toEqual({
      ok: true,
      from: "collecting",
      to: "drafted",
    });
  });

  it("transitions from collecting to handed_off when a human or error handoff occurs", () => {
    const current: ConversationState = "collecting";
    const res = transitionConversationState(current, {
      type: "HANDOFF",
      reason: "human_agent_requested",
    });
    expect(res).toEqual({
      ok: true,
      from: "collecting",
      to: "handed_off",
    });
  });

  it("transitions from drafted to link_sent when staff approves (Save + Share)", () => {
    const current: ConversationState = "drafted";
    const res = transitionConversationState(current, {
      type: "STAFF_APPROVED",
      quoteId: "QT-1010-ANA",
      estimateUrl: "https://casa.test/quote/est-123",
    });
    expect(res).toEqual({
      ok: true,
      from: "drafted",
      to: "link_sent",
    });
  });

  it("stays in drafted when an existing draft is updated with new trip facts", () => {
    const current: ConversationState = "drafted";
    const res = transitionConversationState(current, {
      type: "DRAFT_CREATED",
      quoteId: "QT-1010-ANA",
      estimateId: "est-123",
    });
    expect(res).toEqual({
      ok: true,
      from: "drafted",
      to: "drafted",
    });
  });

  it("transitions from drafted to handed_off when staff archives or guest stalls", () => {
    const current: ConversationState = "drafted";
    const res = transitionConversationState(current, {
      type: "HANDOFF",
      reason: "staff_archived",
    });
    expect(res).toEqual({
      ok: true,
      from: "drafted",
      to: "handed_off",
    });
  });

  it("transitions from link_sent to handed_off on inquiry or complaint", () => {
    const current: ConversationState = "link_sent";
    const res = transitionConversationState(current, {
      type: "HANDOFF",
      reason: "guest_inquiry",
    });
    expect(res).toEqual({
      ok: true,
      from: "link_sent",
      to: "handed_off",
    });
  });

  it("handles idempotent STAFF_APPROVED in link_sent state", () => {
    const current: ConversationState = "link_sent";
    const res = transitionConversationState(current, {
      type: "STAFF_APPROVED",
      estimateUrl: "https://casa.test/quote/est-123",
    });
    expect(res).toEqual({
      ok: true,
      from: "link_sent",
      to: "link_sent",
    });
  });

  it("resumes from handed_off back to collecting", () => {
    const current: ConversationState = "handed_off";
    const res = transitionConversationState(current, { type: "RESUME" });
    expect(res).toEqual({
      ok: true,
      from: "handed_off",
      to: "collecting",
    });
  });

  it("resets to collecting from any state", () => {
    for (const state of ["collecting", "drafted", "link_sent", "handed_off"] as const) {
      const res = transitionConversationState(state, { type: "RESET" });
      expect(res.ok).toBe(true);
      expect(res.to).toBe("collecting");
    }
  });

  it("rejects invalid transitions cleanly with a reason", () => {
    // Cannot approve before draft exists
    const invalidApproval = transitionConversationState("collecting", {
      type: "STAFF_APPROVED",
      estimateUrl: "https://casa.test/quote/none",
    });
    expect(invalidApproval.ok).toBe(false);
    expect(invalidApproval.reason).toMatch(/Cannot execute STAFF_APPROVED in state collecting/);

    // Cannot draft while parked
    const draftWhileParked = transitionConversationState("handed_off", {
      type: "DRAFT_CREATED",
      estimateId: "est-999",
    });
    expect(draftWhileParked.ok).toBe(false);
    expect(draftWhileParked.reason).toMatch(/handed off to human staff/);
  });
});
