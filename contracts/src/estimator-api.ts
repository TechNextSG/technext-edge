import { z } from "zod";

/**
 * Zod schemas for tn-casa Estimator REST API and Webhook contracts.
 * Anti-Corruption Layer (Pattern 2) ensuring technext-edge never relies
 * on loose `as Record<string, unknown>` type casting.
 */

// -----------------------------------------------------------------------------
// 1. Estimate Responses (POST /api/estimates & PATCH /api/estimates/:id)
// -----------------------------------------------------------------------------

export const EstimateSuccessResponseSchema = z.object({
  id: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  issues: z.array(z.unknown()).optional().default([]),
  computedAt: z.string().nullable().optional(),
  model: z.unknown().refine((val) => val !== undefined, {
    message: "model is required in estimate success response",
  }),
  retail_model: z.unknown().optional().nullable(),
  sample: z.boolean().optional(),
  mode: z.enum(["fixture", "odoo"]).nullable().optional(),
  ok: z.boolean().optional(),
}).passthrough();

export type EstimateSuccessResponse = z.infer<typeof EstimateSuccessResponseSchema>;

export const RefusalIssueItemSchema = z.object({
  code: z.string().optional(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
  message: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export type RefusalIssueItem = z.infer<typeof RefusalIssueItemSchema>;

export const EstimateRefusalResponseSchema = z.object({
  ok: z.boolean().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
  fields: z.array(z.string()).optional().default([]),
  issues: z.array(RefusalIssueItemSchema).optional().default([]),
}).passthrough();

export type EstimateRefusalResponse = z.infer<typeof EstimateRefusalResponseSchema>;

export const EstimateConflictResponseSchema = z.object({
  ok: z.boolean().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
}).passthrough();

export type EstimateConflictResponse = z.infer<typeof EstimateConflictResponseSchema>;

// -----------------------------------------------------------------------------
// 2. Commit Response (POST /api/estimates/:id/commit)
// -----------------------------------------------------------------------------

export const CommitResponseSchema = z.object({
  seq: z.number().int().default(0),
  computedAt: z.string().nullable().optional(),
}).passthrough();

export type CommitResponse = z.infer<typeof CommitResponseSchema>;

// -----------------------------------------------------------------------------
// 3. Share Response (POST /api/estimates/:id/share)
// -----------------------------------------------------------------------------

export const ShareResponseSchema = z.object({
  url: z.string().min(1),
  expiresAt: z.string().nullable().optional(),
}).passthrough();

export type ShareResponse = z.infer<typeof ShareResponseSchema>;

// -----------------------------------------------------------------------------
// 4. Extras Response (POST/PATCH /api/estimates/:id/extras)
// -----------------------------------------------------------------------------

export const ExtrasResponseSchema = z.object({
  ok: z.boolean().optional(),
  extras: z.array(z.unknown()).optional().default([]),
  computedAt: z.string().nullable().optional(),
}).passthrough();

export type ExtrasResponse = z.infer<typeof ExtrasResponseSchema>;

// -----------------------------------------------------------------------------
// 5. Lookup by ID (GET /api/estimates/:id)
// -----------------------------------------------------------------------------

export const GetEstimateResponseSchema = z.object({
  id: z.string(),
  status: z.enum(["draft", "committed", "shared", "approved", "archived"]).optional(),
  trip: z.unknown().optional(),
  extras: z.array(z.unknown()).optional().default([]),
  revisions: z.array(z.unknown()).optional().default([]),
  computedAt: z.string().nullable().optional(),
}).passthrough();

export type GetEstimateResponse = z.infer<typeof GetEstimateResponseSchema>;

// -----------------------------------------------------------------------------
// 6. Signed Staff Approval / Archive Webhook Payload
// -----------------------------------------------------------------------------

export const EstimatorWebhookPayloadSchema = z.object({
  event: z.enum(["approved", "archived"]),
  estimateId: z.string(),
  seq: z.number().optional(),
  url: z.string().optional(),
  guestName: z.string().optional(),
  guestPhone: z.string().optional(),
  timestamp: z.number().int(),
  signature: z.string().optional(),
}).passthrough();

export type EstimatorWebhookPayload = z.infer<typeof EstimatorWebhookPayloadSchema>;

// -----------------------------------------------------------------------------
// Safe Parser Helpers
// -----------------------------------------------------------------------------

export function parseEstimateSuccess(data: unknown): { ok: true; data: EstimateSuccessResponse } | { ok: false; error: z.ZodError } {
  const result = EstimateSuccessResponseSchema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error };
}

export function parseEstimateRefusal(data: unknown): { ok: true; data: EstimateRefusalResponse } | { ok: false; error: z.ZodError } {
  const result = EstimateRefusalResponseSchema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error };
}

export function parseCommitResponse(data: unknown): { ok: true; data: CommitResponse } | { ok: false; error: z.ZodError } {
  const result = CommitResponseSchema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error };
}

export function parseShareResponse(data: unknown): { ok: true; data: ShareResponse } | { ok: false; error: z.ZodError } {
  const result = ShareResponseSchema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error };
}

export function parseExtrasResponse(data: unknown): { ok: true; data: ExtrasResponse } | { ok: false; error: z.ZodError } {
  const result = ExtrasResponseSchema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error };
}

export function parseGetEstimateResponse(data: unknown): { ok: true; data: GetEstimateResponse } | { ok: false; error: z.ZodError } {
  const result = GetEstimateResponseSchema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error };
}

export function parseEstimatorWebhookPayload(data: unknown): { ok: true; data: EstimatorWebhookPayload } | { ok: false; error: z.ZodError } {
  const result = EstimatorWebhookPayloadSchema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error };
}
