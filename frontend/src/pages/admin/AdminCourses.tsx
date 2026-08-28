import { useRef, useState, type FormEvent } from "react";
import { useApi } from "../../lib/useApi";
import { api, ApiError, downloadFile, uploadFile } from "../../api/client";

interface Programme { id: string; name: string }
interface Course {
  id: string; code: string; name: string; theory_credit: number; practical_credit: number;
  category: string; component_type: string; programme_id: string; level: number; semester: number;
}

const EMPTY = {
  code: "", name: "", theoryCredit: "2", practicalCredit: "0", category: "CORE",
  componentType: "THEORY_ONLY", programmeId: "", level: "1", semester: "1",
};

type CourseFormState = typeof EMPTY;

function toFormState(c: Course): CourseFormState {
  return {
    code: c.code, name: c.name, theoryCredit: String(c.theory_credit), practicalCredit: String(c.practical_credit),
    category: c.category, componentType: c.component_type, programmeId: c.programme_id,
    level: String(c.level), semester: String(c.semester),
  };
}

function toPayload(form: CourseFormState) {
  return {
    code: form.code,
    name: form.name,
    theoryCredit: Number(form.theoryCredit),
    practicalCredit: Number(form.practicalCredit),
    category: form.category,
    componentType: form.componentType,
    programmeId: form.programmeId,
    level: Number(form.level),
    semester: Number(form.semester),
  };
}

function CourseFields({
  form, set, programmes,
}: {
  form: CourseFormState;
  set: <K extends keyof CourseFormState>(key: K, value: string) => void;
  programmes: Programme[];
}) {
  return (
    <>
      <div className="form-row">
        <div className="field"><label>Code</label><input value={form.code} onChange={(e) => set("code", e.target.value)} required /></div>
        <div className="field" style={{ flex: 2 }}><label>Name</label><input value={form.name} onChange={(e) => set("name", e.target.value)} required /></div>
      </div>
      <div className="form-row">
        <div className="field">
          <label>Programme</label>
          <select value={form.programmeId} onChange={(e) => set("programmeId", e.target.value)} required>
            <option value="">Select…</option>
            {programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Category</label>
          <select value={form.category} onChange={(e) => set("category", e.target.value)}>
            <option value="CORE">Core</option><option value="ELECTIVE">Elective</option><option value="ACU">Auxiliary (ACU)</option>
          </select>
        </div>
        <div className="field">
          <label>Component type</label>
          <select value={form.componentType} onChange={(e) => set("componentType", e.target.value)}>
            <option value="THEORY_ONLY">Theory only</option>
            <option value="PRACTICAL_ONLY">Practical only</option>
            <option value="BOTH">Theory + Practical</option>
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="field"><label>Theory credit (Ct)</label><input type="number" min={0} step={0.5} value={form.theoryCredit} onChange={(e) => set("theoryCredit", e.target.value)} /></div>
        <div className="field"><label>Practical credit (Cp)</label><input type="number" min={0} step={0.5} value={form.practicalCredit} onChange={(e) => set("practicalCredit", e.target.value)} /></div>
        <div className="field"><label>Level</label><input type="number" min={1} max={4} value={form.level} onChange={(e) => set("level", e.target.value)} /></div>
        <div className="field"><label>Semester</label><input type="number" min={1} max={2} value={form.semester} onChange={(e) => set("semester", e.target.value)} /></div>
      </div>
    </>
  );
}

export function AdminCourses() {
  const programmes = useApi<Programme[]>(() => api.get("/admin/programmes"));
  const courses = useApi<Course[]>(() => api.get("/admin/courses"));
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<CourseFormState>(EMPTY);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function set<K extends keyof typeof EMPTY>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/admin/courses", toPayload(form));
      setForm(EMPTY);
      courses.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create course unit.");
    }
  }

  function startEdit(c: Course) {
    setEditingId(c.id);
    setEditForm(toFormState(c));
    setEditError(null);
  }

  async function saveEdit(id: string) {
    setSavingEdit(true);
    setEditError(null);
    try {
      await api.patch(`/admin/courses/${id}`, toPayload(editForm));
      setEditingId(null);
      courses.reload();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Could not update course unit.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteCourse(c: Course) {
    if (!window.confirm(`Delete course unit ${c.code} — ${c.name}? This cannot be undone.`)) return;
    setDeletingId(c.id);
    setError(null);
    try {
      await api.del(`/admin/courses/${c.id}`);
      courses.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete course unit.");
    } finally {
      setDeletingId(null);
    }
  }

  const progName = (id: string) => programmes.data?.find((p) => p.id === id)?.name ?? "—";

  return (
    <div>
      <div className="page-header">
        <h1>Course Units</h1>
        <p>The credit split (Ct/Cp) drives the Final Result formula for two-component courses.</p>
      </div>
      <div className="card">
        <h2>All course units</h2>
        {error && <div className="banner banner-error">{error}</div>}
        {(courses.data ?? []).length === 0 ? <div className="empty-state">No course units yet.</div> : (
          <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Ct / Cp</th><th>Category</th><th>Component</th><th>Programme</th><th>Lvl/Sem</th><th></th></tr></thead>
            <tbody>
              {(courses.data ?? []).map((c) => (
                editingId === c.id ? (
                  <tr key={c.id}>
                    <td colSpan={8}>
                      {editError && <div className="banner banner-error" style={{ marginTop: 10 }}>{editError}</div>}
                      <CourseFields
                        form={editForm}
                        set={(k, v) => setEditForm((f) => ({ ...f, [k]: v }))}
                        programmes={programmes.data ?? []}
                      />
                      <div className="gap-8" style={{ marginBottom: 14 }}>
                        <button className="small" onClick={() => saveEdit(c.id)} disabled={savingEdit}>
                          {savingEdit ? "Saving…" : "Save changes"}
                        </button>
                        <button className="small secondary" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id}>
                    <td><strong>{c.code}</strong></td><td>{c.name}</td>
                    <td>{c.theory_credit} / {c.practical_credit}</td>
                    <td>{c.category}</td><td>{c.component_type.replace("_", " ")}</td>
                    <td>{progName(c.programme_id)}</td><td>L{c.level} S{c.semester}</td>
                    <td className="text-right">
                      <span className="gap-8" style={{ justifyContent: "flex-end" }}>
                        <button className="small ghost" onClick={() => startEdit(c)}>Edit</button>
                        <button className="small danger" onClick={() => deleteCourse(c)} disabled={deletingId === c.id}>
                          {deletingId === c.id ? "Deleting…" : "Delete"}
                        </button>
                      </span>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
      <div className="card">
        <h2>Add a course unit</h2>
        {error && <div className="banner banner-error">{error}</div>}
        <form onSubmit={onSubmit}>
          <CourseFields form={form} set={set} programmes={programmes.data ?? []} />
          <button type="submit">Add course unit</button>
        </form>
      </div>

      <div className="card">
        <h2>Bulk-add course units (Excel)</h2>
        <p className="muted" style={{ marginTop: -6 }}>
          Fill in one row per course unit and upload — each valid row is created immediately, and
          any problem rows are reported individually so they don't block the rest. Leave Level and
          Semester blank and they're worked out automatically from the course code (e.g. "IT2223" →
          Level 2, Semester 2); fill them in yourself for a code that doesn't follow that pattern.
        </p>
        <BulkCourseUploader onDone={() => courses.reload()} />
      </div>
    </div>
  );
}

interface CourseBulkRowResult { row: number; code: string; name?: string; status: "created" | "error"; reason?: string }
interface CourseBulkResponse { created: number; failed: number; results: CourseBulkRowResult[] }

function BulkCourseUploader({ onDone }: { onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CourseBulkResponse | null>(null);

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
      const res = await uploadFile<CourseBulkResponse>("/admin/bulk/courses", file);
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
        <button className="small secondary" onClick={() => downloadFile("/admin/bulk/courses/template", "course-unit-bulk-import-template.xlsx")}>
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
            {result.created} course unit(s) created, {result.failed} failed.
          </div>
          {result.results.some((r) => r.status === "error") && (
            <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Row</th><th>Code</th><th>Reason</th></tr></thead>
              <tbody>
                {result.results.filter((r) => r.status === "error").map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.code}</td>
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
