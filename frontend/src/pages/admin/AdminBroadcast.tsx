import { useState, type FormEvent } from "react";
import { useApi } from "../../lib/useApi";
import { api, ApiError } from "../../api/client";

type Audience = "STUDENTS" | "LECTURERS" | "STAFF" | "ALL";

const AUDIENCE_OPTIONS: { value: Audience; label: string }[] = [
  { value: "STUDENTS", label: "All students" },
  { value: "LECTURERS", label: "All lecturers" },
  { value: "STAFF", label: "All staff (Lecturer, HOD, Dean, Examination Branch, Super Admin)" },
  { value: "ALL", label: "Everyone" },
];

const SUBJECT_MAX = 150;
const MESSAGE_MAX = 8000;

export function AdminBroadcast() {
  const [audience, setAudience] = useState<Audience>("STUDENTS");
  const [studentYear, setStudentYear] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ audienceLabel: string; recipientCount: number } | null>(null);

  const yearQuery = audience === "STUDENTS" && studentYear ? `?studentYear=${studentYear}` : "";
  const counts = useApi<Record<Audience, number>>(
    () => api.get(`/admin/broadcast-email/audience-counts${yearQuery}`),
    [audience, studentYear]
  );
  const years = useApi<number[]>(() => api.get("/admin/broadcast-email/student-years"));

  const recipientCount = counts.data?.[audience];
  const audienceLabel =
    audience === "STUDENTS" && studentYear
      ? `students admitted in ${studentYear}`
      : AUDIENCE_OPTIONS.find((o) => o.value === audience)?.label ?? audience;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSent(null);
    if (!subject.trim() || !message.trim()) {
      setError("Subject and message are both required.");
      return;
    }
    setSending(true);
    try {
      const res = await api.post<{ queued: boolean; recipientCount: number }>("/admin/broadcast-email", {
        audience,
        ...(audience === "STUDENTS" && studentYear ? { studentYear: Number(studentYear) } : {}),
        subject: subject.trim(),
        message: message.trim(),
      });
      setSent({ audienceLabel, recipientCount: res.recipientCount });
      setSubject("");
      setMessage("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send this email.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Broadcast Email</h1>
        <p>Send one message to every active account in an audience — all students, all staff, all lecturers, or everyone at once.</p>
      </div>

      {sent && (
        <div className="banner banner-success">
          Queued for <strong>{sent.recipientCount}</strong> recipient{sent.recipientCount === 1 ? "" : "s"} ({sent.audienceLabel}).
          Sending happens in the background in small batches, so it may take a few minutes to finish reaching everyone.
        </div>
      )}
      {error && <div className="banner banner-error">{error}</div>}

      <div className="card">
        <form onSubmit={submit}>
          <div className="form-row">
            <div className="field">
              <label>Audience</label>
              <select
                value={audience}
                onChange={(e) => {
                  setAudience(e.target.value as Audience);
                  setStudentYear("");
                }}
              >
                {AUDIENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {audience === "STUDENTS" && (
              <div className="field">
                <label>Year (optional)</label>
                <select value={studentYear} onChange={(e) => setStudentYear(e.target.value)}>
                  <option value="">All years</option>
                  {years.data?.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                <div style={{ fontSize: 12, color: "var(--muted, #667085)", marginTop: 4 }}>
                  Narrow this send to students admitted in one intake year, or leave as "All years".
                </div>
              </div>
            )}
          </div>

          <div style={{ fontSize: 12, color: "var(--muted, #667085)", margin: "-8px 0 8px" }}>
            {counts.loading
              ? "Checking recipient count…"
              : recipientCount === undefined
              ? null
              : `Will reach ${recipientCount} account${recipientCount === 1 ? "" : "s"} with a personal email on file.`}
          </div>

          <div className="form-row">
            <div className="field">
              <label>Subject</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value.slice(0, SUBJECT_MAX))}
                maxLength={SUBJECT_MAX}
                placeholder="e.g. Results release for Semester 1, 2026"
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="field">
              <label>Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
                maxLength={MESSAGE_MAX}
                rows={10}
                placeholder="Write the announcement here. It will be dropped into the SARMS email template automatically — no need to add a greeting or sign-off."
                required
              />
              <div style={{ fontSize: 12, color: "var(--muted, #667085)", marginTop: 4, textAlign: "right" }}>
                {message.length} / {MESSAGE_MAX}
              </div>
            </div>
          </div>

          <button type="submit" disabled={sending || recipientCount === 0}>
            {sending ? "Sending…" : `Send to ${audienceLabel.toLowerCase()}`}
          </button>
        </form>
      </div>
    </div>
  );
}
