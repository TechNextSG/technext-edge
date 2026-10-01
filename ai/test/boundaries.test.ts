import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The rules CLAUDE.md §1 sets for ai/, and the layer direction ai/README.md describes, checked on the
// source rather than trusted to review:
//   - no import from bff/, no Odoo client, no booking submit, no api-key handling
//   - domain/ imports nothing but itself and @casa/contracts
//   - application/ imports domain/ and ports/, never infra/
//   - infra/ implements ports/ and imports nothing else of ours
const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesIn(full) : full.endsWith('.ts') ? [full] : [];
  });
}

const files = filesIn(src).map((file) => ({
  rel: path.relative(src, file).split(path.sep).join('/'),
  code: readFileSync(file, 'utf8'),
}));

function importsOf(code: string): string[] {
  // Statements only: the word "from" also appears in comments and guest-facing copy.
  const statements = /^\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm;
  return [...code.matchAll(statements)].map((m) => (m[1] ?? m[2] ?? m[3])!);
}

/** The top-level folder an import lands in, resolved from the importing file. */
function layerOf(fromRel: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  return target.startsWith('..') ? 'outside' : target.split('/')[0]!;
}

describe('ai/ package boundaries', () => {
  it('never imports bff/, the Odoo client, or anything outside the package', () => {
    const bad = files.flatMap(({ rel, code }) =>
      importsOf(code)
        .filter((spec) => /(^|\/)bff\//.test(spec) || /odoo\/client/.test(spec) || layerOf(rel, spec) === 'outside')
        .map((spec) => `${rel} -> ${spec}`),
    );
    expect(bad).toEqual([]);
  });

  it('never creates an Odoo client, submits a booking, or reads the Odoo api key', () => {
    const bad = files
      .filter(({ code }) => /createOdooClient|booking\/submit|ODOO_API_KEY|['"]api-key['"]/.test(code))
      .map(({ rel }) => rel);
    expect(bad).toEqual([]);
  });

  it('keeps the layers pointing one way', () => {
    const allowed: Record<string, string[]> = {
      domain: ['domain'],
      application: ['application', 'domain', 'ports'],
      ports: ['ports', 'domain'],
      infra: ['infra', 'ports', 'domain'],
    };
    const bad = files.flatMap(({ rel, code }) => {
      const layer = rel.split('/')[0]!;
      const ok = allowed[layer];
      if (!ok) return []; // index.ts is the public surface and may re-export any layer
      return importsOf(code)
        .map((spec) => ({ spec, to: layerOf(rel, spec) }))
        .filter(({ spec, to }) => (to === null ? !/^(zod|@casa\/contracts|node:)/.test(spec) : !ok.includes(to)))
        .map(({ spec }) => `${rel} -> ${spec}`);
    });
    expect(bad).toEqual([]);
  });
});
