import { db, newId, nowIso } from "../db/client";
import { generateOneTimePassword, hashPassword } from "./auth";
import { sendMail } from "./mailer";
import { welcomeAccountEmail } from "./emailTemplates";
import { Role } from "./types";

export interface CreateAccountInput {
  username: string;
  fullName: string;
  email: string;
  role: Role;
  departmentId?: string | null;
  password?: string; // if omitted, a one-time password is generated
  // The Super Admin UI and bulk-import both require this for every new account (see
  // routes/admin.ts / routes/bulkAccounts.ts) — it's a personal address the person actually
  // checks, as opposed to `email` (their institutional address, which may not be live yet for a
  // brand-new account). It's the ONLY address the welcome email and the forgot-password flow ever
  // send to. Stays optional on this type because the seed script still creates a few demo
  // accounts without one — those just don't get a welcome email (see below).
  personalEmail?: string | null;
}

/** Creates a login account for any role. Used by the Super Admin's bulk-create endpoints and
 *  by the seed script. Returns the generated password when one wasn't supplied, so the caller
 *  (Super Admin UI) can still hand it to the person directly (on-screen / PDF download) as a
 *  fallback. When a password was auto-generated and a personal email is on file, a welcome email
 *  carrying the username + one-time password is also sent there (see lib/mailer.ts — if SMTP
 *  isn't configured on the server this just logs to the console, same "no email integration yet"
 *  dev-mode fallback already used by the forgot-password flow). */
export async function createUserAccount(input: CreateAccountInput) {
  const password = input.password ?? generateOneTimePassword();
  const wasGenerated = !input.password;
  const id = newId();
  await db.prepare(
    `INSERT INTO users (id, username, password_hash, role, full_name, email, personal_email, must_change_password, active, department_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`
  ).run(id, input.username, hashPassword(password), input.role, input.fullName, input.email, input.personalEmail ?? null, input.departmentId ?? null, nowIso());

  if (wasGenerated && input.personalEmail) {
    const { subject, text, html, attachments } = welcomeAccountEmail({
      fullName: input.fullName,
      username: input.username,
      password,
      role: input.role,
      loginUrl: process.env.FRONTEND_URL || undefined,
    });
    // Fire-and-forget from the caller's perspective would risk an unhandled rejection with no
    // one to report it to, so this is awaited — but a failed send never blocks account creation
    // itself; sendMail() already swallows and logs its own errors instead of throwing.
    await sendMail({ to: input.personalEmail, subject, text, html, attachments });
  }

  return { id, generatedPassword: wasGenerated ? password : null };
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
