// The scoring rules of the eval, in one place, because two callers need to agree on them:
//
//   eval/runner.mjs             — runs the dataset against a live provider and prints a score
//   test/evalReplay.test.ts     — runs the *recorded* answers of a past live run through the
//                                 current pipeline, offline, on every `npm test`
//
// Importing this from both is what keeps "fabricated fields must be 0" and "these four
// fields must be right" from quietly drifting apart between the scored run and the gate.

export const REQUIRED_FIELDS = ["checkIn", "guests", "rooms", "nights"];

// Fields the estimate is priced from that are *not* part of the Playbook's four required
// fields. `transport` is the one that matters today: an airport transfer the guest did not
// ask for is a line on the estimate, and the recorded run contains that mistake twice — a
// guest who says they are driving themselves comes back as `transport: true` in vi-07
// ("xe tụi mình tự đi") and in zh-09 ("自己开车过去"), with their own sentence as the
// evidence, so nothing in the pipeline could tell and nothing in the score reported it.
// Kept as its own category rather than folded into REQUIRED_FIELDS, so a live run's
// required-field number stays comparable with results-deepseek.log's 63/87.
export const PRICED_FIELDS = ["transport"];

/**
 * The priced fields a case's ground truth has an opinion about, and where the trip
 * disagrees. Compared on *value*: that is what reaches the quote. A house-norm `default`
 * that happens to agree with the guest ("no transfer needed" answered by the norm rather
 * than by the model) is not a pricing error, and flagging its state instead would bury the
 * mismatches that are.
 */
export function checkPricedFields(testCase, trip) {
  const mismatches = [];
  let checked = 0;
  for (const field of PRICED_FIELDS) {
    const expected = testCase.expected[field];
    if (!expected || expected.value === undefined) continue;
    checked += 1;
    const actual = trip[field];
    if (actual?.value !== expected.value) {
      mismatches.push({
        field,
        expected: { state: expected.state, value: expected.value },
        actual: { state: actual?.state, value: actual?.value },
      });
    }
  }
  return { checked, mismatches };
}

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
