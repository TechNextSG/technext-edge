// Small, dependency-free statistics for the judge and its calibration. Every function is pure.

export function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Ranks 1..n, ties get the average of the ranks they span. */
function ranks(values) {
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = avg;
    i = j + 1;
  }
  return out;
}

function pearson(a, b) {
  const n = a.length;
  if (n < 2) return null;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  if (da === 0 || db === 0) return null; // one side never varies: a correlation does not exist
  return num / Math.sqrt(da * db);
}

export function spearman(a, b) {
  if (a.length !== b.length) throw new Error("spearman: samples differ in length");
  return pearson(ranks(a), ranks(b));
}

export function exactAgreement(a, b) {
  if (a.length === 0) return null;
  return a.filter((v, i) => v === b[i]).length / a.length;
}

export function withinOneAgreement(a, b) {
  if (a.length === 0) return null;
  return a.filter((v, i) => Math.abs(v - b[i]) <= 1).length / a.length;
}

/**
 * Cohen's kappa with quadratic weights over the integer scale [min, max]. Disagreeing by 2 costs four times
 * disagreeing by 1, which is what a 1-5 rubric means. Null when both raters always give the same score, because
 * chance agreement is then total and the statistic is undefined (one rater that never varies gives 0, not null).
 */
export function weightedKappa(a, b, { min = 1, max = 5 } = {}) {
  if (a.length !== b.length) throw new Error("weightedKappa: samples differ in length");
  const n = a.length;
  if (n === 0) return null;
  const k = max - min + 1;
  const obs = Array.from({ length: k }, () => new Array(k).fill(0));
  const ra = new Array(k).fill(0);
  const rb = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    const x = Math.round(a[i]) - min;
    const y = Math.round(b[i]) - min;
    if (x < 0 || x >= k || y < 0 || y >= k) throw new Error(`weightedKappa: score outside ${min}..${max}`);
    obs[x][y] += 1;
    ra[x] += 1;
    rb[y] += 1;
  }
  const w = (i, j) => ((i - j) / (k - 1)) ** 2;
  let observed = 0;
  let expected = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      observed += w(i, j) * (obs[i][j] / n);
      expected += w(i, j) * ((ra[i] / n) * (rb[j] / n));
    }
  }
  if (expected === 0) return null;
  return 1 - observed / expected;
}

/** Deterministic PRNG, so a calibration sample can be redrawn. */
export function seededRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
