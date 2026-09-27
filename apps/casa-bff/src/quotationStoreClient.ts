/**
 * Persistent storage for quotations — the thing the guest's `/q/:slug` link resolves through.
 *
 * Why this file exists: `quotationStore.ts` kept its quotations in two module-level `Map`s, which
 * die on every cold start and every deploy. Measured, not theorised: a real guest link returned
 * 200 before a redeploy and 404 after it, because the record no longer existed. A guest link is
 * the one thing this product hands a customer, so it has to survive a serverless instance that
 * does not exist between requests.
 *
 * The same env var the conversation store reads (`KV_REST_API_URL`/`KV_REST_API_TOKEN`, or the
 * `UPSTASH_*` spellings) drives this one, so one Upstash database serves both. Quotations carry no
 * TTL: they are business records, not transient thread state, and a link must outlive the 24h
 * WhatsApp window.
 */
import type { HonoQuotationDraft } from "../../../packages/extractor/src/index.js";

export interface QuotationStore {
  get(idOrSlug: string): Promise<HonoQuotationDraft | undefined>;
  save(draft: HonoQuotationDraft): Promise<HonoQuotationDraft>;
  list(): Promise<HonoQuotationDraft[]>;
}

export interface RedisConfig {
  url: string;
  token: string;
}

/** In-memory store: the previous behaviour, kept for local dev and for the contract test. */
export function createInMemoryQuotationStore(): QuotationStore {
  const quotesById = new Map<string, HonoQuotationDraft>();
  const quoteIdBySlug = new Map<string, string>();
  const allIds = new Set<string>();

  return {
    async get(idOrSlug: string): Promise<HonoQuotationDraft | undefined> {
      const direct = quotesById.get(idOrSlug) ?? quotesById.get(idOrSlug.toUpperCase());
      if (direct) return direct;
      const mappedId = quoteIdBySlug.get(idOrSlug.toLowerCase());
      return mappedId ? quotesById.get(mappedId) : undefined;
    },
    async save(draft: HonoQuotationDraft): Promise<HonoQuotationDraft> {
      quotesById.set(draft.quoteId, draft);
      quoteIdBySlug.set(draft.slug.toLowerCase(), draft.quoteId);
      allIds.add(draft.quoteId);
      return draft;
    },
    async list(): Promise<HonoQuotationDraft[]> {
      return [...allIds]
        .map((id) => quotesById.get(id))
        .filter((d): d is HonoQuotationDraft => d !== undefined)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
  };
}

/**
 * Redis REST store, speaking the Upstash/Vercel KV HTTP protocol the conversation store already
 * uses. Layout:
 *
 *   quote:<id>             -> JSON of the draft (no TTL)
 *   quote_slug:<lower>     -> quote id (slug lookup; lowercased because URLs are case-sensitive
 *                             while our index is not)
 *   quotes:all             -> a SET of every quote id, so `list` never needs KEYS/SCAN
 */
export function createRedisQuotationStore(config: RedisConfig): QuotationStore {
  async function command<T = unknown>(args: (string | number)[]): Promise<T> {
    const res = await fetch(config.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Redis command [${args[0]}] failed (${res.status}): ${errText.slice(0, 200)}`);
    }
    const json = (await res.json()) as { result: T; error?: string };
    if (json.error) throw new Error(`Redis command error [${args[0]}]: ${json.error}`);
    return json.result;
  }

  async function read(id: string): Promise<HonoQuotationDraft | undefined> {
    const raw = await command<string | null>(["GET", `quote:${id}`]);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as HonoQuotationDraft;
    } catch {
      return undefined;
    }
  }

  return {
    async get(idOrSlug: string): Promise<HonoQuotationDraft | undefined> {
      const direct = (await read(idOrSlug)) ?? (await read(idOrSlug.toUpperCase()));
      if (direct) return direct;
      const mappedId = await command<string | null>(["GET", `quote_slug:${idOrSlug.toLowerCase()}`]);
      return mappedId ? read(mappedId) : undefined;
    },
    async save(draft: HonoQuotationDraft): Promise<HonoQuotationDraft> {
      const json = JSON.stringify(draft);
      await command(["SET", `quote:${draft.quoteId}`, json]);
      await command(["SET", `quote_slug:${draft.slug.toLowerCase()}`, draft.quoteId]);
      await command(["SADD", "quotes:all", draft.quoteId]);
      return draft;
    },
    async list(): Promise<HonoQuotationDraft[]> {
      const ids = (await command<string[]>(["SMEMBERS", "quotes:all"])) ?? [];
      const drafts: HonoQuotationDraft[] = [];
      for (const id of ids) {
        const draft = await read(id);
        if (draft) drafts.push(draft);
      }
      return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
  };
}

/**
 * Reads the same KV env vars as the conversation store, so one Upstash database backs both. Falls
 * back to in-memory — correct for local dev, and loud about it under production, because a silent
 * fallback here is exactly the bug this file exists to fix (guest links that work until the next
 * deploy).
 */
export function createQuotationStoreFromEnv(): QuotationStore {
  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (kvUrl && kvToken) {
    return createRedisQuotationStore({ url: kvUrl, token: kvToken });
  }
  if (process.env.NODE_ENV === "production") {
    // eslint-disable-next-line no-console
    console.error(
      "[casa-bff] NO KV CONFIGURED IN PRODUCTION: quotations fall back to in-memory storage, " +
        "so every guest quotation link will 404 on the next cold start or deploy. " +
        "Set KV_REST_API_URL + KV_REST_API_TOKEN (or the UPSTASH_* equivalents).",
    );
  }
  return createInMemoryQuotationStore();
}
