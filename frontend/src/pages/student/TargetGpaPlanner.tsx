import { useState, type FormEvent } from "react";
import { api, ApiError } from "../../api/client";

interface TargetResult {
  requiredAverageGpa: number | null;
  achievable: boolean;
  message: string;
  completedLevels?: number;
  remainingLevels?: number;
  currentOgpa?: number;
}

export function TargetGpaPlanner() {
  const [targetOgpa, setTargetOgpa] = useState("3.7");
  const [totalLevels, setTotalLevels] = useState("4");
  const [result, setResult] = useState<TargetResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await api.post<TargetResult>("/gpa/target", {
        targetOgpa: Number(targetOgpa),
        totalLevels: Number(totalLevels),
      });
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not calculate.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Target GPA Planner</h1>
        <p>Set the OGPA you're aiming for and see the average you'll need across your remaining levels.</p>
      </div>
      <div className="card" style={{ maxWidth: 480 }}>
        <form onSubmit={onSubmit}>
          <div className="form-row">
            <div className="field">
              <label htmlFor="target">Target OGPA (0–4.00)</label>
              <input id="target" type="number" min={0} max={4} step={0.01} value={targetOgpa} onChange={(e) => setTargetOgpa(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="levels">Total levels in your programme</label>
              <input id="levels" type="number" min={1} max={6} value={totalLevels} onChange={(e) => setTotalLevels(e.target.value)} required />
            </div>
          </div>
          <button type="submit" disabled={loading}>{loading ? "Calculating…" : "Calculate"}</button>
        </form>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {result && (
        <div className={`banner ${result.achievable ? "banner-success" : "banner-error"}`}>
          {result.message}
          {result.requiredAverageGpa != null && (
            <div style={{ marginTop: 6, fontSize: "1.3rem", fontWeight: 700 }}>{result.requiredAverageGpa.toFixed(2)}</div>
          )}
        </div>
      )}
    </div>
  );
}
