/**
 * Explicit Conversation State Machine (Pattern 5).
 * Enforces valid state transitions across the 4 conversation lifecycle phases:
 *
 *   collecting ─(ready + 201)→ drafted ─(staff Save + Share)→ link_sent
 *       │  └──────────────┬──────────────┘
 *       └→ handed_off ←───┘ (human request, complaint, stall, error, archived)
 */

export type ConversationState = "collecting" | "drafted" | "link_sent" | "handed_off";

export type ConversationEvent =
  | { type: "DRAFT_CREATED"; quoteId?: string; estimateId?: string }
  | { type: "STAFF_APPROVED"; quoteId?: string; estimateUrl?: string }
  | { type: "HANDOFF"; reason: string }
  | { type: "RESET" }
  | { type: "RESUME" };

export interface StateTransitionResult {
  ok: boolean;
  from: ConversationState;
  to: ConversationState;
  reason?: string;
}

/**
 * Single, deterministic state transition function.
 * Every state change MUST flow through this function.
 */
export function transitionConversationState(
  current: ConversationState,
  event: ConversationEvent,
): StateTransitionResult {
  switch (current) {
    case "collecting":
      if (event.type === "DRAFT_CREATED") return { ok: true, from: current, to: "drafted" };
      if (event.type === "HANDOFF") return { ok: true, from: current, to: "handed_off" };
      if (event.type === "RESET" || event.type === "RESUME") return { ok: true, from: current, to: "collecting" };
      return { ok: false, from: current, to: current, reason: `Cannot execute ${event.type} in state ${current}` };

    case "drafted":
      if (event.type === "STAFF_APPROVED") return { ok: true, from: current, to: "link_sent" };
      if (event.type === "DRAFT_CREATED" || event.type === "RESUME") return { ok: true, from: current, to: "drafted" };
      if (event.type === "HANDOFF") return { ok: true, from: current, to: "handed_off" };
      if (event.type === "RESET") return { ok: true, from: current, to: "collecting" };
      return { ok: false, from: current, to: current, reason: "Invalid event in drafted" };

    case "link_sent":
      if (event.type === "HANDOFF") return { ok: true, from: current, to: "handed_off" };
      if (event.type === "DRAFT_CREATED") return { ok: true, from: current, to: "drafted" };
      if (event.type === "RESET") return { ok: true, from: current, to: "collecting" };
      if (event.type === "STAFF_APPROVED" || event.type === "RESUME") return { ok: true, from: current, to: "link_sent" };
      return { ok: false, from: current, to: current, reason: "Invalid event in link_sent" };

    case "handed_off":
      if (event.type === "RESUME" || event.type === "RESET") return { ok: true, from: current, to: "collecting" };
      if (event.type === "HANDOFF") return { ok: true, from: current, to: "handed_off" };
      return {
        ok: false,
        from: current,
        to: current,
        reason: "Thread is handed off to human staff; cannot execute event before resume",
      };
  }
}
