import { STATUS_LABELS } from "../lib/roles";

const COLORS: Record<string, string> = {
  ICA_OPEN: "badge-grey",
  SUBMITTED: "badge-amber",
  HOD_APPROVED: "badge-blue",
  RELEASED: "badge-green",
  PENDING: "badge-amber",
  APPROVED: "badge-green",
  REJECTED: "badge-red",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = COLORS[status] ?? "badge-grey";
  const label = STATUS_LABELS[status] ?? status;
  return <span className={`badge ${cls}`}>{label}</span>;
}
