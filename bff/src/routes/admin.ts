import type { Context, Hono } from "hono";
import { z } from "zod";
import { isKnownModel, PROVIDER_KINDS, type ModelChoice, type ProviderKind, type ProviderSettings } from "../../../ai/src/index.js";
import { testChoice, type TestResult } from "../services/aiProvider.js";
import {
  LIMITS,
  validateDeepseekBaseUrl,
  type AiSettingsPatch,
  type SettingsStore,
} from "../stores/settingsStore.js";
import { renderAdminAiPage } from "../views/adminAiPage.js";

export interface AdminRouteDeps {
  settings: SettingsStore;
  /**
   * Null when the caller is an admin; otherwise the response to send: 404 when the dashboard is not switched on
   * (no `ADMIN_ACCESS_KEY`), 401 without a session, 403 for a staff session — staff may not open `/admin`.
   */
  guard: (c: Context, kind: "page" | "api") => Response | null;
  env?: NodeJS.ProcessEnv;
  /** Injected so a test can answer the test-call without a network. */
  fetch?: typeof fetch;
}

const Kind = z.enum(["gemini", "deepseek", "anthropic"]);
const Choice = z.object({ provider: Kind, model: z.string().min(1).max(80) }).strict();
const ms = (min: number, max: number) => z.number().int().min(min).max(max);

const PatchShape = {
  primary: Choice.optional(),
  fallback: Choice.nullable().optional(),
  timeoutsMs: z
    .object({
      extract: ms(LIMITS.timeoutMs.min, LIMITS.timeoutMs.max),
      synthesis: ms(LIMITS.timeoutMs.min, LIMITS.timeoutMs.max),
    })
    .strict()
    .optional(),
  breaker: z
    .object({
      cooldownMs: ms(LIMITS.cooldownMs.min, LIMITS.cooldownMs.max),
      authCooldownMs: ms(LIMITS.authCooldownMs.min, LIMITS.authCooldownMs.max),
    })
    .strict()
    .optional(),
  synthesisEnabled: z.boolean().optional(),
  deepseekBaseUrl: z.string().max(300).nullable().optional(),
};

/** Shared by PUT settings and POST test: the model ids, the URL and the pairing must all make sense. */
function checked<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value: z.infer<T>, ctx) => {
    const v = value as AiSettingsPatch & { primary?: ModelChoice; fallback?: ModelChoice | null };
    for (const [path, choice] of [["primary", v.primary], ["fallback", v.fallback]] as const) {
      if (choice && !isKnownModel(choice.provider, choice.model)) {
        ctx.addIssue({ code: "custom", path: [path, "model"], message: `"${choice.model}" is not a ${choice.provider} model this app knows` });
      }
    }
    if (v.primary && v.fallback && v.primary.provider === v.fallback.provider && v.primary.model === v.fallback.model) {
      ctx.addIssue({ code: "custom", path: ["fallback"], message: "the fallback is the same model as the primary, which protects nothing" });
    }
    if (typeof v.deepseekBaseUrl === "string" && v.deepseekBaseUrl !== "") {
      const problem = validateDeepseekBaseUrl(v.deepseekBaseUrl);
      if (problem) ctx.addIssue({ code: "custom", path: ["deepseekBaseUrl"], message: problem });
    }
  });
}

const PutSettings = checked(z.object({ ...PatchShape, saveAnyway: z.boolean().optional() }).strict());
const TestBody = checked(z.object(PatchShape).strict());
const KeyBody = z.object({ key: z.string().trim().min(8).max(500) }).strict();

function asPatch(body: z.infer<typeof TestBody>): AiSettingsPatch {
  const { deepseekBaseUrl, ...rest } = body;
  return { ...rest, ...(deepseekBaseUrl !== undefined ? { deepseekBaseUrl: deepseekBaseUrl === "" ? null : deepseekBaseUrl } : {}) } as AiSettingsPatch;
}

/** The settings as they would be in force if `patch` were saved. */
function candidate(current: ProviderSettings, patch: AiSettingsPatch): ProviderSettings {
  return {
    ...current,
    ...(patch.primary ? { primary: patch.primary } : {}),
    ...("fallback" in patch && patch.fallback !== undefined ? { fallback: patch.fallback } : {}),
    ...(patch.timeoutsMs ? { timeoutsMs: patch.timeoutsMs } : {}),
    ...(patch.breaker ? { breaker: patch.breaker } : {}),
    ...(patch.synthesisEnabled !== undefined ? { synthesisEnabled: patch.synthesisEnabled } : {}),
    ...("deepseekBaseUrl" in patch && patch.deepseekBaseUrl !== undefined
      ? patch.deepseekBaseUrl === null
        ? { deepseekBaseUrl: undefined }
        : { deepseekBaseUrl: patch.deepseekBaseUrl }
      : {}),
  };
}

export function registerAdminRoutes(app: Hono, deps: AdminRouteDeps): void {
  const { settings: store, guard } = deps;
  const env = deps.env ?? process.env;
  // The audit records who; there is one admin key, so the actor is the role.
  const BY = "admin";

  async function runTests(current: ProviderSettings, patch: AiSettingsPatch, onlyWhatChanged: boolean): Promise<TestResult[]> {
    const next = candidate(current, patch);
    const tests: Promise<TestResult>[] = [];
    const tuning = Boolean(patch.timeoutsMs || patch.deepseekBaseUrl !== undefined);
    if (!onlyWhatChanged || patch.primary || tuning) {
      tests.push(testChoice("primary", next.primary, next, env, deps.fetch));
    }
    if (next.fallback && (!onlyWhatChanged || ("fallback" in patch && patch.fallback))) {
      tests.push(testChoice("fallback", next.fallback, next, env, deps.fetch));
    }
    return Promise.all(tests);
  }

  app.get("/admin/ai", (c) => {
    const denied = guard(c, "page");
    if (denied) return denied;
    return c.html(renderAdminAiPage());
  });

  app.get("/v1/admin/ai/settings", async (c) => {
    const denied = guard(c, "api");
    if (denied) return denied;
    return c.json({ ok: true, ...(await store.view()) });
  });

  app.put("/v1/admin/ai/settings", async (c) => {
    const denied = guard(c, "api");
    if (denied) return denied;
    const parsed = PutSettings.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, reason: "invalid_settings", issues: parsed.error.issues }, 422);
    const { saveAnyway, ...rest } = parsed.data;
    const patch = asPatch(rest);

    // A model that does not answer is not saved by accident: the dashboard tests what is being set first, and
    // "Save anyway" is the deliberate way past a failed test (a key that is about to be added, say).
    let tests: TestResult[] = [];
    if (!saveAnyway && (patch.primary || patch.fallback || patch.timeoutsMs || patch.deepseekBaseUrl !== undefined)) {
      tests = await runTests((await store.resolve()).settings, patch, true);
      if (tests.some((t) => !t.ok)) {
        return c.json({ ok: false, reason: "test_failed", tests, hint: "Fix the key or the model, or save anyway." }, 409);
      }
    }
    const saved = await store.apply(patch, BY);
    return c.json({ ok: true, version: saved.version, tests });
  });

  app.post("/v1/admin/ai/test", async (c) => {
    const denied = guard(c, "api");
    if (denied) return denied;
    const parsed = TestBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, reason: "invalid_settings", issues: parsed.error.issues }, 422);
    const tests = await runTests((await store.resolve()).settings, asPatch(parsed.data), false);
    return c.json({ ok: tests.every((t) => t.ok), tests });
  });

  app.put("/v1/admin/ai/keys/:provider", async (c) => {
    const denied = guard(c, "api");
    if (denied) return denied;
    const provider = Kind.safeParse(c.req.param("provider"));
    if (!provider.success) return c.json({ ok: false, reason: "unknown_provider" }, 404);
    if (!(await store.view()).encryptionConfigured) {
      return c.json(
        { ok: false, reason: "encryption_not_configured", detail: "Set SETTINGS_ENCRYPTION_KEY (32 bytes, base64) in the environment before saving keys here." },
        503,
      );
    }
    const parsed = KeyBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, reason: "invalid_key", issues: parsed.error.issues.map((i) => i.message) }, 422);
    await store.setKey(provider.data as ProviderKind, parsed.data.key, BY);
    // The response carries the masked view only — never the key that was just sent.
    return c.json({ ok: true, key: (await store.view()).keys[provider.data as ProviderKind] });
  });

  app.delete("/v1/admin/ai/keys/:provider", async (c) => {
    const denied = guard(c, "api");
    if (denied) return denied;
    const provider = Kind.safeParse(c.req.param("provider"));
    if (!provider.success) return c.json({ ok: false, reason: "unknown_provider" }, 404);
    await store.removeKey(provider.data as ProviderKind, BY);
    return c.json({ ok: true, key: (await store.view()).keys[provider.data as ProviderKind] });
  });

  app.get("/v1/admin/ai/stats", async (c) => {
    const denied = guard(c, "api");
    if (denied) return denied;
    const days = Number(c.req.query("days") ?? 7);
    return c.json({ ok: true, ...(await store.stats(Number.isFinite(days) ? days : 7)), providers: PROVIDER_KINDS });
  });

  app.get("/v1/admin/ai/audit", async (c) => {
    const denied = guard(c, "api");
    if (denied) return denied;
    return c.json({ ok: true, entries: await store.audit() });
  });
}
