import { Router } from "express";
import multer from "multer";
import { db, newId, nowIso } from "../db/client";
import { requireAuth, requireRole } from "../middleware/auth";
import { logActivity } from "../lib/activityLog";
import { parseWorkbookRows, cell, sendWorkbook, requireColumns } from "../lib/excel";

// "What a lecturer is capable of teaching", uploaded as a spreadsheet — each row proposes a
// lecturer-to-course-offering assignment. Nothing here touches course_offerings directly; every
// row lands as PENDING and only becomes a real offering once the Super Admin clicks Assign
// (Accept) on it, or is discarded with Reject — a deliberate one-click checkpoint since assigning
// a lecturer hands them editing rights over that course's marks.
const router = Router();
router.use(requireAuth, requireRole("SUPER_ADMIN"));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function badRequest(res: any, issue?: string) {
  return res.status(400).json({ error: issue ?? "Invalid request." });
}

router.get("/template", (_req, res) => {
  const example = [
    {
      "Lecturer Username": "lecturer.perera",
      "Course Code": "IT2032",
      "Academic Year": "2025/2026",
      Semester: 1,
    },
  ];
  sendWorkbook(res, example, "lecturer-assignment-template.xlsx", "Assignments");
});

router.post("/bulk-upload", upload.single("file"), async (req, res) => {
  if (!req.file) return badRequest(res, "No file uploaded.");
  let rows: Record<string, any>[];
  try {
    rows = parseWorkbookRows(req.file.buffer);
  } catch {
    return badRequest(res, "Could not read that file — upload a .xlsx or .csv file.");
  }
  if (rows.length === 0) return badRequest(res, "The file has no data rows.");

  const formatIssue = requireColumns(rows, [
    { label: "Lecturer Username", candidates: ["Lecturer Username", "Lecturer", "Username"] },
    { label: "Course Code", candidates: ["Course Code", "Course", "Code"] },
    { label: "Academic Year", candidates: ["Academic Year", "Year"] },
    { label: "Semester", candidates: ["Semester"] },
  ]);
  if (formatIssue) return badRequest(res, formatIssue);

  const results: { row: number; lecturer: string; course: string; status: "queued" | "error"; reason?: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const lecturerUsername = cell(row, "Lecturer Username", "Lecturer", "Username");
    const courseCode = cell(row, "Course Code", "Course", "Code");
    const academicYear = cell(row, "Academic Year", "Year");
    const semesterStr = cell(row, "Semester");

    if (!lecturerUsername || !courseCode || !academicYear || !semesterStr) {
      results.push({
        row: rowNum,
        lecturer: lecturerUsername || "(blank)",
        course: courseCode || "(blank)",
        status: "error",
        reason: "Missing a required column (Lecturer Username, Course Code, Academic Year, Semester).",
      });
      continue;
    }
    const semester = Number(semesterStr);
    if (![1, 2].includes(semester)) {
      results.push({ row: rowNum, lecturer: lecturerUsername, course: courseCode, status: "error", reason: "Semester must be 1 or 2." });
      continue;
    }
    const lecturer = (await db
      .prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND role = 'LECTURER'")
      .get(lecturerUsername)) as { id: string } | undefined;
    if (!lecturer) {
      results.push({ row: rowNum, lecturer: lecturerUsername, course: courseCode, status: "error", reason: `No Lecturer account found with username "${lecturerUsername}".` });
      continue;
    }
    const course = (await db.prepare("SELECT id FROM course_units WHERE UPPER(code) = UPPER(?)").get(courseCode)) as { id: string } | undefined;
    if (!course) {
      results.push({ row: rowNum, lecturer: lecturerUsername, course: courseCode, status: "error", reason: `Unknown course code "${courseCode}".` });
      continue;
    }
    const existingOffering = await db
      .prepare("SELECT id FROM course_offerings WHERE course_id = ? AND academic_year = ? AND semester = ?")
      .get(course.id, academicYear, semester);
    if (existingOffering) {
      results.push({ row: rowNum, lecturer: lecturerUsername, course: courseCode, status: "error", reason: "This course already has an offering for that academic year & semester." });
      continue;
    }
    const existingPending = await db
      .prepare(
        `SELECT id FROM lecturer_assignment_requests
         WHERE lecturer_id = ? AND course_id = ? AND academic_year = ? AND semester = ? AND status = 'PENDING'`
      )
      .get(lecturer.id, course.id, academicYear, semester);
    if (existingPending) {
      results.push({ row: rowNum, lecturer: lecturerUsername, course: courseCode, status: "error", reason: "A pending request for this lecturer/course/year/semester already exists." });
      continue;
    }

    await db.prepare(
      `INSERT INTO lecturer_assignment_requests (id, lecturer_id, course_id, academic_year, semester, status, uploaded_by_id, uploaded_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)`
    ).run(newId(), lecturer.id, course.id, academicYear, semester, req.user!.id, nowIso());
    results.push({ row: rowNum, lecturer: lecturerUsername, course: courseCode, status: "queued" });
  }

  const queued = results.filter((r) => r.status === "queued").length;
  await logActivity(req.user!.id, "BULK_UPLOAD", "LecturerAssignmentRequest", undefined, { queued });
  res.json({ queued, failed: results.length - queued, results });
});

router.get("/", async (req, res) => {
  const status = (req.query.status as string) || "PENDING";
  res.json(
    await db
      .prepare(
        `SELECT r.id, r.academic_year, r.semester, r.status, r.uploaded_at,
                u.full_name AS lecturer_name, u.username AS lecturer_username,
                cu.code AS course_code, cu.name AS course_name
         FROM lecturer_assignment_requests r
         JOIN users u ON u.id = r.lecturer_id
         JOIN course_units cu ON cu.id = r.course_id
         WHERE r.status = ?
         ORDER BY r.uploaded_at DESC`
      )
      .all(status)
  );
});

router.post("/:id/accept", async (req, res) => {
  const request = (await db.prepare("SELECT * FROM lecturer_assignment_requests WHERE id = ?").get(req.params.id)) as any;
  if (!request) return res.status(404).json({ error: "Request not found." });
  if (request.status !== "PENDING") return badRequest(res, "This request has already been decided.");

  const offeringId = newId();
  try {
    await db.prepare(
      `INSERT INTO course_offerings (id, course_id, lecturer_id, academic_year, semester, assigned_by_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(offeringId, request.course_id, request.lecturer_id, request.academic_year, request.semester, req.user!.id, nowIso());
  } catch {
    return badRequest(res, "This course already has an offering for that academic year & semester — reject this request instead.");
  }
  await db.prepare(
    "UPDATE lecturer_assignment_requests SET status = 'APPROVED', offering_id = ?, decided_by_id = ?, decided_at = ? WHERE id = ?"
  ).run(offeringId, req.user!.id, nowIso(), req.params.id);
  await logActivity(req.user!.id, "ASSIGN_LECTURER", "CourseOffering", offeringId, { fromRequest: req.params.id });
  res.json({ ok: true, offeringId });
});

router.post("/:id/reject", async (req, res) => {
  const request = (await db.prepare("SELECT * FROM lecturer_assignment_requests WHERE id = ?").get(req.params.id)) as any;
  if (!request) return res.status(404).json({ error: "Request not found." });
  if (request.status !== "PENDING") return badRequest(res, "This request has already been decided.");

  await db.prepare(
    "UPDATE lecturer_assignment_requests SET status = 'REJECTED', decided_by_id = ?, decided_at = ? WHERE id = ?"
  ).run(req.user!.id, nowIso(), req.params.id);
  await logActivity(req.user!.id, "REJECT_ASSIGNMENT_REQUEST", "LecturerAssignmentRequest", req.params.id);
  res.json({ ok: true });
});

export default router;
