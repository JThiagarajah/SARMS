import { db } from "../db/client";
import { DEFAULT_MARKING_SCHEME, MarkingSchemeConfig } from "./grading";

export interface FullMarkingScheme extends MarkingSchemeConfig {
  acuMinPassGrade: string;
  coreMinPassGrade: string;
  languageAcuMinPassGrade: string;
}

const DEFAULT_FULL: FullMarkingScheme = {
  ...DEFAULT_MARKING_SCHEME,
  acuMinPassGrade: "D+",
  coreMinPassGrade: "C-",
  languageAcuMinPassGrade: "C",
};

/** The active marking scheme for a department/year, falling back to the handbook defaults if
 *  the Dean/HOD haven't configured one yet for that year. Never mutates history: a Result
 *  stores its own computed m1/m2/finalMark, so changing this later doesn't touch past results. */
export async function getActiveMarkingScheme(departmentId: string, academicYear: string): Promise<FullMarkingScheme> {
  const row = await db
    .prepare(
      `SELECT * FROM marking_schemes WHERE department_id = ? AND academic_year = ? AND active = 1
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(departmentId, academicYear);
  if (!row) return DEFAULT_FULL;
  return {
    theoryEseWeight: row.theory_ese_weight,
    theoryIcaWeight: row.theory_ica_weight,
    practicalEseWeight: row.practical_ese_weight,
    practicalIcaWeight: row.practical_ica_weight,
    icaBestOfCount: row.ica_best_of_count,
    icaTotalCount: row.ica_total_count,
    acuMinPassGrade: row.acu_min_pass_grade,
    coreMinPassGrade: row.core_min_pass_grade,
    languageAcuMinPassGrade: row.language_acu_min_pass_grade,
  };
}
