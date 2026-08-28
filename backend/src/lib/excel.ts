// Thin wrapper around SheetJS (`xlsx`) for the bulk-import / bulk-export features. Accepts
// both .xlsx and .csv uploads — SheetJS auto-detects the format from the buffer.
import * as XLSX from "xlsx";

/** Parses an uploaded workbook's first sheet into an array of row objects, keyed by the
 *  header row (trimmed, case-insensitive access is the caller's job). Blank rows are dropped. */
export function parseWorkbookRows(buffer: Buffer): Record<string, any>[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
  return rows.filter((r) => Object.values(r).some((v) => String(v).trim() !== ""));
}

function normalizeKey(k: string) {
  return k.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/** Case/whitespace-insensitive column lookup — spreadsheets from real users rarely match a
 *  header exactly ("Reg No" vs "registration_no" vs "Registration Number "). */
export function cell(row: Record<string, any>, ...candidates: string[]): string {
  const normalized = Object.keys(row).reduce<Record<string, any>>((acc, k) => {
    acc[normalizeKey(k)] = row[k];
    return acc;
  }, {});
  for (const c of candidates) {
    const key = normalizeKey(c);
    if (normalized[key] !== undefined && String(normalized[key]).trim() !== "") {
      return String(normalized[key]).trim();
    }
  }
  return "";
}

/** Checks that an uploaded sheet actually has (at least one of each set of) the columns a
 *  template expects, using the same normalized matching as `cell()`. This runs once, on the
 *  first row, before any per-row processing — its job is to turn "every single row failed with
 *  a confusing per-row reason" into one clear message the moment someone uploads the wrong
 *  file, a re-saved/renamed-header copy, or a sheet from a totally different feature.
 *  `columnGroups` is an array of "at least one of these header spellings must be present"
 *  groups; `label` is what to call each group in the error message (e.g. "Registration No"). */
export function requireColumns(
  rows: Record<string, any>[],
  columnGroups: { label: string; candidates: string[] }[]
): string | null {
  if (rows.length === 0) return null;
  const presentKeys = new Set(Object.keys(rows[0]).map(normalizeKey));
  const missing = columnGroups.filter(
    (g) => !g.candidates.some((c) => presentKeys.has(normalizeKey(c)))
  );
  if (missing.length === 0) return null;
  const expectedCols = columnGroups.map((g) => `"${g.candidates[0]}"`).join(", ");
  const missingLabels = missing.map((g) => `"${g.candidates[0]}"`).join(", ");
  return (
    `This file doesn't look like the template — missing column(s): ${missingLabels}. ` +
    `Expected columns: ${expectedCols}. Use the "Download template" button above rather than a ` +
    `hand-built or re-saved sheet, and don't rename or remove its header row.`
  );
}

/** Builds a single-sheet .xlsx file buffer from an array of row objects. */
export function buildWorkbook(rows: Record<string, any>[], sheetName = "Sheet1"): Buffer {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function sendWorkbook(res: any, rows: Record<string, any>[], filename: string, sheetName = "Sheet1") {
  const buffer = buildWorkbook(rows, sheetName);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}
