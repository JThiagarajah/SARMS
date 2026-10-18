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
    <div className="login-root">
      {/*
        Desktop-only split layout (see .login-split in styles.css — hidden below 861px). A
        marketing-style left panel plus the same sign-in form on the right, so screens wide
        enough to spare the space get a more considered first impression than a lone centred
        card. Field ids are suffixed "-desktop" because this block sits in the DOM alongside
        the unchanged mobile block below; ids must stay unique even though only one block is
        ever visible at a time.
      */}
      <div className="login-split">
        <div className="login-hero">
          <div className="login-hero-brand">
            <img className="seal" src="/assets/vau-seal.png" alt="University of Vavuniya seal" />
            <div className="name">University of Vavuniya</div>
            <div className="sub">Faculty of Applied Science · Department of Physical Science</div>
          </div>
          <div className="login-hero-content">
            <h1 className="login-hero-headline">
              Results &amp; GPA,
              <br />
              <span>tracked with precision.</span>
            </h1>
            <div className="login-hero-letter">
              <p>
                To every student checking a result here: a number on this screen is never the whole story. It
                stands for the early mornings, the questions you asked in class, the draft you rewrote one more
                time. Whatever it says today, keep showing up for the next one — that's what the whole semester
                is actually made of.
              </p>
              <div className="login-hero-letter-sign">— Department of Physical Science, University of Vavuniya</div>
            </div>
          </div>
        </div>

        <div className="login-panel">
          <div className="login-card login-card-desktop">
            <img className="seal" src="/assets/vau-seal.png" alt="University of Vavuniya seal" />
            <div className="system-name">SARMS</div>
            <h1>Welcome back</h1>
            <p className="sub">Sign in with the account created by your administrator.</p>
            {error && <div className="banner banner-error">{error}</div>}
            <form onSubmit={onSubmit}>
              <div className="field">
                <label htmlFor="username-desktop">Username</label>
                <input
                  id="username-desktop"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="password-desktop">Password</label>
                <input
                  id="password-desktop"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <button type="submit" disabled={submitting} style={{ width: "100%" }}>
                {submitting ? "Signing in…" : "Sign in"}
              </button>
            </form>
            <Link className="forgot-link" to="/forgot-password">Forgot password?</Link>
            <div className="login-firsttime">
              <strong>First time signing in?</strong> Use the temporary password from your administrator — you'll
              be asked to set your own right after.
            </div>
            <div className="footer-note">© {new Date().getFullYear()} University of Vavuniya. All rights reserved.</div>
          </div>
        </div>
      </div>

      {/* Mobile layout — unchanged from before this change, and the only thing shown below 861px. */}
      <div className="center-page login-mobile-only">
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
    </div>
  );
}
