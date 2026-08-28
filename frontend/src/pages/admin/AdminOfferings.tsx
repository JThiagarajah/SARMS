import { useRef, useState, type FormEvent, Fragment } from "react";
import { useApi } from "../../lib/useApi";
import { api, ApiError, downloadFile, uploadFile } from "../../api/client";

interface Course { id: string; code: string; name: string }
interface Lecturer { id: string; full_name: string }
interface Offering { id: string; course_code: string; course_name: string; lecturer_name: string; academic_year: string; semester: number }
interface Student { id: string; full_name: string; registration_no: string }
interface Enrollment { id: string; student_name: string; registration_no: string }
interface AssignmentRequest {
  id: string;
  lecturer_name: string;
  lecturer_username: string;
  course_code: string;
  course_name: string;
  academic_year: string;
  semester: number;
  uploaded_at: string;
}
interface AssignmentRowResult { row: number; lecturer: string; course: string; status: "queued" | "error"; reason?: string }
interface AssignmentBulkResponse { queued: number; failed: number; results: AssignmentRowResult[] }

export function AdminOfferings() {
  const courses = useApi<Course[]>(() => api.get("/admin/courses"));
  const lecturers = useApi<Lecturer[]>(() => api.get("/admin/users?role=LECTURER"));
  const offerings = useApi<Offering[]>(() => api.get("/admin/offerings"));
  const students = useApi<Student[]>(() => api.get("/admin/users?role=STUDENT"));
  const pendingRequests = useApi<AssignmentRequest[]>(() => api.get("/admin/assignment-requests?status=PENDING"));

  const [courseId, setCourseId] = useState("");
  const [lecturerId, setLecturerId] = useState("");
  const [academicYear, setAcademicYear] = useState("2025/2026");
  const [semester, setSemester] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [enrollStudentId, setEnrollStudentId] = useState("");

  const enrollments = useApi<Enrollment[]>(
    () => (expanded ? api.get(`/admin/enrollments?offeringId=${expanded}`) : Promise.resolve([])),
    [expanded]
  );

  async function addOffering(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/admin/offerings", { courseId, lecturerId, academicYear, semester: Number(semester) });
      offerings.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create offering.");
    }
  }

  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);

  async function acceptRequest(id: string) {
    setDecidingId(id);
    setDecideError(null);
    try {
      await api.post(`/admin/assignment-requests/${id}/accept`);
      pendingRequests.reload();
      offerings.reload();
    } catch (err) {
      setDecideError(err instanceof ApiError ? err.message : "Could not assign this lecturer.");
    } finally {
      setDecidingId(null);
    }
  }

  async function rejectRequest(id: string) {
    setDecidingId(id);
    setDecideError(null);
    try {
      await api.post(`/admin/assignment-requests/${id}/reject`);
      pendingRequests.reload();
    } catch (err) {
      setDecideError(err instanceof ApiError ? err.message : "Could not reject this request.");
    } finally {
      setDecidingId(null);
    }
  }

  async function enrol() {
    if (!expanded || !enrollStudentId) return;
    setError(null);
    try {
      await api.post("/admin/enrollments", { studentId: enrollStudentId, offeringId: expanded });
      setEnrollStudentId("");
      enrollments.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not enrol student.");
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Course Offerings</h1>
        <p>Assign a lecturer to a course for a given year/semester, then enrol students — the Super Admin's exclusive authority.</p>
      </div>
      {error && <div className="banner banner-error">{error}</div>}

      <div className="card">
        <h2>Bulk-assign lecturers (Excel)</h2>
        <p className="muted" style={{ marginTop: -6 }}>
          Upload a spreadsheet of what each lecturer is capable of teaching — one row per lecturer/course/year/semester.
          Nothing is assigned automatically: every row lands below as a pending request, and you Assign or Reject it
          with a single click. Assigning creates the same course offering the form below would.
        </p>
        <BulkAssignUploader onDone={() => pendingRequests.reload()} />
      </div>

      <div className="card">
        <h2>Pending assignment requests {pendingRequests.data && pendingRequests.data.length > 0 && `(${pendingRequests.data.length})`}</h2>
        {decideError && <div className="banner banner-error">{decideError}</div>}
        {(pendingRequests.data ?? []).length === 0 ? (
          <div className="empty-state">No pending requests — uploaded assignments will show up here for review.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Lecturer</th><th>Course</th><th>Year/Sem</th><th>Uploaded</th><th></th></tr></thead>
            <tbody>
              {(pendingRequests.data ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{r.lecturer_name} <span className="muted mono">({r.lecturer_username})</span></td>
                  <td><strong>{r.course_code}</strong> — {r.course_name}</td>
                  <td>{r.academic_year}, S{r.semester}</td>
                  <td className="muted">{new Date(r.uploaded_at).toLocaleDateString()}</td>
                  <td className="text-right">
                    <span className="gap-8" style={{ justifyContent: "flex-end" }}>
                      <button className="small" onClick={() => acceptRequest(r.id)} disabled={decidingId === r.id}>
                        {decidingId === r.id ? "…" : "Assign"}
                      </button>
                      <button className="small danger" onClick={() => rejectRequest(r.id)} disabled={decidingId === r.id}>
                        Reject
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Create an offering</h2>
        <form onSubmit={addOffering} className="form-row">
          <div className="field">
            <label>Course</label>
            <select value={courseId} onChange={(e) => setCourseId(e.target.value)} required>
              <option value="">Select…</option>
              {(courses.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Lecturer</label>
            <select value={lecturerId} onChange={(e) => setLecturerId(e.target.value)} required>
              <option value="">Select…</option>
              {(lecturers.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.full_name}</option>)}
            </select>
          </div>
          <div className="field"><label>Academic year</label><input value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} required /></div>
          <div className="field"><label>Semester</label><input type="number" min={1} max={2} value={semester} onChange={(e) => setSemester(e.target.value)} /></div>
          <button type="submit">Create</button>
        </form>
      </div>

      <div className="card">
        <h2>All offerings</h2>
        {(offerings.data ?? []).length === 0 ? <div className="empty-state">No offerings yet.</div> : (
          <table>
            <thead><tr><th>Course</th><th>Lecturer</th><th>Year/Sem</th><th></th></tr></thead>
            <tbody>
              {(offerings.data ?? []).map((o) => (
                <Fragment key={o.id}>
                  <tr>
                    <td><strong>{o.course_code}</strong> — {o.course_name}</td>
                    <td>{o.lecturer_name}</td>
                    <td>{o.academic_year}, S{o.semester}</td>
                    <td className="text-right">
                      <button className="small ghost" onClick={() => setExpanded(expanded === o.id ? null : o.id)}>
                        {expanded === o.id ? "Hide enrolments" : "Manage enrolments"}
                      </button>
                    </td>
                  </tr>
                  {expanded === o.id && (
                    <tr>
                      <td colSpan={4} style={{ background: "#fafbfd" }}>
                        <div style={{ padding: "10px 4px" }}>
                          <table style={{ marginBottom: 10 }}>
                            <thead><tr><th>Reg. No.</th><th>Name</th></tr></thead>
                            <tbody>
                              {(enrollments.data ?? []).map((e) => <tr key={e.id}><td>{e.registration_no}</td><td>{e.student_name}</td></tr>)}
                              {(enrollments.data ?? []).length === 0 && <tr><td colSpan={2} className="muted">No students enrolled yet.</td></tr>}
                            </tbody>
                          </table>
                          <div className="form-row" style={{ maxWidth: 420 }}>
                            <div className="field">
                              <label>Enrol a student</label>
                              <select value={enrollStudentId} onChange={(e) => setEnrollStudentId(e.target.value)}>
                                <option value="">Select…</option>
                                {(students.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.registration_no} — {s.full_name}</option>)}
                              </select>
                            </div>
                            <button className="small" onClick={enrol}>Enrol</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function BulkAssignUploader({ onDone }: { onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AssignmentBulkResponse | null>(null);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const res = await uploadFile<AssignmentBulkResponse>("/admin/assignment-requests/bulk-upload", file);
      setResult(res);
      if (fileRef.current) fileRef.current.value = "";
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not process that file.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div className="gap-8" style={{ alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <button className="small secondary" onClick={() => downloadFile("/admin/assignment-requests/template", "lecturer-assignment-template.xlsx")}>
          Download template
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" />
        <button className="small" onClick={handleUpload} disabled={uploading}>
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {result && (
        <div>
          <div className={`banner ${result.failed > 0 ? "banner-error" : "banner-success"}`}>
            {result.queued} request(s) queued for review below, {result.failed} failed.
          </div>
          {result.results.some((r) => r.status === "error") && (
            <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Row</th><th>Lecturer</th><th>Course</th><th>Reason</th></tr></thead>
              <tbody>
                {result.results.filter((r) => r.status === "error").map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.lecturer}</td>
                    <td>{r.course}</td>
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
