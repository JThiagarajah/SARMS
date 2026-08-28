import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { requireAuth, requireRole } from "../middleware/auth";
import { computeHonoursEligibility } from "../lib/gpaService";

const router = Router();
router.use(requireAuth);

async function gpaAndOgpaFor(studentId: string) {
  const levels = await db.prepare("SELECT level, gpa_value FROM gpa_records WHERE student_id = ? ORDER BY level").all(studentId);
  const ogpa = await db.prepare("SELECT * FROM ogpa_records WHERE student_id = ?").get(studentId);
  const honours = await computeHonoursEligibility(studentId);
  return { levels, ogpa, honours };
}

router.get("/me", requireRole("STUDENT"), async (req, res) => {
  res.json(await gpaAndOgpaFor(req.user!.id));
});

router.get("/student/:studentId", requireRole("HOD", "DEAN", "CHAIRMAN_EXAM_BRANCH"), async (req, res) => {
  res.json(await gpaAndOgpaFor(req.params.studentId));
});

// "Set a target GPA and get the required average for remaining courses" (Table 3, Student).
const targetSchema = z.object({
  targetOgpa: z.number().min(0).max(4),
  totalLevels: z.number().int().min(1).max(6),
});

router.post("/target", requireRole("STUDENT"), async (req, res) => {
  const parsed = targetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "targetOgpa and totalLevels are required." });
  const { targetOgpa, totalLevels } = parsed.data;

  const completed = (await db.prepare("SELECT gpa_value FROM gpa_records WHERE student_id = ?").all(req.user!.id)) as {
    gpa_value: number;
  }[];
  const completedLevels = completed.length;
  const sumCompleted = completed.reduce((s, r) => s + r.gpa_value, 0);
  const remainingLevels = totalLevels - completedLevels;

  if (remainingLevels <= 0) {
    const currentOgpa = completedLevels > 0 ? sumCompleted / completedLevels : 0;
    return res.json({
      achievable: currentOgpa >= targetOgpa,
      message:
        currentOgpa >= targetOgpa
          ? "You have already completed all levels and met this target."
          : "You have completed all levels and did not reach this target.",
      requiredAverageGpa: null,
      currentOgpa: Math.round(currentOgpa * 100) / 100,
    });
  }

  const required = (targetOgpa * totalLevels - sumCompleted) / remainingLevels;
  res.json({
    completedLevels,
    remainingLevels,
    requiredAverageGpa: Math.round(required * 100) / 100,
    achievable: required <= 4.0,
    message:
      required > 4.0
        ? "This target is no longer mathematically achievable — the maximum possible GPA is 4.00."
        : required < 0
        ? "You have already exceeded this target based on your completed levels."
        : `You need an average GPA of ${Math.round(required * 100) / 100} across your remaining ${remainingLevels} level(s).`,
  });
});

// Anonymised batch comparison (Table 3, Student: "view an anonymised batch comparison").
router.get("/batch-comparison", requireRole("STUDENT"), async (req, res) => {
  const me = (await db.prepare("SELECT programme_id, admission_year FROM students WHERE user_id = ?").get(req.user!.id)) as any;
  if (!me) return res.status(404).json({ error: "Student record not found." });
  const cohort = (await db
    .prepare(
      `SELECT o.ogpa_value FROM ogpa_records o
       JOIN students s ON s.user_id = o.student_id
       WHERE s.programme_id = ? AND s.admission_year = ?`
    )
    .all(me.programme_id, me.admission_year)) as { ogpa_value: number }[];
  const values = cohort.map((c) => c.ogpa_value).sort((a, b) => a - b);
  const mine = ((await db.prepare("SELECT ogpa_value FROM ogpa_records WHERE student_id = ?").get(req.user!.id)) as any)?.ogpa_value;
  const rank = mine != null ? values.filter((v) => v > mine).length + 1 : null;
  res.json({
    cohortSize: values.length,
    average: values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100 : null,
    highest: values.length ? values[values.length - 1] : null,
    lowest: values.length ? values[0] : null,
    myOgpa: mine ?? null,
    myRankFromTop: rank,
  });
});

// Dean's / HOD's read-only department report — the Dean's dashboard is built around this,
// since Dean has no edit/approve/release action anywhere in the workflow.
router.get("/department-report", requireRole("DEAN", "HOD"), async (req, res) => {
  const departmentId = req.user!.departmentId;
  if (!departmentId) return res.status(400).json({ error: "Your account has no department linked." });

  const statusCounts = await db
    .prepare(
      `SELECT r.status AS status, COUNT(*) AS count
       FROM results r
       JOIN enrollments e ON e.id = r.enrollment_id
       JOIN course_offerings co ON co.id = e.offering_id
       JOIN lecturers l ON l.user_id = co.lecturer_id
       WHERE l.department_id = ?
       GROUP BY r.status`
    )
    .all(departmentId);

  const gradeDistribution = await db
    .prepare(
      `SELECT r.grade AS grade, COUNT(*) AS count
       FROM results r
       JOIN enrollments e ON e.id = r.enrollment_id
       JOIN course_offerings co ON co.id = e.offering_id
       JOIN lecturers l ON l.user_id = co.lecturer_id
       WHERE l.department_id = ? AND r.status = 'RELEASED'
       GROUP BY r.grade
       ORDER BY r.grade`
    )
    .all(departmentId);

  const pendingCorrections = (await db
    .prepare(
      `SELECT COUNT(*) AS c FROM correction_requests cr
       JOIN results r ON r.id = cr.result_id
       JOIN enrollments e ON e.id = r.enrollment_id
       JOIN course_offerings co ON co.id = e.offering_id
       JOIN lecturers l ON l.user_id = co.lecturer_id
       WHERE l.department_id = ? AND cr.status = 'PENDING'`
    )
    .get(departmentId)) as { c: number };

  res.json({ statusCounts, gradeDistribution, pendingCorrections: pendingCorrections.c });
});

export default router;
