import { describe, it, expect, vi } from "vitest";
import { createExtractProvider } from "../../src/infra/providers/core.ts";
import type { Transport, StructuredRequest, TextRequest } from "../../src/infra/providers/core.ts";
import {
  EXTRACT_SYSTEM_PROMPT,
  GUESTS_ONLY_PROMPT,
  CHECKIN_ONLY_PROMPT,
  DIVE_WINDOW_ONLY_PROMPT,
  GUESTS_SCHEMA,
  CHECKIN_SCHEMA,
  DIVE_WINDOW_SCHEMA,
} from "../../src/infra/providers/prompts.ts";
import { MalformedArgumentsError } from "../../src/ports/provider.ts";

describe("core: createExtractProvider with fake transport (T2)", () => {
  it("verifies prompts fixed broken sentences", () => {
    // Broken sentence 1: "Never invent a value For 'guests':" -> "Never invent a value. For 'guests':"
    expect(EXTRACT_SYSTEM_PROMPT).toContain("Never invent a value. For 'guests':");
    expect(EXTRACT_SYSTEM_PROMPT).not.toContain("Never invent a value For 'guests':");

    // All focused prompts and schemas are defined
    expect(GUESTS_ONLY_PROMPT).toContain("ONE fact");
    expect(CHECKIN_ONLY_PROMPT).toContain("ONE fact");
    expect(DIVE_WINDOW_ONLY_PROMPT).toContain("TWO facts");
    expect(GUESTS_SCHEMA).toBeDefined();
    expect(CHECKIN_SCHEMA).toBeDefined();
    expect(DIVE_WINDOW_SCHEMA).toBeDefined();
  });

  it("call() sends EXTRACT_SYSTEM_PROMPT and tool extract_trip, parsing string JSON", async () => {
    let capturedReq: StructuredRequest | undefined;
    const fakeTransport: Transport = {
      structured: async (req) => {
        capturedReq = req;
        return {
          json: JSON.stringify({ guests: { value: 3, state: "stated", evidence: "3" } }),
          tokensIn: 100,
          tokensOut: 20,
          cacheRead: 5,
        };
      },
    };

    const provider = createExtractProvider(fakeTransport, { id: "test-provider", timeoutMs: 5000 });
    const res = await provider.call({
      text: "3 guests staying",
      jsonSchema: { type: "object" },
      today: "2026-10-15",
    });

    expect(capturedReq?.system).toBe(EXTRACT_SYSTEM_PROMPT);
    expect(capturedReq?.toolName).toBe("extract_trip");
    expect(capturedReq?.user).toContain("Today's date (Asia/Manila): 2026-10-15");
    expect(capturedReq?.user).toContain("3 guests staying");
    expect(res.raw).toEqual({ guests: { value: 3, state: "stated", evidence: "3" } });
    expect(res.tokensIn).toBe(100);
    expect(res.tokensOut).toBe(20);
    expect(res.cacheReadTokens).toBe(5);
  });

  it("call() parses already-parsed object json", async () => {
    const fakeTransport: Transport = {
      structured: async () => ({
        json: { nights: { value: 2, state: "stated", evidence: "2 nights" } },
      }),
    };

    const provider = createExtractProvider(fakeTransport, { id: "test-provider" });
    const res = await provider.call({
      text: "2 nights",
      jsonSchema: {},
      today: "2026-10-15",
    });

    expect(res.raw).toEqual({ nights: { value: 2, state: "stated", evidence: "2 nights" } });
  });

  it("call() includes retry notice when retry is present", async () => {
    let capturedUser = "";
    const fakeTransport: Transport = {
      structured: async (req) => {
        capturedUser = req.user;
        return { json: "{}" };
      },
    };

    const provider = createExtractProvider(fakeTransport, { id: "test-provider" });
    await provider.call({
      text: "2 nights",
      jsonSchema: {},
      today: "2026-10-15",
      retry: { previousRaw: { nights: -1 }, error: "nights must be positive" },
    });

    expect(capturedUser).toContain("[RETRY NOTICE: Your previous extraction failed validation: nights must be positive");
  });

  it("call() throws MalformedArgumentsError on invalid JSON string", async () => {
    const fakeTransport: Transport = {
      structured: async () => ({ json: "not-json {{{" }),
    };

    const provider = createExtractProvider(fakeTransport, { id: "test-provider" });
    await expect(
      provider.call({ text: "hi", jsonSchema: {}, today: "2026-10-15" }),
    ).rejects.toThrow(MalformedArgumentsError);
  });

  it("call() converts AbortError to error containing timed out", async () => {
    const fakeTransport: Transport = {
      structured: async () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      },
    };

    const provider = createExtractProvider(fakeTransport, { id: "test-provider", timeoutMs: 4000 });
    await expect(
      provider.call({ text: "hi", jsonSchema: {}, today: "2026-10-15" }),
    ).rejects.toThrow(/test-provider extract timed out after 4000ms/);
  });

  it("extractGuests() calls record_guests with GUESTS_ONLY_PROMPT", async () => {
    let capturedReq: StructuredRequest | undefined;
    const fakeTransport: Transport = {
      structured: async (req) => {
        capturedReq = req;
        return {
          json: JSON.stringify({ value: 5, state: "stated", evidence: "5 guests" }),
          tokensIn: 40,
          tokensOut: 10,
        };
      },
    };

    const provider = createExtractProvider(fakeTransport, { id: "test-provider" });
    const res = await provider.extractGuests!("5 guests");

    expect(capturedReq?.system).toBe(GUESTS_ONLY_PROMPT);
    expect(capturedReq?.toolName).toBe("record_guests");
    expect(res).toEqual({
      value: 5,
      state: "stated",
      evidence: "5 guests",
      tokensIn: 40,
      tokensOut: 10,
      ms: expect.any(Number),
    });
  });

  it("extractCheckIn() calls record_checkin with CHECKIN_ONLY_PROMPT", async () => {
    let capturedReq: StructuredRequest | undefined;
    const fakeTransport: Transport = {
      structured: async (req) => {
        capturedReq = req;
        return {
          json: JSON.stringify({ value: "2026-11-20", state: "stated", evidence: "Nov 20" }),
        };
      },
    };

    const provider = createExtractProvider(fakeTransport, { id: "test-provider" });
    const res = await provider.extractCheckIn!("Nov 20", "2026-10-15");

    expect(capturedReq?.system).toBe(CHECKIN_ONLY_PROMPT);
    expect(capturedReq?.toolName).toBe("record_checkin");
    expect(res.value).toBe("2026-11-20");
    expect(res.state).toBe("stated");
    expect(res.evidence).toBe("Nov 20");
  });

  it("extractDiveWindow() calls record_dive_window with DIVE_WINDOW_ONLY_PROMPT", async () => {
    let capturedReq: StructuredRequest | undefined;
    const fakeTransport: Transport = {
      structured: async (req) => {
        capturedReq = req;
        return {
          json: JSON.stringify({
            diveFromValue: "2026-11-21",
            diveFromState: "stated",
            diveFromEvidence: "Nov 21",
            diveToValue: "2026-11-22",
            diveToState: "stated",
            diveToEvidence: "Nov 22",
          }),
        };
      },
    };

    const provider = createExtractProvider(fakeTransport, { id: "test-provider" });
    const res = await provider.extractDiveWindow!("Nov 21 to 22", "2026-10-15");

    expect(capturedReq?.system).toBe(DIVE_WINDOW_ONLY_PROMPT);
    expect(capturedReq?.toolName).toBe("record_dive_window");
    expect(res.diveFrom).toEqual({ value: "2026-11-21", state: "stated", evidence: "Nov 21" });
    expect(res.diveTo).toEqual({ value: "2026-11-22", state: "stated", evidence: "Nov 22" });
  });

  it("generateText() delegates to transport.text", async () => {
    let capturedReq: TextRequest | undefined;
    const fakeTransport: Transport = {
      structured: async () => ({ json: "{}" }),
      text: async (req) => {
        capturedReq = req;
        return "Warm reply";
      },
    };

    const provider = createExtractProvider(fakeTransport, { id: "test-provider", synthesisTimeoutMs: 3000 });
    const reply = await provider.generateText!("system prompt", "user prompt");

    expect(capturedReq?.system).toBe("system prompt");
    expect(capturedReq?.user).toBe("user prompt");
    expect(capturedReq?.timeoutMs).toBe(3000);
    expect(reply).toBe("Warm reply");
  });
});
