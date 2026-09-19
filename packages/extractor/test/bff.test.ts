import { describe, it, expect } from "vitest";
import { createApp } from "../../../apps/casa-bff/src/app.js";

describe("BFF Endpoints", () => {
  const app = createApp();

  it("responds 200 { ok: true } on /v1/health (canonical Delivery Plan endpoint)", async () => {
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("responds 200 { ok: true } on /healthz (backward compatibility alias)", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("serves HTML on GET / (test console page)", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("DeepSeek Flash");
    expect(html).toContain("Gemini 2.5 Flash");
  });
});
