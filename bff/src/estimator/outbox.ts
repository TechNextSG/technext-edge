import type { BffTrip } from "../../../ai/src/index.ts";
import type { EstimatorPort, CreateDraftResult } from "./port.ts";

export interface OutboxStore {
  get(key: string): Promise<CreateDraftResult | undefined>;
  set(key: string, result: CreateDraftResult, ttlMs?: number): Promise<void>;
}

export function createInMemoryOutboxStore(ttlMs = 24 * 60 * 60 * 1000): OutboxStore {
  const store = new Map<string, { result: CreateDraftResult; expiresAt: number }>();

  function sweep(): void {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) store.delete(key);
    }
  }

  return {
    async get(key: string): Promise<CreateDraftResult | undefined> {
      sweep();
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return undefined;
      }
      return entry.result;
    },
    async set(key: string, result: CreateDraftResult, customTtlMs?: number): Promise<void> {
      sweep();
      store.set(key, {
        result,
        expiresAt: Date.now() + (customTtlMs ?? ttlMs),
      });
    },
  };
}

export interface EstimatorOutboxOptions {
  estimator: EstimatorPort;
  store?: OutboxStore;
  maxRetries?: number;
  initialBackoffMs?: number;
}

export interface EstimatorOutbox {
  executeDraft(
    idempotencyKey: string,
    trip: BffTrip,
    extras?: unknown[],
  ): Promise<CreateDraftResult>;
}

/**
 * Creates an Estimator Outbox for reliable, idempotent upstream calls (Pattern 5).
 * - Enforces idempotency per message id / key to prevent duplicated draft minting.
 * - Retries transient failures with exponential backoff up to maxRetries.
 * - Fails fast on business refusals (e.g. 422) without wasteful retries.
 */
export function createEstimatorOutbox(options: EstimatorOutboxOptions): EstimatorOutbox {
  const {
    estimator,
    store = createInMemoryOutboxStore(),
    maxRetries = 3,
    initialBackoffMs = 50,
  } = options;

  async function executeDraft(
    idempotencyKey: string,
    trip: BffTrip,
    extras?: unknown[],
  ): Promise<CreateDraftResult> {
    const cached = await store.get(idempotencyKey);
    if (cached) {
      return cached;
    }

    let attempt = 0;
    let lastResult: CreateDraftResult | undefined;

    while (attempt < maxRetries) {
      attempt++;
      try {
        const res = await estimator.createDraft(trip, extras);
        lastResult = res;

        if (res.ok) {
          await store.set(idempotencyKey, res);
          return res;
        }

        // Non-transient errors (refusals, conflict) should not be retried
        if (res.status === 422 || res.status === 409) {
          return res;
        }

        // Transient error (e.g. unreachable, timeout)
        if (attempt < maxRetries) {
          const backoff = initialBackoffMs * Math.pow(2, attempt - 1);
          if (backoff > 0) {
            await new Promise((r) => setTimeout(r, backoff));
          }
        }
      } catch (err) {
        lastResult = {
          ok: false,
          reason: "unreachable",
          detail: err instanceof Error ? err.message : String(err),
        };
        if (attempt < maxRetries) {
          const backoff = initialBackoffMs * Math.pow(2, attempt - 1);
          if (backoff > 0) {
            await new Promise((r) => setTimeout(r, backoff));
          }
        }
      }
    }

    return lastResult ?? { ok: false, reason: "unreachable", detail: "Exceeded max retries" };
  }

  return { executeDraft };
}
