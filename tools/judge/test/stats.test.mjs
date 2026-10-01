import { describe, it, expect } from "vitest";
import { median, spearman, weightedKappa, exactAgreement, withinOneAgreement, seededRandom } from "../lib/stats.mjs";

describe("median", () => {
  it("odd, even, empty", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("spearman", () => {
  it("is 1 for the same order and -1 for the reverse", () => {
    expect(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])).toBeCloseTo(1, 10);
    expect(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])).toBeCloseTo(-1, 10);
  });
  it("handles ties with average ranks (value computed by hand)", () => {
    // ranks a: 1, 2.5, 2.5, 4   ranks b: 1, 2, 3, 4  -> pearson of the ranks
    expect(spearman([1, 2, 2, 3], [1, 2, 3, 4])).toBeCloseTo(0.9486833, 6);
  });
  it("does not exist when one side never varies", () => {
    expect(spearman([3, 3, 3], [1, 2, 3])).toBeNull();
  });
  it("rejects samples of different length", () => {
    expect(() => spearman([1, 2], [1])).toThrow();
  });
});

describe("weightedKappa (quadratic)", () => {
  it("is 1 for identical ratings", () => {
    expect(weightedKappa([1, 2, 3, 4, 5], [1, 2, 3, 4, 5])).toBeCloseTo(1, 10);
  });
  it("is -1 when ratings are reversed on a symmetric scale", () => {
    expect(weightedKappa([1, 5], [5, 1])).toBeCloseTo(-1, 10);
  });
  it("matches a hand-worked case", () => {
    // a = 1,2,3  b = 1,3,3 on 1..3. Weights w(i,j)=((i-j)/2)^2.
    // observed = (1/3)(w(1,1)+w(2,3)+w(3,3)) = (1/3)(0 + 0.25 + 0) = 0.083333
    // marginals a: 1/3 each; b: 1/3,0,2/3
    // expected = sum_ij w * pa_i * pb_j = pa(1)*[w11*1/3 + w13*2/3] + pa(2)*[w21*1/3 + w23*2/3] + pa(3)*[w31*1/3 + w33*2/3]
    //          = 1/3*[0 + 1*2/3] + 1/3*[0.25*1/3 + 0.25*2/3] + 1/3*[1*1/3 + 0]
    //          = 1/3*0.666667 + 1/3*0.25 + 1/3*0.333333 = 0.416667
    // kappa = 1 - 0.083333/0.416667 = 0.8
    expect(weightedKappa([1, 2, 3], [1, 3, 3], { min: 1, max: 3 })).toBeCloseTo(0.8, 10);
  });
  it("is undefined only when both raters always give the same score", () => {
    expect(weightedKappa([3, 3, 3], [3, 3, 3])).toBeNull();
  });
  it("is 0 when one rater never varies: no agreement beyond chance", () => {
    expect(weightedKappa([3, 3, 3], [1, 3, 5])).toBeCloseTo(0, 10);
  });
  it("rejects a score outside the scale", () => {
    expect(() => weightedKappa([6], [3])).toThrow();
  });
});

describe("agreement", () => {
  it("exact and within one", () => {
    expect(exactAgreement([1, 2, 3, 4], [1, 2, 4, 2])).toBe(0.5);
    expect(withinOneAgreement([1, 2, 3, 4], [1, 2, 4, 2])).toBe(0.75);
  });
});

describe("seededRandom", () => {
  it("repeats for the same seed and differs between seeds", () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(seededRandom(8)()).not.toBe(seededRandom(7)());
  });
});
