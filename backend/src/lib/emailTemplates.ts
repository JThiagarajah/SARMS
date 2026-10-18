/**
 * Branded HTML email templates for SARMS (University of Vavuniya).
 *
 * Every template renders into the same table-based "shell" — inline styles only, no external
 * assets — because that's what actually survives being viewed in Gmail, Outlook, and mobile mail
 * clients, unlike a normal CSS stylesheet. Each exported function returns { subject, text, html }
 * (plus `attachments`, for the embedded seal logo) so callers (mailer.ts) always have a plain-text
 * fallback for clients that don't render HTML.
 *
 * Colours here are the same maroon + gold palette as the frontend's University of Vavuniya seal
 * theme (see frontend/src/styles.css :root) — kept in sync by hand since email needs literal hex
 * values inlined, not CSS custom properties (mail clients don't support var()).
 */

import path from "path";

const BRAND = {
  product: "SARMS",
  productFull: "Student Academic Results & GPA Management System",
  org: "University of Vavuniya",
  navy: "#3b0f33", // primary — deep maroon, matches --navy in frontend/src/styles.css
  navyDark: "#260a21", // matches --maroon-dark
  gold: "#c99a2e", // matches --gold — accent stripes/underlines only (fails AA as white-on-gold text)
  goldLight: "#f6d170", // matches --gold-light
  ink: "#241a1e", // matches --text
  muted: "#6b5f56", // matches --text-muted
  border: "#e7ddc9", // matches --border
  bg: "#f7f3ec", // matches --bg
  danger: "#b3261e", // matches --red
};

/** Where the University seal PNG lives on disk. Resolved relative to this compiled file rather
 *  than the frontend folder, so email sending doesn't depend on the frontend being deployed
 *  alongside the backend — backend/assets/vau-seal.png is this file's own copy of the same seal
 *  used at frontend/public/assets/vau-seal.png. Works both from ts-node (src/lib) and the built
 *  dist (dist/lib): both sit one level under backend/, so ../../assets resolves the same way. */
const LOGO_PATH = path.resolve(__dirname, "../../assets/vau-seal.png");
const LOGO_CID = "sarms-seal-logo";

/** The seal, embedded as a CID attachment rather than a linked <img src="https://…">, so it
 *  renders even though SARMS has no public image host — mail clients fetch a `cid:` image from
 *  the message's own attachments instead of the network. */
function logoAttachment(): NonNullable<EmailContent["attachments"]> {
  return [{ filename: "vau-seal.png", path: LOGO_PATH, cid: LOGO_CID }];
}

/** Escapes text pulled from the database or an admin's own typed input before it's dropped into
 *  HTML — an ordinary name or message shouldn't be able to break the markup (or worse, inject a
 *  tag) just because it contains a "<", "&", etc. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain multi-line text -> safe HTML paragraphs (used for the free-text broadcast body). */
function textToHtmlParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 14px;">${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

interface ShellOptions {
  preheader: string;
  heading: string;
  bodyHtml: string;
  accentColor?: string;
}

function renderShell({ preheader, heading, bodyHtml, accentColor }: ShellOptions): string {
  const accent = accentColor ?? BRAND.gold;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(BRAND.product)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid ${BRAND.border};border-top:3px solid ${BRAND.gold};">
          <tr>
            <td style="background:linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyDark});padding:24px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:44px;padding-right:12px;vertical-align:middle;">
                    <img src="cid:${LOGO_CID}" width="40" height="40" alt="${escapeHtml(BRAND.org)} seal" style="display:block;width:40px;height:40px;border-radius:50%;">
                  </td>
                  <td style="vertical-align:middle;">
                    <div style="color:${BRAND.goldLight};font-size:19px;font-weight:700;letter-spacing:0.3px;font-family:Georgia,'Times New Roman',serif;">${escapeHtml(BRAND.product)}</div>
                    <div style="color:#e4d6e7;font-size:11.5px;margin-top:1px;">${escapeHtml(BRAND.org)}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 8px;">
              <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${BRAND.ink};border-left:4px solid ${accent};padding-left:12px;">${escapeHtml(heading)}</h1>
              <div style="font-size:14.5px;line-height:1.65;color:${BRAND.ink};">
                ${bodyHtml}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 32px 28px;">
              <hr style="border:none;border-top:1px solid ${BRAND.border};margin:0 0 16px;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted};">
                This is an automated message from ${escapeHtml(BRAND.product)} at ${escapeHtml(BRAND.org)}.
                Please don't reply directly to this email — it isn't monitored.
              </p>
            </td>
          </tr>
        </table>
        <p style="max-width:560px;margin:16px 0 0;font-size:11px;color:${BRAND.muted};">
          &copy; ${new Date().getFullYear()} ${escapeHtml(BRAND.org)} · ${escapeHtml(BRAND.product)}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function codeBox(code: string, accentColor: string): string {
  return `<div style="margin:22px 0;text-align:center;">
    <span style="display:inline-block;font-family:'Courier New',monospace;font-size:26px;font-weight:700;letter-spacing:6px;color:${BRAND.navy};background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:8px;padding:14px 22px;">${escapeHtml(code)}</span>
  </div>
  <div style="height:2px;background:${accentColor};width:48px;margin:0 auto 4px;border-radius:2px;"></div>`;
}

const ROLE_LABELS: Record<string, string> = {
  STUDENT: "Student",
  LECTURER: "Lecturer",
  HOD: "Head of Department",
  DEAN: "Dean",
  CHAIRMAN_EXAM_BRANCH: "Chairman, Examination Branch",
  EXAMINATION_BRANCH: "Examination Branch",
  SUPER_ADMIN: "Super Admin",
};

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; path: string; cid?: string }[];
}

/** Sent once, right after a Super Admin creates an account (single or bulk) — carries the
 *  username and the auto-generated one-time password so the person can log in without the
 *  password ever having to be read out loud or handed over on paper. */
export function welcomeAccountEmail(input: {
  fullName: string;
  username: string;
  password: string;
  role: string;
  loginUrl?: string;
}): EmailContent {
  const roleLabel = ROLE_LABELS[input.role] ?? input.role;
  const subject = `Welcome to SARMS — your ${roleLabel} account is ready`;

  const loginLine = input.loginUrl
    ? `<div style="text-align:center;margin:24px 0 8px;">
         <a href="${escapeHtml(input.loginUrl)}" style="display:inline-block;background:${BRAND.navy};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 26px;border-radius:6px;border-bottom:2px solid ${BRAND.gold};">Sign in to SARMS</a>
       </div>`
    : "";

  const html = renderShell({
    preheader: `Your SARMS account and one-time password are ready.`,
    heading: "Your account is ready",
    bodyHtml: `
      <p style="margin:0 0 14px;">Hello ${escapeHtml(input.fullName)},</p>
      <p style="margin:0 0 14px;">An SARMS account has been created for you at ${escapeHtml(BRAND.org)} as a
        <strong>${escapeHtml(roleLabel)}</strong>. Use the temporary password below to sign in — you'll be asked
        to choose your own password immediately after your first login.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:18px 0;border:1px solid ${BRAND.border};border-radius:8px;overflow:hidden;">
        <tr>
          <td style="background:${BRAND.bg};padding:12px 16px;font-size:12px;color:${BRAND.muted};width:40%;">Username</td>
          <td style="padding:12px 16px;font-size:14px;font-weight:600;color:${BRAND.ink};">${escapeHtml(input.username)}</td>
        </tr>
        <tr>
          <td style="background:${BRAND.bg};padding:12px 16px;font-size:12px;color:${BRAND.muted};border-top:1px solid ${BRAND.border};">Temporary password</td>
          <td style="padding:12px 16px;font-size:14px;font-weight:600;font-family:'Courier New',monospace;color:${BRAND.ink};border-top:1px solid ${BRAND.border};letter-spacing:1px;">${escapeHtml(input.password)}</td>
        </tr>
      </table>
      ${loginLine}
      <p style="margin:18px 0 0;font-size:13px;color:${BRAND.muted};">For your security, don't forward this email or share this password with anyone — SARMS staff will never ask you for it.</p>
    `,
  });

  const text =
    `Hello ${input.fullName},\n\n` +
    `An SARMS account has been created for you at ${BRAND.org} as a ${roleLabel}.\n\n` +
    `Username: ${input.username}\n` +
    `Temporary password: ${input.password}\n\n` +
    `You'll be asked to choose your own password the first time you log in.\n` +
    (input.loginUrl ? `Sign in: ${input.loginUrl}\n\n` : "\n") +
    `For your security, don't share this password with anyone.\n\n— SARMS, ${BRAND.org}`;

  return { subject, text, html, attachments: logoAttachment() };
}

/** Sent on every "forgot password" request that matches a real account + personal email —
 *  carries the 6-digit one-time verification code. */
export function passwordResetOtpEmail(input: {
  fullName: string;
  username: string;
  otp: string;
  validityMinutes: number;
}): EmailContent {
  const subject = "SARMS — Your password reset code";

  const html = renderShell({
    preheader: `Your SARMS verification code is ${input.otp}.`,
    heading: "Password reset code",
    accentColor: BRAND.danger,
    bodyHtml: `
      <p style="margin:0 0 14px;">Hello ${escapeHtml(input.fullName)},</p>
      <p style="margin:0 0 14px;">A password reset was requested for your SARMS account
        (username: <strong>${escapeHtml(input.username)}</strong>). Enter the verification code below to continue.</p>
      ${codeBox(input.otp, BRAND.danger)}
      <p style="margin:20px 0 0;font-size:13px;color:${BRAND.muted};text-align:center;">This code expires in ${input.validityMinutes} minutes and can only be used once.</p>
      <p style="margin:18px 0 0;font-size:13px;color:${BRAND.muted};">If you didn't request this, you can safely ignore this email — your password will not be changed.</p>
    `,
  });

  const text =
    `Hello ${input.fullName},\n\n` +
    `A password reset was requested for your SARMS account (username: ${input.username}).\n\n` +
    `Your verification code is: ${input.otp}\n\n` +
    `This code expires in ${input.validityMinutes} minutes. If you didn't request this, you can ` +
    `safely ignore this email — your password will not be changed.\n\n— SARMS, ${BRAND.org}`;

  return { subject, text, html, attachments: logoAttachment() };
}

/** Sent by a Super Admin to a whole audience (all students / all staff / all lecturers /
 *  everyone) — subject and message are theirs; this just wraps it in the same SARMS letterhead. */
export function broadcastEmail(input: {
  fullName: string;
  subject: string;
  message: string;
  audienceLabel: string;
  senderName: string;
}): EmailContent {
  const html = renderShell({
    preheader: input.message.slice(0, 120),
    heading: input.subject,
    bodyHtml: `
      <p style="margin:0 0 14px;">Hello ${escapeHtml(input.fullName)},</p>
      ${textToHtmlParagraphs(input.message)}
      <p style="margin:20px 0 0;font-size:13px;color:${BRAND.muted};">
        Sent to ${escapeHtml(input.audienceLabel)} by ${escapeHtml(input.senderName)} via SARMS.
      </p>
    `,
  });

  const text =
    `Hello ${input.fullName},\n\n${input.message}\n\n` +
    `— Sent to ${input.audienceLabel} by ${input.senderName} via SARMS, ${BRAND.org}`;

  return { subject: input.subject, text, html, attachments: logoAttachment() };
}
