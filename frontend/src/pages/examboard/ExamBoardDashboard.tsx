import { useState } from "react";
import { OfferingList } from "../shared/OfferingList";
import { api, ApiError, downloadFile } from "../../api/client";

interface StudentHit { id: string; registration_no: string; full_name: string; programme_name: string }

export function ExamBoardDashboard() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  async function search(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    try {
      const res = await api.get<StudentHit[]>(`/academic/students?query=${encodeURIComponent(q)}`);
      setHits(res);
    } catch {
      // ignore transient errors while typing
    } finally {
      setSearching(false);
    }
  }

  async function generate(studentId: string, reg: string) {
    setError(null);
    try {
      await downloadFile(`/pdf/students/${studentId}/certificate`, `${reg}-certificate.pdf`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate certificate.");
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Generate a certificate / result sheet</h2>
        <p className="muted" style={{ marginTop: -6 }}>Search by registration number or name. Only released results appear.</p>
        <input placeholder="e.g. APS/IT/2022/045 or a name…" value={query} onChange={(e) => search(e.target.value)} />
        {error && <div className="banner banner-error">{error}</div>}
        {searching && <p className="muted">Searching…</p>}
        {hits.length > 0 && (
          <table style={{ marginTop: 12 }}>
            <thead><tr><th>Reg. No.</th><th>Name</th><th>Programme</th><th></th></tr></thead>
            <tbody>
              {hits.map((h) => (
                <tr key={h.id}>
                  <td>{h.registration_no}</td>
                  <td>{h.full_name}</td>
                  <td>{h.programme_name}</td>
                  <td className="text-right"><button className="small" onClick={() => generate(h.id, h.registration_no)}>Generate PDF</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <OfferingList
        basePath="/examboard/offerings"
        title="Released Courses"
        subtitle="Only officially released results are visible to the Examination Branch — nothing before release."
      />
    </div>
  );
}
