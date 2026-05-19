/**
 * The HTML body for the magic-link email. Branded with Playfair +
 * Montserrat (loaded from Google Fonts via @import — most clients
 * will fall back to serif/sans-serif if blocked, and that's fine).
 *
 * Email clients are picky: every layout uses tables, every color is
 * inline, every dimension is in pixels. This is not a modern CSS
 * environment. The goal is "polished and on-brand" without trying to
 * be a magazine.
 *
 * Called from src/auth.ts → Resend provider's sendVerificationRequest.
 */

export interface MagicLinkEmailParams {
  url: string;       // the magic link, signed/expiring
  host: string;      // e.g. "ops.sharpsighted.studio"
  email: string;     // the recipient
}

export function magicLinkHtml({ url, host }: MagicLinkEmailParams): string {
  // Don't trust the URL/host as raw text — escape for HTML embedding.
  const safeUrl = escapeHtml(url);
  const safeHost = escapeHtml(host);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in to Sharp Sighted Ops</title>
</head>
<body style="margin:0;padding:0;background:#0c0c0b;font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#0c0c0b;">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;background:#1a1917;border:1px solid rgba(255,255,255,0.08);border-radius:10px;">
          <tr>
            <td style="padding:36px 36px 16px 36px;">
              <div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;color:#c25f3e;margin-bottom:18px;">
                Sharp Sighted · Ops
              </div>
              <h1 style="margin:0 0 12px 0;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:28px;line-height:1.15;color:#faf5ec;letter-spacing:-0.01em;">
                Your <em style="color:#c25f3e;">sign-in link</em> is ready.
              </h1>
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#b5ad9f;">
                Click the link below to sign in to Sharp Sighted Ops. The link
                is valid for 24 hours and can only be used once. If you didn't
                request this, ignore the email — no account changes happen
                without the click.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:16px 36px 28px 36px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#c25f3e" style="border-radius:8px;">
                    <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 28px;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;font-weight:600;color:#faf5ec;text-decoration:none;border-radius:8px;">
                      Sign in to Ops →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 36px 32px 36px;">
              <p style="margin:0 0 8px 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.04em;color:#7a746c;">
                Or paste this URL into your browser:
              </p>
              <p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:11px;line-height:1.5;color:#94a3b8;word-break:break-all;">
                ${safeUrl}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 36px 28px 36px;border-top:1px solid rgba(255,255,255,0.08);">
              <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:13px;color:#38bdf8;letter-spacing:0.02em;">
                Stay Sharp. Stay Seen. Stay Human.
              </p>
              <p style="margin:8px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#58534c;">
                ${safeHost}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Plain-text fallback for clients that block HTML.
 */
export function magicLinkText({ url, host }: MagicLinkEmailParams): string {
  return [
    `Sign in to Sharp Sighted Ops`,
    ``,
    `Click the link below to sign in. It is valid for 24 hours and can only`,
    `be used once. If you didn't request this, ignore this email.`,
    ``,
    url,
    ``,
    `—`,
    `Stay Sharp. Stay Seen. Stay Human.`,
    host,
  ].join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
