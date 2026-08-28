import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";

interface ForgotPasswordResponse {
  ok: boolean;
  message: string;
  devOtp?: string;
  devNote?: string;
}

export function ForgotPassword() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ForgotPasswordResponse | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<ForgotPasswordResponse>("/auth/forgot-password", { username, email });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not process that request.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="center-page">
      <div className="login-card">
        <img className="seal" src="/assets/vau-seal.png" alt="University of Vavuniya seal" />
        <div className="system-name">University of Vavuniya</div>
        <h1>Reset your password</h1>
        <p className="sub">
          Enter your username and the personal email address on file for your account. If they match, we'll send a
          verification code to that email.
        </p>
        {error && <div className="banner banner-error">{error}</div>}
        {result && (
          <div className="banner banner-info">
            {result.message}
            {result.devOtp && (
              <div style={{ marginTop: 8 }}>
                <strong>{result.devNote}</strong>
                <div style={{ marginTop: 4 }}>
                  Your verification code: <span className="mono" style={{ fontSize: "1.1rem", fontWeight: 700 }}>{result.devOtp}</span>
                </div>
              </div>
            )}
          </div>
        )}
        {!result && (
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="username">Username</label>
              <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
            </div>
            <div className="field">
              <label htmlFor="email">Personal email on file</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <button type="submit" disabled={submitting} style={{ width: "100%" }}>
              {submitting ? "Sending…" : "Send verification code"}
            </button>
          </form>
        )}
        {result && (
          <button style={{ width: "100%", marginTop: 4 }} onClick={() => navigate("/reset-password", { state: { username } })}>
            I have a code — reset password
          </button>
        )}
        <Link className="forgot-link" to="/login">Back to sign in</Link>
      </div>
    </div>
  );
}
