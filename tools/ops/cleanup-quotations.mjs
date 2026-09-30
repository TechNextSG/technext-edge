/**
 * One-off cleanup for the quotation store: the duplicates a fixed bug left behind.
 *
 * Why it exists: before `findOpenQuotationForPhone`, every message in a WhatsApp thread that had
 * enough information minted a NEW quotation for the same phone. One manual test produced thirteen
 * (`QT-1120-MIGU-*`, four of them inside the same minute), and a staff queue where the same guest
 * appears thirteen times is a queue nobody can work.
 *
 * The bug is fixed, so this only has to clear the backlog. It is deliberately conservative and
 * deliberately loud:
 *
 *   * **dry run by default.** Nothing is deleted without `--delete`.
 *   * it only ever removes a record that is (a) not the newest for its phone, (b) never published
 *     (`estimator.sharedAt` empty) and (c) never corrected by staff (`staffEdits` empty) — i.e. a
 *     record nobody has looked at, which a newer record for the same guest already replaces.
 *   * anything with a published link is kept, because a guest may be holding that link.
 *   * the seeded fixture (`QT-1010-SKY`) is kept so a cold start still has something to show.
 *
 * Usage (KV credentials in the environment; on Vercel: `vercel env pull` first):
 *   node tools/ops/cleanup-quotations.mjs              # list what would go
 *   node tools/ops/cleanup-quotations.mjs --delete     # do it
 *
 * **It usually cannot run from a laptop**, and that is not a defect: the KV vars are Vercel
 * *Secrets*, and `vercel env pull` writes `[SENSITIVE]` for those by design. The supported path is
 * the same rule served from inside the deployment —
 * `POST /v1/quotes/cleanup-duplicates` (staff-only, dry unless `{confirm:true}`), which is what
 * actually cleared the backlog on 2026-09-27. This file stays for a deployment that does hold the
 * credentials in its own env, and as the readable statement of what the route deletes.
 */
const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const deleting = process.argv.includes("--delete");

if (!kvUrl || !kvToken) {
  console.error("No KV credentials in the environment (KV_REST_API_URL + KV_REST_API_TOKEN).");
  console.error("On Vercel: `npx vercel env pull .env.vercel.local --environment=production`, then re-run.");
  process.exit(1);
}

async function command(args) {
  const res = await fetch(kvUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${kvToken}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`KV ${args[0]} -> ${res.status} ${await res.text()}`);
  return (await res.json()).result;
}

const ids = (await command(["SMEMBERS", "quotes:all"])) ?? [];
const quotes = [];
for (const id of ids) {
  const raw = await command(["GET", `quote:${id}`]);
  if (raw) quotes.push(JSON.parse(raw));
}
quotes.sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));

/** Newest record per phone; every other unpublished, unedited record for that phone is a leftover. */
const newestByPhone = new Map();
for (const q of quotes) {
  const key = q.phone ?? `(no phone) ${q.quoteId}`;
  newestByPhone.set(key, q.quoteId);
}

const doomed = [];
for (const q of quotes) {
  const key = q.phone ?? `(no phone) ${q.quoteId}`;
  const kept = newestByPhone.get(key) === q.quoteId;
  const published = Boolean(q.estimator?.sharedAt);
  const touched = (q.staffEdits ?? []).length > 0;
  const seeded = q.quoteId === "QT-1010-SKY" || typeof q.seedVersion === "number";
  if (kept || published || touched || seeded) continue;
  doomed.push(q);
}

console.log(`${quotes.length} quotation(s) in the store.`);
console.log(`Keeping ${quotes.length - doomed.length}: newest per phone, plus anything published, corrected or seeded.\n`);
for (const q of quotes) {
  const mark = doomed.includes(q) ? "DELETE" : "keep  ";
  console.log(
    `${mark} ${String(q.quoteId).padEnd(26)} ${String(q.phone ?? "-").padEnd(14)} ` +
      `${String(q.createdAt).slice(0, 16)} rev=${q.estimator?.seq ?? "-"} shared=${q.estimator?.sharedAt ? "yes" : "no"} ` +
      `trip=${q.bffTrip ? "yes" : "no"} edits=${(q.staffEdits ?? []).length}`,
  );
}

if (!deleting) {
  console.log(`\nDry run. ${doomed.length} record(s) would be removed. Re-run with --delete to remove them.`);
  process.exit(0);
}

for (const q of doomed) {
  await command(["DEL", `quote:${q.quoteId}`]);
  await command(["DEL", `quote_slug:${String(q.slug).toLowerCase()}`]);
  await command(["SREM", "quotes:all", q.quoteId]);
  console.log(`removed ${q.quoteId}`);
}
console.log(`\nRemoved ${doomed.length} record(s).`);
