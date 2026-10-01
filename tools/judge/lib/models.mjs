// Turning `--candidate gemini:<model>` into a provider, and the rules about who may judge whom.
// Kept apart from run.mjs so it can be tested without ai/ or a key.

const KINDS = ["gemini", "deepseek"];

/** `gemini:gemini-3.8-flash`, `deepseek:deepseek-pro`, or a bare name the ai package already knows. */
export function parseModelSpec(spec, { choiceFromName, isKnownModel, env = {} }) {
  const text = String(spec ?? "").trim();
  if (!text) throw new Error("empty model spec");
  const colon = text.indexOf(":");
  if (colon > 0) {
    const kind = text.slice(0, colon).toLowerCase();
    const model = text.slice(colon + 1).trim();
    if (!KINDS.includes(kind)) throw new Error(`unknown provider '${kind}' in '${text}' (use ${KINDS.join(" or ")})`);
    if (!model) throw new Error(`no model in '${text}'`);
    if (!isKnownModel(kind, model)) throw new Error(`'${model}' is not a model the ${kind} provider accepts`);
    return { provider: kind, model };
  }
  const choice = choiceFromName(text, env);
  if (!choice) throw new Error(`unknown model '${text}' (write it as gemini:<model> or deepseek:<model>)`);
  return choice;
}

export const modelId = (choice) => `${choice.provider}:${choice.model}`;

/**
 * A judge from the same vendor as the model it grades prefers that model's style. So the judge must come from a
 * different vendor than every candidate. With candidates from both vendors no judge can satisfy that, which is
 * why `allowSelfPreference` exists: it lets the run happen and the summary says so.
 */
export function assertIndependentJudge(judge, candidates, { allowSelfPreference = false } = {}) {
  const clash = candidates.filter((c) => c.provider === judge.provider);
  if (clash.length === 0) return { selfPreference: false };
  if (allowSelfPreference) return { selfPreference: true };
  throw new Error(
    `the judge (${modelId(judge)}) is from the same vendor as ${clash.map(modelId).join(", ")}. ` +
      "Pick a judge from another vendor, or pass --allow-self-preference and read the result with that bias in mind.",
  );
}
