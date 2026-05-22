/**
 * The morning-digest email — renders DigestData to branded HTML + text.
 *
 * Sent by the digest cron route to reps who opted in (ops_profiles.
 * digest_email). Same table-based, inline-styled approach as the other
 * Ops emails — email clients are not a modern CSS environment.
 */

import type { DigestData, DigestItem } from '@/lib/digest';

export interface DigestEmailParams {
  firstName: string;
  dateLabel: string; // e.g. "Tuesday, May 26"
  appUrl: string; // origin, no trailing slash
}

const INK = '#faf5ec';
const MUTED = '#b5ad9f';
const FAINT = '#7a746c';
const RUST = '#c25f3e';
const GOOD = '#4ade80';
const WARN = '#fbbf24';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** One prospect row inside a section. */
function itemRow(item: DigestItem, href: string, tag: string, tagColor: string): string {
  const org = item.orgName ? ` &middot; ${esc(item.orgName)}` : '';
  return `<tr>
    <td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
      <a href="${esc(href)}" style="text-decoration:none;color:${INK};font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:bold;">
        ${esc(item.contactName)}
      </a>
      <div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;color:${MUTED};margin-top:2px;">
        ${esc(item.workflowName)}${org}
      </div>
    </td>
    <td align="right" style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.07);font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:${tagColor};white-space:nowrap;">
      ${esc(tag)}
    </td>
  </tr>`;
}

function section(title: string, rows: string): string {
  return `<tr><td style="padding:22px 36px 0 36px;">
    <div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${RUST};margin-bottom:6px;">
      ${esc(title)}
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>
  </td></tr>`;
}

export function digestEmailHtml(data: DigestData, p: DigestEmailParams): string {
  const base = p.appUrl.replace(/\/$/, '');

  const sections: string[] = [];
  if (data.replies.length > 0) {
    sections.push(
      section(
        'Replies waiting on you',
        data.replies
          .map((i) => itemRow(i, `${base}/prospects/${i.id}`, 'Replied', GOOD))
          .join(''),
      ),
    );
  }
  if (data.dueNow.length > 0) {
    sections.push(
      section(
        'Follow-ups due today',
        data.dueNow
          .map((i) =>
            itemRow(
              i,
              `${base}/tracking`,
              `${i.status === 'due' ? 'Due' : 'Ready'} · ${i.nextLabel}`,
              i.status === 'due' ? WARN : RUST,
            ),
          )
          .join(''),
      ),
    );
  }
  if (data.closeOuts.length > 0) {
    sections.push(
      section(
        'Ready to close out',
        data.closeOuts
          .map((i) => itemRow(i, `${base}/tracking`, 'No reply', FAINT))
          .join(''),
      ),
    );
  }

  const intro = data.allClear
    ? 'Nothing is waiting on you this morning — a clean slate. A good day to put fresh names in the pipeline.'
    : `Your brief for today: ${[
        data.replies.length > 0 &&
          `${data.replies.length} repl${data.replies.length === 1 ? 'y' : 'ies'} to act on`,
        data.dueNow.length > 0 &&
          `${data.dueNow.length} follow-up${data.dueNow.length === 1 ? '' : 's'} due`,
        data.closeOuts.length > 0 && `${data.closeOuts.length} to close out`,
      ]
        .filter(Boolean)
        .join(', ')}.`;

  const waitingLine =
    data.waiting.length > 0
      ? `<tr><td style="padding:18px 36px 0 36px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${FAINT};">
          ${data.waiting.length} prospect${data.waiting.length === 1 ? ' is' : 's are'} mid-cycle${
            data.soonestWait !== null
              ? ` — the next comes due in ${data.soonestWait} day${data.soonestWait === 1 ? '' : 's'}.`
              : '.'
          }
        </td></tr>`
      : '';

  const body = data.allClear
    ? `<tr><td style="padding:6px 36px 0 36px;">
        <a href="${esc(base)}/today" style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${RUST};">Open Today &rarr;</a>
      </td></tr>`
    : sections.join('');

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Your morning brief</title></head>
<body style="margin:0;padding:0;background:#0c0c0b;font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#0c0c0b;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:540px;background:#1a1917;border:1px solid rgba(255,255,255,0.08);border-radius:10px;">
        <tr><td style="padding:34px 36px 0 36px;">
          <div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${RUST};margin-bottom:14px;">
            Sharp Sighted &middot; ${esc(p.dateLabel)}
          </div>
          <h1 style="margin:0 0 10px 0;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:26px;line-height:1.15;color:${INK};letter-spacing:-0.01em;">
            Good morning, <em style="color:${RUST};">${esc(p.firstName || 'there')}</em>.
          </h1>
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:${MUTED};">
            ${esc(intro)}
          </p>
        </td></tr>
        ${body}
        ${waitingLine}
        <tr><td style="padding:24px 36px 30px 36px;border-top:1px solid rgba(255,255,255,0.08);margin-top:20px;">
          <p style="margin:0 0 10px 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:${FAINT};">
            <a href="${esc(base)}/today" style="color:${FAINT};">Open Today</a>
            &nbsp;&middot;&nbsp;
            <a href="${esc(base)}/today" style="color:${FAINT};">Turn this email off</a>
          </p>
          <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:13px;color:#38bdf8;">
            Stay Sharp. Stay Seen. Stay Human.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function digestEmailText(data: DigestData, p: DigestEmailParams): string {
  const base = p.appUrl.replace(/\/$/, '');
  const lines: string[] = [`Good morning, ${p.firstName || 'there'} — ${p.dateLabel}`, ''];

  if (data.allClear) {
    lines.push('Nothing is waiting on you this morning. A clean slate.');
  } else {
    const list = (title: string, items: DigestItem[], tagFor: (i: DigestItem) => string) => {
      if (items.length === 0) return;
      lines.push(`${title}:`);
      for (const i of items) {
        lines.push(
          `  - ${i.contactName} (${i.workflowName}${i.orgName ? `, ${i.orgName}` : ''}) — ${tagFor(i)}`,
        );
      }
      lines.push('');
    };
    list('Replies waiting on you', data.replies, () => 'replied');
    list('Follow-ups due today', data.dueNow, (i) =>
      `${i.status === 'due' ? 'due' : 'ready'} · ${i.nextLabel}`,
    );
    list('Ready to close out', data.closeOuts, () => 'no reply');
  }

  if (data.waiting.length > 0) {
    lines.push(
      `${data.waiting.length} prospect(s) mid-cycle${
        data.soonestWait !== null ? ` — next due in ${data.soonestWait} day(s).` : '.'
      }`,
      '',
    );
  }

  lines.push(`Open Today: ${base}/today`, '', '—', 'Stay Sharp. Stay Seen. Stay Human.');
  return lines.join('\n');
}
