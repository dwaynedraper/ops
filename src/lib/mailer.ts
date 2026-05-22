/**
 * Outbound email — a thin wrapper over the Resend REST API.
 *
 * Auth's magic-link send has its own inline call (it runs inside the
 * Auth.js provider); everything else — rep invites, the morning digest
 * — goes through here. Same Resend account, same verified sending
 * domain: AUTH_RESEND_KEY for the key, EMAIL_FROM for the from-address.
 *
 * Server-only. Never import into a client component.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

/** True when Resend is configured — callers can degrade gracefully. */
export function emailConfigured(): boolean {
  return !!process.env.AUTH_RESEND_KEY && !!process.env.EMAIL_FROM;
}

/**
 * Send one email via Resend. Throws on a missing config or a non-2xx
 * response — callers decide whether that's fatal (an invite) or just
 * logged (a best-effort digest).
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  const apiKey = process.env.AUTH_RESEND_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new Error(
      'Email is not configured — set AUTH_RESEND_KEY and EMAIL_FROM.',
    );
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
}
