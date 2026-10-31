import nodemailer from "nodemailer";

export function emailConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

type Mail = { to: string; subject: string; html: string; text?: string; attachments?: { filename: string; content: Buffer }[] };

/** Send an email via SMTP when configured. Returns false (and logs) when email is not set up. */
export async function sendEmail(mail: Mail): Promise<boolean> {
  if (!emailConfigured()) {
    console.info(`[email not configured] Would send "${mail.subject}" to ${mail.to}\n${mail.text ?? ""}`);
    return false;
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({ from: process.env.SMTP_FROM ?? process.env.SMTP_USER, ...mail });
  return true;
}

export function appUrl() {
  return (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
