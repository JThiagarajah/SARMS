import { useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useApi } from "../../lib/useApi";
import { api, ApiError, downloadFile, uploadFile } from "../../api/client";
import { StatusBadge } from "../../components/StatusBadge";

interface BulkRowResult { row: number; status: "updated" | "submitted" | "error"; reason?: string; registrationNo?: string }
interface BulkUploadResponse { updated?: number; submitted?: number; failed: number; results: BulkRowResult[] }

/** Shared "download template / upload filled-in file" control used for both the ICA-marks and
 *  final-marks bulk-import flows below. Requires an explicit second "Confirm & upload" click
 *  after a file is chosen — the first click only shows what's about to happen — so a lecturer
 *  never fires off a bulk submission by a single misclick. Reports a row-by-row summary after
 *  upload. */
function BulkUploadControl({
  templatePath,
  templateFilename,
  uploadPath,
  successLabel,
  confirmWarning,
  onDone,
  onResult,
}: {
  templatePath: string;
  templateFilename: string;
  uploadPath: string;
  successLabel: string;
  confirmWarning?: string;
  onDone: () => void;
  onResult?: (res: BulkUploadResponse) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [chosenName, setChosenName] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkUploadResponse | null>(null);

  function onFileChosen() {
    const file = fileRef.current?.files?.[0];
    setChosenName(file ? file.name : null);
    setConfirming(false);
    setResult(null);
    setError(null);
  }

  function reviewUpload() {
    if (!fileRef.current?.files?.[0]) {
      setError("Choose a file first.");
      return;
    }
    setError(null);
    setConfirming(true);
  }

  async function confirmUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first.");
      setConfirming(false);
      return;
    }
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const res = await uploadFile<BulkUploadResponse>(uploadPath, file);
      setResult(res);
      onResult?.(res);
      if (fileRef.current) fileRef.current.value = "";
      setChosenName(null);
      setConfirming(false);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not process that file.");
    } finally {
      setUploading(false);
    }
  }

  const successCount = result ? result.updated ?? result.submitted ?? 0 : 0;

  return (
    <div className="card" style={{ background: "var(--bg-subtle, #f7f7f8)" }}>
      <div className="gap-8" style={{ alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <button className="small secondary" onClick={() => downloadFile(templatePath, templateFilename)}>
          Download template
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFileChosen} />
        {!confirming && (
          <button className="small" onClick={reviewUpload} disabled={uploading || !chosenName}>
            Review &amp; upload
          </button>
        )}
      </div>
      {confirming && (
        <div className="banner banner-info" style={{ marginBottom: 8 }}>
          <div style={{ marginBottom: 8 }}>
            About to upload <strong>{chosenName}</strong>. {confirmWarning ?? "This will apply every row in the file."}
          </div>
          <div className="gap-8">
            <button className="small" onClick={confirmUpload} disabled={uploading}>
              {uploading ? "Uploading…" : "Confirm & upload"}
            </button>
            <button className="small secondary" onClick={() => setConfirming(false)} disabled={uploading}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <div className="banner banner-error">{error}</div>}
      {result && (
        <div>
          <div className={`banner ${result.failed > 0 ? "banner-error" : "banner-success"}`}>
            {successCount} {successLabel}, {result.failed} failed.
          </div>
          {result.results.some((r) => r.status === "error") && (
            <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Row</th><th>Reg. No.</th><th>Reason</th></tr></thead>
              <tbody>
                {result.results.filter((r) => r.status === "error").map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.registrationNo ?? "—"}</td>
                    <td>{r.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface Offering {
  id: string;
  course_code: string;
  course_name: string;
  component_type: "THEORY_ONLY" | "PRACTICAL_ONLY" | "BOTH";
}
interface Instrument {
  id: string;
  name: string;
  component: "THEORY" | "PRACTICAL";
  max_marks: number;
  sequence_no: number;
  released: 0 | 1;
}
interface StudentMark { student_id: string; registration_no: string; full_name: string; mark: number | null }
interface ResultRow {
  id: string; enrollment_id: string; registration_no: string; student_name: string;
  status: string; ese_theory: number | null; ese_practical: number | null;
  final_mark: number | null; grade: string | null;
}

type Tab = "ica" | "final" | "results";

export function LecturerOffering() {
  const { id = "" } = useParams();
  const offerings = useApi<Offering[]>(() => api.get("/academic/my-offerings"));
  const offering = offerings.data?.find((o) => o.id === id);

  const instruments = useApi<Instrument[]>(() => api.get(`/ica/offerings/${id}/instruments`), [id]);
  const results = useApi<ResultRow[]>(() => api.get(`/results/offerings/${id}`), [id]);
  const [tab, setTab] = useState<Tab>("ica");

  const pendingCount = (results.data ?? []).filter((r) => r.status === "ICA_OPEN").length;
  const submittedCount = (results.data ?? []).length - pendingCount;

  return (
    <div>
      <div className="page-header">
        <h1>{offering ? `${offering.course_code} — ${offering.course_name}` : "Course offering"}</h1>
        <p>Manage ICA instruments, marks, and the final-marks submission for this course.</p>
      </div>

      <div className="tab-bar">
        <button className={`tab ${tab === "ica" ? "active" : ""}`} onClick={() => setTab("ica")}>
          ICA marks
          {instruments.data && instruments.data.length > 0 && <span className="tab-count">{instruments.data.length}</span>}
        </button>
        <button className={`tab ${tab === "final" ? "active" : ""}`} onClick={() => setTab("final")}>
          Final marks (ESE)
          {pendingCount > 0 && <span className="tab-count tab-count-amber">{pendingCount} pending</span>}
        </button>
        <button className={`tab ${tab === "results" ? "active" : ""}`} onClick={() => setTab("results")}>
          Results
          {submittedCount > 0 && <span className="tab-count">{submittedCount}</span>}
        </button>
      </div>

      {tab === "ica" && (
        <div>
          <p className="muted" style={{ marginTop: -4 }}>
            Set up instruments (quizzes, assignments, in-class tests) and enter each student's In-Course Assessment
            marks here. This tab is separate from Final marks below — ICA stays open until you submit the course's
            final marks, at which point both lock together.
          </p>
          <InstrumentsCard offeringId={id} instruments={instruments} />
          {instruments.data && instruments.data.length > 0 && <MarksEntryCard instruments={instruments.data} />}
        </div>
      )}

      {tab === "final" && offering && (
        <div>
          <p className="muted" style={{ marginTop: -4 }}>
            Enter the End-of-Semester Examination (ESE) mark for each student and submit the course's final result.
            This is a separate step from ICA above — nothing here affects ICA marks until you actually submit.
          </p>
          <FinalMarksCard offeringId={id} componentType={offering.component_type} results={results} />
        </div>
      )}

      {tab === "results" && (
        <ResultsCard offeringId={id} courseCode={offering?.course_code ?? "course"} results={results} />
      )}
    </div>
  );
}

function InstrumentsCard({ offeringId, instruments }: { offeringId: string; instruments: ReturnType<typeof useApi<Instrument[]>> }) {
  const [name, setName] = useState("");
  const [component, setComponent] = useState<"THEORY" | "PRACTICAL">("THEORY");
  const [maxMarks, setMaxMarks] = useState("20");
  const [seq, setSeq] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const locked = instruments.data?.length === 0 && false;

  async function addInstrument(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/ica/offerings/${offeringId}/instruments`, {
        name,
        component,
        maxMarks: Number(maxMarks),
        sequenceNo: Number(seq),
      });
      setName("");
      instruments.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add instrument.");
    }
  }

  async function toggleRelease(instrumentId: string, released: boolean) {
    await api.post(`/ica/instruments/${instrumentId}/release`, { released });
    instruments.reload();
  }

  return (
    <div className="card">
      <h2>ICA instruments</h2>
      {error && <div className="banner banner-error">{error}</div>}
      {instruments.data && instruments.data.length > 0 && (
        <div style={{ overflowX: "auto" }}>
        <table style={{ marginBottom: 16 }}>
          <thead><tr><th>Name</th><th>Component</th><th>Max</th><th>Released to students</th></tr></thead>
          <tbody>
            {instruments.data.map((i) => (
              <tr key={i.id}>
                <td>{i.name}</td>
                <td>{i.component}</td>
                <td>{i.max_marks}</td>
                <td>
                  <button className={`small ${i.released ? "secondary" : ""}`} onClick={() => toggleRelease(i.id, !i.released)}>
                    {i.released ? "Released — click to hide" : "Not released — click to release"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      <form onSubmit={addInstrument} className="form-row" style={{ alignItems: "flex-end" }}>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. In-class Test 1" required disabled={locked} />
        </div>
        <div className="field">
          <label>Component</label>
          <select value={component} onChange={(e) => setComponent(e.target.value as "THEORY" | "PRACTICAL")}>
            <option value="THEORY">Theory</option>
            <option value="PRACTICAL">Practical</option>
          </select>
        </div>
        <div className="field">
          <label>Max marks</label>
          <input type="number" min={1} value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} required />
        </div>
        <div className="field">
          <label>Order</label>
          <input type="number" min={1} value={seq} onChange={(e) => setSeq(e.target.value)} required />
        </div>
        <button type="submit">Add instrument</button>
      </form>
    </div>
  );
}

function MarksEntryCard({ instruments }: { instruments: Instrument[] }) {
  const [selected, setSelected] = useState(instruments[0]?.id ?? "");
  const marks = useApi<StudentMark[]>(() => api.get(`/ica/instruments/${selected}/marks`), [selected]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const instrument = instruments.find((i) => i.id === selected);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = Object.entries(edits)
        .filter(([, v]) => v !== "")
        .map(([studentId, v]) => ({ studentId, mark: Number(v) }));
      await api.put(`/ica/instruments/${selected}/marks`, { marks: payload });
      setEdits({});
      marks.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save marks.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>Enter ICA marks</h2>
      <div className="field" style={{ maxWidth: 320 }}>
        <label>Instrument</label>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {instruments.map((i) => (
            <option key={i.id} value={i.id}>{i.name} ({i.component}, out of {i.max_marks})</option>
          ))}
        </select>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {marks.data && (
        <div style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Reg. No.</th><th>Name</th><th style={{ width: 120 }}>Mark (/{instrument?.max_marks})</th></tr></thead>
          <tbody>
            {marks.data.map((m) => (
              <tr key={m.student_id}>
                <td>{m.registration_no}</td>
                <td>{m.full_name}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={instrument?.max_marks}
                    value={edits[m.student_id] ?? m.mark ?? ""}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [m.student_id]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      <div style={{ marginTop: 12, marginBottom: 20 }}>
        <button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save marks"}</button>
      </div>

      {selected && (
        <div>
          <h3 style={{ marginBottom: 8 }}>Or upload marks in bulk</h3>
          <p className="muted" style={{ marginTop: -6 }}>
            Download the template for <strong>{instrument?.name}</strong>, fill in the Mark column in Excel, then
            upload it here. Existing marks for students left blank in the file are left unchanged.
          </p>
          <BulkUploadControl
            key={selected}
            templatePath={`/ica/instruments/${selected}/marks-template`}
            templateFilename={`${instrument?.name ?? "ica"}-marks-template.xlsx`}
            uploadPath={`/ica/instruments/${selected}/marks/bulk-upload`}
            successLabel="mark(s) updated"
            confirmWarning="Marks for any student listed in the file will be overwritten with the file's values."
            onDone={() => marks.reload()}
          />
        </div>
      )}
    </div>
  );
}

function FinalMarksCard({
  offeringId,
  componentType,
  results,
}: {
  offeringId: string;
  componentType: "THEORY_ONLY" | "PRACTICAL_ONLY" | "BOTH";
  results: ReturnType<typeof useApi<ResultRow[]>>;
}) {
  const total = results.data ?? [];
  const pending = total.filter((r) => r.status === "ICA_OPEN");
  const [entries, setEntries] = useState<Record<string, { theory: string; practical: string }>>({});
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept at this level (not inside BulkUploadControl) so the confirmation survives even when the
  // bulk upload submits every remaining student and `pending` drops to zero right after — otherwise
  // the whole card (and its result banner) would vanish the instant the reload completes.
  const [bulkResult, setBulkResult] = useState<BulkUploadResponse | null>(null);

  // This card is now ALWAYS shown while the offering exists (never returns null) — it used to
  // disappear silently whenever there was nothing pending and no fresh bulk result, which made
  // the whole final-marks / bulk-ESE-upload feature look like it didn't exist. Every state below
  // renders something explaining what's going on instead.

  function reviewEntries() {
    setError(null);
    const missing = pending.filter((r) => {
      const e = entries[r.enrollment_id];
      const needsTheory = componentType !== "PRACTICAL_ONLY";
      const needsPractical = componentType !== "THEORY_ONLY";
      if (needsTheory && (!e || e.theory === "")) return true;
      if (needsPractical && (!e || e.practical === "")) return true;
      return false;
    });
    if (missing.length > 0) {
      setError(`Enter a mark for every student before reviewing — ${missing.length} student(s) still missing a mark.`);
      return;
    }
    setReviewing(true);
  }

  async function confirmSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const payload = pending.map((r) => ({
        enrollmentId: r.enrollment_id,
        eseTheory: componentType !== "PRACTICAL_ONLY" ? Number(entries[r.enrollment_id]?.theory ?? 0) : undefined,
        esePractical: componentType !== "THEORY_ONLY" ? Number(entries[r.enrollment_id]?.practical ?? 0) : undefined,
      }));
      await api.post(`/results/offerings/${offeringId}/submit`, { entries: payload });
      setReviewing(false);
      results.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not submit final marks.");
      setReviewing(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <h2>Submit final marks</h2>

      {total.length === 0 && (
        <div className="empty-state">No students are enrolled in this course offering yet — nothing to submit.</div>
      )}

      {total.length > 0 && pending.length === 0 && !bulkResult && (
        <div className="banner banner-success">
          All final marks for this course have already been submitted. See the <strong>Results</strong> tab above.
        </div>
      )}

      {pending.length > 0 && !reviewing && (
        <>
          <p className="muted" style={{ marginTop: -6 }}>
            Enter the End-of-Semester Examination (ESE) mark for each student. M1/M2 and the Final Result are
            computed automatically from ICA marks already entered. Submitting locks all ICA and final marks for
            this course — you'll get a chance to review everything before it's final.
          </p>
          {error && <div className="banner banner-error">{error}</div>}
          <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Reg. No.</th>
                <th>Name</th>
                {componentType !== "PRACTICAL_ONLY" && <th style={{ width: 120 }}>ESE Theory (/100)</th>}
                {componentType !== "THEORY_ONLY" && <th style={{ width: 120 }}>ESE Practical (/100)</th>}
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.enrollment_id}>
                  <td>{r.registration_no}</td>
                  <td>{r.student_name}</td>
                  {componentType !== "PRACTICAL_ONLY" && (
                    <td>
                      <input
                        type="number" min={0} max={100}
                        value={entries[r.enrollment_id]?.theory ?? ""}
                        onChange={(e) => setEntries((p) => ({ ...p, [r.enrollment_id]: { theory: e.target.value, practical: p[r.enrollment_id]?.practical ?? "" } }))}
                      />
                    </td>
                  )}
                  {componentType !== "THEORY_ONLY" && (
                    <td>
                      <input
                        type="number" min={0} max={100}
                        value={entries[r.enrollment_id]?.practical ?? ""}
                        onChange={(e) => setEntries((p) => ({ ...p, [r.enrollment_id]: { theory: p[r.enrollment_id]?.theory ?? "", practical: e.target.value } }))}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div style={{ marginTop: 12, marginBottom: 20 }}>
            <button onClick={reviewEntries}>Review before submitting ({pending.length} student(s))</button>
          </div>

          <h3 style={{ marginBottom: 8 }}>Or upload final marks in bulk</h3>
          <p className="muted" style={{ marginTop: -6 }}>
            Download the template, fill in the ESE mark(s) for each student in Excel, then upload it here. Each row
            is submitted and graded the same way as the form above — students left blank in the file are skipped.
          </p>
          <BulkUploadControl
            templatePath={`/results/offerings/${offeringId}/submit-template`}
            templateFilename="final-marks-submit-template.xlsx"
            uploadPath={`/results/offerings/${offeringId}/submit/bulk-upload`}
            successLabel="student(s) submitted"
            confirmWarning="This locks ICA and final marks for every student included in the file — it cannot be undone."
            onDone={() => results.reload()}
            onResult={setBulkResult}
          />
        </>
      )}

      {pending.length > 0 && reviewing && (
        <div>
          <div className="banner banner-info">
            <strong>Step 2 of 2 — confirm and submit.</strong> Review the marks below. Once you confirm, ICA and
            final marks for these {pending.length} student(s) lock immediately and this cannot be undone from here —
            you'd need to ask your HOD for a correction afterwards.
          </div>
          {error && <div className="banner banner-error">{error}</div>}
          <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Reg. No.</th>
                <th>Name</th>
                {componentType !== "PRACTICAL_ONLY" && <th>ESE Theory</th>}
                {componentType !== "THEORY_ONLY" && <th>ESE Practical</th>}
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.enrollment_id}>
                  <td>{r.registration_no}</td>
                  <td>{r.student_name}</td>
                  {componentType !== "PRACTICAL_ONLY" && <td className="mono">{entries[r.enrollment_id]?.theory}</td>}
                  {componentType !== "THEORY_ONLY" && <td className="mono">{entries[r.enrollment_id]?.practical}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="gap-8" style={{ marginTop: 14, marginBottom: 8 }}>
            <button onClick={confirmSubmit} disabled={submitting}>
              {submitting ? "Submitting…" : `Confirm & submit final marks for ${pending.length} student(s)`}
            </button>
            <button className="secondary" onClick={() => setReviewing(false)} disabled={submitting}>
              Back to edit
            </button>
          </div>
        </div>
      )}

      {pending.length === 0 && bulkResult && (
        <div>
          <div className={`banner ${bulkResult.failed > 0 ? "banner-error" : "banner-success"}`}>
            {bulkResult.submitted ?? bulkResult.updated ?? 0} student(s) submitted via bulk upload, {bulkResult.failed} failed.
            All final marks for this course have now been submitted.
          </div>
          {bulkResult.results.some((r) => r.status === "error") && (
            <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Row</th><th>Reg. No.</th><th>Reason</th></tr></thead>
              <tbody>
                {bulkResult.results.filter((r) => r.status === "error").map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.registrationNo ?? "—"}</td>
                    <td>{r.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultsCard({ offeringId, courseCode, results }: { offeringId: string; courseCode: string; results: ReturnType<typeof useApi<ResultRow[]>> }) {
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submitted = (results.data ?? []).filter((r) => r.status !== "ICA_OPEN");

  async function requestCorrection(resultId: string) {
    try {
      await api.post(`/results/${resultId}/corrections`, { reason });
      setReasonFor(null);
      setReason("");
      results.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not request correction.");
    }
  }

  return (
    <div className="card">
      <div className="flex-between">
        <h2>Results</h2>
        {submitted.length > 0 && (
          <button className="secondary small" onClick={() => downloadFile(`/pdf/offerings/${offeringId}/result-sheet`, `${courseCode}-result-sheet.pdf`)}>
            Download PDF
          </button>
        )}
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {submitted.length === 0 && <div className="empty-state">No final marks submitted yet for this course.</div>}
      {submitted.length > 0 && (
        <div style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Reg. No.</th><th>Name</th><th>Final mark</th><th>Grade</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {submitted.map((r) => (
              <tr key={r.id}>
                <td>{r.registration_no}</td>
                <td>{r.student_name}</td>
                <td className="mono">{r.final_mark != null ? r.final_mark.toFixed(1) : "—"}</td>
                <td><strong>{r.grade ?? "—"}</strong></td>
                <td><StatusBadge status={r.status} /></td>
                <td className="text-right">
                  {r.status !== "RELEASED" && (
                    reasonFor === r.id ? (
                      <span className="gap-8">
                        <input style={{ width: 220 }} placeholder="Reason for correction…" value={reason} onChange={(e) => setReason(e.target.value)} />
                        <button className="small" onClick={() => requestCorrection(r.id)}>Send</button>
                        <button className="small secondary" onClick={() => setReasonFor(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button className="small ghost" onClick={() => setReasonFor(r.id)}>Request correction</button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
