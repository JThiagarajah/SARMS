import { OfferingList } from "../shared/OfferingList";

export function ChairmanDashboard() {
  return (
    <OfferingList
      basePath="/chairman/offerings"
      title="Release Queue"
      subtitle="Every course offering, faculty-wide. Open one to release its HOD-approved results to students."
    />
  );
}
