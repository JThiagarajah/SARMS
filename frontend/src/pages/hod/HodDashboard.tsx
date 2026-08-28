import { OfferingList } from "../shared/OfferingList";

export function HodDashboard() {
  return (
    <OfferingList
      basePath="/hod/offerings"
      title="Results Review"
      subtitle="Every course offering in your department. Open one to review, correct, or approve its submitted final marks."
    />
  );
}
