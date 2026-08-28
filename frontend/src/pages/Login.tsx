import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { ROLE_HOME } from "../lib/roles";

export function Login() {
  const { login, mustChangePassword, user } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in.");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  // Fires once auth state updates after a successful login.
  useEffect(() => {
    if (!user) return;
    navigate(mustChangePassword ? "/change-password" : ROLE_HOME[user.role], { replace: true });
  }, [user, mustChangePassword, navigate]);

  return (
    <div className="center-page">
      <div className="login-card">
        <img className="seal" src="/assets/vau-seal.png" alt="University of Vavuniya seal" />
        <div className="system-name">University of Vavuniya</div>
        <h1>SARMS</h1>
        <p className="sub">Student Academic Results &amp; GPA Management System<br />Faculty of Applied Science — Dept. of Physical Science</p>
        {error && <div className="banner banner-error">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <Link className="forgot-link" to="/forgot-password">Forgot password?</Link>
        <div className="footer-note">© {new Date().getFullYear()} University of Vavuniya. All rights reserved.</div>
      </div>
    </div>
  );
}
