import { useApi } from "../../lib/useApi";
import { api } from "../../api/client";
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from "recharts";
import { STATUS_LABELS } from "../../lib/roles";
import { CHART_COLORS, CHART_OTHER_COLOR } from "../../lib/chartColors";

interface Report {
  statusCounts: { status: string; count: number }[];
  gradeDistribution: { grade: string; count: number }[];
  pendingCorrections: number;
}

// Pie/donut charts only read well up to ~6 segments (see dataviz skill anti-patterns) — grade
// distribution can have up to 12 bands (A+ through E), so anything past the top 5 by count folds
// into a neutral "Other" slice rather than producing an unreadable 12-color wheel.
const MAX_PIE_SEGMENTS = 5;

function toPieData(rows: { name: string; count: number }[]) {
  const sorted = [...rows].filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
  const head = sorted.slice(0, MAX_PIE_SEGMENTS);
  const tailTotal = sorted.slice(MAX_PIE_SEGMENTS).reduce((s, r) => s + r.count, 0);
  const data = head.map((r, i) => ({ ...r, color: CHART_COLORS[i % CHART_COLORS.length] }));
  if (tailTotal > 0) data.push({ name: "Other", count: tailTotal, color: CHART_OTHER_COLOR });
  return data;
}

function DonutChart({ data, emptyLabel }: { data: { name: string; count: number; color: string }[]; emptyLabel: string }) {
  if (data.length === 0) return <div className="empty-state">{emptyLabel}</div>;
  const total = data.reduce((s, r) => s + r.count, 0);
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="name"
          innerRadius={62}
          outerRadius={92}
          paddingAngle={2}
          cornerRadius={3}
          label={({ percent }) => ((percent ?? 0) >= 0.08 ? `${Math.round((percent ?? 0) * 100)}%` : "")}
          labelLine={false}
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.color} stroke="#fff" strokeWidth={2} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value, name) => [`${value} (${Math.round((Number(value) / total) * 100)}%)`, name]}
        />
        <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function DepartmentReport() {
  const report = useApi<Report>(() => api.get("/gpa/department-report"));

  if (report.loading) return <p className="muted">Loading…</p>;
  if (report.error) return <div className="banner banner-error">{report.error}</div>;
  if (!report.data) return null;

  // Fixed lifecycle order (not sorted by count) so a stage's color/position never jumps around
  // as counts change — color follows the entity, never its rank.
  const statusData = toPieData(
    Object.keys(STATUS_LABELS).map((status) => ({
      name: STATUS_LABELS[status],
      count: report.data!.statusCounts.find((s) => s.status === status)?.count ?? 0,
    }))
  );
  const gradeData = toPieData(report.data.gradeDistribution.map((g) => ({ name: g.grade, count: g.count })));

  return (
    <div>
      <div className="grid grid-3">
        <div className="card stat-card">
          <div className="value">{report.data.statusCounts.reduce((s, r) => s + r.count, 0)}</div>
          <div className="label">Total results in department</div>
        </div>
        <div className="card stat-card">
          <div className="value">{report.data.statusCounts.find((s) => s.status === "RELEASED")?.count ?? 0}</div>
          <div className="label">Released</div>
        </div>
        <div className="card stat-card">
          <div className="value">{report.data.pendingCorrections}</div>
          <div className="label">Pending correction requests</div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>Results by lifecycle stage</h2>
          <DonutChart data={statusData} emptyLabel="No results yet." />
        </div>
        <div className="card">
          <h2>Grade distribution (released only)</h2>
          <DonutChart data={gradeData} emptyLabel="No released results yet." />
        </div>
      </div>
    </div>
  );
}
