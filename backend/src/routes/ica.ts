import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { db, newId, nowIso } from "../db/client";
import { requireAuth, requireRole } from "../middleware/auth";
import { logActivity } from "../lib/activityLog";
import { parseWorkbookRows, cell, sendWorkbook, requireColumns } from "../lib/excel";

const router = Router();
router.use(requireAuth, requireRole("LECTURER"));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function badRequest(res: any, issue?: string) {
  return res.status(400).json({ error: issue ?? "Invalid request." });
}

/** A Lecturer may only touch an offering they were assigned to, and only while every enrolled
 *  student's Result is still ICA_OPEN — once final marks are submitted, ICA marks lock too
 *  (Table 3: "edit any mark for a course after submitting its final marks"). */
async function assertEditableOffering(offeringId: string, lecturerId: string) {
  const offering = await db.prepare("SELECT * FROM course_offerings WHERE id = ?").get(offeringId);
  if (!offering) throw { status: 404, message: "Course offering not found." };
  if (offering.lecturer_id !== lecturerId) {
    throw { status: 403, message: "You are not the lecturer assigned to this course offering." };
  }
  const locked = (await db
    .prepare(
      `SELECT COUNT(*) AS c FROM results r JOIN enrollments e ON e.id = r.enrollment_id
       WHERE e.offering_id = ? AND r.status != 'ICA_OPEN'`
    )
    .get(offeringId)) as { c: number };
  if (Number(locked.c) > 0) {
    throw { status: 403, message: "Final marks have already been submitted for this course — ICA marks are locked." };
  }
  return offering;
}

router.get("/offerings/:offeringId/instruments", async (req, res) => {
  const offering = await db.prepare("SELECT * FROM course_offerings WHERE id = ?").get(req.params.offeringId);
  if (!offering || offering.lecturer_id !== req.user!.id) {
    return res.status(403).json({ error: "You are not the lecturer assigned to this course offering." });
  }
  res.json(
    await db.prepare("SELECT * FROM ica_instruments WHERE offering_id = ? ORDER BY component, sequence_no").all(req.params.offeringId)
  );
});

const instrumentSchema = z.object({
  name: z.string().min(1),
  component: z.enum(["THEORY", "PRACTICAL"]),
  maxMarks: z.number().positive(),
  sequenceNo: z.number().int().positive(),
});

router.post("/offerings/:offeringId/instruments", async (req, res) => {
  try {
    await assertEditableOffering(req.params.offeringId, req.user!.id);
  } catch (e: any) {
    return res.status(e.status ?? 500).json({ error: e.message });
  }
  const parsed = instrumentSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message);
  const id = newId();
  const d = parsed.data;
  await db.prepare(
    `INSERT INTO ica_instruments (id, offering_id, name, component, max_marks, sequence_no, released)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).run(id, req.params.offeringId, d.name, d.component, d.maxMarks, d.sequenceNo);
  await logActivity(req.user!.id, "CREATE", "ICAInstrument", id);
  res.status(201).json({ id, offeringId: req.params.offeringId, ...d, released: false });
});

async function getOwnedInstrument(instrumentId: string, lecturerId: string) {
  const instrument = await db
    .prepare(
      `SELECT ii.*, co.lecturer_id FROM ica_instruments ii
       JOIN course_offerings co ON co.id = ii.offering_id WHERE ii.id = ?`
    )
    .get(instrumentId);
  if (!instrument) throw { status: 404, message: "ICA instrument not found." };
  if (instrument.lecturer_id !== lecturerId) {
    throw { status: 403, message: "You are not the lecturer assigned to this course offering." };
  }
  return instrument;
}

router.patch("/instruments/:id", async (req, res) => {
  let instrument;
  try {
    instrument = await getOwnedInstrument(req.params.id, req.user!.id);
    await assertEditableOffering(instrument.offering_id, req.user!.id);
  } catch (e: any) {
    return res.status(e.status ?? 500).json({ error: e.message });
  }
  const schema = z.object({
    name: z.string().min(1).optional(),
    maxMarks: z.number().positive().optional(),
    sequenceNo: z.number().int().positive().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message);
  const d = parsed.data;
  await db.prepare(
    `UPDATE ica_instruments SET name = COALESCE(?, name), max_marks = COALESCE(?, max_marks), sequence_no = COALESCE(?, sequence_no) WHERE id = ?`
  ).run(d.name ?? null, d.maxMarks ?? null, d.sequenceNo ?? null, req.params.id);
  await logActivity(req.user!.id, "UPDATE", "ICAInstrument", req.params.id);
  res.json({ ok: true });
});

// The lecturer's own discretion — releasing an ICA's grade to students is independent of the
// final-marks lifecycle and does not require the offering to still be editable.
router.post("/instruments/:id/release", async (req, res) => {
  try {
    await getOwnedInstrument(req.params.id, req.user!.id);
  } catch (e: any) {
    return res.status(e.status ?? 500).json({ error: e.message });
  }
  const schema = z.object({ released: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return badRequest(res);
  await db.prepare("UPDATE ica_instruments SET released = ? WHERE id = ?").run(parsed.data.released ? 1 : 0, req.params.id);
  await logActivity(req.user!.id, parsed.data.released ? "RELEASE_ICA_GRADE" : "UNRELEASE_ICA_GRADE", "ICAInstrument", req.params.id);
  res.json({ ok: true });
});

router.get("/instruments/:id/marks", async (req, res) => {
  try {
    await getOwnedInstrument(req.params.id, req.user!.id);
  } catch (e: any) {
    return res.status(e.status ?? 500).json({ error: e.message });
  }
  const instrument = await db.prepare("SELECT * FROM ica_instruments WHERE id = ?").get(req.params.id);
  const rows = await db
    .prepare(
      `SELECT e.student_id, s.registration_no, u.full_name, im.mark
       FROM enrollments e
       JOIN students s ON s.user_id = e.student_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN ica_marks im ON im.instrument_id = ? AND im.student_id = e.student_id
       WHERE e.offering_id = ?
       ORDER BY s.registration_no`
    )
    .all(req.params.id, instrument.offering_id);
  res.json(rows);
});

const bulkMarksSchema = z.object({
  marks: z.array(z.object({ studentId: z.string().min(1), mark: z.number().min(0) })),
});

router.put("/instruments/:id/marks", async (req, res) => {
  let instrument;
  try {
    instrument = await getOwnedInstrument(req.params.id, req.user!.id);
    await assertEditableOffering(instrument.offering_id, req.user!.id);
  } catch (e: any) {
    return res.status(e.status ?? 500).json({ error: e.message });
  }
  const parsed = bulkMarksSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message);

  for (const { studentId, mark } of parsed.data.marks) {
    if (mark > instrument.max_marks) {
      return badRequest(res, `Mark ${mark} exceeds this instrument's maximum of ${instrument.max_marks}.`);
    }
    const existing = (await db
      .prepare("SELECT id FROM ica_marks WHERE instrument_id = ? AND student_id = ?")
      .get(req.params.id, studentId)) as { id: string } | undefined;
    if (existing) {
      await db.prepare("UPDATE ica_marks SET mark = ?, entered_at = ? WHERE id = ?").run(mark, nowIso(), existing.id);
    } else {
      await db.prepare(
        "INSERT INTO ica_marks (id, instrument_id, student_id, mark, entered_at) VALUES (?, ?, ?, ?, ?)"
      ).run(newId(), req.params.id, studentId, mark, nowIso());
    }
  }
  await logActivity(req.user!.id, "ENTER_ICA_MARKS", "ICAInstrument", req.params.id, { count: parsed.data.marks.length });
  res.json({ ok: true, updated: parsed.data.marks.length });
});

// --- Bulk upload via Excel/CSV ---------------------------------------------------------------

/** Registration-number-keyed template pre-filled with every enrolled student, so the lecturer
 *  only has to type marks into one column and re-upload. */
router.get("/instruments/:id/marks-template", async (req, res) => {
  let instrument;
  try {
    instrument = await getOwnedInstrument(req.params.id, req.user!.id);
  } catch (e: any) {
    return res.status(e.status ?? 500).json({ error: e.message });
  }
  const rows = (await db
    .prepare(
      `SELECT s.registration_no, u.full_name, im.mark
       FROM enrollments e
       JOIN students s ON s.user_id = e.student_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN ica_marks im ON im.instrument_id = ? AND im.student_id = e.student_id
       WHERE e.offering_id = ?
       ORDER BY s.registration_no`
    )
    .all(req.params.id, instrument.offering_id)) as { registration_no: string; full_name: string; mark: number | null }[];

  const sheetRows = rows.map((r) => ({
    "Registration No": r.registration_no,
    "Full Name": r.full_name,
    [`Mark (out of ${instrument.max_marks})`]: r.mark ?? "",
  }));
  sendWorkbook(res, sheetRows, `${instrument.name.replace(/[^a-z0-9]+/gi, "-")}-marks-template.xlsx`, "ICA Marks");
});

router.post("/instruments/:id/marks/bulk-upload", upload.single("file"), async (req, res) => {
  let instrument;
  try {
    instrument = await getOwnedInstrument(req.params.id, req.user!.id);
    await assertEditableOffering(instrument.offering_id, req.user!.id);
  } catch (e: any) {
    return res.status(e.status ?? 500).json({ error: e.message });
  }
  if (!req.file) return badRequest(res, "No file uploaded.");

  let rows: Record<string, any>[];
  try {
    rows = parseWorkbookRows(req.file.buffer);
  } catch {
    return badRequest(res, "Could not read that file — upload a .xlsx or .csv file.");
  }
  if (rows.length === 0) return badRequest(res, "The file has no data rows.");

  const formatIssue = requireColumns(rows, [
    { label: "Registration No", candidates: ["Registration No", "Registration Number", "Reg No"] },
    { label: "Mark", candidates: [`Mark (out of ${instrument.max_marks})`, "Mark", "Marks"] },
  ]);
  if (formatIssue) return badRequest(res, formatIssue);

  const roster = (await db
    .prepare(
      `SELECT e.student_id, s.registration_no FROM enrollments e
       JOIN students s ON s.user_id = e.student_id WHERE e.offering_id = ?`
    )
    .all(instrument.offering_id)) as { student_id: string; registration_no: string }[];
  const byRegNo = new Map(roster.map((r) => [r.registration_no.toLowerCase(), r.student_id]));

  const results: { row: number; registrationNo: string; status: "updated" | "error"; reason?: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const regNo = cell(row, "Registration No", "Registration Number", "Reg No");
    const markStr = cell(row, `Mark (out of ${instrument.max_marks})`, "Mark", "Marks");
    if (!regNo) {
      results.push({ row: rowNum, registrationNo: "(blank)", status: "error", reason: "Missing Registration No." });
      continue;
    }
    const studentId = byRegNo.get(regNo.toLowerCase());
    if (!studentId) {
      results.push({ row: rowNum, registrationNo: regNo, status: "error", reason: "Not enrolled in this course offering." });
      continue;
    }
    if (markStr === "") {
      results.push({ row: rowNum, registrationNo: regNo, status: "error", reason: "No mark given — left blank." });
      continue;
    }
    const mark = Number(markStr);
    if (Number.isNaN(mark) || mark < 0 || mark > instrument.max_marks) {
      results.push({ row: rowNum, registrationNo: regNo, status: "error", reason: `Mark must be a number between 0 and ${instrument.max_marks}.` });
      continue;
    }
    const existing = (await db
      .prepare("SELECT id FROM ica_marks WHERE instrument_id = ? AND student_id = ?")
      .get(req.params.id, studentId)) as { id: string } | undefined;
    if (existing) {
      await db.prepare("UPDATE ica_marks SET mark = ?, entered_at = ? WHERE id = ?").run(mark, nowIso(), existing.id);
    } else {
      await db.prepare(
        "INSERT INTO ica_marks (id, instrument_id, student_id, mark, entered_at) VALUES (?, ?, ?, ?, ?)"
      ).run(newId(), req.params.id, studentId, mark, nowIso());
    }
    results.push({ row: rowNum, registrationNo: regNo, status: "updated" });
  }

  const updated = results.filter((r) => r.status === "updated").length;
  await logActivity(req.user!.id, "BULK_ENTER_ICA_MARKS", "ICAInstrument", req.params.id, { updated });
  res.json({ updated, failed: results.length - updated, results });
});

export default router;
