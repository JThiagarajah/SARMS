import { db, newId, nowIso } from "../db/client";
import { generateOneTimePassword, hashPassword } from "./auth";
import { Role } from "./types";

export interface CreateAccountInput {
  username: string;
  fullName: string;
  email: string;
  role: Role;
  departmentId?: string | null;
  password?: string; // if omitted, a one-time password is generated
  personalEmail?: string | null; // used only by the forgot-password flow (see routes/auth.ts)
}

/** Creates a login account for any role. Used by the Super Admin's bulk-create endpoints and
 *  by the seed script. Returns the generated password when one wasn't supplied, so the caller
 *  (Super Admin UI) can hand it to the person — SARMS has no email/SMS integration, matching
 *  the proposal's "auto-generate one-time passwords with a forced first-login change" rule. */
export async function createUserAccount(input: CreateAccountInput) {
  const password = input.password ?? generateOneTimePassword();
  const id = newId();
  await db.prepare(
    `INSERT INTO users (id, username, password_hash, role, full_name, email, personal_email, must_change_password, active, department_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`
  ).run(id, input.username, hashPassword(password), input.role, input.fullName, input.email, input.personalEmail ?? null, input.departmentId ?? null, nowIso());

  return { id, generatedPassword: input.password ? null : password };
}

/** Derives a unique username from a full name or email local-part — used by the bulk-import
 *  flow when the spreadsheet leaves the username column blank. Appends a numeric suffix on
 *  collision (e.g. "j.perera", "j.perera2"). */
export async function generateUsername(seed: string): Promise<string> {
  const base = seed
    .toLowerCase()
    .replace(/@.*/, "")
    .replace(/[^a-z0-9.]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "") || "user";

  let candidate = base;
  let suffix = 1;
  while (await db.prepare("SELECT 1 FROM users WHERE username = ?").get(candidate)) {
    suffix += 1;
    candidate = `${base}${suffix}`;
  }
  return candidate;
}
