import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProviderFromEnv, settingsFromEnv } from '../src/infra/providers/providerFromEnv.js';
import { createDeepSeekProvider } from '../src/infra/providers/deepseek.js';

// ai/ is a library: it is handed its configuration and never reaches for the process's. And a provider must not
// carry a host in its source — the caller says where guest text may go.
const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesIn(full) : full.endsWith('.ts') ? [full] : [];
  });
}
const files = filesIn(src).map((file) => ({ rel: path.relative(src, file).split(path.sep).join('/'), code: readFileSync(file, 'utf8') }));

afterEach(() => vi.unstubAllGlobals());

describe('ai/src takes its configuration as an argument', () => {
  it('never reads process.env', () => {
    const hits = files.filter((f) => f.code.includes('process.env')).map((f) => f.rel);
    expect(hits).toEqual([]);
  });

  it('carries no gateway host', () => {
    const hits = files.filter((f) => /railway\.app|litellm-production/.test(f.code)).map((f) => f.rel);
    expect(hits).toEqual([]);
  });
});

describe('DeepSeek without a configured gateway', () => {
  it('is not configured, and nothing goes out', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    expect(() => createProviderFromEnv({ EXTRACTOR_PROVIDER: 'deepseek-flash', DEEPSEEK_GATEWAY_KEY: 'k' })).toThrow(/not set/);
    expect(() => createDeepSeekProvider('k', 'deepseek-flash', { baseUrl: '' })).toThrow(/not configured/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is skipped as a fallback when its URL is missing, so Gemini alone answers', () => {
    const env = { EXTRACTOR_PROVIDER: 'gemini', GEMINI_API_KEY: 'g', DEEPSEEK_GATEWAY_KEY: 'd' };
    expect(settingsFromEnv(env).fallback).toBeNull();
    expect(createProviderFromEnv(env).id).toContain('google:');
  });

  it('is used as a fallback only when both key and URL are there', () => {
    const provider = createProviderFromEnv({
      EXTRACTOR_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'g',
      DEEPSEEK_GATEWAY_KEY: 'd',
      DEEPSEEK_BASE_URL: 'https://gateway.test/v1',
    });
    expect(provider.answeredBy).toBeTypeOf('function');
  });
});
