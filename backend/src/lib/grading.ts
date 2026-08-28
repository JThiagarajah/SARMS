// Grading engine — pure functions, no I/O. Mirrors the proposal's Section 3.2/3.3 rules,
// sourced from University of Vavuniya, Dept. of Physical Science, HB_2024_2025_1.pdf Sec. 3.3.
//
//   M1 = ESE(theory)   x theoryEseWeight    + best-N-of-K ICA(theory)    x theoryIcaWeight
//   M2 = ESE(practical)x practicalEseWeight + best-N-of-K ICA(practical) x practicalIcaWeight
//   Final Result = (Ct x M1 + Cp x M2) / (Ct + Cp)      [course with both components]
//                = M1                                    [theory-only course]
//                = M2                                    [practical-only course]
//
// Minimum pass: C- for Core/Elective; for a unit with both components, the lower of the two
// component grades carries forward if either component alone would fail — a combined average
// that clears C- cannot paper over a genuinely failing component. ACUs use a different minimum
// pass grade (C for English Language I/II, D+ otherwise) and are excluded from GPA/OGPA.

export interface MarkingSchemeConfig {
  theoryEseWeight: number;
  theoryIcaWeight: number;
  practicalEseWeight: number;
  practicalIcaWeight: number;
  icaBestOfCount: number;
  icaTotalCount: number;
}

export const DEFAULT_MARKING_SCHEME: MarkingSchemeConfig = {
  theoryEseWeight: 0.7,
  theoryIcaWeight: 0.3,
  practicalEseWeight: 0.6,
  practicalIcaWeight: 0.4,
  icaBestOfCount: 2,
  icaTotalCount: 3,
};

// Table 1 of the proposal, verbatim.
export const GRADE_TABLE: { min: number; grade: string; point: number }[] = [
  { min: 80, grade: "A+", point: 4.0 },
  { min: 75, grade: "A", point: 4.0 },
  { min: 70, grade: "A-", point: 3.7 },
  { min: 65, grade: "B+", point: 3.3 },
  { min: 60, grade: "B", point: 3.0 },
  { min: 55, grade: "B-", point: 2.7 },
  { min: 50, grade: "C+", point: 2.3 },
  { min: 45, grade: "C", point: 2.0 },
  { min: 40, grade: "C-", point: 1.7 },
  { min: 35, grade: "D+", point: 1.3 },
  { min: 30, grade: "D", point: 1.0 },
  { min: 0, grade: "E", point: 0.0 },
];

export function gradeFromMark(mark: number): { grade: string; gradePoint: number } {
  const clamped = Math.max(0, Math.min(100, mark));
  const row = GRADE_TABLE.find((r) => clamped >= r.min)!;
  return { grade: row.grade, gradePoint: row.point };
}

function gradeRank(grade: string): number {
  return GRADE_TABLE.findIndex((r) => r.grade === grade);
  // lower index = higher grade; GRADE_TABLE is sorted best-to-worst, so a bigger index is worse.
}

/** Best-N-of-K average of ICA marks, each normalised to a 0-100 percentage of its own max. */
export function bestOfIcaAverage(
  marks: { mark: number; maxMarks: number }[],
  bestOfCount: number
): number {
  if (marks.length === 0) return 0;
  const percentages = marks.map((m) => (m.maxMarks > 0 ? (m.mark / m.maxMarks) * 100 : 0));
  percentages.sort((a, b) => b - a);
  const taken = percentages.slice(0, Math.min(bestOfCount, percentages.length));
  return taken.reduce((s, v) => s + v, 0) / taken.length;
}

export function computeM1(eseTheory: number, icaTheory: { mark: number; maxMarks: number }[], scheme: MarkingSchemeConfig) {
  const icaAvg = bestOfIcaAverage(icaTheory, scheme.icaBestOfCount);
  return eseTheory * scheme.theoryEseWeight + icaAvg * scheme.theoryIcaWeight;
}

export function computeM2(esePractical: number, icaPractical: { mark: number; maxMarks: number }[], scheme: MarkingSchemeConfig) {
  const icaAvg = bestOfIcaAverage(icaPractical, scheme.icaBestOfCount);
  return esePractical * scheme.practicalEseWeight + icaAvg * scheme.practicalIcaWeight;
}

export type ComponentType = "THEORY_ONLY" | "PRACTICAL_ONLY" | "BOTH";

export interface FinalResultInput {
  componentType: ComponentType;
  m1: number | null; // required unless PRACTICAL_ONLY
  m2: number | null; // required unless THEORY_ONLY
  theoryCredit: number; // Ct
  practicalCredit: number; // Cp
}

export interface FinalResultOutput {
  finalMark: number;
  grade: string;
  gradePoint: number;
}

/** Computes the course's final mark & grade, applying the "lowest component grade carries
 *  forward" rule for two-component courses. */
export function computeFinalResult(input: FinalResultInput): FinalResultOutput {
  const { componentType, m1, m2, theoryCredit, practicalCredit } = input;

  if (componentType === "THEORY_ONLY") {
    if (m1 == null) throw new Error("Theory mark (M1) is required for a theory-only course.");
    const g = gradeFromMark(m1);
    return { finalMark: round2(m1), ...g };
  }
  if (componentType === "PRACTICAL_ONLY") {
    if (m2 == null) throw new Error("Practical mark (M2) is required for a practical-only course.");
    const g = gradeFromMark(m2);
    return { finalMark: round2(m2), ...g };
  }

  // BOTH: credit-weighted combination, then the lower of the three candidate grades
  // (combined, theory-alone, practical-alone) carries forward.
  if (m1 == null || m2 == null) throw new Error("Both M1 and M2 are required for this course.");
  const totalCredit = theoryCredit + practicalCredit;
  if (totalCredit <= 0) throw new Error("Course must have positive theory + practical credit.");
  const finalMark = (theoryCredit * m1 + practicalCredit * m2) / totalCredit;

  const gCombined = gradeFromMark(finalMark);
  const gTheory = gradeFromMark(m1);
  const gPractical = gradeFromMark(m2);
  const worst = [gCombined, gTheory, gPractical].reduce((a, b) => (gradeRank(b.grade) > gradeRank(a.grade) ? b : a));

  return { finalMark: round2(finalMark), grade: worst.grade, gradePoint: worst.gradePoint };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- Pass / minimum-grade rules ---------------------------------------------------------------

export function minimumPassGrade(category: "CORE" | "ELECTIVE" | "ACU", courseCode: string, scheme: {
  acuMinPassGrade: string;
  coreMinPassGrade: string;
  languageAcuMinPassGrade: string;
}): string {
  if (category !== "ACU") return scheme.coreMinPassGrade;
  const isLanguage = /ENGL|ENGLISH/i.test(courseCode);
  return isLanguage ? scheme.languageAcuMinPassGrade : scheme.acuMinPassGrade;
}

export function passes(grade: string, minGrade: string): boolean {
  return gradeRank(grade) <= gradeRank(minGrade);
}

// --- GPA / OGPA ---------------------------------------------------------------------------------

export interface GpaCourseInput {
  credit: number; // Ct + Cp (0 for ACU/Industrial Training — excluded from GPA)
  gradePoint: number;
  excludeFromGpa: boolean; // true for ACU / Industrial Training
}

/** GPA for one level = sum(credit x grade point) / sum(credit), over GPA-eligible courses only. */
export function computeGpa(courses: GpaCourseInput[]): number {
  const eligible = courses.filter((c) => !c.excludeFromGpa && c.credit > 0);
  const totalCredit = eligible.reduce((s, c) => s + c.credit, 0);
  if (totalCredit === 0) return 0;
  const weighted = eligible.reduce((s, c) => s + c.credit * c.gradePoint, 0);
  return round2(weighted / totalCredit);
}

/** OGPA = equal-weight mean of each level's GPA (not credit-weighted across levels). */
export function computeOgpa(levelGpas: number[]): number {
  if (levelGpas.length === 0) return 0;
  return round2(levelGpas.reduce((s, g) => s + g, 0) / levelGpas.length);
}

export function classOfAward(ogpa: number): string {
  if (ogpa >= 3.7) return "First Class";
  if (ogpa >= 3.3) return "Second Class (Upper Division)";
  if (ogpa >= 3.0) return "Second Class (Lower Division)";
  if (ogpa >= 2.0) return "Pass";
  return "Not yet classified";
}
