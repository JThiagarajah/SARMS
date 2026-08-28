import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { db, newId, nowIso, transaction } from "../db/client";
import { requireAuth, requireRole } from "../middleware/auth";
import { logActivity } from "../lib/activityLog";
import { getActiveMarkingScheme } from "../lib/markingScheme";
import { computeM1, computeM2, computeFinalResult, ComponentType } from "../lib/grading";
import { recomputeGpaForStudent } from "../lib/gpaService";
import { getOfferingContext as lookupOfferingContext } from "../lib/offeringAccess";
import { parseWorkbookRows, cell, sendWorkbook, requireColumns } from "../lib/excel";

const router = Router();
router.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function fail(status: number, message: string): never {
  throw { status, message };
}

async function handle(res: any, fn: () => Promise<void> | void) {
  try {
    await fn();
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message ?? "Internal server error." });
  }
}

interface OfferingContext {
  offering: any;
  course: any;
  lecturerDepartmentId: string;
}

async function getOfferingContext(offeringId: string): Promise<OfferingContext> {
  const ctx = await lookupOfferingContext(offeringId);
  if (!ctx.offering) fail(404, "Course offering not found.");
  return ctx;
}

async function recordVersion(resultId: string, field: string, oldValue: unknown, newValue: unknown, userId: string) {
  await db.prepare(
    `INSERT INTO result_versions (id, result_id, field_changed, old_value, new_value, changed_by_id, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(newId(), resultId, field, oldValue == null ? null : String(oldValue), newValue == null ? null : String(newValue), userId, nowIso());
}

// ---------------------------------------------------------------------------------------------
// GET /offerings/:offeringId — role-scoped visibility over an offering's results.
// ---------------------------------------------------------------------------------------------
router.get("/offerings/:offeringId", requireRole("LECTURER", "HOD", "DEAN", "CHAIRMAN_EXAM_BRANCH", "EXAMINATION_BRANCH"), (req, res) =>
  handle(res, async () => {
    const { offering, lecturerDepartmentId } = await getOfferingContext(req.params.offeringId);
    const role = req.user!.role;

    if (role === "LECTURER" && offering.lecturer_id !== req.user!.id) {
      fail(403, "You are not the lecturer assigned to this course offering.");
    }
    if ((role === "HOD" || role === "DEAN") && req.user!.departmentId !== lecturerDepartmentId) {
      fail(403, "This course offering belongs to a different department.");
    }

    const rows = (await db
      .prepare(
        `SELECT r.*, e.id AS enrollment_id, s.registration_no, u.full_name AS student_name
         FROM enrollments e
         JOIN results r ON r.enrollment_id = e.id
         JOIN students s ON s.user_id = e.student_id
         JOIN users u ON u.id = s.user_id
         WHERE e.offering_id = ?
         ORDER BY s.registration_no`
      )
      .all(req.params.offeringId)) as any[];

    // HOD/Dean only see a course once the lecturer has submitted; Chairman only sees
    // HOD-approved-or-later; Examination Branch only sees released results.
    const visible = rows.filter((r) => {
      if (role === "LECTURER") return true;
      if (role === "HOD" || role === "DEAN") return r.status !== "ICA_OPEN";
      if (role === "CHAIRMAN_EXAM_BRANCH") return r.status === "HOD_APPROVED" || r.status === "RELEASED";
      if (role === "EXAMINATION_BRANCH") return r.status === "RELEASED";
      return false;
    });

    res.json(visible);
  })
);

// ---------------------------------------------------------------------------------------------
// POST /offerings/:offeringId/submit — Lecturer submits final marks for every enrolled student
// at once. Computes M1/M2/Final Result server-side from ICA marks + the ESE marks supplied here.
// ---------------------------------------------------------------------------------------------
const submitSchema = z.object({
  entries: z.array(
    z.object({
      enrollmentId: z.string().min(1),
      eseTheory: z.number().min(0).max(100).optional(),
      esePractical: z.number().min(0).max(100).optional(),
    })
  ).min(1),
});

interface SubmitEntry {
  enrollmentId: string;
  eseTheory?: number;
  esePractical?: number;
}

/** Shared by the JSON submit route and the bulk-Excel-upload route: validates and computes
 *  M1/M2/Final Result for each entry and moves its Result to SUBMITTED. Throws {status,message}
 *  (via `fail`) on the first hard error — used by the strict JSON path; the bulk-upload path
 *  wraps each entry individually instead (see below) so one bad row doesn't sink the batch. */
async function submitOneEntry(
  offeringId: string,
  course: any,
  scheme: Awaited<ReturnType<typeof getActiveMarkingScheme>>,
  entry: SubmitEntry,
  userId: string
) {
  const result = (await db.prepare("SELECT * FROM results WHERE enrollment_id = ?").get(entry.enrollmentId)) as any;
  if (!result) fail(404, `No result row for enrollment ${entry.enrollmentId}.`);
  if (result.status !== "ICA_OPEN") fail(403, "Final marks have already been submitted for this course.");

  const enrollment = (await db.prepare("SELECT * FROM enrollments WHERE id = ?").get(entry.enrollmentId)) as any;
  const studentId = enrollment.student_id;
  const componentType = course.component_type as ComponentType;

  const icaTheory = (await db
    .prepare(
      `SELECT im.mark, ii.max_marks AS "maxMarks" FROM ica_marks im
       JOIN ica_instruments ii ON ii.id = im.instrument_id
       WHERE ii.offering_id = ? AND ii.component = 'THEORY' AND im.student_id = ?`
    )
    .all(offeringId, studentId)) as { mark: number; maxMarks: number }[];
  const icaPractical = (await db
    .prepare(
      `SELECT im.mark, ii.max_marks AS "maxMarks" FROM ica_marks im
       JOIN ica_instruments ii ON ii.id = im.instrument_id
       WHERE ii.offering_id = ? AND ii.component = 'PRACTICAL' AND im.student_id = ?`
    )
    .all(offeringId, studentId)) as { mark: number; maxMarks: number }[];

  const m1 = componentType !== "PRACTICAL_ONLY" ? computeM1(entry.eseTheory!, icaTheory, scheme) : null;
  const m2 = componentType !== "THEORY_ONLY" ? computeM2(entry.esePractical!, icaPractical, scheme) : null;
  const final = computeFinalResult({
    componentType,
    m1,
    m2,
    theoryCredit: course.theory_credit,
    practicalCredit: course.practical_credit,
  });

  const now = nowIso();
  await db.prepare(
    `UPDATE results SET ese_theory = ?, ese_practical = ?, m1 = ?, m2 = ?, final_mark = ?, grade = ?, grade_point = ?,
     status = 'SUBMITTED', submitted_at = ?, submitted_by_id = ?, updated_at = ? WHERE id = ?`
  ).run(
    entry.eseTheory ?? null,
    entry.esePractical ?? null,
    m1,
    m2,
    final.finalMark,
    final.grade,
    final.gradePoint,
    now,
    userId,
    now,
    result.id
  );
  await recordVersion(result.id, "status", result.status, "SUBMITTED", userId);
  return final;
}

router.post("/offerings/:offeringId/submit", requireRole("LECTURER"), (req, res) =>
  handle(res, async () => {
    const { offering, course, lecturerDepartmentId } = await getOfferingContext(req.params.offeringId);
    if (offering.lecturer_id !== req.user!.id) fail(403, "You are not the lecturer assigned to this course offering.");

    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) fail(400, parsed.error.issues[0]?.message ?? "Invalid request.");
    const entries = parsed.data!.entries;

    const componentType = course.component_type as ComponentType;
    if (componentType !== "PRACTICAL_ONLY") {
      for (const e of entries) if (e.eseTheory == null) fail(400, "eseTheory is required for this course.");
    }
    if (componentType !== "THEORY_ONLY") {
      for (const e of entries) if (e.esePractical == null) fail(400, "esePractical is required for this course.");
    }

    const scheme = await getActiveMarkingScheme(lecturerDepartmentId, offering.academic_year);

    await transaction(async () => {
      for (const entry of entries) await submitOneEntry(req.params.offeringId, course, scheme, entry, req.user!.id);
    });

    await logActivity(req.user!.id, "SUBMIT_FINAL_MARKS", "CourseOffering", req.params.offeringId, { count: entries.length });
    res.json({ ok: true, submitted: entries.length });
  })
);

// --- Bulk upload of final (ESE) marks via Excel/CSV -------------------------------------------

router.get("/offerings/:offeringId/submit-template", requireRole("LECTURER"), (req, res) =>
  handle(res, async () => {
    const { offering, course } = await getOfferingContext(req.params.offeringId);
    if (offering.lecturer_id !== req.user!.id) fail(403, "You are not the lecturer assigned to this course offering.");
    const componentType = course.component_type as ComponentType;

    const rows = (await db
      .prepare(
        `SELECT s.registration_no, u.full_name FROM enrollments e
         JOIN students s ON s.user_id = e.student_id
         JOIN users u ON u.id = s.user_id
         WHERE e.offering_id = ?
         ORDER BY s.registration_no`
      )
      .all(req.params.offeringId)) as { registration_no: string; full_name: string }[];

    const sheetRows = rows.map((r) => {
      const row: Record<string, any> = { "Registration No": r.registration_no, "Full Name": r.full_name };
      if (componentType !== "PRACTICAL_ONLY") row["ESE Theory (out of 100)"] = "";
      if (componentType !== "THEORY_ONLY") row["ESE Practical (out of 100)"] = "";
      return row;
    });
    sendWorkbook(res, sheetRows, `${course.code}-final-marks-template.xlsx`, "Final Marks");
  })
);

router.post("/offerings/:offeringId/submit/bulk-upload", requireRole("LECTURER"), upload.single("file"), (req, res) =>
  handle(res, async () => {
    const { offering, course, lecturerDepartmentId } = await getOfferingContext(req.params.offeringId);
    if (offering.lecturer_id !== req.user!.id) fail(403, "You are not the lecturer assigned to this course offering.");
    if (!req.file) fail(400, "No file uploaded.");

    let rows: Record<string, any>[];
    try {
      rows = parseWorkbookRows(req.file!.buffer);
    } catch {
      fail(400, "Could not read that file — upload a .xlsx or .csv file.");
    }
    if (rows!.length === 0) fail(400, "The file has no data rows.");

    const componentType = course.component_type as ComponentType;
    const expectedColumns = [
      { label: "Registration No", candidates: ["Registration No", "Registration Number", "Reg No"] },
    ];
    if (componentType !== "PRACTICAL_ONLY") {
      expectedColumns.push({ label: "ESE Theory", candidates: ["ESE Theory (out of 100)", "ESE Theory", "Theory"] });
    }
    if (componentType !== "THEORY_ONLY") {
      expectedColumns.push({ label: "ESE Practical", candidates: ["ESE Practical (out of 100)", "ESE Practical", "Practical"] });
    }
    const formatIssue = requireColumns(rows!, expectedColumns);
    if (formatIssue) fail(400, formatIssue);

    const roster = (await db
      .prepare(
        `SELECT e.id AS enrollment_id, s.registration_no FROM enrollments e
         JOIN students s ON s.user_id = e.student_id WHERE e.offering_id = ?`
      )
      .all(req.params.offeringId)) as { enrollment_id: string; registration_no: string }[];
    const byRegNo = new Map(roster.map((r) => [r.registration_no.toLowerCase(), r.enrollment_id]));
    const scheme = await getActiveMarkingScheme(lecturerDepartmentId, offering.academic_year);

    const results: { row: number; registrationNo: string; status: "submitted" | "error"; reason?: string }[] = [];

    for (let i = 0; i < rows!.length; i++) {
      const row = rows![i];
      const rowNum = i + 2;
      const regNo = cell(row, "Registration No", "Registration Number", "Reg No");
      if (!regNo) {
        results.push({ row: rowNum, registrationNo: "(blank)", status: "error", reason: "Missing Registration No." });
        continue;
      }
      const enrollmentId = byRegNo.get(regNo.toLowerCase());
      if (!enrollmentId) {
        results.push({ row: rowNum, registrationNo: regNo, status: "error", reason: "Not enrolled in this course offering." });
        continue;
      }
      const theoryStr = cell(row, "ESE Theory (out of 100)", "ESE Theory", "Theory");
      const practicalStr = cell(row, "ESE Practical (out of 100)", "ESE Practical", "Practical");
      if (componentType !== "PRACTICAL_ONLY" && theoryStr === "") {
        results.push({ row: rowNum, registrationNo: regNo, status: "error", reason: "Missing ESE Theory mark." });
        continue;
      }
      if (componentType !== "THEORY_ONLY" && practicalStr === "") {
        results.push({ row: rowNum, registrationNo: regNo, status: "error", reason: "Missing ESE Practical mark." });
        continue;
      }
      const eseTheory = theoryStr !== "" ? Number(theoryStr) : undefined;
      const esePractical = practicalStr !== "" ? Number(practicalStr) : undefined;
      if ((eseTheory != null && (Number.isNaN(eseTheory) || eseTheory < 0 || eseTheory > 100)) ||
          (esePractical != null && (Number.isNaN(esePractical) || esePractical < 0 || esePractical > 100))) {
        results.push({ row: rowNum, registrationNo: regNo, status: "error", reason: "Marks must be numbers between 0 and 100." });
        continue;
      }
      try {
        await submitOneEntry(req.params.offeringId, course, scheme, { enrollmentId, eseTheory, esePractical }, req.user!.id);
        results.push({ row: rowNum, registrationNo: regNo, status: "submitted" });
      } catch (e: any) {
        results.push({ row: rowNum, registrationNo: regNo, status: "error", reason: e.message ?? "Could not submit this row." });
      }
    }

    const submitted = results.filter((r) => r.status === "submitted").length;
    await logActivity(req.user!.id, "BULK_SUBMIT_FINAL_MARKS", "CourseOffering", req.params.offeringId, { submitted });
    res.json({ submitted, failed: results.length - submitted, results });
  })
);

// ---------------------------------------------------------------------------------------------
// PATCH /:resultId — HOD reviews, corrects or edits final marks (pre-release only).
// ---------------------------------------------------------------------------------------------
const hodEditSchema = z.object({
  eseTheory: z.number().min(0).max(100).optional(),
  esePractical: z.number().min(0).max(100).optional(),
});

router.patch("/:resultId", requireRole("HOD"), (req, res) =>
  handle(res, async () => {
    const result = (await db.prepare("SELECT * FROM results WHERE id = ?").get(req.params.resultId)) as any;
    if (!result) fail(404, "Result not found.");
    if (result.status === "ICA_OPEN") fail(403, "This course's final marks have not been submitted yet.");
    if (result.status === "RELEASED") fail(403, "This result has been released — HOD editing rights were revoked at that instant.");

    const enrollment = (await db.prepare("SELECT * FROM enrollments WHERE id = ?").get(result.enrollment_id)) as any;
    const { course, lecturerDepartmentId } = await getOfferingContext(enrollment.offering_id);
    if (req.user!.departmentId !== lecturerDepartmentId) fail(403, "This result belongs to a different department.");

    const parsed = hodEditSchema.safeParse(req.body);
    if (!parsed.success) fail(400, parsed.error.issues[0]?.message ?? "Invalid request.");
    const d = parsed.data!;

    const offering = (await db.prepare("SELECT * FROM course_offerings WHERE id = ?").get(enrollment.offering_id)) as any;
    const scheme = await getActiveMarkingScheme(lecturerDepartmentId, offering.academic_year);
    const componentType = course.component_type as ComponentType;

    const newEseTheory = d.eseTheory ?? result.ese_theory;
    const newEsePractical = d.esePractical ?? result.ese_practical;

    const icaTheory = (await db
      .prepare(
        `SELECT im.mark, ii.max_marks AS "maxMarks" FROM ica_marks im
         JOIN ica_instruments ii ON ii.id = im.instrument_id
         WHERE ii.offering_id = ? AND ii.component = 'THEORY' AND im.student_id = ?`
      )
      .all(enrollment.offering_id, enrollment.student_id)) as { mark: number; maxMarks: number }[];
    const icaPractical = (await db
      .prepare(
        `SELECT im.mark, ii.max_marks AS "maxMarks" FROM ica_marks im
         JOIN ica_instruments ii ON ii.id = im.instrument_id
         WHERE ii.offering_id = ? AND ii.component = 'PRACTICAL' AND im.student_id = ?`
      )
      .all(enrollment.offering_id, enrollment.student_id)) as { mark: number; maxMarks: number }[];

    const m1 = componentType !== "PRACTICAL_ONLY" ? computeM1(newEseTheory, icaTheory, scheme) : null;
    const m2 = componentType !== "THEORY_ONLY" ? computeM2(newEsePractical, icaPractical, scheme) : null;
    const final = computeFinalResult({
      componentType,
      m1,
      m2,
      theoryCredit: course.theory_credit,
      practicalCredit: course.practical_credit,
    });

    // Editing after HOD's own approval reopens the result for re-approval — an edit is never
    // silently released without the HOD explicitly approving the corrected figures.
    const nextStatus = result.status === "HOD_APPROVED" ? "SUBMITTED" : result.status;

    const now = nowIso();
    await db.prepare(
      `UPDATE results SET ese_theory = ?, ese_practical = ?, m1 = ?, m2 = ?, final_mark = ?, grade = ?, grade_point = ?,
       status = ?, hod_approved_at = NULL, hod_approved_by_id = NULL, updated_at = ? WHERE id = ?`
    ).run(newEseTheory, newEsePractical, m1, m2, final.finalMark, final.grade, final.gradePoint, nextStatus, now, result.id);

    await recordVersion(result.id, "final_mark", result.final_mark, final.finalMark, req.user!.id);
    await recordVersion(result.id, "grade", result.grade, final.grade, req.user!.id);
    await logActivity(req.user!.id, "HOD_EDIT_RESULT", "Result", result.id);

    res.json({ ok: true, finalMark: final.finalMark, grade: final.grade, status: nextStatus });
  })
);

router.post("/:resultId/approve", requireRole("HOD"), (req, res) =>
  handle(res, async () => {
    const result = (await db.prepare("SELECT * FROM results WHERE id = ?").get(req.params.resultId)) as any;
    if (!result) fail(404, "Result not found.");
    if (result.status !== "SUBMITTED") fail(403, "Only a submitted result awaiting review can be approved.");

    const enrollment = (await db.prepare("SELECT * FROM enrollments WHERE id = ?").get(result.enrollment_id)) as any;
    const { lecturerDepartmentId } = await getOfferingContext(enrollment.offering_id);
    if (req.user!.departmentId !== lecturerDepartmentId) fail(403, "This result belongs to a different department.");

    const now = nowIso();
    await db.prepare(
      "UPDATE results SET status = 'HOD_APPROVED', hod_approved_at = ?, hod_approved_by_id = ?, updated_at = ? WHERE id = ?"
    ).run(now, req.user!.id, now, result.id);
    await recordVersion(result.id, "status", "SUBMITTED", "HOD_APPROVED", req.user!.id);
    await logActivity(req.user!.id, "HOD_APPROVE", "Result", result.id);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------------------------
// POST /offerings/:offeringId/release — Chairman of Examination Branch releases every
// HOD-approved result for the offering at once. This permanently revokes both the HOD's and
// the Lecturer's editing privileges for that course-offering, and triggers each released
// student's GPA/OGPA recomputation.
// ---------------------------------------------------------------------------------------------
router.post("/offerings/:offeringId/release", requireRole("CHAIRMAN_EXAM_BRANCH"), (req, res) =>
  handle(res, async () => {
    const rows = (await db
      .prepare(
        `SELECT r.*, e.student_id FROM enrollments e JOIN results r ON r.enrollment_id = e.id WHERE e.offering_id = ?`
      )
      .all(req.params.offeringId)) as any[];
    if (rows.length === 0) fail(404, "No enrolled students found for this course offering.");
    const notReady = rows.filter((r) => r.status !== "HOD_APPROVED");
    if (notReady.length > 0) {
      fail(403, `${notReady.length} of ${rows.length} result(s) are not yet HOD-approved — cannot release this course offering.`);
    }

    const now = nowIso();
    await transaction(async () => {
      for (const r of rows) {
        await db.prepare(
          "UPDATE results SET status = 'RELEASED', released_at = ?, released_by_id = ?, updated_at = ? WHERE id = ?"
        ).run(now, req.user!.id, now, r.id);
        await recordVersion(r.id, "status", "HOD_APPROVED", "RELEASED", req.user!.id);
      }
    });
    for (const r of rows) await recomputeGpaForStudent(r.student_id);

    await logActivity(req.user!.id, "RELEASE_RESULTS", "CourseOffering", req.params.offeringId, { count: rows.length });
    res.json({ ok: true, released: rows.length });
  })
);

// ---------------------------------------------------------------------------------------------
// Correction requests — raisable by the Lecturer any time before release.
// ---------------------------------------------------------------------------------------------
const correctionSchema = z.object({ reason: z.string().min(5) });

router.post("/:resultId/corrections", requireRole("LECTURER"), (req, res) =>
  handle(res, async () => {
    const result = (await db.prepare("SELECT * FROM results WHERE id = ?").get(req.params.resultId)) as any;
    if (!result) fail(404, "Result not found.");
    if (result.status === "RELEASED") fail(403, "This result has already been released — correction requests are no longer possible.");
    if (result.status === "ICA_OPEN") fail(403, "Final marks have not been submitted yet.");

    const enrollment = (await db.prepare("SELECT * FROM enrollments WHERE id = ?").get(result.enrollment_id)) as any;
    const offering = (await db.prepare("SELECT * FROM course_offerings WHERE id = ?").get(enrollment.offering_id)) as any;
    if (offering.lecturer_id !== req.user!.id) fail(403, "You are not the lecturer assigned to this course offering.");

    const parsed = correctionSchema.safeParse(req.body);
    if (!parsed.success) fail(400, parsed.error.issues[0]?.message ?? "Invalid request.");

    const id = newId();
    await db.prepare(
      `INSERT INTO correction_requests (id, result_id, requested_by_id, reason, status, created_at)
       VALUES (?, ?, ?, ?, 'PENDING', ?)`
    ).run(id, req.params.resultId, req.user!.id, parsed.data!.reason, nowIso());
    await logActivity(req.user!.id, "REQUEST_CORRECTION", "CorrectionRequest", id);
    res.status(201).json({ id, status: "PENDING" });
  })
);

router.get("/corrections", requireRole("HOD"), async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT cr.*, cu.code AS course_code, cu.name AS course_name, s.registration_no, su.full_name AS student_name,
              lu.full_name AS requested_by_name
       FROM correction_requests cr
       JOIN results r ON r.id = cr.result_id
       JOIN enrollments e ON e.id = r.enrollment_id
       JOIN course_offerings co ON co.id = e.offering_id
       JOIN course_units cu ON cu.id = co.course_id
       JOIN lecturers l ON l.user_id = co.lecturer_id
       JOIN students s ON s.user_id = e.student_id
       JOIN users su ON su.id = s.user_id
       JOIN users lu ON lu.id = cr.requested_by_id
       WHERE l.department_id = ?
       ORDER BY cr.created_at DESC`
    )
    .all(req.user!.departmentId);
  res.json(rows);
});

const decideSchema = z.object({ approve: z.boolean(), note: z.string().optional() });

router.post("/corrections/:id/decide", requireRole("HOD"), (req, res) =>
  handle(res, async () => {
    const cr = (await db.prepare("SELECT * FROM correction_requests WHERE id = ?").get(req.params.id)) as any;
    if (!cr) fail(404, "Correction request not found.");
    if (cr.status !== "PENDING") fail(403, "This correction request has already been decided.");

    const parsed = decideSchema.safeParse(req.body);
    if (!parsed.success) fail(400, "approve (boolean) is required.");

    await db.prepare(
      "UPDATE correction_requests SET status = ?, decided_by_id = ?, decided_at = ? WHERE id = ?"
    ).run(parsed.data!.approve ? "APPROVED" : "REJECTED", req.user!.id, nowIso(), req.params.id);
    await logActivity(req.user!.id, "DECIDE_CORRECTION", "CorrectionRequest", req.params.id, parsed.data);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------------------------
// Resit attempts — recorded by the HOD (grade authority once results have been reviewed).
// ---------------------------------------------------------------------------------------------
const resitSchema = z.object({
  studentId: z.string().min(1),
  courseId: z.string().min(1),
  attemptNo: z.number().int().min(2).max(3),
  grade: z.string().optional(),
});

router.post("/resits", requireRole("HOD"), async (req, res) => {
  const parsed = resitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const id = newId();
  const d = parsed.data;
  await db.prepare(
    "INSERT INTO resit_attempts (id, student_id, course_id, attempt_no, grade, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, d.studentId, d.courseId, d.attemptNo, d.grade ?? null, nowIso());
  await logActivity(req.user!.id, "RECORD_RESIT", "ResitAttempt", id);
  res.status(201).json({ id, ...d });
});

router.get("/resits", requireRole("HOD", "DEAN", "STUDENT"), async (req, res) => {
  const studentId = req.user!.role === "STUDENT" ? req.user!.id : (req.query.studentId as string | undefined);
  if (!studentId) return res.status(400).json({ error: "studentId is required." });
  res.json(
    await db
      .prepare(
        `SELECT ra.*, cu.code AS course_code, cu.name AS course_name
         FROM resit_attempts ra JOIN course_units cu ON cu.id = ra.course_id
         WHERE ra.student_id = ? ORDER BY ra.created_at DESC`
      )
      .all(studentId)
  );
});

// ---------------------------------------------------------------------------------------------
// Student's own results — grades only, never numeric marks.
// ---------------------------------------------------------------------------------------------
router.get("/my-results", requireRole("STUDENT"), async (req, res) => {
  res.json(
    await db
      .prepare(
        `SELECT cu.code AS course_code, cu.name AS course_name, co.academic_year, co.semester,
                r.grade, r.grade_point, r.released_at
         FROM enrollments e
         JOIN results r ON r.enrollment_id = e.id
         JOIN course_offerings co ON co.id = e.offering_id
         JOIN course_units cu ON cu.id = co.course_id
         WHERE e.student_id = ? AND r.status = 'RELEASED'
         ORDER BY co.academic_year, co.semester`
      )
      .all(req.user!.id)
  );
});

export default router;
