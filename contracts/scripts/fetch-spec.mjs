#!/usr/bin/env node
/* Compares Phillip's live staging spec with the pinned copy.
 *
 *   node scripts/fetch-spec.mjs          exit 0 if identical, 1 if different (prints a path/schema diff)
 *   node scripts/fetch-spec.mjs --write  overwrite the pinned copy, then remind to regenerate types
 *
 * Read-only against Odoo: a single GET of openapi.json, which is public. Never touches submit.
 * CI runs the check form so a spec change shows up as a red job, not as a surprise for Evane.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC_URL = process.env.ODOO_SPEC_URL
  ?? 'https://casa-escondida-03-staging-web-37790335.dev.odoo.com/estimate-api/openapi.json';
const PINNED = join(dirname(fileURLToPath(import.meta.url)), '..', 'odoo', 'estimate-api.v1.json');
const write = process.argv.includes('--write');

const md5 = (s) => createHash('md5').update(s).digest('hex');

const res = await fetch(SPEC_URL, { signal: AbortSignal.timeout(30_000) });
if (!res.ok) {
  console.error(`fetch failed: ${res.status} ${res.statusText}`);
  process.exit(2);
}
const liveText = await res.text();
const pinnedText = await readFile(PINNED, 'utf8').catch(() => '');

console.log(`live   md5 ${md5(liveText)}`);
console.log(`pinned md5 ${pinnedText ? md5(pinnedText) : '(none)'}`);

if (liveText === pinnedText) {
  console.log('spec unchanged');
  process.exit(0);
}

// Byte-level diff is noisy (key order, whitespace). Show what a reader cares about: paths and schemas.
const live = JSON.parse(liveText);
const pinned = pinnedText ? JSON.parse(pinnedText) : { paths: {}, components: { schemas: {} } };
const diffKeys = (label, a, b) => {
  const added = Object.keys(b).filter((k) => !(k in a));
  const removed = Object.keys(a).filter((k) => !(k in b));
  const changed = Object.keys(a).filter((k) => k in b && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  for (const k of added) console.log(`  + ${label} ${k}`);
  for (const k of removed) console.log(`  - ${label} ${k}`);
  for (const k of changed) console.log(`  ~ ${label} ${k}`);
};
console.log('spec differs:');
diffKeys('path', pinned.paths ?? {}, live.paths ?? {});
diffKeys('schema', pinned.components?.schemas ?? {}, live.components?.schemas ?? {});
if (pinned.info?.version !== live.info?.version) console.log(`  ~ info.version ${pinned.info?.version} -> ${live.info?.version}`);

if (write) {
  await writeFile(PINNED, liveText);
  console.log(`wrote ${PINNED}`);
  console.log('next: npm run gen -w contracts, then update odoo/SOURCE.md (date, md5)');
  process.exit(0);
}
process.exit(1);
