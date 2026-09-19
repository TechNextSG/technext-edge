// The scoring rules of the eval, in one place, because two callers need to agree on them:
//
//   eval/runner.mjs             — runs the dataset against a live provider and prints a score
//   test/evalReplay.test.ts     — runs the *recorded* answers of a past live run through the
//                                 current pipeline, offline, on every `npm test`
//
// Importing this from both is what keeps "fabricated fields must be 0" and "these four
// fields must be right" from quietly drifting apart between the scored run and the gate.

export const REQUIRED_FIELDS = ["checkIn", "guests", "rooms", "nights"];

export function checkEvidence(trip, sourceText) {
  const haystack = sourceText.toLowerCase();
  let stated = 0;
  let evidenceOk = 0;
  for (const f of Object.values(trip)) {
    if (f.state === "stated") {
      stated++;
      if (f.evidence && haystack.includes(f.evidence.toLowerCase())) evidenceOk++;
    }
  }
  return { stated, evidenceOk };
}

export function scoreCase(testCase, trip) {
  const rows = [];
  let fabricated = 0;
  let requiredTotal = 0;
  let requiredCorrect = 0;

  for (const [field, expected] of Object.entries(testCase.expected)) {
    const actual = trip[field];
    const stateOk = actual.state === expected.state;
    const valueOk = expected.value === undefined ? true : actual.value === expected.value;

    // Fabrication per Playbook's own definition: "a value present that the
    // message never said AND NO HOUSE NORM COVERS." "default" is the house
    // norm doing its job on purpose — that is not fabrication, it's the
    // opposite: an honest, labeled guess. Only "stated"/"inferred" claim the
    // message itself as the source, so only those can be dishonest about it.
    const isFabrication =
      expected.state === "missing" && (actual.state === "stated" || actual.state === "inferred") && actual.value !== null;
    if (isFabrication) fabricated++;

    if (REQUIRED_FIELDS.includes(field) && expected.state === "stated") {
      requiredTotal++;
      if (stateOk && valueOk) requiredCorrect++;
    }

    rows.push({ field, expected, actual: { state: actual.state, value: actual.value }, stateOk, valueOk, isFabrication });
  }

  return { rows, fabricated, requiredTotal, requiredCorrect };
}
