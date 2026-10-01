// Real guest messages never reach a judge by accident. Scenario files say whether they are synthetic; anything that
// is not needs two deliberate switches, and its text is masked before it leaves the machine.

export function assertScenariosAllowed(file, { allowRealFlag = false, env = {} } = {}) {
  if (file.synthetic === true) return { masked: false };
  if (allowRealFlag && env.JUDGE_REAL_OK === "1") return { masked: true };
  throw new Error(
    "these scenarios are not marked synthetic. Real guest text goes to a third-party model only with " +
      "--allow-real AND JUDGE_REAL_OK=1, and which provider may see it is the team's decision (Q-021, asked to Anthony; Q-029 in the team repo).",
  );
}
