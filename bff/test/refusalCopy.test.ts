import { describe, it, expect, vi } from "vitest";
import { ISSUE_COPY, KNOWN_ISSUE_CODES, describeRefusal } from "../src/services/refusalCopy.js";
import { createEstimatorClient } from "../src/services/estimatorClient.js";
import { createSimulatedEstimator } from "../src/services/simulatedEstimator.js";
import { buildBffTrip } from "../../quotation/src/index.js";
import type { Trip } from "../../ai/src/index.js";
import * as spec from "../../contracts/bff-contract/contract-spec.mjs";

const f = <T,>(value: T | null, state = "stated") => ({ value, state, evidence: null });

/** `rooms` omitted -> the count nobody stated (house-norm default). */
function tripOf(guests: number, rooms?: number) {
  return buildBffTrip({
    language: f("en", "default"), contactName: f("Ana"), checkIn: f("2026-11-20"), checkOut: f("2026-11-22"),
    nights: f(2), guests: f(guests), rooms: rooms ? f(rooms) : f(1, "default"), meals: f("full_board"),
    transport: f(false), guestType: f("retail", "default"), transportType: f("none"), diver: f(false),
    divers: f(null, "missing"), diveFrom: f(null, "missing"), diveTo: f(null, "missing"),
    diveNotes: f(null, "missing"), specialRequests: f(null, "missing"), guestNames: f([]),
  } as unknown as Trip);
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const OVER = {
  code: "room-over-capacity",
  level: "error",
  fields: ["guests[2].roomId"],
  params: { roomId: "r1", date: "2026-11-20", n: 3, cap: 2 },
};

describe("every issue code the source engine can raise has a sentence for staff", () => {
  it.each([...spec.ISSUE_CODES])("%s", (code) => {
    expect(KNOWN_ISSUE_CODES).toContain(code);
  });
  it("and nothing is described that the engine no longer raises", () => {
    expect([...KNOWN_ISSUE_CODES].sort()).toEqual([...spec.ISSUE_CODES].sort());
  });
});

describe("describeRefusal", () => {
  it("names the room, the night, the head count and the cap", () => {
    const body = { error: "Chuyến không hợp lệ", code: "room-over-capacity", fields: OVER.fields, issues: [OVER] };
    expect(describeRefusal(body)).toBe("Room r1 holds 2; 3 guests on Nov 20 — add a room");
  });
  it("shows a code it does not know, with its fields, rather than swallowing it", () => {
    expect(describeRefusal({ code: "brand-new-rule", fields: ["guests[0].x"] })).toBe("brand-new-rule (guests[0].x)");
  });
  it("has nothing to say about a body with no code", () => {
    expect(describeRefusal({ error: "Thiếu field", fields: ["a"] })).toBeNull();
  });
  it("every entry renders without params", () => {
    for (const fn of Object.values(ISSUE_COPY)) expect(() => fn({ code: "x" })).not.toThrow();
  });
});

describe("the estimator client keeps what their 422 said", () => {
  it("keeps code, issues and params, and reports it in English", async () => {
    const fetchImpl = vi.fn(async () =>
      json(422, { error: "Chuyến không hợp lệ", code: "room-over-capacity", fields: OVER.fields, issues: [OVER] }),
    );
    const res = await createEstimatorClient({ baseUrl: "http://bff.test", fetchImpl: fetchImpl as never }).sendEstimate(
      tripOf(2),
    );
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("rejected");
    expect(res.detail).toBe("Room r1 holds 2; 3 guests on Nov 20 — add a room");
    expect(res.code).toBe("room-over-capacity");
    expect(res.issues).toEqual([OVER]);
  });
});

describe("the simulated estimator is no more lenient than the engine", () => {
  it("prices a party of three, which needs two standard rooms", async () => {
    expect((await createSimulatedEstimator().sendEstimate(tripOf(3))).ok).toBe(true);
  });

  it("POST of an over-full single room splits it rather than refusing", async () => {
    const over = { ...tripOf(3), rooms: [{ id: "r1", type: "standard" as const, name: null }] };
    over.guests = over.guests.map((g) => ({ ...g, roomId: "r1" }));
    expect((await createSimulatedEstimator().sendEstimate(over)).ok).toBe(true);
  });

  it("PATCH with an over-full room is refused with 422 room-over-capacity", async () => {
    const port = createSimulatedEstimator();
    const first = await port.sendEstimate(tripOf(2));
    if (!first.ok) throw new Error("setup");
    const session = { id: first.id!, cookie: first.sessionCookie! };
    const res = await port.sendEstimate(tripOf(3, 1), session);
    if (res.ok) throw new Error("expected a refusal");
    expect(res.status).toBe(422);
    expect(res.reason).toBe("rejected");
    expect(res.code).toBe("room-over-capacity");
    expect(res.detail).toBe("Room r1 holds 2; 3 guests on Nov 20 — add a room");
  });

  it("PATCH of the trip we now build for three guests passes, and so does commit", async () => {
    const port = createSimulatedEstimator();
    const first = await port.sendEstimate(tripOf(3));
    if (!first.ok) throw new Error("setup");
    const session = { id: first.id!, cookie: first.sessionCookie! };
    expect((await port.sendEstimate(tripOf(3), session)).ok).toBe(true);
    expect((await port.commit(session, tripOf(3))).ok).toBe(true);
  });

  it("prices a trip that claims to be a partner as a guest, with no retail comparison", async () => {
    const port = createSimulatedEstimator();
    const agent = await port.sendEstimate({ ...tripOf(2), guestType: "agent" });
    const instructor = await port.sendEstimate({ ...tripOf(2), guestType: "instructor" });
    if (!agent.ok || !instructor.ok) throw new Error("setup");
    expect(agent.role).toBe("guest");
    expect(agent.retailModel).toBeNull();
    expect(instructor.retailModel).toBeNull();
  });
});

describe("the simulated estimator refuses what the engine refuses, with their codes", () => {
  it("PATCH with a check-out that is not after the check-in -> 422 checkout-not-after-checkin", async () => {
    const port = createSimulatedEstimator();
    const first = await port.sendEstimate(tripOf(2));
    if (!first.ok) throw new Error("setup");
    const session = { id: first.id!, cookie: first.sessionCookie! };
    const reversed = { ...tripOf(2), checkIn: "2026-11-22", checkOut: "2026-11-20" };
    const res = await port.sendEstimate(reversed, session);
    if (res.ok) throw new Error("expected a refusal");
    expect(res.status).toBe(422);
    expect(res.code).toBe("checkout-not-after-checkin");
    expect(res.detail).toBe("Check-out must be after check-in");
  });

  it("POST for a guest whose check-in has passed -> 422 checkin-in-past", async () => {
    const past = { ...tripOf(2), checkIn: "2026-01-10", checkOut: "2026-01-12" };
    const res = await createSimulatedEstimator().sendEstimate(past);
    if (res.ok) throw new Error("expected a refusal");
    expect(res.code).toBe("checkin-in-past");
  });

  it("a dive window outside the stay -> 422 dive-window-outside-stay", async () => {
    const t = tripOf(2);
    const bad = { ...t, diveFrom: "2026-11-25", diveTo: "2026-11-26", guests: t.guests.map((g, i) => (i === 0 ? { ...g, diver: true, days: { "2026-11-25": { dive: true, third: false, night: false, boatId: null } } } : g)) };
    const res = await createSimulatedEstimator().sendEstimate(bad);
    if (res.ok) throw new Error("expected a refusal");
    expect(res.code).toBe("dive-window-outside-stay");
  });
});
