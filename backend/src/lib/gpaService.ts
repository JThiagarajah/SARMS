import { db, newId, nowIso } from "../db/client";
import { computeGpa, computeOgpa, classOfAward } from "./grading";

// GPA threshold for the "Special/Honours" track eligibility flag (Level 4, honours programmes
// only). This is deliberately a computed, read-only flag — nothing else in the system gates on
// it yet (no separate course structure or grading table), it just surfaces the eligibility so
// the student, HOD and Dean can see it. See README for the reasoning.
const HONOURS_GPA_THRESHOLD = 3.0;

export type HonoursEligibility =
  | { applicable: false }
  | { applicable: true; eligible: boolean; ogpa: number | null; threshold: number };

/** Computed on the fly from the student's current level, their programme's honours_flag, and
 *  their OGPA so far (which — since OGPA is recomputed from every RELEASED result the student
 *  has to date — already reflects everything up through their most recently completed level). */
export async function computeHonoursEligibility(studentId: string): Promise<HonoursEligibility> {
  const student = (await db
    .prepare(
      `SELECT s.level AS level, p.honours_flag AS "honoursFlag"
       FROM students s JOIN degree_programmes p ON p.id = s.programme_id
       WHERE s.user_id = ?`
    )
    .get(studentId)) as { level: number; honoursFlag: number } | undefined;

  if (!student || !student.honoursFlag || student.level < 4) {
    return { applicable: false };
  }

  const ogpaRow = (await db.prepare("SELECT ogpa_value FROM ogpa_records WHERE student_id = ?").get(studentId)) as
    | { ogpa_value: number }
    | undefined;
  const ogpa = ogpaRow?.ogpa_value ?? null;

  return {
    applicable: true,
    eligible: ogpa != null && ogpa >= HONOURS_GPA_THRESHOLD,
    ogpa,
    threshold: HONOURS_GPA_THRESHOLD,
  };
}

/** Recomputes and stores a student's per-level GPA and overall OGPA from every RELEASED
 *  result they currently have. Called whenever a Result transitions to RELEASED. ACU course
 *  units (which in this implementation also stand in for Industrial Training units) are
 *  excluded from both, per the handbook rule. */
export async function recomputeGpaForStudent(studentId: string): Promise<void> {
  const rows = (await db
    .prepare(
      `SELECT r.grade_point AS "gradePoint", cu.theory_credit + cu.practical_credit AS credit,
              cu.category AS category, cu.level AS level
       FROM results r
       JOIN enrollments e ON e.id = r.enrollment_id
       JOIN course_offerings co ON co.id = e.offering_id
       JOIN course_units cu ON cu.id = co.course_id
       WHERE e.student_id = ? AND r.status = 'RELEASED' AND r.grade_point IS NOT NULL`
    )
    .all(studentId)) as { gradePoint: number; credit: number; category: string; level: number }[];

  const byLevel = new Map<number, typeof rows>();
  for (const row of rows) {
    if (!byLevel.has(row.level)) byLevel.set(row.level, []);
    byLevel.get(row.level)!.push(row);
  }

  const levelGpas: number[] = [];
  for (const [level, levelRows] of byLevel.entries()) {
    const gpa = computeGpa(
      levelRows.map((r) => ({ credit: r.credit, gradePoint: r.gradePoint, excludeFromGpa: r.category === "ACU" }))
    );
    levelGpas.push(gpa);
    const existing = (await db.prepare("SELECT id FROM gpa_records WHERE student_id = ? AND level = ?").get(studentId, level)) as
      | { id: string }
      | undefined;
    if (existing) {
      await db.prepare("UPDATE gpa_records SET gpa_value = ?, computed_at = ? WHERE id = ?").run(gpa, nowIso(), existing.id);
    } else {
      await db.prepare(
        "INSERT INTO gpa_records (id, student_id, level, gpa_value, computed_at) VALUES (?, ?, ?, ?, ?)"
      ).run(newId(), studentId, level, gpa, nowIso());
    }
  }

  const ogpa = computeOgpa(levelGpas);
  const award = classOfAward(ogpa);
  const existingOgpa = (await db.prepare("SELECT id FROM ogpa_records WHERE student_id = ?").get(studentId)) as
    | { id: string }
    | undefined;
  if (existingOgpa) {
    await db.prepare("UPDATE ogpa_records SET ogpa_value = ?, class_of_award = ?, computed_at = ? WHERE id = ?").run(
      ogpa,
      award,
      nowIso(),
      existingOgpa.id
    );
  } else {
    await db.prepare(
      "INSERT INTO ogpa_records (id, student_id, ogpa_value, class_of_award, computed_at) VALUES (?, ?, ?, ?, ?)"
    ).run(newId(), studentId, ogpa, award, nowIso());
  }
}
