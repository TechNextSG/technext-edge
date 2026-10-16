import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCommitResponse,
  parseEstimateRefusal,
  parseEstimateSuccess,
  parseEstimatorWebhookPayload,
  parseExtrasResponse,
  parseGetEstimateResponse,
  parseShareResponse,
  EstimateConflictResponseSchema,
} from "../src/estimator-api.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(here, "../fixtures/estimator");

function loadFixture<T = unknown>(filename: string): T {
  const content = readFileSync(path.join(fixtureDir, filename), "utf8");
  return JSON.parse(content) as T;
}

describe("Estimator API & Webhook Contracts (ACL)", () => {
  it("parses 201 Estimate Success fixture", () => {
    const raw = loadFixture("estimate-201.json");
    const parsed = parseEstimateSuccess(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.id).toBe("scn_20261014_retail_couple");
    expect(parsed.data.role).toBe("guest");
    expect(parsed.data.mode).toBe("fixture");
    expect(parsed.data.model).toBeDefined();
  });

  it("parses 422 Estimate Refusal fixture", () => {
    const raw = loadFixture("refusal-422.json");
    const parsed = parseEstimateRefusal(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.code).toBe("INVALID_DATES");
    expect(parsed.data.fields).toEqual(["checkIn", "checkOut"]);
    expect(parsed.data.issues?.length).toBe(1);
    expect(parsed.data.issues?.[0]?.code).toBe("too_small");
  });

  it("parses 409 Estimate Conflict fixture", () => {
    const raw = loadFixture("conflict-409.json");
    const result = EstimateConflictResponseSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.code).toBe("NO_SNAPSHOT");
  });

  it("parses 200 Commit fixture", () => {
    const raw = loadFixture("commit-200.json");
    const parsed = parseCommitResponse(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.seq).toBe(1);
    expect(parsed.data.computedAt).toBeDefined();
  });

  it("parses 200 Share fixture", () => {
    const raw = loadFixture("share-200.json");
    const parsed = parseShareResponse(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.url).toBe("/quote/test-share-token-12345");
  });

  it("parses 200 Extras fixture", () => {
    const raw = loadFixture("extras-200.json");
    const parsed = parseExtrasResponse(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.extras.length).toBe(1);
  });

  it("parses GET Estimate fixture", () => {
    const raw = loadFixture("get-estimate-200.json");
    const parsed = parseGetEstimateResponse(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.id).toBe("scn_20261014_retail_couple");
    expect(parsed.data.status).toBe("committed");
  });

  it("parses approved Webhook payload fixture", () => {
    const raw = loadFixture("webhook-approved.json");
    const parsed = parseEstimatorWebhookPayload(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.event).toBe("approved");
    expect(parsed.data.url).toContain("/quote/test-share-token-12345");
  });

  it("parses archived Webhook payload fixture", () => {
    const raw = loadFixture("webhook-archived.json");
    const parsed = parseEstimatorWebhookPayload(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.event).toBe("archived");
    expect(parsed.data.estimateId).toBe("scn_20261014_retail_couple");
  });

  it("rejects invalid payloads with structured Zod errors", () => {
    const invalidShare = { url: "" }; // min(1) violation
    const parsed = parseShareResponse(invalidShare);
    expect(parsed.ok).toBe(false);

    const invalidWebhook = { event: "unknown_event", timestamp: "not-a-number" };
    const parsedWebhook = parseEstimatorWebhookPayload(invalidWebhook);
    expect(parsedWebhook.ok).toBe(false);
  });
});
