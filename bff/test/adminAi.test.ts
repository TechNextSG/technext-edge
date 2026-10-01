// The AI settings dashboard: who may open it, what it accepts, what it stores, and that the provider
// the app answers with follows the settings without a deploy.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.ts";
import { createSettingsStore, type SettingsStore } from "../src/stores/settingsStore.ts";
import { createProviderHolder } from "../src/services/aiProvider.ts";
import { decryptSecret, encryptionKeyFromEnv, encryptSecret, SecretDecryptError } from "../src/auth/secretBox.ts";

const STAFF = "staff-key-for-admin-tests";
const ADMIN = "admin-key-for-admin-tests";
const ENC = randomBytes(32).toString("base64");
const SECRET_KEY = "AIza-SECRET-abcdef-1234";

beforeEach(() => {
  vi.stubEnv("STAFF_ACCESS_KEY", STAFF);
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", STAFF);
  vi.stubEnv("ADMIN_ACCESS_KEY", ADMIN);
  vi.stubEnv("SETTINGS_ENCRYPTION_KEY", ENC);
  for (const k of ["GEMINI_API_KEY", "DEEPSEEK_GATEWAY_KEY", "DEEPSEEK_BASE_URL", "EXTRACTOR_PROVIDER", "KV_REST_API_URL", "KV_REST_API_TOKEN"]) {
    vi.stubEnv(k, "");
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** What the model answers, for the dashboard's test-call. */
const providerOk = () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }], usageMetadata: {} }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const providerUnauthorized = () => new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 401 });

/** Every provider call goes through the global fetch, so a test stubs that and no real provider is reached. */
function setup(answer: () => Response = providerOk) {
  const settings = createSettingsStore({ kv: null, env: process.env });
  const fetchImpl = vi.fn(async () => answer());
  vi.stubGlobal("fetch", fetchImpl);
  const app = createApp({ settings });
  return { app, settings, fetchImpl };
}

const asAdmin = { "x-admin-key": ADMIN, "content-type": "application/json" };
const put = (app: ReturnType<typeof createApp>, path: string, body: unknown, headers: Record<string, string> = asAdmin) =>
  app.request(path, { method: "PUT", headers, body: JSON.stringify(body) });

describe("who may open the dashboard", () => {
  it("does not exist until ADMIN_ACCESS_KEY is set, whatever key is sent", async () => {
    vi.stubEnv("ADMIN_ACCESS_KEY", "");
    const { app } = setup();
    expect((await app.request("/v1/admin/ai/settings", { headers: asAdmin })).status).toBe(404);
    expect((await app.request("/v1/admin/ai/settings", { headers: { "x-verify-token": STAFF } })).status).toBe(404);
    expect((await app.request("/admin/ai")).status).toBe(404);
  });

  it("refuses no session (401), and a staff session (403)", async () => {
    const { app } = setup();
    expect((await app.request("/v1/admin/ai/settings")).status).toBe(401);
    expect((await app.request("/v1/admin/ai/settings", { headers: { "x-verify-token": STAFF } })).status).toBe(403);
    expect((await app.request("/v1/admin/ai/settings", { headers: { "x-admin-key": "wrong" } })).status).toBe(401);
  });

  it("the page sends a signed-out visitor to sign in, and tells a staff session it is not for them", async () => {
    const { app } = setup();
    const anon = await app.request("/admin/ai");
    expect(anon.status).toBe(302);
    expect(anon.headers.get("location")).toContain("/login");
    expect((await app.request("/admin/ai", { headers: { "x-verify-token": STAFF } })).status).toBe(403);
    const ok = await app.request("/admin/ai", { headers: { "x-admin-key": ADMIN } });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("AI settings");
  });

  it("the admin key signs in as admin; the staff key never does, even when the form asks for it", async () => {
    const { app } = setup();
    const login = (password: string, role?: string) =>
      app.request("/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ password, ...(role ? { role } : {}) }).toString(),
      });
    const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    const admin = await login(ADMIN);
    expect(admin.status).toBe(302);
    expect(admin.headers.get("location")).toBe("/admin/ai");
    expect((await app.request("/v1/admin/ai/settings", { headers: { cookie: cookieOf(admin) } })).status).toBe(200);

    const staff = await login(STAFF, "admin");
    expect((await app.request("/v1/admin/ai/settings", { headers: { cookie: cookieOf(staff) } })).status).toBe(403);
    // …but an admin is still allowed to do what staff do.
    expect((await app.request("/v1/quotes", { headers: { cookie: cookieOf(admin) } })).status).toBe(200);
  });

  it("the same value for both keys gives staff, not an admin everyone can be", async () => {
    vi.stubEnv("ADMIN_ACCESS_KEY", STAFF);
    const { app } = setup();
    const res = await app.request("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: STAFF }).toString(),
    });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect((await app.request("/v1/admin/ai/settings", { headers: { cookie } })).status).toBe(403);
  });
});

describe("what it accepts", () => {
  it("refuses a model nobody listed, a timeout outside the limits, a pointless fallback and an unsafe URL", async () => {
    const { app } = setup();
    const bad = async (body: unknown) => {
      const res = await put(app, "/v1/admin/ai/settings", body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      return res.json();
    };
    await bad({ primary: { provider: "anthropic", model: "claude-opus-5-5" } }); // no such provider here
    await bad({ primary: { provider: "gemini", model: "gpt-5" } });
    await bad({ timeoutsMs: { extract: 50, synthesis: 8000 } });
    await bad({ timeoutsMs: { extract: 15000, synthesis: 999999 } });
    await bad({ breaker: { cooldownMs: 1, authCooldownMs: 3_600_000 } });
    await bad({ primary: { provider: "gemini", model: "gemini-2.5-flash" }, fallback: { provider: "gemini", model: "gemini-2.5-flash" } });
    await bad({ deepseekBaseUrl: "http://gateway.example.com/v1" });
    await bad({ deepseekBaseUrl: "https://127.0.0.1/v1" });
    await bad({ deepseekBaseUrl: "https://user:pw@gateway.example.com/v1" });
    await bad({ surprise: true });
  });

  it("nothing was saved by any of those", async () => {
    const { app } = setup();
    await put(app, "/v1/admin/ai/settings", { timeoutsMs: { extract: 50, synthesis: 8000 } });
    const view = await (await app.request("/v1/admin/ai/settings", { headers: asAdmin })).json();
    expect(view.version).toBe(0);
  });
});

describe("keys", () => {
  it("are stored as ciphertext, shown as dots and four characters, and never echoed back", async () => {
    const { app, settings } = setup();
    const res = await put(app, "/v1/admin/ai/keys/gemini", { key: SECRET_KEY });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain(SECRET_KEY);
    expect(JSON.parse(body).key).toMatchObject({ present: true, source: "kv", masked: "••••1234" });

    const viewText = await (await app.request("/v1/admin/ai/settings", { headers: asAdmin })).text();
    expect(viewText).not.toContain(SECRET_KEY);
    expect(viewText).toContain("••••1234");

    const stored = await settings.read();
    const secret = stored!.keys!.gemini!;
    expect(JSON.stringify(stored)).not.toContain(SECRET_KEY);
    expect(secret.ct).not.toBe(SECRET_KEY);
    expect(decryptSecret(secret, encryptionKeyFromEnv(process.env))).toBe(SECRET_KEY);

    const audit = await (await app.request("/v1/admin/ai/audit", { headers: asAdmin })).text();
    expect(audit).not.toContain(SECRET_KEY);
    expect(audit).toContain("keys.gemini");
  });

  it("cannot be saved without an encryption key, and the dashboard says so", async () => {
    vi.stubEnv("SETTINGS_ENCRYPTION_KEY", "");
    const { app } = setup();
    const res = await put(app, "/v1/admin/ai/keys/gemini", { key: "AIzaSyExampleKey-0000" });
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("encryption_not_configured");
  });

  it("the wrong encryption key reads as a problem, and the environment's own key covers for it", () => {
    const right = Buffer.from(ENC, "base64");
    const wrong = randomBytes(32);
    const secret = encryptSecret("sk-something-long", right);
    expect(() => decryptSecret(secret, wrong)).toThrow(SecretDecryptError);
    expect(() => decryptSecret(secret, null)).toThrow(SecretDecryptError);
  });

  it("a saved key that can no longer be opened falls back to the environment key, with the reason shown", async () => {
    // Two stores over one KV, the second holding a different encryption key: what a rotated key looks like.
    const kv = fakeKv();
    vi.stubGlobal("fetch", kv.fetch);
    const first = createSettingsStore({ kv: { url: "https://kv.test", token: "t" }, env: process.env, encryptionKey: Buffer.from(ENC, "base64") });
    await first.setKey("gemini", SECRET_KEY, "admin");
    const second = createSettingsStore({
      kv: { url: "https://kv.test", token: "t" },
      env: { ...process.env, GEMINI_API_KEY: "AIza-from-env-9999" },
      encryptionKey: randomBytes(32),
    });
    const view = await second.view();
    expect(view.keys.gemini).toMatchObject({ present: true, source: "env", masked: "••••9999" });
    expect(view.keys.gemini.problem).toMatch(/cannot be opened/);
    const { settings, keyProblems } = await second.resolve();
    expect(keyProblems).toEqual(["gemini"]);
    expect(settings.keys.gemini).toBeUndefined();
  });

  it("can be removed, after which the environment decides again", async () => {
    const { app } = setup();
    await put(app, "/v1/admin/ai/keys/gemini", { key: "AIzaSy-saved-key-0001" });
    const res = await app.request("/v1/admin/ai/keys/gemini", { method: "DELETE", headers: asAdmin });
    expect((await res.json()).key).toMatchObject({ present: false, source: "none" });
  });
});

describe("saving a model", () => {
  it("tests what is being set first, and saves it when the test passes", async () => {
    const { app, fetchImpl } = setup(providerOk);
    await put(app, "/v1/admin/ai/keys/gemini", { key: SECRET_KEY });

    const res = await put(app, "/v1/admin/ai/settings", { primary: { provider: "gemini", model: "gemini-2.5-pro" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBeGreaterThan(1);
    expect(body.tests).toEqual([expect.objectContaining({ role: "primary", provider: "gemini", ok: true })]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const view = await (await app.request("/v1/admin/ai/settings", { headers: asAdmin })).json();
    expect(view.primary).toMatchObject({ provider: "gemini", model: "gemini-2.5-pro", source: "kv" });
    const audit = (await (await app.request("/v1/admin/ai/audit", { headers: asAdmin })).json()).entries;
    expect(audit[0].diff.some((d: { field: string }) => d.field === "primary")).toBe(true);
  });

  it("does not save a model whose test call fails — unless told to", async () => {
    const { app } = setup(providerUnauthorized);
    await put(app, "/v1/admin/ai/keys/gemini", { key: "AIza-bad-key-000000" });
    const before = (await (await app.request("/v1/admin/ai/settings", { headers: asAdmin })).json()).version;

    const refused = await put(app, "/v1/admin/ai/settings", { primary: { provider: "gemini", model: "gemini-2.5-pro" } });
    expect(refused.status).toBe(409);
    const refusedBody = await refused.json();
    expect(refusedBody.reason).toBe("test_failed");
    expect(refusedBody.tests[0]).toMatchObject({ ok: false });
    expect(JSON.stringify(refusedBody)).not.toContain("AIza-bad-key-000000");
    expect((await (await app.request("/v1/admin/ai/settings", { headers: asAdmin })).json()).version).toBe(before);

    const forced = await put(app, "/v1/admin/ai/settings", { primary: { provider: "gemini", model: "gemini-2.5-pro" }, saveAnyway: true });
    expect(forced.status).toBe(200);
  });

  it("the test button reports each side without saving anything", async () => {
    const { app } = setup(providerOk);
    await put(app, "/v1/admin/ai/keys/gemini", { key: SECRET_KEY });
    const res = await app.request("/v1/admin/ai/test", {
      method: "POST",
      headers: asAdmin,
      body: JSON.stringify({ primary: { provider: "gemini", model: "gemini-2.5-pro" } }),
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tests[0]).toMatchObject({ model: "gemini-2.5-pro", ok: true });
    const view = await (await app.request("/v1/admin/ai/settings", { headers: asAdmin })).json();
    expect(view.primary).toMatchObject({ model: "gemini-3.1-flash-lite", source: "default" }); // the test saved nothing
  });

  it("reports a missing key as a failed test without calling anyone", async () => {
    const { app, fetchImpl } = setup();
    const res = await app.request("/v1/admin/ai/test", {
      method: "POST",
      headers: asAdmin,
      body: JSON.stringify({ primary: { provider: "deepseek", model: "deepseek-flash" } }),
    });
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.tests[0].error).toMatch(/no deepseek key/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the provider the app answers with follows the settings", () => {
  it("changes on the next request after a save, with no restart", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g-key-000000");
    const settings = createSettingsStore({ kv: null, env: process.env });
    const holder = createProviderHolder(settings, process.env);

    const before = await holder.get();
    expect(before.id).toBe("google:gemini-3.1-flash-lite");
    expect(await holder.get()).toBe(before); // same instance: the breaker's state is kept

    await settings.apply({ primary: { provider: "gemini", model: "gemini-2.5-pro" } }, "admin");

    const after = await holder.get();
    expect(after.id).toBe("google:gemini-2.5-pro");
    expect(after).not.toBe(before);
  });

  it("keeps its circuit breaker across requests", async () => {
    const kv = fakeKv();
    vi.stubGlobal("fetch", kv.fetch);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: string[] = [];
    const settings = createSettingsStore({ kv: null, env: process.env });
    await settings.setKey("deepseek", SECRET_KEY, "admin");
    vi.stubEnv("GEMINI_API_KEY", "g-key-000000");
    await settings.apply(
      {
        primary: { provider: "deepseek", model: "deepseek-flash" },
        fallback: { provider: "gemini", model: "gemini-3.1-flash-lite" },
        deepseekBaseUrl: "https://gateway.example.com/v1",
      },
      "admin",
    );
    const holder = createProviderHolder(settings, process.env);
    // Every provider call goes through global fetch here: the gateway's fails, Gemini's answers.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const target = String(url);
        calls.push(target.includes("gateway.example.com") ? "deepseek" : "gemini");
        if (target.includes("gateway.example.com")) return providerUnauthorized();
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }], usageMetadata: {} }), { status: 200 });
      }),
    );
    const args = { text: "x", jsonSchema: {}, today: "2026-09-30" };
    const provider = await holder.get();
    await provider.call(args);
    await (await holder.get()).call(args);

    expect(calls.filter((c) => c === "deepseek")).toHaveLength(1); // the second request went straight to the fallback
    expect(provider.answeredBy?.()).toContain("gemini");
  });
});

describe("numbers for the health table", () => {
  it("counts answers, failures and fallbacks per provider, and averages the time", async () => {
    const settings = createSettingsStore({ kv: null, env: process.env });
    await settings.recordOutcome({ provider: "gemini", kind: "ok", ms: 100 });
    await settings.recordOutcome({ provider: "gemini", kind: "ok", ms: 300 });
    await settings.recordOutcome({ provider: "gemini", kind: "fail", ms: 10 });
    await settings.recordOutcome({ provider: "deepseek", kind: "fallback", ms: 50 });

    const { rows } = await settings.stats(7);
    expect(rows.find((r) => r.provider === "gemini")).toMatchObject({ ok: 2, fail: 1, fallback: 0, avgMs: 137 });
    expect(rows.find((r) => r.provider === "deepseek")).toMatchObject({ fallback: 1 });
    expect(rows.find((r) => r.provider === "klingon")).toBeUndefined();
  });

  it("are served to the admin and to nobody else", async () => {
    const { app } = setup();
    expect((await app.request("/v1/admin/ai/stats")).status).toBe(401);
    const res = await app.request("/v1/admin/ai/stats?days=7", { headers: asAdmin });
    expect(res.status).toBe(200);
    expect((await res.json()).rows).toEqual([]);
  });
});

describe("the public console no longer takes a provider or a key", () => {
  const body = JSON.stringify({ text: "2 guests, Nov 20", provider: "gemini-2.5-flash", apiKey: "AIza-whatever-000000" });

  it("/v1/extract and /v1/converse refuse an override from a caller with no staff session", async () => {
    const { app } = setup();
    const extract = await app.request("/v1/extract", { method: "POST", headers: { "content-type": "application/json" }, body });
    expect(extract.status).toBe(401);
    const converse = await app.request("/v1/converse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hi", provider: "gemini-2.5-flash", apiKey: "AIza-whatever-000000" }),
    });
    expect(converse.status).toBe(401);
  });
});

/** A Redis-over-REST stand-in, enough for the settings store. */
function fakeKv() {
  const strings = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const [cmd, ...a] = JSON.parse(String(init?.body)) as Array<string | number>;
    const key = String(a[0]);
    let result: unknown = null;
    switch (String(cmd).toUpperCase()) {
      case "GET": result = strings.get(key) ?? null; break;
      case "SET": strings.set(key, String(a[1])); result = "OK"; break;
      case "LPUSH": lists.set(key, [String(a[1]), ...(lists.get(key) ?? [])]); result = lists.get(key)!.length; break;
      case "LTRIM": lists.set(key, (lists.get(key) ?? []).slice(Number(a[1]), Number(a[2]) + 1)); result = "OK"; break;
      case "LRANGE": result = (lists.get(key) ?? []).slice(Number(a[1]), Number(a[2]) + 1); break;
      case "INCR": strings.set(key, String(Number(strings.get(key) ?? 0) + 1)); result = Number(strings.get(key)); break;
      case "INCRBY": strings.set(key, String(Number(strings.get(key) ?? 0) + Number(a[1]))); result = Number(strings.get(key)); break;
      case "EXPIRE": result = 1; break;
      case "MGET": result = a.map((k) => strings.get(String(k)) ?? null); break;
    }
    return new Response(JSON.stringify({ result }), { status: 200 });
  });
  return { fetch: fetchImpl as unknown as typeof fetch, strings, lists };
}

describe("the same store over a KV", () => {
  it("round-trips settings, audit and counters through Redis commands", async () => {
    const kv = fakeKv();
    vi.stubGlobal("fetch", kv.fetch);
    const store: SettingsStore = createSettingsStore({ kv: { url: "https://kv.test", token: "t" }, env: process.env, cacheMs: 0 });
    await store.setKey("gemini", "AIzaSy-kv-roundtrip-0001", "admin");
    await store.apply({ synthesisEnabled: false }, "admin");
    await store.recordOutcome({ provider: "gemini", kind: "ok", ms: 120 });

    expect((await store.read())!.synthesisEnabled).toBe(false);
    expect((await store.audit()).length).toBe(2);
    expect((await store.stats(7)).rows[0]).toMatchObject({ provider: "gemini", ok: 1, avgMs: 120 });
    expect(kv.strings.get("settings:ai")).not.toContain("AIzaSy-kv-roundtrip-0001");
  });
});

describe("the dashboard page", () => {
  it("carries a script that parses, and puts no saved key or secret in the markup", async () => {
    const { app } = setup();
    const html = await (await app.request("/admin/ai", { headers: asAdmin })).text();
    const script = /<script>([\s\S]*?)<\/script\s*>/i.exec(html)?.[1];
    expect(script).toBeTruthy();
    const { Script } = await import("node:vm");
    expect(() => new Script(script!)).not.toThrow();
    expect(html).not.toContain(ENC);
    expect(html).not.toContain(ADMIN);
  });
});

describe("deployment", () => {
  it("vercel.json routes /admin to the function, or the dashboard page would 404 in production", async () => {
    const { readFileSync } = await import("node:fs");
    const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
      rewrites: Array<{ source: string; destination: string }>;
    };
    const sources = config.rewrites.map((r) => r.source);
    expect(sources).toContain("/admin/:path*");
    expect(sources).toContain("/v1/:path*"); // the dashboard's own API
  });
});
