import { db } from "../db/client";

// SARMS originally blocked every delete the moment anything referenced the row being removed
// ("Cannot delete a course unit that has course offerings", etc.) and told the admin to
// deactivate/unlink instead. That's the safe default, but it also means a genuine mistake (a
// duplicate course, a test student, a lecturer entered twice) could never actually be removed
// once anything at all pointed to it. Every function here does the opposite: it walks the row's
// real dependents and deletes them too, so the top-level delete always succeeds. Each function
// assumes it's called inside `transaction()` (see routes/admin.ts) so a failure partway through
// rolls back the whole thing rather than leaving the database half-cascaded.
//
// One distinction matters throughout: a row can depend on the thing being deleted in two very
// different ways.
//   1. It's really the deleted entity's OWN data — a student's enrolments and grades, a
//      lecturer's course offerings, a course's offerings. Deleting the parent legitimately means
//      deleting these too, so they're cascaded (actually removed).
//   2. It merely records that the deleted entity (almost always a staff account) ADMINISTRATIVELY
//      ACTED on someone else's data — who assigned an offering, who approved a result, who
//      created a marking scheme. That data belongs to other students/lecturers/courses and must
//      survive; only the "who did it" attribution is cleared to NULL. schema.sql loosens those
//      specific columns' NOT NULL constraint so this is possible.

async function cascadeDeleteEnrollment(enrollmentId: string): Promise<void> {
  const result = (await db.prepare("SELECT id FROM results WHERE enrollment_id = ?").get(enrollmentId)) as
    | { id: string }
    | undefined;
  if (result) {
    await db.prepare("DELETE FROM result_versions WHERE result_id = ?").run(result.id);
    await db.prepare("DELETE FROM correction_requests WHERE result_id = ?").run(result.id);
    await db.prepare("DELETE FROM results WHERE id = ?").run(result.id);
  }
  await db.prepare("DELETE FROM enrollments WHERE id = ?").run(enrollmentId);
}

/** Deletes a single enrolment (and its Result, with that Result's own version history and
 *  correction requests) — used directly by DELETE /admin/enrollments/:id, and by every other
 *  cascade below that needs to clear enrolments out from under a student/offering/course. */
export async function cascadeDeleteEnrollmentById(enrollmentId: string): Promise<void> {
  await cascadeDeleteEnrollment(enrollmentId);
}

/** Deletes a course offering and everything that exists only because of it: its enrolments (each
 *  fully cascaded, per cascadeDeleteEnrollment) and its ICA instruments (and each instrument's
 *  marks). Any lecturer_assignment_request that produced this offering is a historical decision
 *  record in its own right, so it isn't deleted — just its offering_id link (nullable) is
 *  cleared. */
export async function cascadeDeleteOffering(offeringId: string): Promise<void> {
  const enrollmentIds = (
    (await db.prepare("SELECT id FROM enrollments WHERE offering_id = ?").all(offeringId)) as { id: string }[]
  ).map((r) => r.id);
  for (const id of enrollmentIds) await cascadeDeleteEnrollment(id);

  const instrumentIds = (
    (await db.prepare("SELECT id FROM ica_instruments WHERE offering_id = ?").all(offeringId)) as { id: string }[]
  ).map((r) => r.id);
  for (const id of instrumentIds) {
    await db.prepare("DELETE FROM ica_marks WHERE instrument_id = ?").run(id);
  }
  await db.prepare("DELETE FROM ica_instruments WHERE offering_id = ?").run(offeringId);

  await db.prepare("UPDATE lecturer_assignment_requests SET offering_id = NULL WHERE offering_id = ?").run(offeringId);
  await db.prepare("DELETE FROM course_offerings WHERE id = ?").run(offeringId);
}

/** Deletes a course unit and every offering ever created for it (each fully cascaded — see
 *  cascadeDeleteOffering), plus its resit attempts and any lecturer_assignment_requests naming it
 *  (those exist only to propose an offering for this exact course, so they go with it). */
export async function cascadeDeleteCourse(courseId: string): Promise<void> {
  const offeringIds = (
    (await db.prepare("SELECT id FROM course_offerings WHERE course_id = ?").all(courseId)) as { id: string }[]
  ).map((r) => r.id);
  for (const id of offeringIds) await cascadeDeleteOffering(id);

  await db.prepare("DELETE FROM resit_attempts WHERE course_id = ?").run(courseId);
  await db.prepare("DELETE FROM lecturer_assignment_requests WHERE course_id = ?").run(courseId);
  await db.prepare("DELETE FROM course_units WHERE id = ?").run(courseId);
}

/** Deletes a student's own academic footprint: enrolments (each fully cascaded), ICA marks,
 *  resit attempts, and GPA/OGPA records. Does not delete the `students`/`users` rows themselves
 *  — callers (cascadeDeleteUser) do that. Safe to call for a non-student id (every query below
 *  just matches zero rows). */
async function cascadeDeleteStudentRecords(studentUserId: string): Promise<void> {
  const enrollmentIds = (
    (await db.prepare("SELECT id FROM enrollments WHERE student_id = ?").all(studentUserId)) as { id: string }[]
  ).map((r) => r.id);
  for (const id of enrollmentIds) await cascadeDeleteEnrollment(id);

  await db.prepare("DELETE FROM ica_marks WHERE student_id = ?").run(studentUserId);
  await db.prepare("DELETE FROM resit_attempts WHERE student_id = ?").run(studentUserId);
  await db.prepare("DELETE FROM gpa_records WHERE student_id = ?").run(studentUserId);
  await db.prepare("DELETE FROM ogpa_records WHERE student_id = ?").run(studentUserId);
}

/** Deletes any user account — student, lecturer, or any staff role — and everything that's
 *  really theirs: as a student, their own enrolments/marks/results/GPA; as a lecturer, every
 *  course offering they were assigned (each fully cascaded, so no enrolment/result is left
 *  orphaned) and their own teaching-assignment requests; their own activity-log history;
 *  password_resets (already ON DELETE CASCADE from users). It deliberately does NOT delete
 *  records that merely belong to *other* people just because this user administratively acted on
 *  them at some point (an offering they assigned as Super Admin, a result they approved as HOD, a
 *  marking scheme they created as Dean) — those "who did this" references are cleared to NULL
 *  instead (see the ALTER TABLE ... DROP NOT NULL statements in schema.sql), so the underlying
 *  record survives for whoever it actually belongs to. `students`/`lecturers` rows are removed
 *  automatically (ON DELETE CASCADE from users) once the users row itself is deleted below. */
export async function cascadeDeleteUser(userId: string): Promise<void> {
  await cascadeDeleteStudentRecords(userId);

  const offeringIds = (
    (await db.prepare("SELECT id FROM course_offerings WHERE lecturer_id = ?").all(userId)) as { id: string }[]
  ).map((r) => r.id);
  for (const id of offeringIds) await cascadeDeleteOffering(id);

  await db.prepare("DELETE FROM lecturer_assignment_requests WHERE lecturer_id = ?").run(userId);
  await db.prepare("DELETE FROM activity_log WHERE user_id = ?").run(userId);

  await db.prepare("UPDATE course_offerings SET assigned_by_id = NULL WHERE assigned_by_id = ?").run(userId);
  await db.prepare("UPDATE enrollments SET enrolled_by_id = NULL WHERE enrolled_by_id = ?").run(userId);
  await db.prepare("UPDATE marking_schemes SET created_by_id = NULL WHERE created_by_id = ?").run(userId);
  await db.prepare("UPDATE results SET submitted_by_id = NULL WHERE submitted_by_id = ?").run(userId);
  await db.prepare("UPDATE results SET hod_approved_by_id = NULL WHERE hod_approved_by_id = ?").run(userId);
  await db.prepare("UPDATE results SET released_by_id = NULL WHERE released_by_id = ?").run(userId);
  await db.prepare("UPDATE result_versions SET changed_by_id = NULL WHERE changed_by_id = ?").run(userId);
  await db.prepare("UPDATE correction_requests SET requested_by_id = NULL WHERE requested_by_id = ?").run(userId);
  await db.prepare("UPDATE correction_requests SET decided_by_id = NULL WHERE decided_by_id = ?").run(userId);
  await db.prepare("UPDATE lecturer_assignment_requests SET uploaded_by_id = NULL WHERE uploaded_by_id = ?").run(userId);
  await db.prepare("UPDATE lecturer_assignment_requests SET decided_by_id = NULL WHERE decided_by_id = ?").run(userId);

  await db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}

/** Deletes a degree programme and every student/course unit still linked to it (each fully
 *  cascaded — see cascadeDeleteUser / cascadeDeleteCourse). Potentially the most destructive
 *  delete in SARMS short of a whole department: it can remove every student ever admitted to the
 *  programme, along with all of their results. */
export async function cascadeDeleteProgramme(programmeId: string): Promise<void> {
  const studentIds = (
    (await db.prepare("SELECT user_id FROM students WHERE programme_id = ?").all(programmeId)) as { user_id: string }[]
  ).map((r) => r.user_id);
  for (const id of studentIds) await cascadeDeleteUser(id);

  const courseIds = (
    (await db.prepare("SELECT id FROM course_units WHERE programme_id = ?").all(programmeId)) as { id: string }[]
  ).map((r) => r.id);
  for (const id of courseIds) await cascadeDeleteCourse(id);

  await db.prepare("DELETE FROM degree_programmes WHERE id = ?").run(programmeId);
}

/** Deletes a department and every programme, staff account, and marking scheme linked to it
 *  (each fully cascaded). Programmes cascade to their own students and course units, so this is
 *  the single most destructive delete in SARMS — it can remove an entire department's student
 *  body and staff. */
export async function cascadeDeleteDepartment(departmentId: string): Promise<void> {
  const programmeIds = (
    (await db.prepare("SELECT id FROM degree_programmes WHERE department_id = ?").all(departmentId)) as {
      id: string;
    }[]
  ).map((r) => r.id);
  for (const id of programmeIds) await cascadeDeleteProgramme(id);

  const staffIds = (
    (await db.prepare("SELECT id FROM users WHERE department_id = ?").all(departmentId)) as { id: string }[]
  ).map((r) => r.id);
  for (const id of staffIds) await cascadeDeleteUser(id);

  await db.prepare("DELETE FROM marking_schemes WHERE department_id = ?").run(departmentId);
  await db.prepare("DELETE FROM departments WHERE id = ?").run(departmentId);
}
