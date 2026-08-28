import { Link } from "react-router-dom";
import { useApi } from "../../lib/useApi";
import { api } from "../../api/client";

interface Offering {
  id: string;
  course_code: string;
  course_name: string;
  academic_year: string;
  semester: number;
  lecturer_name: string;
}

export function OfferingList({ basePath, title, subtitle }: { basePath: string; title: string; subtitle: string }) {
  const offerings = useApi<Offering[]>(() => api.get("/academic/department-offerings"));

  return (
    <div>
      <div className="page-header">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="card">
        {offerings.loading && <p className="muted">Loading…</p>}
        {offerings.error && <div className="banner banner-error">{offerings.error}</div>}
        {offerings.data && offerings.data.length === 0 && <div className="empty-state">No course offerings found.</div>}
        {offerings.data && offerings.data.length > 0 && (
          <table>
            <thead>
              <tr><th>Course</th><th>Lecturer</th><th>Year / Semester</th><th></th></tr>
            </thead>
            <tbody>
              {offerings.data.map((o) => (
                <tr key={o.id}>
                  <td><strong>{o.course_code}</strong> — {o.course_name}</td>
                  <td>{o.lecturer_name}</td>
                  <td>{o.academic_year}, Sem {o.semester}</td>
                  <td className="text-right"><Link to={`${basePath}/${o.id}`}><button className="small">Open</button></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
