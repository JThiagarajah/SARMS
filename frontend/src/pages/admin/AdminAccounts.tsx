import { useRef, useState, type FormEvent } from "react";
import { useApi } from "../../lib/useApi";
import { api, ApiError, downloadFile, uploadFile } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { ROLE_LABELS } from "../../lib/roles";

/** Posts to a PDF-generating endpoint and immediately triggers a browser download — used to turn
 *  a one-time password that only ever exists transiently in memory into a file on disk the moment
 *  it's generated, so a page refresh (or just navigating away) can never lose it. */
async function downloadPdf(path: string, body: unknown, filename: string) {
  const blob = await api.post<Blob>(path, body);
  const url = URL.createObjectURL(blob as unknown as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface Department { id: string; name: string }
interface Programme { id: string; name: string }
interface UserRow { id: string; username: string; full_name: string; email: string; personal_email: string | null; role: string; active: 0 | 1; registration_no?: string }

interface BulkRowResult {
  row: number;
  fullName: string;
  username?: string;
  password?: string;
  status: "created" | "error";
  reason?: string;
}
interface BulkResponse { created: number; failed: number; results: BulkRowResult[] }

const STAFF_ROLES = ["LECTURER", "HOD", "DEAN", "CHAIRMAN_EXAM_BRANCH", "EXAMINATION_BRANCH", "SUPER_ADMIN"];

export function AdminAccounts() {
  const departments = useApi<Department[]>(() => api.get("/admin/departments"));
  const programmes = useApi<Programme[]>(() => api.get("/admin/programmes"));
  const users = useApi<UserRow[]>(() => api.get("/admin/users"));

  const { user: me } = useAuth();
  const [tab, setTab] = useState<"staff" | "student" | "bulk">("staff");
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{ username: string; password: string; fullName: string; role: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<{ username: string; password: string; fullName: string; role: string } | null>(null);

  const [staff, setStaff] = useState({ username: "", fullName: "", email: "", role: "LECTURER", departmentId: "", designation: "", personalEmail: "" });
  const [student, setStudent] = useState({ username: "", fullName: "", email: "", registrationNo: "", programmeId: "", level: "1", admissionYear: "2025", personalEmail: "" });
  const [editingEmailFor, setEditingEmailFor] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState("");

  async function createStaff(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setGenerated(null);
    try {
      const res = await api.post<{ id: string; generatedPassword: string | null }>("/admin/users", staff);
      if (res.generatedPassword) {
        const g = { username: staff.username, password: res.generatedPassword, fullName: staff.fullName, role: staff.role };
        setGenerated(g);
        // Auto-download the PDF immediately — don't make the admin remember to click anything
        // before the one-time password is otherwise gone for good.
        downloadPdf("/pdf/credentials", g, `${g.username}-onetime-password.pdf`).catch(() => {});
      }
      setStaff({ username: "", fullName: "", email: "", role: "LECTURER", departmentId: "", designation: "", personalEmail: "" });
      users.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create account.");
    }
  }

  async function createStudent(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setGenerated(null);
    try {
      const res = await api.post<{ id: string; generatedPassword: string | null }>("/admin/students", {
        ...student,
        level: Number(student.level),
        admissionYear: Number(student.admissionYear),
      });
      if (res.generatedPassword) {
        const g = { username: student.username, password: res.generatedPassword, fullName: student.fullName, role: "STUDENT" };
        setGenerated(g);
        downloadPdf("/pdf/credentials", g, `${g.username}-onetime-password.pdf`).catch(() => {});
      }
      setStudent({ username: "", fullName: "", email: "", registrationNo: "", programmeId: "", level: "1", admissionYear: "2025", personalEmail: "" });
      users.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create student.");
    }
  }

  async function toggleActive(id: string, active: boolean) {
    await api.patch(`/admin/users/${id}/active`, { active });
    users.reload();
  }

  async function resetPassword(u: UserRow) {
    if (!window.confirm(`Generate a new one-time password for ${u.full_name} (${u.username})? Their current password stops working immediately.`)) return;
    setBusyId(u.id);
    setRowError(null);
    try {
      const res = await api.post<{ generatedPassword: string }>(`/admin/users/${u.id}/reset-password`);
      const g = { username: u.username, password: res.generatedPassword, fullName: u.full_name, role: u.role };
      setResetFor(g);
      downloadPdf("/pdf/credentials", g, `${g.username}-onetime-password.pdf`).catch(() => {});
      users.reload();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Could not reset this account's password.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteAccount(u: UserRow) {
    if (!window.confirm(`Delete the account for ${u.full_name} (${u.username})? This only works while nothing in SARMS references it yet, and cannot be undone.`)) return;
    setBusyId(u.id);
    setRowError(null);
    try {
      await api.del(`/admin/users/${u.id}`);
      users.reload();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Could not delete this account.");
    } finally {
      setBusyId(null);
    }
  }

  async function savePersonalEmail(id: string) {
    try {
      await api.patch(`/admin/users/${id}/personal-email`, { personalEmail: emailDraft });
      setEditingEmailFor(null);
      users.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update personal email.");
    }
  }

  const needsDept = staff.role === "LECTURER" || staff.role === "HOD" || staff.role === "DEAN";

  return (
    <div>
      <div className="page-header">
        <h1>Accounts</h1>
        <p>Create logins for any role. A one-time password is generated and shown once — hand it to the person; they must change it on first login.</p>
      </div>

      {generated && (
        <div className="banner banner-success">
          <div style={{ marginBottom: 6 }}>
            Account <strong>{generated.username}</strong> created. One-time password: <strong className="mono">{generated.password}</strong> — a PDF with these
            details has already been downloaded automatically.
          </div>
          <button className="small secondary" onClick={() => downloadPdf("/pdf/credentials", generated, `${generated.username}-onetime-password.pdf`)}>
            Download PDF again
          </button>
        </div>
      )}
      {resetFor && (
        <div className="banner banner-success">
          <div style={{ marginBottom: 6 }}>
            New one-time password for <strong>{resetFor.username}</strong>: <strong className="mono">{resetFor.password}</strong> — the previous password no
            longer works, and a PDF with the new one has already been downloaded automatically.
          </div>
          <button className="small secondary" onClick={() => downloadPdf("/pdf/credentials", resetFor, `${resetFor.username}-onetime-password.pdf`)}>
            Download PDF again
          </button>
        </div>
      )}
      {error && <div className="banner banner-error">{error}</div>}
      {rowError && <div className="banner banner-error">{rowError}</div>}

      <div className="card">
        <div className="gap-8" style={{ marginBottom: 16 }}>
          <button className={tab === "staff" ? "" : "secondary"} onClick={() => setTab("staff")}>Staff account</button>
          <button className={tab === "student" ? "" : "secondary"} onClick={() => setTab("student")}>Student account</button>
          <button className={tab === "bulk" ? "" : "secondary"} onClick={() => setTab("bulk")}>Bulk import (Excel)</button>
        </div>

        {tab === "bulk" ? (
          <BulkImportSection onDone={() => users.reload()} />
        ) : tab === "staff" ? (
          <form onSubmit={createStaff}>
            <div className="form-row">
              <div className="field"><label>Username</label><input value={staff.username} onChange={(e) => setStaff((s) => ({ ...s, username: e.target.value }))} required /></div>
              <div className="field"><label>Full name</label><input value={staff.fullName} onChange={(e) => setStaff((s) => ({ ...s, fullName: e.target.value }))} required /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Email</label><input type="email" value={staff.email} onChange={(e) => setStaff((s) => ({ ...s, email: e.target.value }))} required /></div>
              <div className="field">
                <label>Role</label>
                <select value={staff.role} onChange={(e) => setStaff((s) => ({ ...s, role: e.target.value }))}>
                  {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r as keyof typeof ROLE_LABELS]}</option>)}
                </select>
              </div>
            </div>
            {needsDept && (
              <div className="form-row">
                <div className="field">
                  <label>Department</label>
                  <select value={staff.departmentId} onChange={(e) => setStaff((s) => ({ ...s, departmentId: e.target.value }))} required>
                    <option value="">Select…</option>
                    {(departments.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                {staff.role === "LECTURER" && (
                  <div className="field"><label>Designation</label><input value={staff.designation} onChange={(e) => setStaff((s) => ({ ...s, designation: e.target.value }))} placeholder="e.g. Senior Lecturer" /></div>
                )}
              </div>
            )}
            <div className="form-row">
              <div className="field">
                <label>Personal email (optional)</label>
                <input type="email" value={staff.personalEmail} onChange={(e) => setStaff((s) => ({ ...s, personalEmail: e.target.value }))} placeholder="Used only for forgot-password verification" />
              </div>
            </div>
            <button type="submit">Create staff account</button>
          </form>
        ) : (
          <form onSubmit={createStudent}>
            <div className="form-row">
              <div className="field"><label>Username</label><input value={student.username} onChange={(e) => setStudent((s) => ({ ...s, username: e.target.value }))} required /></div>
              <div className="field"><label>Full name</label><input value={student.fullName} onChange={(e) => setStudent((s) => ({ ...s, fullName: e.target.value }))} required /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Email</label><input type="email" value={student.email} onChange={(e) => setStudent((s) => ({ ...s, email: e.target.value }))} required /></div>
              <div className="field"><label>Registration No.</label><input value={student.registrationNo} onChange={(e) => setStudent((s) => ({ ...s, registrationNo: e.target.value }))} required /></div>
            </div>
            <div className="form-row">
              <div className="field">
                <label>Programme</label>
                <select value={student.programmeId} onChange={(e) => setStudent((s) => ({ ...s, programmeId: e.target.value }))} required>
                  <option value="">Select…</option>
                  {(programmes.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Level</label><input type="number" min={1} max={4} value={student.level} onChange={(e) => setStudent((s) => ({ ...s, level: e.target.value }))} /></div>
              <div className="field"><label>Admission year</label><input type="number" value={student.admissionYear} onChange={(e) => setStudent((s) => ({ ...s, admissionYear: e.target.value }))} /></div>
            </div>
            <div className="form-row">
              <div className="field">
                <label>Personal email (optional)</label>
                <input type="email" value={student.personalEmail} onChange={(e) => setStudent((s) => ({ ...s, personalEmail: e.target.value }))} placeholder="Used only for forgot-password verification" />
              </div>
            </div>
            <button type="submit">Create student account</button>
          </form>
        )}
      </div>

      <div className="card">
        <h2>All accounts</h2>
        <table>
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Reg. No.</th><th>Personal email</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {(users.data ?? []).map((u) => (
              <tr key={u.id}>
                <td>{u.full_name}</td>
                <td>{u.username}</td>
                <td>{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role}</td>
                <td>{u.registration_no ?? "—"}</td>
                <td>
                  {editingEmailFor === u.id ? (
                    <span className="gap-8">
                      <input style={{ width: 180 }} type="email" value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} placeholder="name@example.com" />
                      <button className="small" onClick={() => savePersonalEmail(u.id)}>Save</button>
                      <button className="small secondary" onClick={() => setEditingEmailFor(null)}>Cancel</button>
                    </span>
                  ) : (
                    <span className="gap-8" style={{ alignItems: "center" }}>
                      <span className="muted">{u.personal_email ?? "—"}</span>
                      <button className="small ghost" onClick={() => { setEditingEmailFor(u.id); setEmailDraft(u.personal_email ?? ""); }}>
                        {u.personal_email ? "Edit" : "Set"}
                      </button>
                    </span>
                  )}
                </td>
                <td><span className={`badge ${u.active ? "badge-green" : "badge-red"}`}>{u.active ? "Active" : "Deactivated"}</span></td>
                <td className="text-right">
                  <span className="gap-8" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <button className="small secondary" onClick={() => toggleActive(u.id, !u.active)}>
                      {u.active ? "Deactivate" : "Reactivate"}
                    </button>
                    <button className="small ghost" onClick={() => resetPassword(u)} disabled={busyId === u.id}>
                      Reset password
                    </button>
                    {u.id !== me?.id && (
                      <button className="small danger" onClick={() => deleteAccount(u)} disabled={busyId === u.id}>
                        {busyId === u.id ? "…" : "Delete"}
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BulkImportSection({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<"student" | "staff">("student");
  return (
    <div>
      <p className="muted" style={{ marginTop: -4 }}>
        Create many accounts at once from an Excel (.xlsx) or CSV file. Download the template, fill in one row per
        person, then upload it. Usernames and one-time passwords are generated automatically if left blank — download
        the results afterwards to get the full list of credentials to hand out.
      </p>
      <div className="gap-8" style={{ marginBottom: 16 }}>
        <button className={kind === "student" ? "small" : "small secondary"} onClick={() => setKind("student")}>Students</button>
        <button className={kind === "staff" ? "small" : "small secondary"} onClick={() => setKind("staff")}>Staff</button>
      </div>
      <BulkImportUploader
        key={kind}
        templatePath={kind === "student" ? "/admin/bulk/students/template" : "/admin/bulk/staff/template"}
        templateFilename={kind === "student" ? "student-bulk-import-template.xlsx" : "staff-bulk-import-template.xlsx"}
        uploadPath={kind === "student" ? "/admin/bulk/students" : "/admin/bulk/staff"}
        onDone={onDone}
      />
    </div>
  );
}

function BulkImportUploader({
  templatePath,
  templateFilename,
  uploadPath,
  onDone,
}: {
  templatePath: string;
  templateFilename: string;
  uploadPath: string;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResponse | null>(null);

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
      const res = await uploadFile<BulkResponse>(uploadPath, file);
      setResult(res);
      if (fileRef.current) fileRef.current.value = "";
      // Auto-download the PDF the moment results come back — the on-screen table (and its
      // manual "Download credentials" button) is only ever React state, so a refresh before
      // anyone clicks it would otherwise lose every password in the batch for good.
      if (res.results.some((r) => r.status === "created" && r.password)) {
        downloadPdf("/pdf/bulk-credentials", { results: res.results }, "bulk-onetime-passwords.pdf").catch(() => {});
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not process that file.");
    } finally {
      setUploading(false);
    }
  }

  async function downloadResults() {
    if (!result) return;
    await downloadResultsWorkbook(result.results);
  }

  return (
    <div>
      <div className="gap-8" style={{ alignItems: "center", marginBottom: 12 }}>
        <button className="small secondary" onClick={() => downloadFile(templatePath, templateFilename)}>
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
            {result.created} account(s) created, {result.failed} failed.
            {result.created > 0 && " A credentials PDF has already been downloaded automatically."}
          </div>
          <div className="flex-between" style={{ marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <span className="muted">Row-by-row outcome — every credential here is also in the PDF that just downloaded.</span>
            <span className="gap-8">
              <button
                className="small secondary"
                onClick={() => downloadPdf("/pdf/bulk-credentials", { results: result.results }, "bulk-onetime-passwords.pdf")}
              >
                Download PDF again
              </button>
              <button className="small secondary" onClick={downloadResults}>Download as spreadsheet</button>
            </span>
          </div>
          <table>
            <thead><tr><th>Row</th><th>Name</th><th>Username</th><th>Password</th><th>Status</th><th>Reason</th></tr></thead>
            <tbody>
              {result.results.map((r) => (
                <tr key={r.row}>
                  <td>{r.row}</td>
                  <td>{r.fullName}</td>
                  <td className="mono">{r.username ?? "—"}</td>
                  <td className="mono">{r.password ?? "—"}</td>
                  <td><span className={`badge ${r.status === "created" ? "badge-green" : "badge-red"}`}>{r.status}</span></td>
                  <td>{r.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

async function downloadResultsWorkbook(results: BulkRowResult[]) {
  const blob = await api.post<Blob>("/admin/bulk/export-results", { results });
  const url = URL.createObjectURL(blob as unknown as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "bulk-import-results.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
