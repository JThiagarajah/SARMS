import { db } from "../db/client";
import { cascadeDeleteUser } from "./cascadeDelete";

/** The Super Admin's "reset the whole system" button. Deletes every account except the one
 *  performing the reset (so the admin is never locked out) — and, via cascadeDeleteUser, every
 *  academic record that only exists because of those accounts: enrolments, marks, results, GPA,
 *  course offerings, ICA data, teaching-assignment requests, activity history. Deliberately
 *  leaves departments, degree_programmes, and course_units untouched — the org structure and
 *  course catalog are treated as setup, not data, and re-entering ~100 course units by hand is
 *  exactly the kind of cost a "reset" shouldn't impose. marking_schemes are wiped too: unlike the
 *  catalog, they're per-academic-year configuration, cheap to recreate, and would otherwise
 *  reference a now-deleted department's grading history.
 *
 *  Must be called inside transaction() — see routes/admin.ts — so a failure partway through never
 *  leaves the database half-reset. */
export async function resetSystemData(keepUserId: string): Promise<{ usersDeleted: number }> {
  const otherUserIds = (
    (await db.prepare("SELECT id FROM users WHERE id != ?").all(keepUserId)) as { id: string }[]
  ).map((r) => r.id);

  for (const id of otherUserIds) {
    await cascadeDeleteUser(id);
  }

  // Every course_offering/enrollment/result/etc. that could exist is reachable only through a
  // user (a lecturer or a student) — so deleting every user above already transitively cleared
  // all of it. What's left to clear explicitly is data that ISN'T owned by any single user:
  await db.prepare("DELETE FROM marking_schemes").run();
  // Wipe the log clean, including the caller's own pre-reset history — the point of a reset is a
  // genuinely fresh start. The route that calls this writes exactly one fresh entry right after,
  // marking when the reset happened and who did it.
  await db.prepare("DELETE FROM activity_log").run();

  return { usersDeleted: otherUserIds.length };
}
