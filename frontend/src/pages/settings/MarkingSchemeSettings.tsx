import { useState, type FormEvent } from "react";
import { useApi } from "../../lib/useApi";
import { api, ApiError } from "../../api/client";

interface Scheme {
  id: string;
  academic_year: string;
  theory_ese_weight: number;
  theory_ica_weight: number;
  practical_ese_weight: number;
  practical_ica_weight: number;
  ica_best_of_count: number;
  ica_total_count: number;
  acu_min_pass_grade: string;
  core_min_pass_grade: string;
  language_acu_min_pass_grade: string;
}

const EMPTY = {
  academicYear: "",
  theoryEseWeight: "0.70",
  theoryIcaWeight: "0.30",
  practicalEseWeight: "0.60",
  practicalIcaWeight: "0.40",
  icaBestOfCount: "2",
  icaTotalCount: "3",
  acuMinPassGrade: "D+",
  coreMinPassGrade: "C-",
  languageAcuMinPassGrade: "C",
};

export function MarkingSchemeSettings() {
  const schemes = useApi<Scheme[]>(() => api.get("/settings/marking-schemes"));
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof EMPTY>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.put("/settings/marking-schemes", {
        academicYear: form.academicYear,
        theoryEseWeight: Number(form.theoryEseWeight),
        theoryIcaWeight: Number(form.theoryIcaWeight),
        practicalEseWeight: Number(form.practicalEseWeight),
        practicalIcaWeight: Number(form.practicalIcaWeight),
        icaBestOfCount: Number(form.icaBestOfCount),
        icaTotalCount: Number(form.icaTotalCount),
        acuMinPassGrade: form.acuMinPassGrade,
        coreMinPassGrade: form.coreMinPassGrade,
        languageAcuMinPassGrade: form.languageAcuMinPassGrade,
      });
      setForm(EMPTY);
      schemes.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Curriculum &amp; Marking-Scheme Settings</h1>
        <p>
          Owned by the Dean or HOD. Versioned by academic year — changing this never rewrites a result computed under a
          previous year's scheme, because every result stores its own computed marks.
        </p>
      </div>

      <div className="card">
        <h2>Existing schemes</h2>
        {schemes.loading && <p className="muted">Loading…</p>}
        {schemes.data && schemes.data.length === 0 && <div className="empty-state">No custom scheme configured — the handbook defaults are in effect.</div>}
        {schemes.data && schemes.data.length > 0 && (
          <table>
            <thead><tr><th>Year</th><th>Theory ESE/ICA</th><th>Practical ESE/ICA</th><th>Best-of ICA</th><th>Core min.</th><th>ACU min.</th><th>Lang. ACU min.</th></tr></thead>
            <tbody>
              {schemes.data.map((s) => (
                <tr key={s.id}>
                  <td>{s.academic_year}</td>
                  <td>{Math.round(s.theory_ese_weight * 100)}% / {Math.round(s.theory_ica_weight * 100)}%</td>
                  <td>{Math.round(s.practical_ese_weight * 100)}% / {Math.round(s.practical_ica_weight * 100)}%</td>
                  <td>{s.ica_best_of_count} of {s.ica_total_count}</td>
                  <td>{s.core_min_pass_grade}</td>
                  <td>{s.acu_min_pass_grade}</td>
                  <td>{s.language_acu_min_pass_grade}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Create / update a year's scheme</h2>
        {error && <div className="banner banner-error">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="field" style={{ maxWidth: 220 }}>
            <label>Academic year</label>
            <input placeholder="e.g. 2026/2027" value={form.academicYear} onChange={(e) => set("academicYear", e.target.value)} required />
          </div>
          <div className="form-row">
            <div className="field">
              <label>Theory: ESE weight</label>
              <input type="number" step={0.05} min={0} max={1} value={form.theoryEseWeight} onChange={(e) => set("theoryEseWeight", e.target.value)} />
            </div>
            <div className="field">
              <label>Theory: ICA weight</label>
              <input type="number" step={0.05} min={0} max={1} value={form.theoryIcaWeight} onChange={(e) => set("theoryIcaWeight", e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label>Practical: ESE weight</label>
              <input type="number" step={0.05} min={0} max={1} value={form.practicalEseWeight} onChange={(e) => set("practicalEseWeight", e.target.value)} />
            </div>
            <div className="field">
              <label>Practical: ICA weight</label>
              <input type="number" step={0.05} min={0} max={1} value={form.practicalIcaWeight} onChange={(e) => set("practicalIcaWeight", e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label>Best-of ICA count</label>
              <input type="number" min={1} value={form.icaBestOfCount} onChange={(e) => set("icaBestOfCount", e.target.value)} />
            </div>
            <div className="field">
              <label>Of total ICA count</label>
              <input type="number" min={1} value={form.icaTotalCount} onChange={(e) => set("icaTotalCount", e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label>Core/Elective min. pass grade</label>
              <input value={form.coreMinPassGrade} onChange={(e) => set("coreMinPassGrade", e.target.value)} />
            </div>
            <div className="field">
              <label>ACU min. pass grade</label>
              <input value={form.acuMinPassGrade} onChange={(e) => set("acuMinPassGrade", e.target.value)} />
            </div>
            <div className="field">
              <label>Language ACU min. pass grade</label>
              <input value={form.languageAcuMinPassGrade} onChange={(e) => set("languageAcuMinPassGrade", e.target.value)} />
            </div>
          </div>
          <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save scheme"}</button>
        </form>
      </div>
    </div>
  );
}
