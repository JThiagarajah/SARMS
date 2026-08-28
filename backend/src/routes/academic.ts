import { Router } from "express";
import { db } from "../db/client";
import { requireAuth, requireRole } from "../middleware/auth";
import { computeHonoursEligibility } from "../lib/gpaService";

// Read-only reference data usable by any authenticated role (dropdowns, "my courses", etc).
// Mutations live in admin.ts (Super Admin only).
const router = Router();
router.use(requireAuth);

// Role-aware "my profile" details for the Profile page — the base account fields already come
// back from GET /auth/me, so this only adds what's specific to the signed-in user's role
// (registration/programme/level for a Student; department/designation for staff).
router.get("/my-profile", async (req, res) => {
  const user = req.user!;
  const base = (await db
    .prepare(
      `SELECT u.full_name, u.username, u.email, u.personal_email, u.role, u.created_at, d.name AS department_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = ?`
    )
    .get(user.id)) as any;

  if (user.role === "STUDENT") {
    const student = (await db
      .prepare(
        `SELECT s.registration_no, s.level, s.admission_year, p.name AS programme_name, d.name AS department_name
         FROM students s
         JOIN degree_programmes p ON p.id = s.programme_id
         JOIN departments d ON d.id = p.department_id
         WHERE s.user_id = ?`
      )
      .get(user.id)) as any;
    const honours = await computeHonoursEligibility(user.id);
    return res.json({ ...base, ...student, honours });
  }

  if (user.role === "LECTURER") {
    const lecturer = (await db.prepare("SELECT designation FROM lecturers WHERE user_id = ?").get(user.id)) as any;
    return res.json({ ...base, ...lecturer });
  }

  res.json(base);
});

router.get("/departments", async (_req, res) => {
  res.json(await db.prepare("SELECT * FROM departments ORDER BY name").all());
});

router.get("/programmes", async (req, res) => {
  const departmentId = req.query.departmentId as string | undefined;
  res.json(
    departmentId
      ? await db.prepare("SELECT * FROM degree_programmes WHERE department_id = ? ORDER BY name").all(departmentId)
      : await db.prepare("SELECT * FROM degree_programmes ORDER BY name").all()
  );
});

router.get("/courses", async (req, res) => {
  const programmeId = req.query.programmeId as string | undefined;
  res.json(
    programmeId
      ? await db.prepare("SELECT * FROM course_units WHERE programme_id = ? ORDER BY code").all(programmeId)
      : await db.prepare("SELECT * FROM course_units ORDER BY code").all()
  );
});

// Lecturer: the offerings assigned to them by the Super Admin.
router.get("/my-offerings", requireRole("LECTURER"), async (req, res) => {
  res.json(
    await db
      .prepare(
        `SELECT co.*, cu.code AS course_code, cu.name AS course_name, cu.component_type,
                cu.theory_credit, cu.practical_credit, cu.category
         FROM course_offerings co
         JOIN course_units cu ON cu.id = co.course_id
         WHERE co.lecturer_id = ?
         ORDER BY co.academic_year DESC, co.semester`
      )
      .all(req.user!.id)
  );
});

// Student: the courses they are enrolled in, with their result's lifecycle status.
router.get("/my-enrollments", requireRole("STUDENT"), async (req, res) => {
  res.json(
    await db
      .prepare(
        `SELECT e.id AS enrollment_id, co.academic_year, co.semester, cu.code AS course_code,
                cu.name AS course_name, cu.category, r.status, r.grade
         FROM enrollments e
         JOIN course_offerings co ON co.id = e.offering_id
         JOIN course_units cu ON cu.id = co.course_id
         LEFT JOIN results r ON r.enrollment_id = e.id
         WHERE e.student_id = ?
         ORDER BY co.academic_year DESC, co.semester`
      )
      .all(req.user!.id)
  );
});

// HOD / Dean / Chairman / Examination Branch: every offering in their department (or, for
// Chairman/Examination Branch, faculty-wide) for browsing into results.
router.get("/department-offerings", requireRole("HOD", "DEAN", "CHAIRMAN_EXAM_BRANCH", "EXAMINATION_BRANCH"), async (req, res) => {
  const departmentId = req.user!.departmentId;
  const rows =
    req.user!.role === "HOD" || req.user!.role === "DEAN"
      ? await db
          .prepare(
            `SELECT co.*, cu.code AS course_code, cu.name AS course_name, cu.component_type, cu.category,
                    cu.theory_credit, cu.practical_credit, u.full_name AS lecturer_name
             FROM course_offerings co
             JOIN course_units cu ON cu.id = co.course_id
             JOIN lecturers l ON l.user_id = co.lecturer_id
             JOIN users u ON u.id = co.lecturer_id
             WHERE l.department_id = ?
             ORDER BY co.academic_year DESC, co.semester`
          )
          .all(departmentId)
      : await db
          .prepare(
            `SELECT co.*, cu.code AS course_code, cu.name AS course_name, cu.component_type, cu.category,
                    cu.theory_credit, cu.practical_credit, u.full_name AS lecturer_name
             FROM course_offerings co
             JOIN course_units cu ON cu.id = co.course_id
             JOIN users u ON u.id = co.lecturer_id
             ORDER BY co.academic_year DESC, co.semester`
          )
          .all();
  res.json(rows);
});

// Staff-facing student lookup (e.g. Examination Branch searching for a certificate recipient).
router.get(
  "/students",
  requireRole("HOD", "DEAN", "CHAIRMAN_EXAM_BRANCH", "EXAMINATION_BRANCH", "SUPER_ADMIN"),
  async (req, res) => {
    const query = ((req.query.query as string) ?? "").trim();
    if (query.length < 2) return res.json([]);
    const like = `%${query}%`;
    res.json(
      await db
        .prepare(
          `SELECT s.user_id AS id, s.registration_no, u.full_name, p.name AS programme_name
           FROM students s JOIN users u ON u.id = s.user_id JOIN degree_programmes p ON p.id = s.programme_id
           WHERE s.registration_no LIKE ? OR u.full_name LIKE ?
           ORDER BY s.registration_no LIMIT 20`
        )
        .all(like, like)
    );
  }
);

export default router;
