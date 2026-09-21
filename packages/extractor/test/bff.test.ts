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

  it("serves HTML on GET / (documentation & architecture hub)", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Casa Escondida Edge &amp; Extractor Tools");
    expect(html).toContain("Extractor Pod Architecture &amp; Trust Boundaries");
  });

  it("serves HTML on GET /test (interactive test console)", async () => {
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("DeepSeek Flash");
    expect(html).toContain("Gemini 2.5 Flash");
  });

  it("serves benchmark report on GET /benchmark and scenarios on /scenarios", async () => {
    const resBench = await app.request("/benchmark");
    expect(resBench.status).toBe(200);
    const resScen = await app.request("/scenarios");
    expect(resScen.status).toBe(200);
  });
});
