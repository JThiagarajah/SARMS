import { Router } from "express";
import multer from "multer";
import { db, newId, nowIso } from "../db/client";
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

// yearOfStudy comes in as "2022/2023" (the cohort's admission academic year, i.e. the first
// year is what students.admission_year actually stores) — also accepts a bare "2022". Returns 0
// (falsy, same as the old blank-Admission-Year case) when nothing parseable is found.
function parseAdmissionYear(yearOfStudy: string): number {
  const match = yearOfStudy.match(/\d{4}/);
  return match ? Number(match[0]) : 0;
}

router.get("/students/template", async (_req, res) => {
  const programmes = (await db.prepare("SELECT name FROM degree_programmes ORDER BY name").all()) as { name: string }[];
  const thisYear = new Date().getFullYear();
  const example = [
    {
      studentId: "s001",
      name: "A. B. Perera",
      registrationNo: "APS/IT/2025/001",
      email: "ab.perera@stu.vau.ac.lk",
      yearOfStudy: `${thisYear}/${thisYear + 1}`,
      department: "ict",
      Programme: programmes[0]?.name ?? "BSc (Hons) in Information Technology",
      Level: 1,
      "Personal Email (required — for login details & password reset)": "ab.perera.personal@gmail.com",
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
    // "studentId" (an external reference from some other system) and "department" (informational
    // only — a student's real department comes from its Programme below) are accepted but not
    // persisted: SARMS has no column for either today.
    const fullName = cell(row, "Full Name", "Name");
    const email = cell(row, "Email");
    const registrationNo = cell(row, "Registration No", "Registration Number", "Reg No", "registrationNo");
    const programmeName = cell(row, "Programme", "Programme Name");
    const level = Number(cell(row, "Level") || "0");
    const explicitAdmissionYear = cell(row, "Admission Year");
    const yearOfStudy = cell(row, "yearOfStudy", "Year Of Study");
    const admissionYear = explicitAdmissionYear ? Number(explicitAdmissionYear) : parseAdmissionYear(yearOfStudy);
    const explicitUsername = cell(row, "Username");
    const personalEmail = cell(row, "Personal Email (required — for login details & password reset)", "Personal Email (optional, for password reset)", "Personal Email");

    if (!fullName || !email || !registrationNo || !programmeName || !level || !admissionYear || !personalEmail) {
      results.push({ row: rowNum, fullName: fullName || "(blank)", status: "error", reason: "Missing a required column (Full Name/name, Email, Registration No, Programme, Level, Admission Year/yearOfStudy, Personal Email)." });
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
      "Personal Email (required — for login details & password reset)": "k.silva.personal@gmail.com",
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
    const personalEmail = cell(row, "Personal Email (required — for login details & password reset)", "Personal Email (optional, for password reset)", "Personal Email");

    if (!fullName || !email || !role || !personalEmail) {
      results.push({ row: rowNum, fullName: fullName || "(blank)", status: "error", reason: "Missing a required column (Full Name, Email, Role, Personal Email)." });
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

/** Pulls the first digit out of free text like "1st year", "3rd year" or "Semester 2" — covers
 *  both the old plain-numeric Level/Semester columns and the new batch/semester text columns with
 *  one code path. Returns null on no digit found (blank cell, etc). */
function extractDigit(text: string): number | null {
  const match = text.match(/\d/);
  return match ? Number(match[0]) : null;
}

interface CourseRowResult {
  row: number;
  code: string;
  name?: string;
  status: "created" | "skipped" | "error";
  reason?: string;
}

// Real course codes at UoV encode which programme they belong to in their subject prefix (the
// letters before the digits) — this lets bulk import work with zero Programme column at all, which
// is exactly what the real course-bulk-template.csv looks like. `match` is matched
// case-insensitively against a substring of the programme's name (so a small rename doesn't break
// it); `prefixes` lists every subject prefix that belongs to it. ACU (Auxiliary Credit Unit —
// English, career guidance, research methods, etc.) is really a category shared by every
// programme rather than one programme's own course (see CATEGORY_PREFIX_MAP below) — every
// programme's sheet lists the same ACU codes with the same details, so they're pinned to one
// programme here purely so each code has a single home row. The "skipped" status below is what
// makes that safe: the same code showing up again later (same file or a re-upload) is left alone,
// not rejected as a duplicate.
const PROGRAMME_PREFIX_MAP: { match: string; prefixes: string[] }[] = [
  { match: "information technology", prefixes: ["IT", "EL", "ACU"] },
  { match: "applied mathematics", prefixes: ["AMA", "PMA", "STA", "CSC", "CSH"] },
];

// Subject prefix -> Category, when the sheet doesn't say explicitly. "EL" = elective, "ACU" =
// auxiliary credit unit (matches course_units.category's own ACU value) — everything else
// defaults to CORE, same as the manual add form's own default.
const CATEGORY_PREFIX_MAP: Record<string, string> = { EL: "ELECTIVE", ACU: "ACU" };

function codePrefix(code: string): string {
  return code.trim().match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "";
}

/** Looks up a course code's Programme from its subject prefix (see PROGRAMME_PREFIX_MAP) against
 *  the programmes actually configured in this system. Returns undefined when the prefix isn't
 *  recognised, or the matching programme doesn't exist yet — the caller falls back to requiring
 *  an explicit Programme column for that row. */
function inferProgrammeFromCode(code: string, programmes: { id: string; name: string }[]): { id: string; name: string } | undefined {
  const prefix = codePrefix(code);
  const group = PROGRAMME_PREFIX_MAP.find((g) => g.prefixes.includes(prefix));
  if (!group) return undefined;
  return programmes.find((p) => p.name.toLowerCase().includes(group.match));
}

function inferCategoryFromCode(code: string): string | undefined {
  return CATEGORY_PREFIX_MAP[codePrefix(code)];
}

router.get("/courses/template", async (_req, res) => {
  const example = [
    {
      subjectCode: "IT2223",
      subjectName: "Example Course Unit",
      totalCredit: 3,
      batch: "2nd year",
      semester: "Semester 2",
      weeklyHours: 4,
      theoryHours: 2,
      practicalHours: 2,
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
    { label: "Code", candidates: ["Code", "Course Code", "subjectCode"] },
    { label: "Name", candidates: ["Name", "Course Name", "subjectName"] },
  ]);
  if (formatIssue) return res.status(400).json({ error: formatIssue });

  const programmes = (await db.prepare("SELECT id, name FROM degree_programmes").all()) as { id: string; name: string }[];
  // Pre-loaded so a code repeated within the same file (e.g. the shared ACU codes above) or
  // already imported in an earlier upload is skipped rather than rejected — see the comment on
  // PROGRAMME_PREFIX_MAP. Grows as rows are created below so later duplicates within this same
  // file are caught too, not just ones already in the database.
  const existingCodes = new Set(
    ((await db.prepare("SELECT code FROM course_units").all()) as { code: string }[]).map((r) => r.code.toUpperCase())
  );
  const results: CourseRowResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const code = cell(row, "Code", "Course Code", "subjectCode");
    const name = cell(row, "Name", "Course Name", "subjectName");
    // Programme/Category/Component Type: an explicit column always wins when present; otherwise
    // each is derived — Programme and Category from the code's subject prefix, Component Type
    // (below, once hours are parsed) from which of Theory/Practical Hours is non-zero.
    const explicitProgrammeName = cell(row, "Programme", "Programme Name");
    const explicitCategory = cell(row, "Category");
    const explicitComponentType = cell(row, "Component Type", "Component");
    // Two ways to express credits: explicit Theory/Practical Credit columns (the original
    // template), or a single totalCredit that gets split below once componentType is known.
    // Hours (weekly/theory/practical) are captured alongside but don't feed credits or grading —
    // they're purely informational (see schema.sql) except as a Component Type signal below.
    const explicitTheoryCredit = cell(row, "Theory Credit", "Theory Credits");
    const explicitPracticalCredit = cell(row, "Practical Credit", "Practical Credits");
    const totalCreditStr = cell(row, "Total Credit", "totalCredit");
    const weeklyHoursStr = cell(row, "Weekly Hours", "weeklyHours");
    const theoryHoursStr = cell(row, "Theory Hours", "theoryHours");
    const practicalHoursStr = cell(row, "Practical Hours", "practicalHours");
    // Level/Semester: an explicit numeric column (old template), or the new batch ("2nd year")
    // and semester ("Semester 2") text columns — extractDigit() reads either style the same way.
    const levelStr = cell(row, "Level (optional — derived from code if blank)", "Level", "batch", "Batch");
    const semesterStr = cell(row, "Semester (optional — derived from code if blank)", "Semester", "semester");

    if (!code || !name) {
      results.push({ row: rowNum, code: code || "(blank)", status: "error", reason: "Missing a required column (Code/subjectCode, Name/subjectName)." });
      continue;
    }

    if (existingCodes.has(code.toUpperCase())) {
      results.push({ row: rowNum, code, name, status: "skipped", reason: "A course unit with this code already exists — left unchanged." });
      continue;
    }

    const programme = explicitProgrammeName
      ? programmes.find((p) => p.name.toLowerCase() === explicitProgrammeName.toLowerCase())
      : inferProgrammeFromCode(code, programmes);
    if (!programme) {
      results.push({
        row: rowNum, code, name, status: "error",
        reason: explicitProgrammeName
          ? `Unknown programme "${explicitProgrammeName}". Check spelling against the Programme list.`
          : `Couldn't work out the Programme from code "${code}" — add a Programme column for this row.`,
      });
      continue;
    }

    const category = (explicitCategory || inferCategoryFromCode(code) || "CORE").toUpperCase();
    if (!["CORE", "ELECTIVE", "ACU"].includes(category)) {
      results.push({ row: rowNum, code, name, status: "error", reason: `Category must be CORE, ELECTIVE or ACU (got "${category}").` });
      continue;
    }

    let level: number | null, semester: number | null;
    if (levelStr && semesterStr) {
      level = extractDigit(levelStr);
      semester = extractDigit(semesterStr);
    } else {
      const derived = deriveLevelSemesterFromCode(code);
      level = derived?.level ?? null;
      semester = derived?.semester ?? null;
    }
    if (level === null || semester === null) {
      results.push({
        row: rowNum, code, name, status: "error",
        reason: "Couldn't work out Level/Semester from the code — add them explicitly in the Level/Semester (or batch/semester) columns for this row.",
      });
      continue;
    }
    if (!Number.isInteger(level) || level < 1 || level > 4 || !Number.isInteger(semester) || semester < 1 || semester > 2) {
      results.push({ row: rowNum, code, name, status: "error", reason: "Level must be 1–4 and Semester must be 1–2." });
      continue;
    }

    const theoryHoursNum = Number(theoryHoursStr || "0");
    const practicalHoursNum = Number(practicalHoursStr || "0");
    // Component Type: explicit column wins; otherwise inferred from which of Theory/Practical
    // Hours is non-zero — both present gets BOTH, only one gets that one, neither falls back to
    // THEORY_ONLY (the same default the manual add form already uses).
    let componentType = (explicitComponentType || "").toUpperCase().replace(/\s+/g, "_");
    if (!componentType) {
      if (theoryHoursNum > 0 && practicalHoursNum > 0) componentType = "BOTH";
      else if (practicalHoursNum > 0) componentType = "PRACTICAL_ONLY";
      else componentType = "THEORY_ONLY";
    }
    if (!["THEORY_ONLY", "PRACTICAL_ONLY", "BOTH"].includes(componentType)) {
      results.push({ row: rowNum, code, name, status: "error", reason: `Component Type must be Theory Only, Practical Only or Both (got "${componentType}").` });
      continue;
    }

    // Theory/Practical credit: explicit columns win if present; otherwise split totalCredit by
    // componentType, proportioning a BOTH course's credit across its theory/practical hours (an
    // even split when no hours are given). Neither given at all just leaves both at 0, same as
    // today's behaviour when Theory/Practical Credit are left blank.
    let theoryCredit = 0;
    let practicalCredit = 0;
    if (explicitTheoryCredit || explicitPracticalCredit) {
      theoryCredit = Number(explicitTheoryCredit || "0");
      practicalCredit = Number(explicitPracticalCredit || "0");
    } else if (totalCreditStr) {
      const totalCredit = Number(totalCreditStr);
      if (componentType === "THEORY_ONLY") {
        theoryCredit = totalCredit;
      } else if (componentType === "PRACTICAL_ONLY") {
        practicalCredit = totalCredit;
      } else {
        const hoursSum = theoryHoursNum + practicalHoursNum;
        theoryCredit = hoursSum > 0 ? Math.round((totalCredit * theoryHoursNum / hoursSum) * 2) / 2 : totalCredit / 2;
        practicalCredit = totalCredit - theoryCredit;
      }
    }
    const weeklyHours = weeklyHoursStr ? Number(weeklyHoursStr) : null;
    const theoryHours = theoryHoursStr ? theoryHoursNum : null;
    const practicalHours = practicalHoursStr ? practicalHoursNum : null;

    try {
      await db.prepare(
        `INSERT INTO course_units (id, code, name, theory_credit, practical_credit, category, component_type, programme_id, level, semester, weekly_hours, theory_hours, practical_hours)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(newId(), code, name, theoryCredit, practicalCredit, category, componentType, programme.id, level, semester, weeklyHours, theoryHours, practicalHours);
      await logActivity(req.user!.id, "BULK_CREATE", "CourseUnit", undefined, { code });
      existingCodes.add(code.toUpperCase());
      results.push({ row: rowNum, code, name, status: "created" });
    } catch {
      results.push({ row: rowNum, code, name, status: "skipped", reason: "A course unit with this code already exists — left unchanged." });
    }
  }

  res.json({
    created: results.filter((r) => r.status === "created").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "error").length,
    results,
  });
});

// --- Lecturer teaching profile -------------------------------------------------------------

// The matrix columns are "<level>.<semester>" (e.g. "2.1" = Level 2, Semester 1), each holding a
// comma-separated list of course codes that lecturer teaches in that level/semester slot.
const LEVEL_SEMESTER_COLUMNS = ["1.1", "1.2", "2.1", "2.2", "3.1", "3.2", "4.1", "4.2"];

interface LecturerProfileRowResult {
  row: number;
  staffCode: string;
  name: string;
  status: "matched" | "error";
  reason?: string;
  offeringsCreated: number;
  offeringsSkipped: number;
  offeringsFailed: number;
  issues: string[];
}

router.get("/lecturer-profiles/template", async (_req, res) => {
  const departments = (await db.prepare("SELECT name FROM departments ORDER BY name").all()) as { name: string }[];
  const example: Record<string, any> = {
    staffCode: "DPS-001",
    name: "Mr. S. Kuhanesan",
    email: "kuhan9@vau.ac.lk",
    phone: "",
    qualification: "PHD in University of Jaffna",
    roleTitle: "Senior Lecturer Gr.I",
    department: departments[0]?.name ?? "Physical Science",
  };
  for (const col of LEVEL_SEMESTER_COLUMNS) example[col] = "";
  example["1.1"] = "IT1113,ACU1113";
  example["1.2"] = "IT1252";
  sendWorkbook(res, [example], "lecturer-teaching-profile-bulk-import-template.xlsx", "Lecturer Teaching Profile");
});

// Deliberately does NOT create lecturer accounts — account creation belongs to one place only
// (Accounts → Staff account, or its bulk import), so credentials/welcome-emails always go
// through that one flow. This route only ASSIGNS COURSES: it matches each row to an existing
// lecturer account by email, syncs their profile fields (department/designation/staffCode/
// qualification) from the sheet, and turns every non-empty Level.Semester cell into a real
// course_offering for the single academicYear supplied on the query string (the admin picks one
// year per upload). A row whose email doesn't match any account is reported as an error asking
// the admin to create that account first, rather than fabricating one. Re-uploading the same
// sheet is safe: a course_offerings row that already exists for (course, academicYear, semester)
// is just counted as "skipped", not an error, so importing an updated version of the sheet (or
// the same one twice) never fails the whole row over it.
router.post("/lecturer-profiles", upload.single("file"), async (req, res) => {
  const academicYear = String(req.query.academicYear || "").trim();
  if (!academicYear) return res.status(400).json({ error: "Missing academicYear — supply the academic year these course offerings belong to." });
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  let rows: Record<string, any>[];
  try {
    rows = parseWorkbookRows(req.file.buffer);
  } catch {
    return res.status(400).json({ error: "Could not read that file — upload a .xlsx or .csv file." });
  }
  if (rows.length === 0) return res.status(400).json({ error: "The file has no data rows." });

  const formatIssue = requireColumns(rows, [
    { label: "Name", candidates: ["name"] },
    { label: "Email", candidates: ["email"] },
    { label: "Department", candidates: ["department"] },
  ]);
  if (formatIssue) return res.status(400).json({ error: formatIssue });

  const departments = (await db.prepare("SELECT id, name FROM departments").all()) as { id: string; name: string }[];
  const results: LecturerProfileRowResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const staffCode = cell(row, "staffCode", "Staff Code");
    const name = cell(row, "name", "Full Name");
    const email = cell(row, "email", "Email");
    // phone: accepted but not persisted — no column for it on users or lecturers today.
    const qualification = cell(row, "qualification", "Qualification");
    const roleTitle = cell(row, "roleTitle", "Role Title", "Designation");
    const departmentName = cell(row, "department", "Department");

    if (!name || !email || !departmentName) {
      results.push({
        row: rowNum, staffCode, name: name || "(blank)", status: "error",
        reason: "Missing a required column (name, email, department).",
        offeringsCreated: 0, offeringsSkipped: 0, offeringsFailed: 0, issues: [],
      });
      continue;
    }
    const department = departments.find((d) => d.name.toLowerCase() === departmentName.toLowerCase());
    if (!department) {
      results.push({
        row: rowNum, staffCode, name, status: "error",
        reason: `Unknown department "${departmentName}". Check spelling against the Department list.`,
        offeringsCreated: 0, offeringsSkipped: 0, offeringsFailed: 0, issues: [],
      });
      continue;
    }

    let lecturerId: string;
    try {
      const existingUser = (await db.prepare("SELECT id, role FROM users WHERE LOWER(email) = LOWER(?)").get(email)) as
        | { id: string; role: string }
        | undefined;
      if (!existingUser) {
        results.push({
          row: rowNum, staffCode, name, status: "error",
          reason: `No account found for "${email}" — create this lecturer's account first (Accounts → Staff account, or the Staff bulk import), then re-upload this sheet to assign their courses.`,
          offeringsCreated: 0, offeringsSkipped: 0, offeringsFailed: 0, issues: [],
        });
        continue;
      }
      if (existingUser.role !== "LECTURER") {
        results.push({
          row: rowNum, staffCode, name, status: "error",
          reason: `"${email}" already belongs to a ${existingUser.role} account, not a lecturer.`,
          offeringsCreated: 0, offeringsSkipped: 0, offeringsFailed: 0, issues: [],
        });
        continue;
      }
      lecturerId = existingUser.id;
      // Account already exists — this only syncs their profile fields from the sheet, it never
      // creates a login (see the comment above this route).
      await db.prepare("UPDATE users SET full_name = ?, department_id = ? WHERE id = ?").run(name, department.id, lecturerId);
      await db.prepare(
        "UPDATE lecturers SET department_id = ?, designation = ?, staff_code = ?, qualification = ? WHERE user_id = ?"
      ).run(department.id, roleTitle || null, staffCode || null, qualification || null, lecturerId);
      await logActivity(req.user!.id, "UPDATE", "Lecturer", lecturerId);
    } catch {
      results.push({
        row: rowNum, staffCode, name, status: "error", reason: "Could not update this lecturer's profile.",
        offeringsCreated: 0, offeringsSkipped: 0, offeringsFailed: 0, issues: [],
      });
      continue;
    }

    let offeringsCreated = 0;
    let offeringsSkipped = 0;
    let offeringsFailed = 0;
    const issues: string[] = [];

    for (const col of LEVEL_SEMESTER_COLUMNS) {
      const cellValue = cell(row, col);
      if (!cellValue) continue;
      const [, levelStr, semesterStr] = col.match(/^(\d)\.(\d)$/) ?? [];
      const semester = Number(semesterStr);
      const codes = cellValue.split(",").map((c) => c.trim()).filter(Boolean);
      for (const code of codes) {
        const course = (await db.prepare("SELECT id FROM course_units WHERE UPPER(code) = UPPER(?)").get(code)) as { id: string } | undefined;
        if (!course) {
          offeringsFailed++;
          issues.push(`${col}: unknown course code "${code}".`);
          continue;
        }
        try {
          await db.prepare(
            `INSERT INTO course_offerings (id, course_id, lecturer_id, academic_year, semester, assigned_by_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(newId(), course.id, lecturerId, academicYear, semester, req.user!.id, nowIso());
          offeringsCreated++;
        } catch {
          // Unique(course_id, academic_year, semester) already exists — treat re-imports as
          // idempotent rather than failing the row.
          offeringsSkipped++;
        }
      }
      void levelStr; // level isn't stored on course_offerings (course_units already has its own level) — kept only for the column-header parse above.
    }

    results.push({ row: rowNum, staffCode, name, status: "matched", offeringsCreated, offeringsSkipped, offeringsFailed, issues });
  }

  res.json({
    lecturers: results.length,
    matched: results.filter((r) => r.status === "matched").length,
    failed: results.filter((r) => r.status === "error").length,
    offeringsCreated: results.reduce((sum, r) => sum + r.offeringsCreated, 0),
    offeringsSkipped: results.reduce((sum, r) => sum + r.offeringsSkipped, 0),
    offeringsFailed: results.reduce((sum, r) => sum + r.offeringsFailed, 0),
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
