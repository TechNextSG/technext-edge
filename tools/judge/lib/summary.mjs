// summary.md: what a run says, and how much of it can be believed.
import { median } from "./stats.mjs";
import { CRITERION_IDS } from "../schema.mjs";

export const KAPPA_THRESHOLD = 0.6;

/**
 * A criterion is trusted only when a calibration exists for THIS judge and THIS rubric version and its weighted kappa
 * reaches the threshold. Anything else prints as uncalibrated and must not decide a model change.
 */
export function calibrationStatus(calibration, { judgeId, rubricVersion }) {
  const out = {};
  for (const id of CRITERION_IDS) {
    const c = calibration?.criteria?.[id];
    if (!calibration) out[id] = { trusted: false, why: "no calibration yet" };
    else if (calibration.judge !== judgeId) out[id] = { trusted: false, why: `calibrated for ${calibration.judge}, not ${judgeId}` };
    else if (calibration.rubricVersion !== rubricVersion) out[id] = { trusted: false, why: `calibrated on rubric ${calibration.rubricVersion}, now ${rubricVersion}` };
    else if (c?.kappa == null) out[id] = { trusted: false, why: "kappa undefined (one side never varied)" };
    else if (c.kappa < KAPPA_THRESHOLD) out[id] = { trusted: false, why: `kappa ${c.kappa.toFixed(2)} < ${KAPPA_THRESHOLD}` };
    else out[id] = { trusted: true, kappa: c.kappa };
  }
  return out;
}

const fmt = (n) => (n == null ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(2));

export function buildSummary({ meta, results, pairwise, calibration, codeFailures }) {
  const trust = calibrationStatus(calibration, { judgeId: meta.judge, rubricVersion: meta.rubricVersion });
  const lines = [];
  lines.push(`# Judge run ${meta.startedAt}`);
  lines.push("");
  lines.push(`- Judge: \`${meta.judge}\`, rubric ${meta.rubricVersion}, prompt ${meta.promptHash}`);
  lines.push(`- Candidates: ${meta.candidates.map((c) => `\`${c}\``).join(", ")}`);
  lines.push(`- Scenarios: ${meta.scenarioCount} (${meta.scenarioFile})`);
  lines.push(`- Model calls used: ${meta.callsUsed} of ${meta.maxCalls}`);
  if (meta.selfPreference) lines.push("- **Warning: the judge shares a vendor with a candidate. Scores favour that vendor's style.**");
  lines.push("");

  lines.push("## Calibration");
  lines.push("");
  lines.push("| Criterion | Can this decide a model change? |");
  lines.push("|---|---|");
  for (const id of CRITERION_IDS) {
    lines.push(`| ${id} | ${trust[id].trusted ? `yes (kappa ${fmt(trust[id].kappa)})` : `**uncalibrated**: ${trust[id].why}`} |`);
  }
  lines.push("");

  if (results) {
    lines.push("## Scores by criterion (median across scenarios, 1-5)");
    lines.push("");
    lines.push(`| Candidate | ${CRITERION_IDS.join(" | ")} |`);
    lines.push(`|---|${CRITERION_IDS.map(() => "---").join("|")}|`);
    for (const [cand, byScenario] of Object.entries(results)) {
      const cells = CRITERION_IDS.map((id) => {
        const scores = Object.values(byScenario).filter((r) => r.judge?.status === "ok").map((r) => r.judge.criteria[id].score);
        const m = median(scores);
        return `${fmt(m)}${trust[id].trusted ? "" : " ⚠"}`;
      });
      lines.push(`| ${cand} | ${cells.join(" | ")} |`);
    }
    lines.push("");
    lines.push("⚠ = uncalibrated criterion, shown for orientation only.");
    lines.push("");

    lines.push("## Machine checks (not overridable by the judge)");
    lines.push("");
    lines.push("| Candidate | no_money | no_link | reply_language | fact_gate | handoff |");
    lines.push("|---|---|---|---|---|---|");
    for (const [cand, byScenario] of Object.entries(results)) {
      const runs = Object.values(byScenario);
      const cell = (k) => `${runs.filter((r) => r.checks[k].ok).length}/${runs.length}`;
      lines.push(`| ${cand} | ${cell("no_money")} | ${cell("no_link")} | ${cell("reply_language")} | ${cell("fact_gate")} | ${cell("handoff")} |`);
    }
    lines.push("");
    if (codeFailures.length) {
      lines.push("Failed machine checks:");
      lines.push("");
      for (const f of codeFailures) lines.push(`- \`${f.candidate}\` ${f.scenario}: ${f.check} (${f.detail})${f.knownGap ? " [known gap]" : ""}`);
      lines.push("");
    }

    lines.push("## Weakest scenarios");
    lines.push("");
    for (const [cand, byScenario] of Object.entries(results)) {
      const ranked = Object.entries(byScenario)
        .filter(([, r]) => r.judge?.status === "ok")
        .map(([id, r]) => ({ id, mean: CRITERION_IDS.reduce((s, c) => s + r.judge.criteria[c].score, 0) / CRITERION_IDS.length }))
        .sort((a, b) => a.mean - b.mean)
        .slice(0, 5);
      lines.push(`**${cand}**: ${ranked.map((r) => `${r.id} (${fmt(r.mean)})`).join(", ") || "nothing scored"}`);
      lines.push("");
    }

    lines.push("## Reliability");
    lines.push("");
    for (const [cand, byScenario] of Object.entries(results)) {
      const all = Object.values(byScenario);
      const invalid = all.filter((r) => r.judge?.status !== "ok").length;
      const unstable = all.reduce((n, r) => n + (r.judge?.status === "ok" ? CRITERION_IDS.filter((c) => r.judge.criteria[c].unstable).length : 0), 0);
      lines.push(`- ${cand}: ${invalid} transcript(s) invalid, ${unstable} criterion score(s) unstable (repeat runs differed by more than 1)`);
    }
    lines.push("");
  }

  if (pairwise) {
    lines.push(`## Pairwise: A = \`${pairwise.a}\`, B = \`${pairwise.b}\``);
    lines.push("");
    lines.push("A verdict counts only when it survives swapping the order. `inconsistent` means the judge followed position, not quality.");
    lines.push("");
    lines.push("| Criterion | A wins | B wins | tie | inconsistent | invalid |");
    lines.push("|---|---|---|---|---|---|");
    for (const id of CRITERION_IDS) {
      const tally = { A: 0, B: 0, tie: 0, inconsistent: 0, invalid: 0 };
      for (const r of Object.values(pairwise.byScenario)) {
        if (r.status !== "ok") tally.invalid += 1;
        else tally[r.criteria[id].winner] += 1;
      }
      lines.push(`| ${id}${trust[id].trusted ? "" : " ⚠"} | ${tally.A} | ${tally.B} | ${tally.tie} | ${tally.inconsistent} | ${tally.invalid} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
