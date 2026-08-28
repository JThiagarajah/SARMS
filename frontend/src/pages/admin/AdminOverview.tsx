import { useApi } from "../../lib/useApi";
import { api } from "../../api/client";
import { ROLE_LABELS } from "../../lib/roles";

interface UserRow { id: string; role: string; active: 0 | 1 }

export function AdminOverview() {
  const departments = useApi<unknown[]>(() => api.get("/admin/departments"));
  const courses = useApi<unknown[]>(() => api.get("/admin/courses"));
  const offerings = useApi<unknown[]>(() => api.get("/admin/offerings"));
  const users = useApi<UserRow[]>(() => api.get("/admin/users"));

  const roleCounts = (users.data ?? []).reduce<Record<string, number>>((acc, u) => {
    acc[u.role] = (acc[u.role] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div className="page-header">
        <h1>System Overview</h1>
        <p>Organisation and account administration — deliberately walled off from every grade-bearing table.</p>
      </div>
      <div className="grid grid-4">
        <div className="card stat-card"><div className="value">{departments.data?.length ?? "—"}</div><div className="label">Departments</div></div>
        <div className="card stat-card"><div className="value">{courses.data?.length ?? "—"}</div><div className="label">Course units</div></div>
        <div className="card stat-card"><div className="value">{offerings.data?.length ?? "—"}</div><div className="label">Course offerings</div></div>
        <div className="card stat-card"><div className="value">{users.data?.length ?? "—"}</div><div className="label">Total accounts</div></div>
      </div>
      <div className="card">
        <h2>Accounts by role</h2>
        <table>
          <thead><tr><th>Role</th><th>Active accounts</th></tr></thead>
          <tbody>
            {Object.entries(ROLE_LABELS).map(([role, label]) => (
              <tr key={role}><td>{label}</td><td>{roleCounts[role] ?? 0}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
