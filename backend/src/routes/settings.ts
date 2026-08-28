import { Router } from "express";
import { z } from "zod";
import { db, newId, nowIso } from "../db/client";
import { requireAuth, requireRole } from "../middleware/auth";
import { logActivity } from "../lib/activityLog";

// Curriculum & marking-scheme settings — owned by Dean or HOD ("academic leadership"), per the
// user's explicit decision to keep the Super Admin walled off from grading logic entirely.
// Versioned by (department, academicYear): a result computed under a prior year's scheme keeps
// showing the formula that was in effect, because Result stores its own computed m1/m2/finalMark.
const router = Router();
router.use(requireAuth, requireRole("DEAN", "HOD"));

router.get("/marking-schemes", async (req, res) => {
  const departmentId = req.user!.departmentId;
  if (!departmentId) return res.status(400).json({ error: "Your account has no department linked." });
  res.json(
    await db.prepare("SELECT * FROM marking_schemes WHERE department_id = ? ORDER BY academic_year DESC").all(departmentId)
  );
});

const schemeSchema = z.object({
  academicYear: z.string().min(1),
  theoryEseWeight: z.number().min(0).max(1),
  theoryIcaWeight: z.number().min(0).max(1),
  practicalEseWeight: z.number().min(0).max(1),
  practicalIcaWeight: z.number().min(0).max(1),
  icaBestOfCount: z.number().int().min(1),
  icaTotalCount: z.number().int().min(1),
  acuMinPassGrade: z.string().min(1),
  coreMinPassGrade: z.string().min(1),
  languageAcuMinPassGrade: z.string().min(1),
});

router.put("/marking-schemes", async (req, res) => {
  const departmentId = req.user!.departmentId;
  if (!departmentId) return res.status(400).json({ error: "Your account has no department linked." });
  const parsed = schemeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
  const d = parsed.data;

  if (Math.abs(d.theoryEseWeight + d.theoryIcaWeight - 1) > 1e-6) {
    return res.status(400).json({ error: "Theory ESE + ICA weights must sum to 1." });
  }
  if (Math.abs(d.practicalEseWeight + d.practicalIcaWeight - 1) > 1e-6) {
    return res.status(400).json({ error: "Practical ESE + ICA weights must sum to 1." });
  }

  const existing = (await db
    .prepare("SELECT id FROM marking_schemes WHERE department_id = ? AND academic_year = ?")
    .get(departmentId, d.academicYear)) as { id: string } | undefined;

  if (existing) {
    await db.prepare(
      `UPDATE marking_schemes SET theory_ese_weight=?, theory_ica_weight=?, practical_ese_weight=?, practical_ica_weight=?,
       ica_best_of_count=?, ica_total_count=?, acu_min_pass_grade=?, core_min_pass_grade=?, language_acu_min_pass_grade=?
       WHERE id = ?`
    ).run(
      d.theoryEseWeight, d.theoryIcaWeight, d.practicalEseWeight, d.practicalIcaWeight,
      d.icaBestOfCount, d.icaTotalCount, d.acuMinPassGrade, d.coreMinPassGrade, d.languageAcuMinPassGrade,
      existing.id
    );
    await logActivity(req.user!.id, "UPDATE", "MarkingScheme", existing.id);
    return res.json({ id: existing.id, ...d });
  }

  const id = newId();
  await db.prepare(
    `INSERT INTO marking_schemes (id, department_id, academic_year, theory_ese_weight, theory_ica_weight,
     practical_ese_weight, practical_ica_weight, ica_best_of_count, ica_total_count, acu_min_pass_grade,
     core_min_pass_grade, language_acu_min_pass_grade, active, created_by_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    id, departmentId, d.academicYear, d.theoryEseWeight, d.theoryIcaWeight, d.practicalEseWeight, d.practicalIcaWeight,
    d.icaBestOfCount, d.icaTotalCount, d.acuMinPassGrade, d.coreMinPassGrade, d.languageAcuMinPassGrade,
    req.user!.id, nowIso()
  );
  await logActivity(req.user!.id, "CREATE", "MarkingScheme", id);
  res.status(201).json({ id, ...d });
});

export default router;
