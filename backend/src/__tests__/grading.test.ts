import {
  gradeFromMark,
  bestOfIcaAverage,
  computeM1,
  computeM2,
  computeFinalResult,
  computeGpa,
  computeOgpa,
  classOfAward,
  minimumPassGrade,
  passes,
  DEFAULT_MARKING_SCHEME,
} from "../lib/grading";

describe("gradeFromMark", () => {
  it.each([
    [100, "A+", 4.0],
    [80, "A+", 4.0],
    [79.9, "A", 4.0],
    [74, "A-", 3.7],
    [45, "C", 2.0],
    [40, "C-", 1.7],
    [39.9, "D+", 1.3],
    [29, "E", 0.0],
    [0, "E", 0.0],
  ])("maps %d marks to %s (%f)", (mark, grade, point) => {
    const result = gradeFromMark(mark as number);
    expect(result.grade).toBe(grade);
    expect(result.gradePoint).toBeCloseTo(point as number);
  });
});

describe("bestOfIcaAverage", () => {
  it("averages the best 2 of 3, normalised to percentage", () => {
    // 8/10=80%, 15/20=75%, 5/10=50% -> best two are 80 and 75 -> avg 77.5
    const avg = bestOfIcaAverage(
      [
        { mark: 8, maxMarks: 10 },
        { mark: 15, maxMarks: 20 },
        { mark: 5, maxMarks: 10 },
      ],
      2
    );
    expect(avg).toBeCloseTo(77.5);
  });

  it("handles fewer marks than bestOfCount gracefully", () => {
    const avg = bestOfIcaAverage([{ mark: 9, maxMarks: 10 }], 2);
    expect(avg).toBeCloseTo(90);
  });

  it("returns 0 for no marks", () => {
    expect(bestOfIcaAverage([], 2)).toBe(0);
  });
});

describe("computeM1 / computeM2", () => {
  it("applies ESE/ICA weights per the handbook formula", () => {
    // theory: ESE 70% + best-2-of-3 ICA 30%
    const m1 = computeM1(80, [{ mark: 9, maxMarks: 10 }, { mark: 8, maxMarks: 10 }, { mark: 5, maxMarks: 10 }], DEFAULT_MARKING_SCHEME);
    // best2 of [90,80,50] = 90,80 -> avg 85; m1 = 80*0.7 + 85*0.3 = 56+25.5 = 81.5
    expect(m1).toBeCloseTo(81.5);
  });

  it("practical uses 60/40 weighting", () => {
    const m2 = computeM2(70, [{ mark: 18, maxMarks: 20 }, { mark: 16, maxMarks: 20 }], DEFAULT_MARKING_SCHEME);
    // ica avg = (90+80)/2 = 85; m2 = 70*0.6 + 85*0.4 = 42+34 = 76
    expect(m2).toBeCloseTo(76);
  });
});

describe("computeFinalResult", () => {
  it("theory-only course uses M1 directly", () => {
    const r = computeFinalResult({ componentType: "THEORY_ONLY", m1: 82, m2: null, theoryCredit: 3, practicalCredit: 0 });
    expect(r.finalMark).toBe(82);
    expect(r.grade).toBe("A+");
  });

  it("practical-only course uses M2 directly", () => {
    const r = computeFinalResult({ componentType: "PRACTICAL_ONLY", m1: null, m2: 42, theoryCredit: 0, practicalCredit: 2 });
    expect(r.finalMark).toBe(42);
    expect(r.grade).toBe("C-");
  });

  it("combines theory + practical by credit weight", () => {
    // Ct=3, Cp=1: (3*80 + 1*60)/4 = (240+60)/4 = 75 -> combined alone would be grade A.
    const r = computeFinalResult({ componentType: "BOTH", m1: 80, m2: 60, theoryCredit: 3, practicalCredit: 1 });
    expect(r.finalMark).toBe(75);
    // But the practical component's own mark (60) grades as B, which is worse than the
    // combined A — the carry-forward rule means B wins even though M1 is much stronger.
    expect(r.grade).toBe("B");
  });

  it("the lowest component grade carries forward when a component fails despite a passing combined average", () => {
    // M1 (theory) = 90 (A+), M2 (practical) = 25 (E, a fail). Credit-weighted combined:
    // Ct=1, Cp=3: (1*90 + 3*25)/4 = (90+75)/4 = 41.25 -> C- on its own (would "pass" at 41.25),
    // but the practical component's own grade (E) is worse and must carry forward.
    const r = computeFinalResult({ componentType: "BOTH", m1: 90, m2: 25, theoryCredit: 1, practicalCredit: 3 });
    expect(r.grade).toBe("E");
    expect(r.gradePoint).toBe(0);
  });

  it("throws if a required component mark is missing", () => {
    expect(() =>
      computeFinalResult({ componentType: "BOTH", m1: 80, m2: null, theoryCredit: 2, practicalCredit: 2 })
    ).toThrow();
  });
});

describe("minimum pass grade & passes()", () => {
  const scheme = { acuMinPassGrade: "D+", coreMinPassGrade: "C-", languageAcuMinPassGrade: "C" };

  it("core/elective units require C-", () => {
    expect(minimumPassGrade("CORE", "PHYS1013", scheme)).toBe("C-");
  });

  it("English-language ACUs require C", () => {
    expect(minimumPassGrade("ACU", "ENGL1012", scheme)).toBe("C");
  });

  it("other ACUs require D+", () => {
    expect(minimumPassGrade("ACU", "ICTC1022", scheme)).toBe("D+");
  });

  it("passes() compares against the threshold correctly", () => {
    expect(passes("C-", "C-")).toBe(true);
    expect(passes("D+", "C-")).toBe(false);
    expect(passes("B", "C-")).toBe(true);
    expect(passes("D+", "D+")).toBe(true);
  });
});

describe("GPA / OGPA", () => {
  it("computes credit-weighted GPA, excluding ACU/Industrial Training courses", () => {
    const gpa = computeGpa([
      { credit: 3, gradePoint: 4.0, excludeFromGpa: false }, // A+ 3-credit core
      { credit: 2, gradePoint: 3.0, excludeFromGpa: false }, // B 2-credit core
      { credit: 1, gradePoint: 0.0, excludeFromGpa: true }, // ACU, excluded regardless of grade
    ]);
    // (3*4.0 + 2*3.0) / 5 = (12+6)/5 = 3.6
    expect(gpa).toBeCloseTo(3.6);
  });

  it("computes OGPA as an equal-weight mean of level GPAs", () => {
    expect(computeOgpa([3.6, 3.2, 3.9, 3.5])).toBeCloseTo(3.55);
  });

  it("returns 0 GPA when there are no GPA-eligible courses", () => {
    expect(computeGpa([{ credit: 2, gradePoint: 3.0, excludeFromGpa: true }])).toBe(0);
  });
});

describe("classOfAward", () => {
  it.each([
    [3.9, "First Class"],
    [3.5, "Second Class (Upper Division)"],
    [3.1, "Second Class (Lower Division)"],
    [2.5, "Pass"],
    [1.5, "Not yet classified"],
  ])("OGPA %f -> %s", (ogpa, expected) => {
    expect(classOfAward(ogpa as number)).toBe(expected);
  });
});
