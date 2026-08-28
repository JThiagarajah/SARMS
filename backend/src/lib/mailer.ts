import nodemailer from "nodemailer";

/**
 * Thin wrapper around Nodemailer for the forgot-password flow.
 *
 * SARMS has no email server of its own — actually delivering mail requires SMTP credentials
 * supplied by whoever deploys the system (Gmail App Password, Office365, a transactional
 * provider, etc). Those credentials are never hard-coded here: they're read from environment
 * variables at send time, so nothing sensitive ships in this repo.
 *
 * If SMTP_PASS isn't configured, sendMail() doesn't throw — it logs the message to the server
 * console and returns { sent: false } so the caller can fall back to showing the OTP directly in
 * the API response (the same "no email integration yet, hand the code to the person" pattern
 * already used for one-time account passwords elsewhere in SARMS).
 */

let cachedTransport: ReturnType<typeof nodemailer.createTransport> | null = null;
let cachedTransportKey = "";

function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  const key = `${host}:${port}:${user}`;
  if (cachedTransport && cachedTransportKey === key) return cachedTransport;

  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  cachedTransportKey = key;
  return cachedTransport;
}

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(input: SendMailInput): Promise<{ sent: boolean; reason?: string }> {
  const transport = getTransport();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@sarms.local";

  if (!transport) {
    console.log(
      `[mailer] SMTP not configured (set SMTP_HOST/SMTP_USER/SMTP_PASS in backend/.env) — ` +
        `would have sent to ${input.to}:\n  Subject: ${input.subject}\n  ${input.text.replace(/\n/g, "\n  ")}`
    );
    return { sent: false, reason: "SMTP not configured" };
  }

  try {
    await transport.sendMail({ from, to: input.to, subject: input.subject, text: input.text, html: input.html });
    return { sent: true };
  } catch (err) {
    console.error("[mailer] Failed to send email:", err);
    return { sent: false, reason: (err as Error).message };
  }
}
