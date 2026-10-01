import createClient from 'openapi-fetch';
import type { paths } from './types.ts';

/** The roles Odoo prices differently. Mapped to ODOO_KEY_{GUEST,AGENT,STAFF} in the BFF env.
 * `instructor` prices like `agent` (Phillip's PDF §1) but earns no commission; it sees no cost data. */
export type OdooRole = 'guest' | 'agent' | 'instructor' | 'staff';

export interface OdooClientOptions {
  baseUrl: string;
  /** Khoá theo vai. Optional: không có khoá thì gọi ẩn danh — từ 21/09/2026 Odoo trả 401. */
  apiKey?: string;
  /**
   * Header mang khoá. Live spec 22/09/2026 khai `components.securitySchemes.ApiKeyAuth`
   * = apiKey in header, name `api-key`. Chỉ đổi khi spec đổi.
   */
  apiKeyHeader?: string;
  fetch?: typeof globalThis.fetch;
}

/** Typed client over Phillip's estimate API. Only bff/ may import this; ai/ never does. */
export function createOdooClient(opts: OdooClientOptions) {
  const headers: Record<string, string> = {};
  if (opts.apiKey) headers[opts.apiKeyHeader ?? 'api-key'] = opts.apiKey;
  return createClient<paths>({
    baseUrl: opts.baseUrl,
    headers,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
}

export type OdooClient = ReturnType<typeof createOdooClient>;
