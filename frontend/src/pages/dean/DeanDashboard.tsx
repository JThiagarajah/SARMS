import { DepartmentReport } from "../shared/DepartmentReport";

export function DeanDashboard() {
  return (
    <div>
      <div className="page-header">
        <h1>Department Report</h1>
        <p>Faculty oversight — read-only. The Dean never edits, approves, or releases a result anywhere in SARMS.</p>
      </div>
      <DepartmentReport />
    </div>
  );
}
