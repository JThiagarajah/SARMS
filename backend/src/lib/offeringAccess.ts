import { db } from "../db/client";

export interface OfferingContext {
  offering: any;
  course: any;
  lecturerDepartmentId: string;
}

/** Shared lookup used by both the results workflow and PDF export routes. */
export async function getOfferingContext(offeringId: string): Promise<OfferingContext> {
  const offering = await db.prepare("SELECT * FROM course_offerings WHERE id = ?").get(offeringId);
  if (!offering) return { offering: null, course: null, lecturerDepartmentId: "" };
  const course = await db.prepare("SELECT * FROM course_units WHERE id = ?").get(offering.course_id);
  const lecturer = await db.prepare("SELECT * FROM lecturers WHERE user_id = ?").get(offering.lecturer_id);
  return { offering, course, lecturerDepartmentId: lecturer.department_id };
}
