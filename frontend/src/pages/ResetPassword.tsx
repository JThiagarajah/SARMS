import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";

export function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefillUsername = (location.state as { username?: string } | null)?.username ?? "";

  const [username, setUsername] = useState(prefillUsername);
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("The two passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/reset-password", { username, otp, newPassword });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset your password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="center-page">
      <div className="login-card">
        <img className="seal" src="/assets/vau-seal.png" alt="University of Vavuniya seal" />
        <div className="system-name">University of Vavuniya</div>
        <h1>Enter your code</h1>
        <p className="sub">Enter the verification code that was sent to your personal email, along with your new password.</p>
        {error && <div className="banner banner-error">{error}</div>}
        {done ? (
          <div>
            <div className="banner banner-success">Your password has been reset. You can now sign in.</div>
            <button style={{ width: "100%" }} onClick={() => navigate("/login")}>Go to sign in</button>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="username">Username</label>
              <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus={!prefillUsername} />
            </div>
            <div className="field">
              <label htmlFor="otp">Verification code</label>
              <input id="otp" value={otp} onChange={(e) => setOtp(e.target.value)} required autoFocus={!!prefillUsername} inputMode="numeric" maxLength={6} />
            </div>
            <div className="field">
              <label htmlFor="newPassword">New password</label>
              <input id="newPassword" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
            </div>
            <div className="field">
              <label htmlFor="confirmPassword">Confirm new password</label>
              <input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} />
            </div>
            <button type="submit" disabled={submitting} style={{ width: "100%" }}>
              {submitting ? "Resetting…" : "Reset password"}
            </button>
          </form>
        )}
        <Link className="forgot-link" to="/login">Back to sign in</Link>
      </div>
    </div>
  );
}
