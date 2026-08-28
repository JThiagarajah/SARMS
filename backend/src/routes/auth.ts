import { Router } from "express";
import { z } from "zod";
import { db, newId, nowIso } from "../db/client";
import { generateOtp, hashPassword, signToken, verifyPassword } from "../lib/auth";
import { requireAuth } from "../middleware/auth";
import { logActivity } from "../lib/activityLog";
import { sendMail } from "../lib/mailer";
import { UserRow } from "../lib/types";

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Username and password are required." });
  const { username, password } = parsed.data;

  const row = (await db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username)) as unknown as UserRow | undefined;

  if (!row || !row.active || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  const authUser = {
    id: row.id,
    username: row.username,
    role: row.role,
    fullName: row.full_name,
    departmentId: row.department_id,
  };
  const token = signToken(authUser);
  await logActivity(row.id, "LOGIN", "User", row.id);

  res.json({
    token,
    user: authUser,
    mustChangePassword: !!row.must_change_password,
  });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
});

router.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
  }
  const { currentPassword, newPassword } = parsed.data;
  const row = (await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user!.id)) as unknown as UserRow;

  if (!verifyPassword(currentPassword, row.password_hash)) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }

  await db.prepare(
    "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?"
  ).run(hashPassword(newPassword), row.id);

  await logActivity(row.id, "CHANGE_PASSWORD", "User", row.id);
  res.json({ ok: true });
});

const OTP_VALIDITY_MINUTES = 15;

const forgotPasswordSchema = z.object({
  username: z.string().min(1),
  email: z.string().min(1),
});

// Step 1 of "forgot password": prove you know both the username AND the personal email address
// on file for it. Always responds with the same generic message either way (so the response can't
// be used to enumerate valid usernames) — the OTP is only actually created and emailed when the
// two match. If no SMTP is configured, the OTP is echoed back in the response under `devOtp` (and
// logged server-side) so the flow is still testable — see backend/.env for how to wire up real email.
router.post("/forgot-password", async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Username and email are required." });
  const { username, email } = parsed.data;

  const genericResponse = {
    ok: true,
    message: "If that username and personal email match our records, a verification code has been sent to that email.",
  };

  const row = (await db.prepare("SELECT * FROM users WHERE username = ?").get(username)) as unknown as UserRow | undefined;
  if (!row || !row.active || !row.personal_email) return res.json(genericResponse);
  if (row.personal_email.trim().toLowerCase() !== email.trim().toLowerCase()) return res.json(genericResponse);

  const otp = generateOtp();
  await db.prepare(
    "INSERT INTO password_resets (id, user_id, otp_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(
    newId(),
    row.id,
    hashPassword(otp),
    new Date(Date.now() + OTP_VALIDITY_MINUTES * 60 * 1000).toISOString(),
    nowIso()
  );
  await logActivity(row.id, "PASSWORD_RESET_REQUESTED", "User", row.id);

  const mailResult = await sendMail({
    to: row.personal_email,
    subject: "SARMS — Password reset code",
    text:
      `Hello ${row.full_name},\n\n` +
      `A password reset was requested for your SARMS account (username: ${row.username}).\n\n` +
      `Your verification code is: ${otp}\n\n` +
      `This code expires in ${OTP_VALIDITY_MINUTES} minutes. If you didn't request this, you can ` +
      `safely ignore this email — your password will not be changed.\n\n` +
      `— SARMS, University of Vavuniya`,
  });

  res.json(mailResult.sent ? genericResponse : { ...genericResponse, devOtp: otp, devNote: "SMTP not configured on the server — showing the code here instead of emailing it." });
});

const resetPasswordSchema = z.object({
  username: z.string().min(1),
  otp: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
});

router.post("/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
  }
  const { username, otp, newPassword } = parsed.data;

  const row = (await db.prepare("SELECT * FROM users WHERE username = ?").get(username)) as unknown as UserRow | undefined;
  if (!row) return res.status(400).json({ error: "Invalid or expired code." });

  const candidates = (await db
    .prepare("SELECT * FROM password_resets WHERE user_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC")
    .all(row.id, nowIso())) as any[];

  const match = candidates.find((c) => verifyPassword(otp, c.otp_hash));
  if (!match) return res.status(400).json({ error: "Invalid or expired code." });

  await db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(
    hashPassword(newPassword),
    row.id
  );
  await db.prepare("UPDATE password_resets SET used_at = ? WHERE id = ?").run(nowIso(), match.id);
  await logActivity(row.id, "PASSWORD_RESET", "User", row.id);

  res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  const row = (await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user!.id)) as unknown as UserRow | undefined;
  if (!row) return res.status(404).json({ error: "User not found." });
  res.json({
    id: row.id,
    username: row.username,
    role: row.role,
    fullName: row.full_name,
    email: row.email,
    personalEmail: row.personal_email,
    departmentId: row.department_id,
    mustChangePassword: !!row.must_change_password,
    createdAt: row.created_at,
  });
});

// Self-service: any signed-in user can set/update their own personal (recovery) email — the one
// the forgot-password flow checks against. A Super Admin can also set this for someone else via
// PATCH /admin/users/:id/personal-email (routes/admin.ts); this is the self-service counterpart.
const selfPersonalEmailSchema = z.object({ personalEmail: z.string().email().optional().or(z.literal("")) });

router.patch("/me/personal-email", requireAuth, async (req, res) => {
  const parsed = selfPersonalEmailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid email address, or leave it blank to clear it." });
  await db.prepare("UPDATE users SET personal_email = ? WHERE id = ?").run(parsed.data.personalEmail || null, req.user!.id);
  await logActivity(req.user!.id, "UPDATE_PERSONAL_EMAIL", "User", req.user!.id);
  res.json({ ok: true });
});

export default router;
