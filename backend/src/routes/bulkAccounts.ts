import { Router } from "express";
import multer from "multer";
import { db, newId } from "../db/client";
import { requireAuth, requireRole } from "../middleware/auth";
import { createUserAccount, generateUsername } from "../lib/userAccounts";
import { logActivity } from "../lib/activityLog";
import { parseWorkbookRows, cell, sendWorkbook, requireColumns } from "../lib/excel";
import { ALL_ROLES } from "../lib/types";

const router = Router();
router.use(requireAuth, requireRole("SUPER_ADMIN"));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const STAFF_ROLES = ["LECTURER", "HOD", "DEAN", "CHAIRMAN_EXAM_BRANCH", "EXAMINATION_BRANCH", "SUPER_ADMIN"];

interface RowResult {
  row: number;
  fullName: string;
  username?: string;
  password?: string;
  status: "created" | "error";
  reason?: string;
}

// --- Students ------------------------------------------------------------------------------

router.get("/students/template", async (_req, res) => {
  const programmes = (await db.prepare("SELECT name FROM degree_programmes ORDER BY name").all()) as { name: string }[];
  const example = [
    {
      "Full Name": "A. B. Perera",
      Email: "ab.perera@stu.vau.ac.lk",
      "Registration No": "APS/IT/2025/001",
      Programme: programmes[0]?.name ?? "BSc (Hons) in Information Technology",
      Level: 1,
      "Admission Year": new Date().getFullYear(),
      Username: "",
      "Personal Email (optional, for password reset)": "",
    },
  ];
  sendWorkbook(res, example, "student-bulk-import-template.xlsx", "Students");
});

router.post("/students", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  let rows: Record<string, any>[];
  try {
    rows = parseWorkbookRows(req.file.buffer);
  } catch {
    return res.status(400).json({ error: "Could not read that file — upload a .xlsx or .csv file." });
  }
  if (rows.length === 0) return res.status(400).json({ error: "The file has no data rows." });

  const programmes = (await db.prepare("SELECT id, name FROM degree_programmes").all()) as { id: string; name: string }[];
  const results: RowResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // account for header row
    const fullName = cell(row, "Full Name", "Name");
    const email = cell(row, "Email");
    const registrationNo = cell(row, "Registration No", "Registration Number", "Reg No");
    const programmeName = cell(row, "Programme", "Programme Name");
    const level = Number(cell(row, "Level") || "0");
    const admissionYear = Number(cell(row, "Admission Year") || "0");
    const explicitUsername = cell(row, "Username");
    const personalEmail = cell(row, "Personal Email (optional, for password reset)", "Personal Email");

    if (!fullName || !email || !registrationNo || !programmeName || !level || !admissionYear) {
      results.push({ row: rowNum, fullName: fullName || "(blank)", status: "error", reason: "Missing a required column (Full Name, Email, Registration No, Programme, Level, Admission Year)." });
      continue;
    }
    const programme = programmes.find((p) => p.name.toLowerCase() === programmeName.toLowerCase());
    if (!programme) {
      results.push({ row: rowNum, fullName, status: "error", reason: `Unknown programme "${programmeName}". Check spelling against the Programme list.` });
      continue;
    }
    try {
      const username = explicitUsername || (await generateUsername(email || fullName));
      const { id, generatedPassword } = await createUserAccount({ username, fullName, email, role: "STUDENT", personalEmail: personalEmail || null });
      await db.prepare(
        "INSERT INTO students (user_id, registration_no, programme_id, level, admission_year) VALUES (?, ?, ?, ?, ?)"
      ).run(id, registrationNo, programme.id, level, admissionYear);
      await logActivity(req.user!.id, "BULK_CREATE", "Student", id);
      results.push({ row: rowNum, fullName, username, password: generatedPassword ?? undefined, status: "created" });
    } catch {
      results.push({ row: rowNum, fullName, status: "error", reason: "Username, email or registration number already exists." });
    }
  }

  res.json({
    created: results.filter((r) => r.status === "created").length,
    failed: results.filter((r) => r.status === "error").length,
    results,
  });
});

// --- Staff -----------------------------------------------------------------------------------

router.get("/staff/template", async (_req, res) => {
  const departments = (await db.prepare("SELECT name FROM departments ORDER BY name").all()) as { name: string }[];
  const example = [
    {
      "Full Name": "Mr. K. Silva",
      Email: "k.silva@vau.ac.lk",
      Role: "LECTURER",
      Department: departments[0]?.name ?? "Physical Science",
      Designation: "Lecturer",
      Username: "",
      "Personal Email (optional, for password reset)": "",
    },
  ];
  sendWorkbook(res, example, "staff-bulk-import-template.xlsx", "Staff");
});

router.post("/staff", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  let rows: Record<string, any>[];
  try {
    rows = parseWorkbookRows(req.file.buffer);
  } catch {
    return res.status(400).json({ error: "Could not read that file — upload a .xlsx or .csv file." });
  }
  if (rows.length === 0) return res.status(400).json({ error: "The file has no data rows." });

  const departments = (await db.prepare("SELECT id, name FROM departments").all()) as { id: string; name: string }[];
  const results: RowResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const fullName = cell(row, "Full Name", "Name");
    const email = cell(row, "Email");
    const role = cell(row, "Role").toUpperCase().replace(/\s+/g, "_");
    const departmentName = cell(row, "Department");
    const designation = cell(row, "Designation");
    const explicitUsername = cell(row, "Username");
    const personalEmail = cell(row, "Personal Email (optional, for password reset)", "Personal Email");

    if (!fullName || !email || !role) {
      results.push({ row: rowNum, fullName: fullName || "(blank)", status: "error", reason: "Missing a required column (Full Name, Email, Role)." });
      continue;
    }
    if (!STAFF_ROLES.includes(role) || !ALL_ROLES.includes(role as any)) {
      results.push({ row: rowNum, fullName, status: "error", reason: `Unknown role "${role}". Must be one of: ${STAFF_ROLES.join(", ")}.` });
      continue;
    }
    const needsDept = role === "LECTURER" || role === "HOD" || role === "DEAN";
    let departmentId: string | null = null;
    if (needsDept) {
      const dept = departments.find((d) => d.name.toLowerCase() === departmentName.toLowerCase());
      if (!dept) {
        results.push({ row: rowNum, fullName, status: "error", reason: `${role} requires a valid Department — "${departmentName}" not found.` });
        continue;
      }
      departmentId = dept.id;
    }
    try {
      const username = explicitUsername || (await generateUsername(email || fullName));
      const { id, generatedPassword } = await createUserAccount({ username, fullName, email, role: role as any, departmentId, personalEmail: personalEmail || null });
      if (role === "LECTURER") {
        await db.prepare("INSERT INTO lecturers (user_id, department_id, designation) VALUES (?, ?, ?)").run(id, departmentId, designation || null);
      }
      await logActivity(req.user!.id, "BULK_CREATE", "User", id, { role });
      results.push({ row: rowNum, fullName, username, password: generatedPassword ?? undefined, status: "created" });
    } catch {
      results.push({ row: rowNum, fullName, status: "error", reason: "Username or email already exists." });
    }
  }

  res.json({
    created: results.filter((r) => r.status === "created").length,
    failed: results.filter((r) => r.status === "error").length,
    results,
  });
});

// --- Course units --------------------------------------------------------------------------

/** Reads a course code like "IT2223" as University-of-Vavuniya-style: the first digit right
 *  after the subject prefix is the level (year), the next digit is the semester — so a bulk
 *  upload doesn't have to spell out Level/Semester columns if the code already encodes them.
 *  Returns null (rather than guessing) whenever the digits don't land in valid ranges — the
 *  caller falls back to requiring an explicit Level/Semester column for that row instead. */
function deriveLevelSemesterFromCode(code: string): { level: number; semester: number } | null {
  const match = code.trim().match(/^[A-Za-z]+\s*(\d)(\d)/);
  if (!match) return null;
  const level = Number(match[1]);
  const semester = Number(match[2]);
  if (level < 1 || level > 4 || semester < 1 || semester > 2) return null;
  return { level, semester };
}

interface CourseRowResult {
  row: number;
  code: string;
  name?: string;
  status: "created" | "error";
  reason?: string;
}

router.get("/courses/template", async (_req, res) => {
  const programmes = (await db.prepare("SELECT name FROM degree_programmes ORDER BY name").all()) as { name: string }[];
  const example = [
    {
      Code: "IT2223",
      Name: "Example Course Unit",
      Programme: programmes[0]?.name ?? "BSc (Hons) in Information Technology",
      Category: "CORE",
      "Component Type": "THEORY_ONLY",
      "Theory Credit": 3,
      "Practical Credit": 0,
      "Level (optional — derived from code if blank)": "",
      "Semester (optional — derived from code if blank)": "",
    },
  ];
  sendWorkbook(res, example, "course-unit-bulk-import-template.xlsx", "Course Units");
});

router.post("/courses", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  let rows: Record<string, any>[];
  try {
    rows = parseWorkbookRows(req.file.buffer);
  } catch {
    return res.status(400).json({ error: "Could not read that file — upload a .xlsx or .csv file." });
  }
  if (rows.length === 0) return res.status(400).json({ error: "The file has no data rows." });

  const formatIssue = requireColumns(rows, [
    { label: "Code", candidates: ["Code", "Course Code"] },
    { label: "Name", candidates: ["Name", "Course Name"] },
    { label: "Programme", candidates: ["Programme", "Programme Name"] },
  ]);
  if (formatIssue) return res.status(400).json({ error: formatIssue });

  const programmes = (await db.prepare("SELECT id, name FROM degree_programmes").all()) as { id: string; name: string }[];
  const results: CourseRowResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const code = cell(row, "Code", "Course Code");
    const name = cell(row, "Name", "Course Name");
    const programmeName = cell(row, "Programme", "Programme Name");
    const category = (cell(row, "Category") || "CORE").toUpperCase();
    const componentType = (cell(row, "Component Type", "Component") || "THEORY_ONLY").toUpperCase().replace(/\s+/g, "_");
    const theoryCredit = Number(cell(row, "Theory Credit", "Theory Credits") || "0");
    const practicalCredit = Number(cell(row, "Practical Credit", "Practical Credits") || "0");
    const levelStr = cell(row, "Level (optional — derived from code if blank)", "Level");
    const semesterStr = cell(row, "Semester (optional — derived from code if blank)", "Semester");

    if (!code || !name || !programmeName) {
      results.push({ row: rowNum, code: code || "(blank)", status: "error", reason: "Missing a required column (Code, Name, Programme)." });
      continue;
    }
    if (!["CORE", "ELECTIVE", "ACU"].includes(category)) {
      results.push({ row: rowNum, code, name, status: "error", reason: `Category must be CORE, ELECTIVE or ACU (got "${category}").` });
      continue;
    }
    if (!["THEORY_ONLY", "PRACTICAL_ONLY", "BOTH"].includes(componentType)) {
      results.push({ row: rowNum, code, name, status: "error", reason: `Component Type must be Theory Only, Practical Only or Both (got "${componentType}").` });
      continue;
    }
    const programme = programmes.find((p) => p.name.toLowerCase() === programmeName.toLowerCase());
    if (!programme) {
      results.push({ row: rowNum, code, name, status: "error", reason: `Unknown programme "${programmeName}". Check spelling against the Programme list.` });
      continue;
    }

    let level: number, semester: number;
    if (levelStr && semesterStr) {
      level = Number(levelStr);
      semester = Number(semesterStr);
    } else {
      const derived = deriveLevelSemesterFromCode(code);
      if (!derived) {
        results.push({
          row: rowNum, code, name, status: "error",
          reason: "Couldn't work out Level/Semester from the code — add them explicitly in the Level/Semester columns for this row.",
        });
        continue;
      }
      level = derived.level;
      semester = derived.semester;
    }
    if (!Number.isInteger(level) || level < 1 || level > 4 || !Number.isInteger(semester) || semester < 1 || semester > 2) {
      results.push({ row: rowNum, code, name, status: "error", reason: "Level must be 1–4 and Semester must be 1–2." });
      continue;
    }

    try {
      await db.prepare(
        `INSERT INTO course_units (id, code, name, theory_credit, practical_credit, category, component_type, programme_id, level, semester)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(newId(), code, name, theoryCredit, practicalCredit, category, componentType, programme.id, level, semester);
      await logActivity(req.user!.id, "BULK_CREATE", "CourseUnit", undefined, { code });
      results.push({ row: rowNum, code, name, status: "created" });
    } catch {
      results.push({ row: rowNum, code, name, status: "error", reason: `A course unit with code "${code}" already exists.` });
    }
  }

  res.json({
    created: results.filter((r) => r.status === "created").length,
    failed: results.filter((r) => r.status === "error").length,
    results,
  });
});

// Lets the admin download the results of a bulk-create call (including generated passwords)
// as a spreadsheet, so they can hand it out. The frontend posts the same `results` array back.
router.post("/export-results", (req, res) => {
  const results = (req.body?.results ?? []) as RowResult[];
  const rows = results.map((r) => ({
    Row: r.row,
    "Full Name": r.fullName,
    Username: r.username ?? "",
    "One-Time Password": r.password ?? "",
    Status: r.status,
    Reason: r.reason ?? "",
  }));
  sendWorkbook(res, rows, "bulk-import-results.xlsx", "Results");
});

export default router;
