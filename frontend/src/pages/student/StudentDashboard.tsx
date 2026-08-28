import { useApi } from "../../lib/useApi";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { StatusBadge } from "../../components/StatusBadge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { CHART_COLORS } from "../../lib/chartColors";

// Placeholder — swap in the Dean's actual wording whenever it's supplied; nothing else about
// this feature needs to change to update the message itself.
const DEAN_WELCOME_MESSAGE =
  "Every result on this page is a step in a much longer journey. Stay curious, keep asking questions in " +
  "class, and don't hesitate to reach out to your lecturers or the department office if something's " +
  "unclear — we're here to help you succeed.";

interface EnrollmentRow {
  enrollment_id: string;
  academic_year: string;
  semester: number;
  course_code: string;
  course_name: string;
  category: string;
  status: string;
  grade: string | null;
}

interface GpaResponse {
  levels: { level: number; gpa_value: number }[];
  ogpa: { ogpa_value: number; class_of_award: string } | null;
}

interface HonoursEligibility {
  applicable: boolean;
  eligible?: boolean;
  ogpa?: number | null;
  threshold?: number;
}

export function StudentDashboard() {
  const { user } = useAuth();
  const enrollments = useApi<EnrollmentRow[]>(() => api.get("/academic/my-enrollments"));
  const gpa = useApi<GpaResponse & { honours?: HonoursEligibility }>(() => api.get("/gpa/me"));
  const batch = useApi<{ cohortSize: number; average: number | null; myOgpa: number | null; myRankFromTop: number | null }>(
    () => api.get("/gpa/batch-comparison")
  );

  const honours = gpa.data?.honours;
  const firstName = user?.fullName?.split(" ")[0] ?? "there";

  return (
    <div>
      <div className="welcome-banner">
        <h1>Welcome back, {firstName}</h1>
        <p>Here's where your grades, GPA and course results live — updated the moment a result is officially released.</p>
        <div className="dean-quote">
          “{DEAN_WELCOME_MESSAGE}”
          <span className="attribution">— A message from the Dean, Faculty of Applied Science</span>
        </div>
      </div>

      {honours?.applicable && honours.eligible && (
        <div className="honours-banner">
          <span className="icon">🏅</span>
          <div>
            <strong>You're eligible for the Special/Honours track.</strong>{" "}
            Your OGPA so far ({honours.ogpa?.toFixed(2)}) clears the {honours.threshold?.toFixed(1)} threshold for
            Level 4 honours eligibility in your programme. Speak with your HOD about what this means for your
            remaining course selections.
          </div>
        </div>
      )}

      <div className="page-header">
        <h1>My Grades &amp; GPA</h1>
        <p>Letter grades only — SARMS never shows a numeric mark to students.</p>
      </div>

      <div className="grid grid-3">
        <div className="card stat-card">
          <div className="value">{gpa.data?.ogpa ? gpa.data.ogpa.ogpa_value.toFixed(2) : "—"}</div>
          <div className="label">Overall GPA (OGPA)</div>
        </div>
        <div className="card stat-card">
          <div className="value">{gpa.data?.ogpa?.class_of_award ?? "—"}</div>
          <div className="label">Projected class of award</div>
        </div>
        <div className="card stat-card">
          <div className="value">{batch.data?.myRankFromTop ?? "—"} / {batch.data?.cohortSize ?? "—"}</div>
          <div className="label">Anonymised rank in your batch</div>
        </div>
      </div>

      {gpa.data && gpa.data.levels.length > 0 && (
        <div className="card">
          <h2>GPA by level</h2>
          <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>
            Shown as a bar chart rather than a pie — GPA is a magnitude on a fixed 0–4 scale, not a
            share of a whole, so comparing levels by bar height (not slice size) is what stays honest here.
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={gpa.data.levels.map((l) => ({ level: `Level ${l.level}`, gpa: l.gpa_value }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7ddc9" vertical={false} />
              <XAxis dataKey="level" fontSize={12} />
              <YAxis domain={[0, 4]} fontSize={12} />
              <Tooltip />
              <Bar dataKey="gpa" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card">
        <h2>Course results</h2>
        {enrollments.loading && <p className="muted">Loading…</p>}
        {enrollments.error && <div className="banner banner-error">{enrollments.error}</div>}
        {enrollments.data && enrollments.data.length === 0 && <div className="empty-state">You are not yet enrolled in any course.</div>}
        {enrollments.data && enrollments.data.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Course</th>
                <th>Year / Semester</th>
                <th>Category</th>
                <th>Status</th>
                <th>Grade</th>
              </tr>
            </thead>
            <tbody>
              {enrollments.data.map((e) => (
                <tr key={e.enrollment_id}>
                  <td><strong>{e.course_code}</strong> — {e.course_name}</td>
                  <td>{e.academic_year}, Sem {e.semester}</td>
                  <td>{e.category}</td>
                  <td><StatusBadge status={e.status} /></td>
                  <td>{e.status === "RELEASED" ? <strong>{e.grade}</strong> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {batch.data && (
        <div className="card">
          <h2>Anonymised batch comparison</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Cohort of {batch.data.cohortSize} students in your programme &amp; admission year. Batch average OGPA:{" "}
            <strong>{batch.data.average ?? "—"}</strong>. No other student's identity or individual OGPA is shown.
          </p>
        </div>
      )}
    </div>
  );
}
