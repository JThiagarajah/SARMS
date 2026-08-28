import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useApi } from "../../lib/useApi";
import { api, downloadFile } from "../../api/client";
import { StatusBadge } from "../../components/StatusBadge";

interface Offering { id: string; course_code: string; course_name: string }
interface ResultRow {
  id: string; registration_no: string; student_name: string; status: string;
  ese_theory: number | null; ese_practical: number | null; final_mark: number | null; grade: string | null;
}

export function ReadOnlyResults({
  offeringListEndpoint = "/academic/department-offerings",
  headerNote,
  footer,
}: {
  offeringListEndpoint?: string;
  headerNote: string;
  footer?: (results: ResultRow[], offering?: Offering, reload?: () => void) => ReactNode;
}) {
  const { id = "" } = useParams();
  const offerings = useApi<Offering[]>(() => api.get(offeringListEndpoint));
  const offering = offerings.data?.find((o) => o.id === id);
  const results = useApi<ResultRow[]>(() => api.get(`/results/offerings/${id}`), [id]);

  return (
    <div>
      <div className="page-header">
        <h1>{offering ? `${offering.course_code} — ${offering.course_name}` : "Course offering"}</h1>
        <p>{headerNote}</p>
      </div>
      <div className="card">
        <div className="flex-between">
          <h2>Results</h2>
          {(results.data ?? []).length > 0 && (
            <button className="secondary small" onClick={() => downloadFile(`/pdf/offerings/${id}/result-sheet`, `${offering?.course_code ?? "course"}-result-sheet.pdf`)}>
              Download PDF
            </button>
          )}
        </div>
        {results.loading && <p className="muted">Loading…</p>}
        {results.error && <div className="banner banner-error">{results.error}</div>}
        {results.data && results.data.length === 0 && <div className="empty-state">Nothing visible to you for this course offering yet.</div>}
        {results.data && results.data.length > 0 && (
          <table>
            <thead>
              <tr><th>Reg. No.</th><th>Name</th><th>Final mark</th><th>Grade</th><th>Status</th></tr>
            </thead>
            <tbody>
              {results.data.map((r) => (
                <tr key={r.id}>
                  <td>{r.registration_no}</td>
                  <td>{r.student_name}</td>
                  <td className="mono">{r.final_mark != null ? r.final_mark.toFixed(1) : "—"}</td>
                  <td><strong>{r.grade ?? "—"}</strong></td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {footer && results.data && footer(results.data, offering, results.reload)}
      </div>
    </div>
  );
}
