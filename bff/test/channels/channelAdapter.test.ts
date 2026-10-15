import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { createWhatsAppChannelAdapter } from "../../src/channels/whatsapp/adapter.ts";
import type { WhatsAppConfig } from "../../src/channels/whatsapp/meta.ts";

describe("ChannelAdapter: WhatsApp implementation (Pattern 3)", () => {
  const secret = "test-app-secret";
  const config: WhatsAppConfig = {
    phoneNumberId: "123456",
    accessToken: "test-token",
    appSecret: secret,
    verifyToken: "test-verify-token",
  };

  it("exposes the adapter name 'whatsapp'", () => {
    const adapter = createWhatsAppChannelAdapter(config);
    expect(adapter.name).toBe("whatsapp");
  });

  describe("verify", () => {
    it("returns true when x-hub-signature-256 matches body HMAC", () => {
      const adapter = createWhatsAppChannelAdapter(config);
      const rawBody = JSON.stringify({ hello: "world" });
      const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;

      const verified = adapter.verify({
        headers: { "x-hub-signature-256": signature },
        rawBody,
      });
      expect(verified).toBe(true);
    });

    it("returns false when signature does not match or is missing", () => {
      const adapter = createWhatsAppChannelAdapter(config);
      const rawBody = JSON.stringify({ hello: "world" });

      expect(adapter.verify({ headers: {}, rawBody })).toBe(false);
      expect(adapter.verify({ headers: { "x-hub-signature-256": "sha256=invalid" }, rawBody })).toBe(false);
    });
  });

  describe("parseInbound", () => {
    it("extracts text messages from Meta inbound webhook envelope", () => {
      const adapter = createWhatsAppChannelAdapter(config);
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "639171234567",
                      id: "wamid.msg1",
                      timestamp: "1789700000",
                      type: "text",
                      text: { body: "Can I book for Nov 20?" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const messages = adapter.parseInbound(payload);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        from: "639171234567",
        id: "wamid.msg1",
        text: "Can I book for Nov 20?",
      });
    });

    it("returns empty array for non-message or receipt payloads", () => {
      const adapter = createWhatsAppChannelAdapter(config);
      expect(adapter.parseInbound({})).toEqual([]);
      expect(adapter.parseInbound(null)).toEqual([]);
    });
  });

  describe("send", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("delegates to WhatsApp Cloud API sender", async () => {
      let calledUrl = "";
      let calledBody: any = null;

      globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
        calledUrl = String(url);
        calledBody = JSON.parse(init?.body as string);
        return {
          ok: true,
          json: async () => ({ messages: [{ id: "wamid.out1" }] }),
        };
      });

      const adapter = createWhatsAppChannelAdapter(config);
      await adapter.send({ to: "639171234567", body: "Hello from Casa Escondida!" });

      expect(calledUrl).toContain("123456/messages");
      expect(calledBody.to).toBe("639171234567");
      expect(calledBody.text.body).toBe("Hello from Casa Escondida!");
    });
  });
});
