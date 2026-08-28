import { Router } from "express";
import { z } from "zod";
import { db, newId, nowIso, transaction } from "../db/client";
import { requireAuth, requireRole } from "../middleware/auth";
import { createUserAccount } from "../lib/userAccounts";
import { generateOneTimePassword, hashPassword } from "../lib/auth";
import { logActivity } from "../lib/activityLog";
import { ALL_ROLES } from "../lib/types";

const router = Router();

// Every route in this file is Super Admin only: system/organisation administration, deliberately
// walled off from every grade-bearing table (results, ica_marks, corrections, gpa/ogpa).
router.use(requireAuth, requireRole("SUPER_ADMIN"));

function badRequest(res: any, issue?: string) {
  return res.status(400).json({ error: issue ?? "Invalid request." });
}

// Postgres reports a foreign-key violation as error code 23503 (foreign_key_violation) —
// this is the equivalent of the "FOREIGN KEY constraint failed" message SQLite used to throw.
function isForeignKeyViolation(e: any): boolean {
  return e?.code === "23503";
}

// --- Departments -----------------------------------------------------------
const deptSchema = z.object({ name: z.string().min(1), faculty: z.string().min(1) });

router.get("/departments", async (_req, res) => {
  res.json(await db.prepare("SELECT * FROM departments ORDER BY name").all());
});

router.post("/departments", async (req, res) => {
  const parsed = deptSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message);
  const id = newId();
  try {
    await db.prepare("INSERT INTO departments (id, name, faculty) VALUES (?, ?, ?)").run(
      id,
      parsed.data.name,
      parsed.data.faculty
    );
  } catch {
    return badRequest(res, `A department named "${parsed.data.name}" already exists.`);
  }
  await logActivity(req.user!.id, "CREATE", "Department", id);
  res.status(201).json({ id, ...parsed.data });
});

router.patch("/departments/:id", async (req, res) => {
  const existing = await db.prepare("SELECT * FROM departments WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Department not found." });
  const parsed = deptSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message);
  try {
    await db.prepare("UPDATE departments SET name = ?, faculty = ? WHERE id = ?").run(
      parsed.data.name,
      parsed.data.faculty,
      req.params.id
    );
  } catch {
    return badRequest(res, `A department named "${parsed.data.name}" already exists.`);
  }
  await logActivity(req.user!.id, "UPDATE", "Department", req.params.id);
  res.json({ id: req.params.id, ...parsed.data });
});

router.delete("/departments/:id", async (req, res) => {
  const existing = await db.prepare("SELECT * FROM departments WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Department not found." });
  const programmeCount = (await db
    .prepare("SELECT COUNT(*) AS c FROM degree_programmes WHERE department_id = ?")
    .get(req.params.id)) as { c: number };
  const staffCount = (await db.prepare("SELECT COUNT(*) AS c FROM users WHERE department_id = ?").get(req.params.id)) as {
    c: number;
  };
  if (programmeCount.c > 0 || staffCount.c > 0) {
    return badRequest(
      res,
      "Cannot delete a department with programmes or staff still linked to it — move or remove those first."
    );
  }
  await db.prepare("DELETE FROM departments WHERE id = ?").run(req.params.id);
  await logActivity(req.user!.id, "DELETE", "Department", req.params.id);
  res.json({ ok: true });
});

// --- Degree Programmes -------------------------------------------------------
const programmeSchema = z.object({
  name: z.string().min(1),
  departmentId: z.string().min(1),
  honoursFlag: z.boolean().optional(),
});

router.get("/programmes", async (_req, res) => {
  res.json(await db.prepare("SELECT * FROM degree_programmes ORDER BY name").all());
});

router.post("/programmes", async (req, res) => {
  const parsed = programmeSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message);
  const id = newId();
  try {
    await db.prepare(
      "INSERT INTO degree_programmes (id, name, department_id, honours_flag) VALUES (?, ?, ?, ?)"
    ).run(id, parsed.data.name, parsed.data.departmentId, parsed.data.honoursFlag ? 1 : 0);
  } catch {
    return badRequest(res, `A programme named "${parsed.data.name}" already exists in that department.`);
  }
  await logActivity(req.user!.id, "CREATE", "DegreeProgramme", id);
  res.status(201).json({ id, ...parsed.data });
});

router.patch("/programmes/:id", async (req, res) => {
  const existing = await db.prepare("SELECT * FROM degree_programmes WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Programme not found." });
  const parsed = programmeSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message);
  try {
    await db.prepare(
      "UPDATE degree_programmes SET name = ?, department_id = ?, honours_flag = ? WHERE id = ?"
    ).run(parsed.data.name, parsed.data.departmentId, parsed.data.honoursFlag ? 1 : 0, req.params.id);
  } catch {
    return badRequest(res, `A programme named "${parsed.data.name}" already exists in that department.`);
  }
  await logActivity(req.user!.id, "UPDATE", "DegreeProgramme", req.params.id);
  res.json({ id: req.params.id, ...parsed.data });
});

router.delete("/programmes/:id", async (req, res) => {
  const existing = await db.prepare("SELECT * FROM degree_programmes WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Programme not found." });
  const courseCount = (await db
    .prepare("SELECT COUNT(*) AS c FROM course_units WHERE programme_id = ?")
    .get(req.params.id)) as { c: number };
  const studentCount = (await db
    .prepare("SELECT COUNT(*) AS c FROM students WHERE programme_id = ?")
    .get(req.params.id)) as { c: number };
  if (courseCount.c > 0 || studentCount.c > 0) {
    return badRequest(
      res,
      "Cannot delete a programme with course units or students still linked to it — move or remove those first."
    );
  }
  await db.prepare("DELETE FROM degree_programmes WHERE id = ?").run(req.params.id);
  await logActivity(req.user!.id, "DELETE", "DegreeProgramme", req.params.id);
  res.json({ ok: true });
});

// --- Course Units ------------------------------------------------------------
const courseSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  theoryCredit: z.number().min(0).default(0),
  practicalCredit: z.number().min(0).default(0),
  category: z.enum(["CORE", "ELECTIVE", "ACU"]).default("CORE"),
  componentType: z.enum(["THEORY_ONLY", "PRACTICAL_ONLY", "BOTH"]).default("THEORY_ONLY"),
  programmeId: z.string().min(1),
  level: z.number().int().min(1).max(4),
  semester: z.number().int().min(1).max(2),
});

router.get("/courses", async (_req, res) => {
  res.json(await db.prepare("SELECT * FROM course_units ORDER BY code").all());
});

router.post("/courses", async (req, res) => {
  const parsed = courseSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message);
  const d = parsed.data;
  const id = newId();
  try {
    await db.prepare(
      `INSERT INTO course_units (id, code, name, theory_credit, practical_credit, category, component_type, programme_id, level, semester)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, d.code, d.name, d.theoryCredit, d.practicalCredit, d.category, d.componentType, d.programmeId, d.level, d.semester);
  } catch {
    return badRequest(res, `A course unit with code "${d.code}" already exists.`);
  }
  await logActivity(req.user!.id, "CREATE", "CourseUnit", id);
  res.status(201).json({ id, ...d });
});

router.patch("/courses/:id", async (req, res) => {
  const existing = await db.prepare("SELECT * FROM course_units WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Course unit not found." });
  const hasOfferings = (await db
    .prepare("SELECT COUNT(*) AS c FROM course_offerings WHERE course_id = ?")
    .get(req.params.id)) as { c: number };
  const parsed = courseSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message);
  const d = parsed.data;
  if (hasOfferings.c > 0 && d.componentType !== (existing as any).component_type) {
    return badRequest(
      res,
      "Cannot change the component type of a course unit that already has offerings — this would invalidate marks already entered against it."
    );
  }
  try {
    await db.prepare(
      `UPDATE course_units SET code = ?, name = ?, theory_credit = ?, practical_credit = ?, category = ?,
       component_type = ?, programme_id = ?, level = ?, semester = ? WHERE id = ?`
    ).run(d.code, d.name, d.theoryCredit, d.practicalCredit, d.category, d.componentType, d.programmeId, d.level, d.semester, req.params.id);
  } catch {
    return badRequest(res, `A course unit with code "${d.code}" already exists.`);
  }
  await logActivity(req.user!.id, "UPDATE", "CourseUnit", req.params.id);
  res.json({ id: req.params.id, ...d });
});

router.delete("/courses/:id", async (req, res) => {
  const existing = await db.prepare("SELECT * FROM course_units WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Course unit not found." });
  const offeringCount = (await db
    .prepare("SELECT COUNT(*) AS c FROM course_offerings WHERE course_id = ?")
    .get(req.params.id)) as { c: number };
  if (offeringCount.c > 0) {
    return badRequest(res, "Cannot delete a course unit that has course offerings — remove those offerings first.");
  }
  await db.prepare("DELETE FROM course_units WHERE id = ?").run(req.params.id);
  await logActivity(req.user!.id, "DELETE", "CourseUnit", req.params.id);
  res.json({ ok: true });
});

// --- Course Offerings (lecturer assignment — Super Admin's exclusive authority) --------------
const offeringSchema = z.object({
  courseId: z.string().min(1),
  lecturerId: z.string().min(1), // Lecturer's user id
  academicYear: z.string().min(1),
  semester: z.number().int().min(1).max(2),
});

router.get("/offerings", async (_req, res) => {
  res.json(
    await db
      .prepare(
        `SELECT co.*, cu.code AS course_code, cu.name AS course_name, u.full_name AS lecturer_name
         FROM course_offerings co
         JOIN course_units cu ON cu.id = co.course_id
         JOIN users u ON u.id = co.lecturer_id
         ORDER BY co.academic_year DESC, co.semester`
      )
      .all()
  );
});

router.post("/offerings", async (req, res) => {
  const parsed = offeringSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message);
  const d = parsed.data;
  const lecturer = await db.prepare("SELECT * FROM lecturers WHERE user_id = ?").get(d.lecturerId);
  if (!lecturer) return badRequest(res, "That user is not registered as a Lecturer.");
  const id = newId();
  try {
    await db.prepare(
      `INSERT INTO course_offerings (id, course_id, lecturer_id, academic_year, semester, assigned_by_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, d.courseId, d.lecturerId, d.academicYear, d.semester, req.user!.id, nowIso());
  } catch (e: any) {
    return badRequest(res, "This course already has an offering for that academic year & semester.");
  }
  await logActivity(req.user!.id, "ASSIGN_LECTURER", "CourseOffering", id, { lecturerId: d.lecturerId });
  res.status(201).json({ id, ...d });
});

router.delete("/offerings/:id", async (req, res) => {
  const offering = await db.prepare("SELECT * FROM course_offerings WHERE id = ?").get(req.params.id);
  if (!offering) return res.status(404).json({ error: "Offering not found." });
  const enrollCount = (await db
    .prepare("SELECT COUNT(*) AS c FROM enrollments WHERE offering_id = ?")
    .get(req.params.id)) as { c: number };
  if (enrollCount.c > 0) {
    return badRequest(res, "Cannot remove an offering with active enrolments — remove students first.");
  }
  await db.prepare("DELETE FROM course_offerings WHERE id = ?").run(req.params.id);
  await logActivity(req.user!.id, "UNASSIGN_LECTURER", "CourseOffering", req.params.id);
  res.json({ ok: true });
});

// --- Enrollments -------------------------------------------------------------
const enrollSchema = z.object({ studentId: z.string().min(1), offeringId: z.string().min(1) });

router.get("/enrollments", async (req, res) => {
  const offeringId = req.query.offeringId as string | undefined;
  if (offeringId) {
    return res.json(
      await db
        .prepare(
          `SELECT e.*, u.full_name AS student_name, s.registration_no
           FROM enrollments e
           JOIN students s ON s.user_id = e.student_id
           JOIN users u ON u.id = s.user_id
           WHERE e.offering_id = ?`
        )
        .all(offeringId)
    );
  }
  res.json(await db.prepare("SELECT * FROM enrollments").all());
});

router.post("/enrollments", async (req, res) => {
  const parsed = enrollSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message);
  const d = parsed.data;
  const student = await db.prepare("SELECT * FROM students WHERE user_id = ?").get(d.studentId);
  if (!student) return badRequest(res, "That user is not registered as a Student.");

  try {
    const result = await transaction(async () => {
      const enrollmentId = newId();
      await db.prepare(
        `INSERT INTO enrollments (id, student_id, offering_id, enrolled_by_id, enrolled_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(enrollmentId, d.studentId, d.offeringId, req.user!.id, nowIso());

      // A Result row is created up front in ICA_OPEN status — this is what the lecturer's
      // ICA-entry and final-marks-submission workflow operates on.
      const now = nowIso();
      await db.prepare(
        `INSERT INTO results (id, enrollment_id, status, created_at, updated_at)
         VALUES (?, ?, 'ICA_OPEN', ?, ?)`
      ).run(newId(), enrollmentId, now, now);

      return enrollmentId;
    });
    await logActivity(req.user!.id, "ENROLL", "Enrollment", result);
    res.status(201).json({ id: result, ...d });
  } catch {
    return badRequest(res, "That student is already enrolled in this course offering.");
  }
});

router.delete("/enrollments/:id", async (req, res) => {
  const enrollment = await db.prepare("SELECT * FROM enrollments WHERE id = ?").get(req.params.id);
  if (!enrollment) return res.status(404).json({ error: "Enrollment not found." });
  const result = (await db
    .prepare("SELECT * FROM results WHERE enrollment_id = ?")
    .get(req.params.id)) as { status: string } | undefined;
  if (result && result.status !== "ICA_OPEN") {
    return badRequest(res, "Cannot remove an enrolment once marks have been submitted for it.");
  }
  await transaction(async () => {
    await db.prepare("DELETE FROM results WHERE enrollment_id = ?").run(req.params.id);
    await db.prepare("DELETE FROM enrollments WHERE id = ?").run(req.params.id);
  });
  await logActivity(req.user!.id, "UNENROLL", "Enrollment", req.params.id);
  res.json({ ok: true });
});

// --- User / account management -----------------------------------------------
const staffAccountSchema = z.object({
  username: z.string().min(3),
  fullName: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["LECTURER", "HOD", "DEAN", "CHAIRMAN_EXAM_BRANCH", "EXAMINATION_BRANCH", "SUPER_ADMIN"]),
  departmentId: z.string().optional(),
  designation: z.string().optional(),
  password: z.string().min(8).optional(),
  // Personal email on file for "forgot password" — optional; only that flow reads it.
  personalEmail: z.string().email().optional().or(z.literal("")),
});

router.get("/users", async (req, res) => {
  const role = req.query.role as string | undefined;
  const rows = role
    ? await db
        .prepare(
          `SELECT u.id, u.username, u.full_name, u.email, u.personal_email, u.role, u.department_id, u.active, s.registration_no
           FROM users u LEFT JOIN students s ON s.user_id = u.id
           WHERE u.role = ? ORDER BY u.full_name`
        )
        .all(role)
    : await db
        .prepare(
          `SELECT u.id, u.username, u.full_name, u.email, u.personal_email, u.role, u.department_id, u.active, s.registration_no
           FROM users u LEFT JOIN students s ON s.user_id = u.id
           ORDER BY u.role, u.full_name`
        )
        .all();
  res.json(rows);
});

router.post("/users", async (req, res) => {
  const parsed = staffAccountSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message);
  const d = parsed.data;
  if ((d.role === "LECTURER" || d.role === "HOD" || d.role === "DEAN") && !d.departmentId) {
    return badRequest(res, `${d.role} accounts must be linked to a department.`);
  }
  try {
    // Frontend always sends departmentId as "" (never undefined) for roles that don't need one —
    // "" is truthy-string-but-falsy-value, so `|| null` (not `?? null`) is required here, or an
    // empty string gets inserted as a literal department_id and trips the foreign-key constraint,
    // which used to get mislabeled below as "username or email already in use".
    const { id, generatedPassword } = await createUserAccount({
      username: d.username,
      fullName: d.fullName,
      email: d.email,
      role: d.role,
      departmentId: d.departmentId || null,
      password: d.password,
      personalEmail: d.personalEmail || null,
    });
    if (d.role === "LECTURER") {
      await db.prepare("INSERT INTO lecturers (user_id, department_id, designation) VALUES (?, ?, ?)").run(
        id,
        d.departmentId || null,
        d.designation ?? null
      );
    }
    await logActivity(req.user!.id, "GRANT_ACCESS", "User", id, { role: d.role });
    res.status(201).json({ id, generatedPassword });
  } catch (e: any) {
    if (isForeignKeyViolation(e)) {
      return badRequest(res, "The selected department no longer exists — refresh and pick a department again.");
    }
    return badRequest(res, "That username or email is already in use.");
  }
});

const studentAccountSchema = z.object({
  username: z.string().min(3),
  fullName: z.string().min(1),
  email: z.string().email(),
  registrationNo: z.string().min(1),
  programmeId: z.string().min(1),
  level: z.number().int().min(1).max(4),
  admissionYear: z.number().int(),
  password: z.string().min(8).optional(),
  personalEmail: z.string().email().optional().or(z.literal("")),
});

router.post("/students", async (req, res) => {
  const parsed = studentAccountSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message);
  const d = parsed.data;
  try {
    const { id, generatedPassword } = await createUserAccount({
      username: d.username,
      fullName: d.fullName,
      email: d.email,
      role: "STUDENT",
      password: d.password,
      personalEmail: d.personalEmail || null,
    });
    await db.prepare(
      "INSERT INTO students (user_id, registration_no, programme_id, level, admission_year) VALUES (?, ?, ?, ?, ?)"
    ).run(id, d.registrationNo, d.programmeId, d.level, d.admissionYear);
    await logActivity(req.user!.id, "CREATE", "Student", id);
    res.status(201).json({ id, generatedPassword });
  } catch {
    return badRequest(res, "That username, email or registration number is already in use.");
  }
});

router.patch("/users/:id/active", async (req, res) => {
  const schema = z.object({ active: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);
  await db.prepare("UPDATE users SET active = ? WHERE id = ?").run(parsed.data.active ? 1 : 0, req.params.id);
  await logActivity(req.user!.id, parsed.data.active ? "REACTIVATE" : "DEACTIVATE", "User", req.params.id);
  res.json({ ok: true });
});

// Issues a brand-new one-time password for an account whose original one was lost (e.g. the
// admin refreshed the page before writing it down or downloading the PDF). The old password's
// hash is simply overwritten — there is no way to recover what it was, by design — and the
// account is put back into "must change password on first login" state, same as a fresh account.
router.post("/users/:id/reset-password", async (req, res) => {
  const user = (await db.prepare("SELECT id, username FROM users WHERE id = ?").get(req.params.id)) as
    | { id: string; username: string }
    | undefined;
  if (!user) return res.status(404).json({ error: "Account not found." });
  const newPassword = generateOneTimePassword();
  await db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?").run(
    hashPassword(newPassword),
    req.params.id
  );
  await logActivity(req.user!.id, "RESET_PASSWORD", "User", req.params.id);
  res.json({ generatedPassword: newPassword });
});

// Deletes an account outright — only permitted while nothing else in the system references it
// yet (no marks entered, no offerings assigned, no logged actions, etc.). PostgreSQL's own
// foreign-key enforcement is the real backstop here (every table that could reference a user does
// so via a REFERENCES users(id) with no cascade except students/lecturers/password_resets), so
// this route just attempts the delete and turns a constraint failure into a plain-language
// explanation instead of a raw database error. An account with real history should be
// deactivated, not deleted.
router.delete("/users/:id", async (req, res) => {
  if (req.params.id === req.user!.id) {
    return badRequest(res, "You can't delete the account you're currently signed in as.");
  }
  const user = await db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "Account not found." });
  try {
    await db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  } catch (e: any) {
    if (isForeignKeyViolation(e)) {
      return badRequest(
        res,
        "This account already has activity tied to it (marks, offerings, enrolments, or logged actions) — deactivate it instead of deleting."
      );
    }
    return res.status(500).json({ error: "Could not delete this account." });
  }
  await logActivity(req.user!.id, "DELETE", "User", req.params.id);
  res.json({ ok: true });
});

// Sets/updates the personal (recovery) email used by the forgot-password flow — separate from the
// institutional `email` column, which stays as the account's primary contact address.
router.patch("/users/:id/personal-email", async (req, res) => {
  const schema = z.object({ personalEmail: z.string().email().optional().or(z.literal("")) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, "Enter a valid email address, or leave it blank to clear it.");
  await db.prepare("UPDATE users SET personal_email = ? WHERE id = ?").run(parsed.data.personalEmail || null, req.params.id);
  await logActivity(req.user!.id, "UPDATE_PERSONAL_EMAIL", "User", req.params.id);
  res.json({ ok: true });
});

// --- Activity log --------------------------------------------------------------
router.get("/activity-log", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 200), 1000);
  res.json(
    await db
      .prepare(
        `SELECT a.*, u.full_name AS user_name, u.role AS user_role
         FROM activity_log a JOIN users u ON u.id = a.user_id
         ORDER BY a.timestamp DESC LIMIT ?`
      )
      .all(limit)
  );
});

router.get("/roles", (_req, res) => res.json(ALL_ROLES));

export default router;
