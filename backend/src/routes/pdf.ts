import { Router } from "express";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "../db/client";
import { requireAuth, requireRole } from "../middleware/auth";
import { logActivity } from "../lib/activityLog";
import { getOfferingContext } from "../lib/offeringAccess";

const router = Router();
router.use(requireAuth);

const NAVY = rgb(0.12, 0.23, 0.34);
const GREY = rgb(0.4, 0.4, 0.4);

async function newPage(title: string, subtitle: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]); // A4
  let y = 800;

  page.drawText("University of Vavuniya — Faculty of Applied Science", { x: 50, y, size: 10, font, color: GREY });
  y -= 14;
  page.drawText("Department of Physical Science — SARMS", { x: 50, y, size: 10, font, color: GREY });
  y -= 28;
  page.drawText(title, { x: 50, y, size: 16, font: bold, color: NAVY });
  y -= 20;
  page.drawText(subtitle, { x: 50, y, size: 11, font, color: GREY });
  y -= 24;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 1, color: NAVY });
  y -= 18;

  return { doc, page, font, bold, y };
}

// Lecturer (own offering) / HOD / Dean (own department, after submission) / Chairman /
// Examination Branch (after release) — the result-sheet PDF, per Table 3.
router.get(
  "/offerings/:offeringId/result-sheet",
  requireRole("LECTURER", "HOD", "DEAN", "CHAIRMAN_EXAM_BRANCH", "EXAMINATION_BRANCH"),
  async (req, res) => {
    const { offering, course, lecturerDepartmentId } = await getOfferingContext(req.params.offeringId);
    if (!offering) return res.status(404).json({ error: "Course offering not found." });
    const role = req.user!.role;

    if (role === "LECTURER" && offering.lecturer_id !== req.user!.id) {
      return res.status(403).json({ error: "You are not the lecturer assigned to this course offering." });
    }
    if ((role === "HOD" || role === "DEAN") && req.user!.departmentId !== lecturerDepartmentId) {
      return res.status(403).json({ error: "This course offering belongs to a different department." });
    }

    const statusFilter =
      role === "EXAMINATION_BRANCH" || role === "CHAIRMAN_EXAM_BRANCH"
        ? "AND r.status = 'RELEASED'"
        : "AND r.status != 'ICA_OPEN'";

    const rows = (await db
      .prepare(
        `SELECT s.registration_no, u.full_name, r.ese_theory, r.ese_practical, r.m1, r.m2, r.final_mark, r.grade, r.status
         FROM enrollments e
         JOIN results r ON r.enrollment_id = e.id
         JOIN students s ON s.user_id = e.student_id
         JOIN users u ON u.id = s.user_id
         WHERE e.offering_id = ? ${statusFilter}
         ORDER BY s.registration_no`
      )
      .all(req.params.offeringId)) as any[];

    if (rows.length === 0) {
      return res.status(404).json({ error: "No results are available to you for this course offering yet." });
    }

    const { doc, page, font, bold, y: startY } = await newPage(
      "Final Result Sheet",
      `${course.code} — ${course.name}  |  ${offering.academic_year}, Semester ${offering.semester}`
    );
    let y = startY;

    const cols = [
      { label: "Reg. No.", x: 50, w: 90 },
      { label: "Name", x: 140, w: 150 },
      { label: "Theory", x: 300, w: 60 },
      { label: "Practical", x: 365, w: 60 },
      { label: "Final", x: 430, w: 50 },
      { label: "Grade", x: 490, w: 55 },
    ];
    for (const c of cols) page.drawText(c.label, { x: c.x, y, size: 9, font: bold, color: NAVY });
    y -= 14;
    page.drawLine({ start: { x: 50, y: y + 4 }, end: { x: 545, y: y + 4 }, thickness: 0.5, color: GREY });

    let current = page;
    for (const r of rows) {
      if (y < 60) {
        const fresh = await newPage("Final Result Sheet (cont.)", `${course.code} — ${course.name}`);
        current = fresh.page;
        y = fresh.y;
      }
      current.drawText(r.registration_no, { x: 50, y, size: 9, font });
      current.drawText(r.full_name, { x: 140, y, size: 9, font });
      current.drawText(r.m1 != null ? r.m1.toFixed(1) : "—", { x: 300, y, size: 9, font });
      current.drawText(r.m2 != null ? r.m2.toFixed(1) : "—", { x: 365, y, size: 9, font });
      current.drawText(r.final_mark != null ? r.final_mark.toFixed(1) : "—", { x: 430, y, size: 9, font });
      current.drawText(r.grade ?? "—", { x: 490, y, size: 9, font: bold });
      y -= 16;
    }

    page.drawText(`Generated ${new Date().toISOString().slice(0, 10)} by ${req.user!.username} (${role})`, {
      x: 50,
      y: 40,
      size: 8,
      font,
      color: GREY,
    });

    const bytes = await doc.save();
    await logActivity(req.user!.id, "EXPORT_PDF", "CourseOffering", req.params.offeringId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${course.code}-result-sheet.pdf"`);
    res.send(Buffer.from(bytes));
  }
);

// Examination Branch: official certificate — a student's full released transcript + OGPA.
router.get("/students/:studentId/certificate", requireRole("EXAMINATION_BRANCH"), async (req, res) => {
  const student = (await db
    .prepare(
      `SELECT s.*, u.full_name, p.name AS programme_name FROM students s
       JOIN users u ON u.id = s.user_id
       JOIN degree_programmes p ON p.id = s.programme_id
       WHERE s.user_id = ?`
    )
    .get(req.params.studentId)) as any;
  if (!student) return res.status(404).json({ error: "Student not found." });

  const rows = (await db
    .prepare(
      `SELECT cu.code, cu.name, r.grade, r.grade_point
       FROM enrollments e
       JOIN results r ON r.enrollment_id = e.id
       JOIN course_offerings co ON co.id = e.offering_id
       JOIN course_units cu ON cu.id = co.course_id
       WHERE e.student_id = ? AND r.status = 'RELEASED'
       ORDER BY cu.level, cu.semester, cu.code`
    )
    .all(req.params.studentId)) as any[];

  if (rows.length === 0) {
    return res.status(404).json({ error: "This student has no released results yet." });
  }

  const ogpa = (await db.prepare("SELECT * FROM ogpa_records WHERE student_id = ?").get(req.params.studentId)) as any;

  const { doc, page, font, bold, y: startY } = await newPage(
    "Official Academic Result Sheet",
    `${student.full_name}  |  Reg. No. ${student.registration_no}  |  ${student.programme_name}`
  );
  let y = startY;
  let current = page;

  for (const r of rows) {
    if (y < 60) {
      const fresh = await newPage("Official Academic Result Sheet (cont.)", student.full_name);
      current = fresh.page;
      y = fresh.y;
    }
    current.drawText(r.code, { x: 50, y, size: 9, font });
    current.drawText(r.name, { x: 130, y, size: 9, font });
    current.drawText(r.grade ?? "—", { x: 420, y, size: 9, font: bold });
    current.drawText(r.grade_point != null ? r.grade_point.toFixed(2) : "—", { x: 480, y, size: 9, font });
    y -= 16;
  }

  y -= 12;
  current.drawLine({ start: { x: 50, y: y + 8 }, end: { x: 545, y: y + 8 }, thickness: 0.5, color: GREY });
  current.drawText(
    `Overall GPA (OGPA): ${ogpa ? ogpa.ogpa_value.toFixed(2) : "N/A"}   Class: ${ogpa?.class_of_award ?? "N/A"}`,
    { x: 50, y, size: 11, font: bold, color: NAVY }
  );

  const bytes = await doc.save();
  await logActivity(req.user!.id, "EXPORT_PDF", "Student", req.params.studentId);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${student.registration_no}-certificate.pdf"`);
  res.send(Buffer.from(bytes));
});

// ---------------------------------------------------------------------------------------------
// One-time-password handout PDFs (Super Admin only). Neither route reads a stored password —
// there isn't one to read, only a bcrypt hash. Both take the plaintext password the caller just
// received in the create/reset API response and immediately turn it into a downloadable file, so
// it survives a page refresh even if nobody remembers to click "download" first. Nothing here
// persists the password anywhere new; SARMS still never stores or logs it once this PDF is sent.
// ---------------------------------------------------------------------------------------------
router.post("/credentials", requireRole("SUPER_ADMIN"), async (req, res) => {
  const { username, password, fullName, role } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: "username and password are required." });

  const { doc, page, font, bold, y: startY } = await newPage(
    "New Account — One-Time Password",
    "Hand this to the account holder. They must change this password the first time they sign in."
  );
  let y = startY;
  const rows: [string, string][] = [
    ["Full name", fullName ?? "—"],
    ["Role", role ?? "—"],
    ["Username", username],
    ["One-time password", password],
  ];
  for (const [label, value] of rows) {
    page.drawText(label, { x: 50, y, size: 10, font: bold, color: NAVY });
    page.drawText(String(value), { x: 220, y, size: 11, font: bold });
    y -= 22;
  }
  y -= 10;
  page.drawLine({ start: { x: 50, y: y + 10 }, end: { x: 545, y: y + 10 }, thickness: 0.5, color: GREY });
  page.drawText(
    "This password is shown only once and is not stored anywhere in SARMS in a readable form — if it's",
    { x: 50, y, size: 9, font, color: GREY }
  );
  y -= 13;
  page.drawText(
    "lost before the account holder signs in, use \"Reset password\" on the Accounts page to issue a new one.",
    { x: 50, y, size: 9, font, color: GREY }
  );
  y -= 20;
  page.drawText(`Generated ${new Date().toISOString().slice(0, 10)} by ${req.user!.username}`, {
    x: 50, y, size: 8, font, color: GREY,
  });

  const bytes = await doc.save();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${username}-onetime-password.pdf"`);
  res.send(Buffer.from(bytes));
});

router.post("/bulk-credentials", requireRole("SUPER_ADMIN"), async (req, res) => {
  const results = (req.body?.results ?? []) as { fullName: string; username?: string; password?: string; status: string }[];
  const created = results.filter((r) => r.status === "created" && r.username && r.password);
  if (created.length === 0) return res.status(400).json({ error: "No created accounts with passwords to export." });

  const { doc, page, font, bold, y: startY } = await newPage(
    "Bulk-Created Accounts — One-Time Passwords",
    "Hand each row to its account holder. Every password must be changed on first sign-in, and is shown only here."
  );
  let y = startY;
  const cols = [
    { label: "Name", x: 50 },
    { label: "Username", x: 250 },
    { label: "One-time password", x: 400 },
  ];
  for (const c of cols) page.drawText(c.label, { x: c.x, y, size: 9, font: bold, color: NAVY });
  y -= 14;
  page.drawLine({ start: { x: 50, y: y + 4 }, end: { x: 545, y: y + 4 }, thickness: 0.5, color: GREY });

  let current = page;
  for (const r of created) {
    if (y < 60) {
      const fresh = await newPage("Bulk-Created Accounts (cont.)", "One-time passwords");
      current = fresh.page;
      y = fresh.y;
    }
    current.drawText(r.fullName, { x: 50, y, size: 9, font });
    current.drawText(r.username!, { x: 250, y, size: 9, font });
    current.drawText(r.password!, { x: 400, y, size: 9, font: bold });
    y -= 16;
  }
  page.drawText(`Generated ${new Date().toISOString().slice(0, 10)} by ${req.user!.username}`, {
    x: 50, y: Math.max(y - 10, 30), size: 8, font, color: GREY,
  });

  const bytes = await doc.save();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="bulk-onetime-passwords.pdf"`);
  res.send(Buffer.from(bytes));
});

export default router;
