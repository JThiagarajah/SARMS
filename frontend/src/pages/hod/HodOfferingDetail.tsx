import { useState } from "react";
import { useParams } from "react-router-dom";
import { useApi } from "../../lib/useApi";
import { api, ApiError, downloadFile } from "../../api/client";
import { StatusBadge } from "../../components/StatusBadge";

interface Offering { id: string; course_code: string; course_name: string; component_type: string }
interface ResultRow {
  id: string; registration_no: string; student_name: string; status: string;
  ese_theory: number | null; ese_practical: number | null; final_mark: number | null; grade: string | null;
}

export function HodOfferingDetail() {
  const { id = "" } = useParams();
  const offerings = useApi<Offering[]>(() => api.get("/academic/department-offerings"));
  const offering = offerings.data?.find((o) => o.id === id);
  const results = useApi<ResultRow[]>(() => api.get(`/results/offerings/${id}`), [id]);
  const [editing, setEditing] = useState<string | null>(null);
  const [theory, setTheory] = useState("");
  const [practical, setPractical] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function startEdit(r: ResultRow) {
    setEditing(r.id);
    setTheory(r.ese_theory != null ? String(r.ese_theory) : "");
    setPractical(r.ese_practical != null ? String(r.ese_practical) : "");
  }

  async function saveEdit(resultId: string) {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, number> = {};
      if (theory !== "") body.eseTheory = Number(theory);
      if (practical !== "") body.esePractical = Number(practical);
      await api.patch(`/results/${resultId}`, body);
      setEditing(null);
      results.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function approve(resultId: string) {
    setError(null);
    try {
      await api.post(`/results/${resultId}/approve`);
      results.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not approve.");
    }
  }

  const readyToRelease = (results.data ?? []).length > 0 && (results.data ?? []).every((r) => r.status === "HOD_APPROVED" || r.status === "RELEASED");

  return (
    <div>
      <div className="page-header">
        <h1>{offering ? `${offering.course_code} — ${offering.course_name}` : "Course offering"}</h1>
        <p>Review, correct or approve each student's final marks. Editing after your own approval reopens the result for re-approval.</p>
      </div>

      {results.data && results.data.length > 0 && (
        <div className="banner banner-info">
          {readyToRelease
            ? "All results are HOD-approved and ready for the Chairman of Examination Branch to release."
            : `${results.data.filter((r) => r.status === "SUBMITTED").length} of ${results.data.length} result(s) still awaiting your approval.`}
        </div>
      )}

      <div className="card">
        <div className="flex-between">
          <h2>Results</h2>
          {(results.data ?? []).length > 0 && (
            <button className="secondary small" onClick={() => downloadFile(`/pdf/offerings/${id}/result-sheet`, `${offering?.course_code ?? "course"}-result-sheet.pdf`)}>
              Download PDF
            </button>
          )}
        </div>
        {error && <div className="banner banner-error">{error}</div>}
        {results.loading && <p className="muted">Loading…</p>}
        {results.data && results.data.length === 0 && (
          <div className="empty-state">No final marks have been submitted for this course yet.</div>
        )}
        {results.data && results.data.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Reg. No.</th><th>Name</th><th>ESE Theory</th><th>ESE Practical</th>
                <th>Final</th><th>Grade</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {results.data.map((r) => (
                <tr key={r.id}>
                  <td>{r.registration_no}</td>
                  <td>{r.student_name}</td>
                  <td>
                    {editing === r.id ? <input style={{ width: 70 }} type="number" value={theory} onChange={(e) => setTheory(e.target.value)} /> : (r.ese_theory ?? "—")}
                  </td>
                  <td>
                    {editing === r.id ? <input style={{ width: 70 }} type="number" value={practical} onChange={(e) => setPractical(e.target.value)} /> : (r.ese_practical ?? "—")}
                  </td>
                  <td className="mono">{r.final_mark != null ? r.final_mark.toFixed(1) : "—"}</td>
                  <td><strong>{r.grade ?? "—"}</strong></td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="text-right">
                    {r.status === "RELEASED" ? (
                      <span className="muted">Locked</span>
                    ) : editing === r.id ? (
                      <span className="gap-8">
                        <button className="small" disabled={busy} onClick={() => saveEdit(r.id)}>Save</button>
                        <button className="small secondary" onClick={() => setEditing(null)}>Cancel</button>
                      </span>
                    ) : (
                      <span className="gap-8">
                        <button className="small ghost" onClick={() => startEdit(r)}>Edit</button>
                        {r.status === "SUBMITTED" && <button className="small" onClick={() => approve(r.id)}>Approve</button>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
