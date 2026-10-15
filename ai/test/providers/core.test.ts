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

describe("core: createExtractProvider with fake transport (T2/Review)", () => {
  describe("Review Item 1: EXTRACT_SYSTEM_PROMPT union of Gemini & DeepSeek rules", () => {
    it("contains verbatim evidence rule", () => {
      expect(EXTRACT_SYSTEM_PROMPT).toContain(
        "Never invent a value that state 'stated' cannot point to verbatim evidence for. Evidence must only be a verbatim substring for 'stated'; set it to null for every other state.",
      );
    });

    it("contains missing state value and evidence nulling rule", () => {
      expect(EXTRACT_SYSTEM_PROMPT).toContain(
        "When state is 'missing', set both value and evidence to null; never use 0 as a placeholder for an unknown count, and never assign unlabeled comma-separated numbers to trip fields.",
      );
    });

    it("contains total guest count not reduced by per-person diver detail rule with group of five example", () => {
      expect(EXTRACT_SYSTEM_PROMPT).toContain(
        "A guest count the message states as a total is never reduced or nulled by a later detail about who is or is not diving, or any other per-person detail — that detail only affects fields it is actually about (like 'diver'), never 'guests'.",
      );
      expect(EXTRACT_SYSTEM_PROMPT).toContain(
        "Example: 'We are a group of five in total: myself, my husband, and our three children (one of whom won't be diving with us).' -> guests is stated 5, evidence 'a group of five in total' — the note about one child not diving is not a reason to question or drop the stated total.",
      );
    });

    it("contains restored full sentence for nights, guests, and rooms", () => {
      expect(EXTRACT_SYSTEM_PROMPT).toContain(
        "Nights, guests, and rooms are 'stated' only when their evidence quotes the exact guest wording; otherwise mark them missing.",
      );
      // Ensure the broken truncated version is gone
      expect(EXTRACT_SYSTEM_PROMPT).not.toMatch(/Nights, guests, and rooms are 'stated' only when their\s*For 'guests':/);
    });
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
    expect(capturedReq?.toolDescription).toBe("Extract structured trip details from a dive resort inquiry.");
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

  describe("Review Item 3: parseFocusedJson throws MalformedArgumentsError on bad JSON", () => {
    it("extractGuests throws MalformedArgumentsError when transport returns invalid JSON string", async () => {
      const fakeTransport: Transport = {
        structured: async () => ({ json: "not json {{{" }),
      };

      const provider = createExtractProvider(fakeTransport, { id: "test-provider" });
      await expect(provider.extractGuests!("5 guests")).rejects.toThrow(MalformedArgumentsError);
    });

    it("extractCheckIn throws MalformedArgumentsError when transport returns null/invalid", async () => {
      const fakeTransport: Transport = {
        structured: async () => ({ json: null }),
      };

      const provider = createExtractProvider(fakeTransport, { id: "test-provider" });
      await expect(provider.extractCheckIn!("Nov 20", "2026-10-15")).rejects.toThrow(MalformedArgumentsError);
    });

    it("extractDiveWindow throws MalformedArgumentsError when transport returns invalid JSON", async () => {
      const fakeTransport: Transport = {
        structured: async () => ({ json: "broken json {" }),
      };

      const provider = createExtractProvider(fakeTransport, { id: "test-provider" });
      await expect(provider.extractDiveWindow!("Oct 10-12", "2026-10-15")).rejects.toThrow(MalformedArgumentsError);
    });
  });

  it("extractGuests() calls record_guests with GUESTS_ONLY_PROMPT and specific toolDescription", async () => {
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
    expect(capturedReq?.toolDescription).toBe("Record the total guest count.");
    expect(res).toEqual({
      value: 5,
      state: "stated",
      evidence: "5 guests",
      tokensIn: 40,
      tokensOut: 10,
      ms: expect.any(Number),
    });
  });

  it("extractCheckIn() calls record_checkin with CHECKIN_ONLY_PROMPT and specific toolDescription", async () => {
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
    expect(capturedReq?.toolDescription).toBe("Record the check-in date.");
    expect(res.value).toBe("2026-11-20");
    expect(res.state).toBe("stated");
    expect(res.evidence).toBe("Nov 20");
  });

  describe("Review Item 5: extractDiveWindow input label", () => {
    it("extractDiveWindow() uses Conversation so far:\\n prefix", async () => {
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
      expect(capturedReq?.toolDescription).toBe("Record diving start and end dates.");
      expect(capturedReq?.user).toBe("Today's date (Asia/Manila): 2026-10-15\n\nConversation so far:\nNov 21 to 22");
      expect(res.diveFrom).toEqual({ value: "2026-11-21", state: "stated", evidence: "Nov 21" });
      expect(res.diveTo).toEqual({ value: "2026-11-22", state: "stated", evidence: "Nov 22" });
    });
  });

  describe("Review Item 6: generateText conditional declaration", () => {
    it("does NOT declare generateText when transport has no text method", () => {
      const fakeTransport: Transport = {
        structured: async () => ({ json: "{}" }),
      };

      const provider = createExtractProvider(fakeTransport, { id: "test-provider" });
      expect("generateText" in provider).toBe(false);
      expect(provider.generateText).toBeUndefined();
    });

    it("declares generateText when transport provides text method", async () => {
      let capturedReq: TextRequest | undefined;
      const fakeTransport: Transport = {
        structured: async () => ({ json: "{}" }),
        text: async (req) => {
          capturedReq = req;
          return "Warm reply";
        },
      };

      const provider = createExtractProvider(fakeTransport, { id: "test-provider", synthesisTimeoutMs: 3000 });
      expect(provider.generateText).toBeDefined();
      const reply = await provider.generateText!("system prompt", "user prompt");

      expect(capturedReq?.system).toBe("system prompt");
      expect(capturedReq?.user).toBe("user prompt");
      expect(capturedReq?.timeoutMs).toBe(3000);
      expect(reply).toBe("Warm reply");
    });
  });
});
