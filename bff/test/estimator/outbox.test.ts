import { describe, it, expect, vi } from "vitest";
import { createEstimatorOutbox, createInMemoryOutboxStore } from "../../src/estimator/outbox.ts";
import type { EstimatorPort } from "../../src/estimator/port.ts";
import type { BffTrip } from "../../../contracts/src/index.ts";

const mockTrip: BffTrip = {
  checkIn: "2026-11-20",
  checkOut: "2026-11-23",
  roomCount: 1,
  guestCount: 2,
  guests: [
    {
      name: "Test Guest",
      days: {
        "2026-11-20": { dives: 0 },
        "2026-11-21": { dives: 2 },
        "2026-11-22": { dives: 2 },
        "2026-11-23": { dives: 0 },
      },
    },
  ],
};

function createMockEstimator(): EstimatorPort & { createDraftCalls: number } {
  return {
    createDraftCalls: 0,
    async createDraft(trip: BffTrip) {
      this.createDraftCalls++;
      return {
        ok: true,
        id: "est-mock-123",
        seq: 1,
        computedAt: "2026-10-15T12:00:00Z",
      };
    },
    async calculatePrice() {
      return { ok: false, reason: "unimplemented" as const };
    },
    async validate() {
      return { ok: true, valid: true };
    },
    async submit() {
      return { ok: false, reason: "unimplemented" as const };
    },
  };
}

describe("Pattern 5: Estimator Outbox", () => {
  it("executes createDraft and returns success on first attempt", async () => {
    const mockEstimator = createMockEstimator();
    const outbox = createEstimatorOutbox({ estimator: mockEstimator });

    const res = await outbox.executeDraft("msg-001", mockTrip);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.id).toBe("est-mock-123");
    }
    expect(mockEstimator.createDraftCalls).toBe(1);
  });

  it("is idempotent: re-using the same idempotencyKey returns cached result without re-calling Estimator", async () => {
    const mockEstimator = createMockEstimator();
    const outbox = createEstimatorOutbox({ estimator: mockEstimator });

    const first = await outbox.executeDraft("msg-002", mockTrip);
    const second = await outbox.executeDraft("msg-002", mockTrip);

    expect(first).toEqual(second);
    expect(mockEstimator.createDraftCalls).toBe(1);
  });

  it("retries transient unreachable errors and succeeds on later attempt", async () => {
    let callCount = 0;
    const mockEstimator = {
      ...createMockEstimator(),
      async createDraft() {
        callCount++;
        if (callCount < 2) {
          return { ok: false as const, reason: "unreachable" as const, detail: "Connection reset" };
        }
        return { ok: true as const, id: "est-retried-456", seq: 1 };
      },
    };

    const outbox = createEstimatorOutbox({
      estimator: mockEstimator,
      maxRetries: 3,
      initialBackoffMs: 5,
    });

    const res = await outbox.executeDraft("msg-003", mockTrip);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.id).toBe("est-retried-456");
    }
    expect(callCount).toBe(2);
  });

  it("does not retry 422 refusal and aborts immediately", async () => {
    let callCount = 0;
    const mockEstimator = {
      ...createMockEstimator(),
      async createDraft() {
        callCount++;
        return {
          ok: false as const,
          reason: "refused" as const,
          status: 422,
          code: "check_in_past",
          fields: ["checkIn"],
          detail: "Check-in cannot be in the past",
        };
      },
    };

    const outbox = createEstimatorOutbox({
      estimator: mockEstimator,
      maxRetries: 3,
      initialBackoffMs: 5,
    });

    const res = await outbox.executeDraft("msg-004", mockTrip);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("refused");
    expect(callCount).toBe(1); // Never retried
  });

  it("fails after exceeding maxRetries on continuous transient error", async () => {
    let callCount = 0;
    const mockEstimator = {
      ...createMockEstimator(),
      async createDraft() {
        callCount++;
        return { ok: false as const, reason: "unreachable" as const, detail: "Network down" };
      },
    };

    const outbox = createEstimatorOutbox({
      estimator: mockEstimator,
      maxRetries: 3,
      initialBackoffMs: 5,
    });

    const res = await outbox.executeDraft("msg-005", mockTrip);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("unreachable");
    expect(callCount).toBe(3);
  });
});
