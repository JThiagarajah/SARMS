import { Link } from "react-router-dom";
import { useApi } from "../../lib/useApi";
import { api } from "../../api/client";

interface Offering {
  id: string;
  course_code: string;
  course_name: string;
  component_type: string;
  category: string;
  academic_year: string;
  semester: number;
}

export function LecturerDashboard() {
  const offerings = useApi<Offering[]>(() => api.get("/academic/my-offerings"));

  return (
    <div>
      <div className="page-header">
        <h1>My Courses</h1>
        <p>Course offerings assigned to you by the Super Admin.</p>
      </div>
      <div className="card">
        {offerings.loading && <p className="muted">Loading…</p>}
        {offerings.error && <div className="banner banner-error">{offerings.error}</div>}
        {offerings.data && offerings.data.length === 0 && (
          <div className="empty-state">No course offerings have been assigned to you yet.</div>
        )}
        {offerings.data && offerings.data.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Course</th>
                <th>Type</th>
                <th>Year / Semester</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {offerings.data.map((o) => (
                <tr key={o.id}>
                  <td><strong>{o.course_code}</strong> — {o.course_name}</td>
                  <td>{o.component_type.replace("_", " ")}</td>
                  <td>{o.academic_year}, Sem {o.semester}</td>
                  <td className="text-right">
                    <Link to={`/lecturer/offerings/${o.id}`}><button className="small">Open</button></Link>
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
