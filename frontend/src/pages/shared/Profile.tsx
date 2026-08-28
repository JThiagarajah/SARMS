import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../../lib/useApi";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { ROLE_LABELS } from "../../lib/roles";

interface MyProfile {
  full_name: string;
  username: string;
  email: string;
  personal_email: string | null;
  role: string;
  created_at: string;
  department_name?: string | null;
  // Student-only
  registration_no?: string;
  programme_name?: string;
  level?: number;
  admission_year?: number;
  // Lecturer-only
  designation?: string | null;
  // Student-only — Level 4 Special/Honours eligibility (see gpaService.computeHonoursEligibility)
  honours?: { applicable: boolean; eligible?: boolean; ogpa?: number | null; threshold?: number };
}

export function Profile() {
  const { user } = useAuth();
  const profile = useApi<MyProfile>(() => api.get("/academic/my-profile"));

  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function savePersonalEmail() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.patch("/auth/me/personal-email", { personalEmail: emailDraft });
      setEditingEmail(false);
      setSaved(true);
      profile.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update personal email.");
    } finally {
      setSaving(false);
    }
  }

  const p = profile.data;

  return (
    <div>
      <div className="page-header">
        <h1>My Profile</h1>
        <p>Your account details on file with SARMS.</p>
      </div>

      {profile.loading && <p className="muted">Loading…</p>}
      {profile.error && <div className="banner banner-error">{profile.error}</div>}

      {p?.honours?.applicable && p.honours.eligible && (
        <div className="honours-banner">
          <span className="icon">🏅</span>
          <div>
            <strong>Eligible for the Special/Honours track.</strong>{" "}
            OGPA so far: {p.honours.ogpa?.toFixed(2)} (threshold {p.honours.threshold?.toFixed(1)}).
          </div>
        </div>
      )}

      {p && (
        <>
          <div className="grid grid-2">
            <div className="card">
              <h2>Account</h2>
              <table>
                <tbody>
                  <tr><th style={{ width: 160 }}>Full name</th><td>{p.full_name}</td></tr>
                  <tr><th>Username</th><td className="mono">{p.username}</td></tr>
                  <tr><th>Role</th><td>{ROLE_LABELS[p.role as keyof typeof ROLE_LABELS] ?? p.role}</td></tr>
                  <tr><th>Institutional email</th><td>{p.email}</td></tr>
                  {p.department_name && <tr><th>Department</th><td>{p.department_name}</td></tr>}
                  {p.designation && <tr><th>Designation</th><td>{p.designation}</td></tr>}
                  <tr><th>Account created</th><td>{new Date(p.created_at).toLocaleDateString()}</td></tr>
                </tbody>
              </table>
            </div>

            {p.role === "STUDENT" && (
              <div className="card">
                <h2>Student details</h2>
                <table>
                  <tbody>
                    <tr><th style={{ width: 160 }}>Registration No.</th><td className="mono">{p.registration_no}</td></tr>
                    <tr><th>Programme</th><td>{p.programme_name}</td></tr>
                    <tr><th>Level</th><td>{p.level}</td></tr>
                    <tr><th>Admission year</th><td>{p.admission_year}</td></tr>
                    <tr><th>Department</th><td>{p.department_name}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h2>Security</h2>
            <p className="muted" style={{ marginTop: -6 }}>
              Your personal email is used only to verify you when you use "Forgot password?" on the sign-in page —
              a verification code is sent there, nowhere else. It's never shown to other users.
            </p>
            {error && <div className="banner banner-error">{error}</div>}
            {saved && <div className="banner banner-success">Personal email updated.</div>}
            <div className="field" style={{ maxWidth: 380 }}>
              <label>Personal email (for password reset)</label>
              {editingEmail ? (
                <div className="gap-8">
                  <input type="email" value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} placeholder="name@example.com" />
                  <button className="small" onClick={savePersonalEmail} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                  <button className="small secondary" onClick={() => setEditingEmail(false)}>Cancel</button>
                </div>
              ) : (
                <div className="gap-8" style={{ alignItems: "center" }}>
                  <span>{p.personal_email ?? "Not set"}</span>
                  <button
                    className="small ghost"
                    onClick={() => { setEditingEmail(true); setEmailDraft(p.personal_email ?? ""); setSaved(false); }}
                  >
                    {p.personal_email ? "Edit" : "Set"}
                  </button>
                </div>
              )}
            </div>
            <div style={{ marginTop: 16 }}>
              <Link to="/change-password"><button className="secondary">Change password</button></Link>
            </div>
          </div>
        </>
      )}

      {!profile.loading && !p && user && (
        <div className="empty-state">Could not load your profile.</div>
      )}
    </div>
  );
}
