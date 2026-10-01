import { describe, expect, it, vi } from 'vitest';
import { createOdooClient } from '../src/odoo/client.ts';

function captureFetch() {
  const seen: { url: string; headers: Headers }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    seen.push({ url: req.url, headers: req.headers });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { seen, fetchImpl: vi.fn(fetchImpl) as unknown as typeof fetch };
}

describe('createOdooClient', () => {
  it('gửi khoá trong header api-key theo mặc định (live spec 22/09/2026)', async () => {
    const { seen, fetchImpl } = captureFetch();
    const client = createOdooClient({ baseUrl: 'https://odoo.example/estimate-api', apiKey: 'k-guest', fetch: fetchImpl });
    await client.GET('/v1/estimate/rates');
    expect(seen[0]?.headers.get('api-key')).toBe('k-guest');
    expect(seen[0]?.headers.get('x-api-key')).toBeNull();
  });

  it('không gửi header khoá nào khi không có apiKey', async () => {
    const { seen, fetchImpl } = captureFetch();
    const client = createOdooClient({ baseUrl: 'https://odoo.example/estimate-api', fetch: fetchImpl });
    await client.GET('/v1/estimate/rates');
    expect(seen[0]?.headers.has('api-key')).toBe(false);
  });

  it('tôn trọng apiKeyHeader khi được chỉ định', async () => {
    const { seen, fetchImpl } = captureFetch();
    const client = createOdooClient({ baseUrl: 'https://odoo.example/estimate-api', apiKey: 'k', apiKeyHeader: 'X-Other', fetch: fetchImpl });
    await client.GET('/v1/estimate/rates');
    expect(seen[0]?.headers.get('X-Other')).toBe('k');
  });
});
