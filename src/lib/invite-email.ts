/**
 * The rep-invite email — sent when an admin adds someone to the roster.
 *
 * It does not carry a magic link (those are one-time and minted at
 * sign-in). It points the rep at the sign-in page, where they enter
 * their invited email and Auth.js sends the real link. Same table-based,
 * inline-styled approach as the magic-link email — email clients are
 * not a modern CSS environment.
 */

export interface InviteEmailParams {
  signinUrl: string; // the /signin page URL
  host: string; // e.g. "ops.sharpsighted.studio"
  repName?: string | null; // the invited rep, if a name was given
}

export function inviteEmailHtml({ signinUrl, host, repName }: InviteEmailParams): string {
  const safeUrl = escapeHtml(signinUrl);
  const safeHost = escapeHtml(host);
  const hello = repName ? `${escapeHtml(repName)}, you're` : `You're`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>You're invited to Sharp Sighted Ops</title>
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
                ${hello} <em style="color:#c25f3e;">invited</em>.
              </h1>
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#b5ad9f;">
                You've been invited to Sharp Sighted Ops — the sales tool for
                the Sharp Sighted pipeline. To get started, open the sign-in
                page and enter this email address; a one-time sign-in link
                will be sent to you.
              </p>
              <p style="margin:14px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#7a746c;">
                After you sign in, your account waits for activation while
                onboarding paperwork is finalized. You'll have full access as
                soon as that's done.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 36px 28px 36px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#c25f3e" style="border-radius:8px;">
                    <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 28px;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;font-weight:600;color:#faf5ec;text-decoration:none;border-radius:8px;">
                      Go to sign-in →
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

export function inviteEmailText({ signinUrl, host, repName }: InviteEmailParams): string {
  return [
    repName ? `${repName}, you're invited to Sharp Sighted Ops` : `You're invited to Sharp Sighted Ops`,
    ``,
    `Open the sign-in page and enter this email address. A one-time`,
    `sign-in link will be sent to you.`,
    ``,
    signinUrl,
    ``,
    `After you sign in, your account waits for activation while onboarding`,
    `paperwork is finalized — you'll have full access as soon as that's done.`,
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
