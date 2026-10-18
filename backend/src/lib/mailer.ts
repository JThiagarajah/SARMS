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

export interface MailAttachment {
  filename: string;
  path: string;
  cid?: string;
}

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
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
    await transport.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments,
    });
    return { sent: true };
  } catch (err) {
    console.error("[mailer] Failed to send email:", err);
    return { sent: false, reason: (err as Error).message };
  }
}

export interface BulkRecipient {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
}

export interface BulkSendSummary {
  attempted: number;
  sent: number;
  failed: number;
  failures: { to: string; reason: string }[];
  usedDevMode: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends a personalised message to many recipients without tripping the sending provider's rate
 * limits — a free Gmail account throttles hard well before "a few hundred students" worth of
 * mail, so this goes out in small batches with a short pause between them rather than firing
 * every message at once. Meant to be run in the background (the caller responds to its own HTTP
 * request immediately, then awaits this) — see routes/admin.ts's broadcast-email endpoint.
 */
export async function sendBulkMail(
  recipients: BulkRecipient[],
  opts: { batchSize?: number; delayMs?: number } = {}
): Promise<BulkSendSummary> {
  const batchSize = opts.batchSize ?? 12;
  const delayMs = opts.delayMs ?? 2000;
  const transportConfigured = !!getTransport();

  const summary: BulkSendSummary = {
    attempted: recipients.length,
    sent: 0,
    failed: 0,
    failures: [],
    usedDevMode: !transportConfigured,
  };

  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (r) => {
        const result = await sendMail(r);
        return { to: r.to, result };
      })
    );
    for (const { to, result } of results) {
      if (result.sent) {
        summary.sent += 1;
      } else if (transportConfigured) {
        // Only counts as a real failure when SMTP is actually configured — otherwise every
        // "not sent" is just dev-mode logging to the console, which isn't an error.
        summary.failed += 1;
        summary.failures.push({ to, reason: result.reason ?? "Unknown error" });
      }
    }
    if (i + batchSize < recipients.length) await sleep(delayMs);
  }

  return summary;
}
