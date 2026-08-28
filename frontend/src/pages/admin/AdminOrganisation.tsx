import { useState, type FormEvent } from "react";
import { useApi } from "../../lib/useApi";
import { api, ApiError } from "../../api/client";

interface Department { id: string; name: string; faculty: string }
interface Programme { id: string; name: string; department_id: string; honours_flag: 0 | 1 }

export function AdminOrganisation() {
  const departments = useApi<Department[]>(() => api.get("/admin/departments"));
  const programmes = useApi<Programme[]>(() => api.get("/admin/programmes"));

  const [deptName, setDeptName] = useState("");
  const [faculty, setFaculty] = useState("Faculty of Applied Science");
  const [progName, setProgName] = useState("");
  const [progDept, setProgDept] = useState("");
  const [honours, setHonours] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
  const [editDeptName, setEditDeptName] = useState("");
  const [editFaculty, setEditFaculty] = useState("");
  const [deptBusy, setDeptBusy] = useState<string | null>(null);

  const [editingProgId, setEditingProgId] = useState<string | null>(null);
  const [editProgName, setEditProgName] = useState("");
  const [editProgDept, setEditProgDept] = useState("");
  const [editProgHonours, setEditProgHonours] = useState(true);
  const [progBusy, setProgBusy] = useState<string | null>(null);

  async function addDepartment(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/admin/departments", { name: deptName, faculty });
      setDeptName("");
      departments.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create department.");
    }
  }

  function startEditDept(d: Department) {
    setEditingDeptId(d.id);
    setEditDeptName(d.name);
    setEditFaculty(d.faculty);
    setError(null);
  }

  async function saveDept(id: string) {
    setDeptBusy(id);
    setError(null);
    try {
      await api.patch(`/admin/departments/${id}`, { name: editDeptName, faculty: editFaculty });
      setEditingDeptId(null);
      departments.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update department.");
    } finally {
      setDeptBusy(null);
    }
  }

  async function deleteDept(d: Department) {
    if (!window.confirm(`Delete department "${d.name}"? This only works while no programmes or staff are linked to it.`)) return;
    setDeptBusy(d.id);
    setError(null);
    try {
      await api.del(`/admin/departments/${d.id}`);
      departments.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete department.");
    } finally {
      setDeptBusy(null);
    }
  }

  async function addProgramme(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/admin/programmes", { name: progName, departmentId: progDept, honoursFlag: honours });
      setProgName("");
      programmes.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create programme.");
    }
  }

  function startEditProg(p: Programme) {
    setEditingProgId(p.id);
    setEditProgName(p.name);
    setEditProgDept(p.department_id);
    setEditProgHonours(!!p.honours_flag);
    setError(null);
  }

  async function saveProg(id: string) {
    setProgBusy(id);
    setError(null);
    try {
      await api.patch(`/admin/programmes/${id}`, { name: editProgName, departmentId: editProgDept, honoursFlag: editProgHonours });
      setEditingProgId(null);
      programmes.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update programme.");
    } finally {
      setProgBusy(null);
    }
  }

  async function deleteProg(p: Programme) {
    if (!window.confirm(`Delete programme "${p.name}"? This only works while no course units or students are linked to it.`)) return;
    setProgBusy(p.id);
    setError(null);
    try {
      await api.del(`/admin/programmes/${p.id}`);
      programmes.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete programme.");
    } finally {
      setProgBusy(null);
    }
  }

  const deptName_ = (id: string) => departments.data?.find((d) => d.id === id)?.name ?? "—";

  return (
    <div>
      <div className="page-header">
        <h1>Departments &amp; Programmes</h1>
        <p>
          Faculty and department structure, and the degree programmes offered under each department. A department or
          programme name must be unique, and either can be edited or removed as long as nothing else (staff, students,
          course units) is linked to it yet.
        </p>
      </div>
      {error && <div className="banner banner-error">{error}</div>}

      <div className="grid grid-2">
        <div className="card">
          <h2>Departments</h2>
          <div style={{ overflowX: "auto" }}>
          <table style={{ marginBottom: 14 }}>
            <thead><tr><th>Name</th><th>Faculty</th><th></th></tr></thead>
            <tbody>
              {(departments.data ?? []).map((d) =>
                editingDeptId === d.id ? (
                  <tr key={d.id}>
                    <td><input value={editDeptName} onChange={(e) => setEditDeptName(e.target.value)} /></td>
                    <td><input value={editFaculty} onChange={(e) => setEditFaculty(e.target.value)} /></td>
                    <td className="text-right">
                      <span className="gap-8" style={{ justifyContent: "flex-end" }}>
                        <button className="small" onClick={() => saveDept(d.id)} disabled={deptBusy === d.id}>
                          {deptBusy === d.id ? "Saving…" : "Save"}
                        </button>
                        <button className="small secondary" onClick={() => setEditingDeptId(null)}>Cancel</button>
                      </span>
                    </td>
                  </tr>
                ) : (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td>{d.faculty}</td>
                    <td className="text-right">
                      <span className="gap-8" style={{ justifyContent: "flex-end" }}>
                        <button className="small ghost" onClick={() => startEditDept(d)}>Edit</button>
                        <button className="small danger" onClick={() => deleteDept(d)} disabled={deptBusy === d.id}>
                          {deptBusy === d.id ? "…" : "Delete"}
                        </button>
                      </span>
                    </td>
                  </tr>
                )
              )}
              {(departments.data ?? []).length === 0 && (
                <tr><td colSpan={3} className="muted">No departments yet.</td></tr>
              )}
            </tbody>
          </table>
          </div>
          <form onSubmit={addDepartment} className="form-row">
            <div className="field"><label>Name</label><input value={deptName} onChange={(e) => setDeptName(e.target.value)} required /></div>
            <div className="field"><label>Faculty</label><input value={faculty} onChange={(e) => setFaculty(e.target.value)} required /></div>
            <button type="submit">Add</button>
          </form>
        </div>

        <div className="card">
          <h2>Degree Programmes</h2>
          <div style={{ overflowX: "auto" }}>
          <table style={{ marginBottom: 14 }}>
            <thead><tr><th>Name</th><th>Department</th><th>Hons.</th><th></th></tr></thead>
            <tbody>
              {(programmes.data ?? []).map((p) =>
                editingProgId === p.id ? (
                  <tr key={p.id}>
                    <td><input value={editProgName} onChange={(e) => setEditProgName(e.target.value)} /></td>
                    <td>
                      <select value={editProgDept} onChange={(e) => setEditProgDept(e.target.value)}>
                        {(departments.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={editProgHonours ? "1" : "0"} onChange={(e) => setEditProgHonours(e.target.value === "1")}>
                        <option value="1">Yes</option>
                        <option value="0">No</option>
                      </select>
                    </td>
                    <td className="text-right">
                      <span className="gap-8" style={{ justifyContent: "flex-end" }}>
                        <button className="small" onClick={() => saveProg(p.id)} disabled={progBusy === p.id}>
                          {progBusy === p.id ? "Saving…" : "Save"}
                        </button>
                        <button className="small secondary" onClick={() => setEditingProgId(null)}>Cancel</button>
                      </span>
                    </td>
                  </tr>
                ) : (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{deptName_(p.department_id)}</td>
                    <td>{p.honours_flag ? "Yes" : "No"}</td>
                    <td className="text-right">
                      <span className="gap-8" style={{ justifyContent: "flex-end" }}>
                        <button className="small ghost" onClick={() => startEditProg(p)}>Edit</button>
                        <button className="small danger" onClick={() => deleteProg(p)} disabled={progBusy === p.id}>
                          {progBusy === p.id ? "…" : "Delete"}
                        </button>
                      </span>
                    </td>
                  </tr>
                )
              )}
              {(programmes.data ?? []).length === 0 && (
                <tr><td colSpan={4} className="muted">No programmes yet.</td></tr>
              )}
            </tbody>
          </table>
          </div>
          <form onSubmit={addProgramme}>
            <div className="field"><label>Name</label><input value={progName} onChange={(e) => setProgName(e.target.value)} required /></div>
            <div className="form-row">
              <div className="field">
                <label>Department</label>
                <select value={progDept} onChange={(e) => setProgDept(e.target.value)} required>
                  <option value="">Select…</option>
                  {(departments.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Honours</label>
                <select value={honours ? "1" : "0"} onChange={(e) => setHonours(e.target.value === "1")}>
                  <option value="1">Yes</option>
                  <option value="0">No</option>
                </select>
              </div>
            </div>
            <p className="muted" style={{ marginTop: -8 }}>
              "Honours" marks a programme where Level 4 students who clear a 3.0 GPA become eligible for the
              Special/Honours track — shown on their profile once they reach Level 4.
            </p>
            <button type="submit">Add programme</button>
          </form>
        </div>
      </div>
    </div>
  );
}
