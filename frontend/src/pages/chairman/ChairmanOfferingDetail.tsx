import { useState } from "react";
import { ReadOnlyResults } from "../shared/ReadOnlyResults";
import { api, ApiError } from "../../api/client";

export function ChairmanOfferingDetail() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <ReadOnlyResults
      headerNote="You see HOD-approved and already-released results. Releasing publishes every approved result to students at once and permanently revokes the HOD's and Lecturer's editing rights for this course."
      footer={(results, offering, reload) => {
        const approved = results.filter((r) => r.status === "HOD_APPROVED");
        const released = results.filter((r) => r.status === "RELEASED");
        // Note: as Chairman you only ever see HOD-approved or already-released rows (never
        // SUBMITTED/ICA_OPEN ones), so this list can't tell you whether *every* enrolled
        // student has reached HOD-approval — the release call itself is the authoritative,
        // all-or-nothing check, and any student not yet ready is reported back by the server.

        async function release() {
          setBusy(true);
          setError(null);
          try {
            await api.post(`/results/offerings/${offering!.id}/release`);
            reload?.();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Could not release.");
          } finally {
            setBusy(false);
          }
        }

        if (results.length === 0) return null;
        return (
          <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            {error && <div className="banner banner-error">{error}</div>}
            {released.length === results.length ? (
              <div className="banner banner-success" style={{ marginBottom: 0 }}>All results for this course have been released.</div>
            ) : approved.length === 0 ? (
              <div className="banner banner-info" style={{ marginBottom: 0 }}>No results are HOD-approved yet.</div>
            ) : (
              <button onClick={release} disabled={busy}>
                {busy ? "Releasing…" : `Release this course's results to students`}
              </button>
            )}
          </div>
        );
      }}
    />
  );
}
