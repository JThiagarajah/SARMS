import { useApi } from "../../lib/useApi";
import { api } from "../../api/client";

interface LogRow {
  id: string; action: string; entity_type: string; entity_id: string | null;
  user_name: string; user_role: string; timestamp: string;
}

export function AdminActivity() {
  const log = useApi<LogRow[]>(() => api.get("/admin/activity-log?limit=300"));

  return (
    <div>
      <div className="page-header">
        <h1>System-Wide Activity Log</h1>
        <p>Every state-changing action in SARMS, across every role — the Super Admin's audit trail.</p>
      </div>
      <div className="card">
        {log.loading && <p className="muted">Loading…</p>}
        {log.data && (
          <table>
            <thead><tr><th>When</th><th>Who</th><th>Role</th><th>Action</th><th>Entity</th></tr></thead>
            <tbody>
              {log.data.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{new Date(l.timestamp).toLocaleString()}</td>
                  <td>{l.user_name}</td>
                  <td>{l.user_role}</td>
                  <td>{l.action}</td>
                  <td>{l.entity_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
