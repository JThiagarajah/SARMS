import { db, newId, nowIso } from "../db/client";

/** Every state-changing action in SARMS is recorded here — this is what the Super Admin's
 *  system-wide activity log (Table 3) reads from, and it's the audit trail a reviewer would
 *  expect from a results-management system. */
export async function logActivity(
  userId: string,
  action: string,
  entityType: string,
  entityId?: string | null,
  meta?: Record<string, unknown>
): Promise<void> {
  await db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, meta, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId(),
    userId,
    action,
    entityType,
    entityId ?? null,
    meta ? JSON.stringify(meta) : null,
    nowIso()
  );
}
