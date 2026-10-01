/**
 * Every environment variable this service reads, named once and typed.
 *
 * `process.env` is read here and nowhere else in `bff/src` (a test enforces it). Everything else takes an
 * `Env` — from `loadEnv()` for the ambient process, or from a literal in a test — so which variables exist,
 * and what a missing one means, is answered by reading this file.
 *
 * Every field is an optional string on purpose. Each reader already says what an unset, empty or malformed
 * value means for it (`staffAccessKey` falls back to the WhatsApp token, a bad timeout falls back to its
 * default), and those meanings are the product's behaviour: this schema names the variables, it does not
 * change them. `loadEnv` therefore never throws.
 *
 * Read lazily, never at import: Vercel does not guarantee the variables exist when a module is first
 * evaluated, and tests set them per case. Call `loadEnv()` where the value is needed.
 */
import { z } from "zod";

const text = z.string().optional();

export const EnvSchema = z.object({
  // Runtime
  NODE_ENV: text,
  VERCEL: text,
  VERCEL_ENV: text,
  PORT: text,
  PUBLIC_BASE_URL: text,
  GUEST_LINK_MODE: text,
  DEBUG_EXTRACT: text,

  // Who may open what
  STAFF_ACCESS_KEY: text,
  ADMIN_ACCESS_KEY: text,
  SETTINGS_ENCRYPTION_KEY: text,

  // KV (Vercel KV / Upstash REST); either pair works
  KV_REST_API_URL: text,
  KV_REST_API_TOKEN: text,
  UPSTASH_REDIS_REST_URL: text,
  UPSTASH_REDIS_REST_TOKEN: text,

  // WhatsApp
  WHATSAPP_VERIFY_TOKEN: text,
  WHATSAPP_APP_SECRET: text,
  WHATSAPP_ACCESS_TOKEN: text,
  WHATSAPP_PHONE_NUMBER_ID: text,
  WHATSAPP_API_VERSION: text,
  WHATSAPP_GRAPH_BASE_URL: text,
  WHATSAPP_TIMEOUT_MS: text,
  WHATSAPP_TURN_TIMEOUT_MS: text,
  RESORT_WHATSAPP_NUMBER: text,

  // The team estimator
  ESTIMATOR_MODE: text,
  ESTIMATOR_BASE_URL: text,
  ESTIMATOR_APP_URL: text,
  ESTIMATOR_TIMEOUT_MS: text,

  // The quotation tool's trace switch ("true" turns it on)
  ENABLE_HONO_QUOTATION_TOOL: text,

  // Follow-up window for a sent quotation
  QUOTATION_VALID_HOURS: text,
  QUOTATION_NUDGE_HOURS: text,

  // The model providers (`ai/` reads exactly these names, through `AiEnv`)
  EXTRACTOR_PROVIDER: text,
  GEMINI_API_KEY: text,
  GEMINI_MODEL: text,
  GEMINI_TIMEOUT_MS: text,
  DEEPSEEK_GATEWAY_KEY: text,
  DEEPSEEK_BASE_URL: text,
  DEEPSEEK_GATEWAY_URL: text, // an older name for the base URL; the dashboard only reports whether it is set
  DEEPSEEK_MODEL: text,
  DEEPSEEK_TIMEOUT_MS: text,
});

export type Env = z.infer<typeof EnvSchema>;

/** The named variables out of `source` (the process by default), nothing else. Never throws. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return EnvSchema.parse(source);
}
