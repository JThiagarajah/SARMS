import { OfferingList } from "../shared/OfferingList";

export function DeanBrowse() {
  return (
    <OfferingList
      basePath="/dean/offerings"
      title="Browse Results"
      subtitle="Read-only visibility into every course offering in your department, once its final marks have been submitted."
    />
  );
}
