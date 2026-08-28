import { useApi } from "../../lib/useApi";
import { api, ApiError } from "../../api/client";
import { StatusBadge } from "../../components/StatusBadge";
import { useState } from "react";

interface Correction {
  id: string;
  course_code: string;
  course_name: string;
  registration_no: string;
  student_name: string;
  requested_by_name: string;
  reason: string;
  status: string;
  created_at: string;
}

export function HodCorrections() {
  const corrections = useApi<Correction[]>(() => api.get("/results/corrections"));
  const [error, setError] = useState<string | null>(null);

  async function decide(id: string, approve: boolean) {
    setError(null);
    try {
      await api.post(`/results/corrections/${id}/decide`, { approve });
      corrections.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record decision.");
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Correction Requests</h1>
        <p>Raised by lecturers before release. Approving records your decision — edit the result directly from its course page if the marks need to change.</p>
      </div>
      <div className="card">
        {error && <div className="banner banner-error">{error}</div>}
        {corrections.loading && <p className="muted">Loading…</p>}
        {corrections.data && corrections.data.length === 0 && <div className="empty-state">No correction requests.</div>}
        {corrections.data && corrections.data.length > 0 && (
          <table>
            <thead>
              <tr><th>Course</th><th>Student</th><th>Requested by</th><th>Reason</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {corrections.data.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.course_code}</strong></td>
                  <td>{c.registration_no} — {c.student_name}</td>
                  <td>{c.requested_by_name}</td>
                  <td style={{ maxWidth: 280 }}>{c.reason}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="text-right">
                    {c.status === "PENDING" && (
                      <span className="gap-8">
                        <button className="small" onClick={() => decide(c.id, true)}>Approve</button>
                        <button className="small danger" onClick={() => decide(c.id, false)}>Reject</button>
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
