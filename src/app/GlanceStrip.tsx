'use client';

/**
 * The dashboard 8-day glance (Phase 6A · §3.2). Today + the next 7, laid
 * out in true wall-calendar weekday columns across two rows, so the *day*
 * something falls on reads at a glance — days are easier to hold in short-
 * term memory than dates. Pure grid from `glanceGrid`; each in-window cell
 * shows its blocks/shoots as small type-colored chips. Click a day → the
 * full calendar for that date.
 */

import Link from 'next/link';
import {
  glanceGrid,
  clockLabelUpper,
  BLOCK_TYPE_COLOR,
  type GlanceCell,
  type BlockType,
} from '@/lib/calendar';

export interface GlanceItem {
  date: string; // 'YYYY-MM-DD'
  title: string;
  kind: 'block' | 'shoot';
  blockType: BlockType | null;
  startClock: string | null; // 'HH:MM'
  durationMin: number;
}

/** Compact duration tag: 60→"1h", 90→"1.5h", 30→"30m". */
function durationTag(min: number): string {
  if (min <= 0) return '';
  if (min % 60 === 0) return `${min / 60}h`;
  if (min < 60) return `${min}m`;
  return `${(min / 60).toFixed(1).replace(/\.0$/, '')}h`;
}

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function GlanceStrip({ today, items }: { today: string; items: GlanceItem[] }) {
  const grid = glanceGrid(today);

  // Bucket items by date for O(1) cell lookup.
  const byDate = new Map<string, GlanceItem[]>();
  for (const it of items) {
    const list = byDate.get(it.date) ?? [];
    list.push(it);
    byDate.set(it.date, list);
  }

  return (
    <section style={{ marginBottom: '1.75rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '0.5rem',
        }}
      >
        <div className="eyebrow">The week ahead</div>
        <Link href="/calendar" className="btn-ghost" style={{ padding: '0.2rem 0' }}>
          Open calendar →
        </Link>
      </div>

      {/* Weekday header row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.4rem', marginBottom: '0.35rem' }}>
        {WEEKDAY_HEADERS.map((w) => (
          <div
            key={w}
            style={{
              fontSize: '0.7rem',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--text-faint)',
              fontWeight: 700,
              textAlign: 'center',
            }}
          >
            {w}
          </div>
        ))}
      </div>

      {/* Two rows of seven */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {grid.map((row, ri) => (
          <div key={ri} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.4rem' }}>
            {row.map((cell) => (
              <GlanceDay key={cell.date} cell={cell} items={byDate.get(cell.date) ?? []} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function GlanceDay({ cell, items }: { cell: GlanceCell; items: GlanceItem[] }) {
  // Out-of-window cells hold the grid shape but recede.
  if (!cell.inWindow) {
    return (
      <div
        aria-hidden
        style={{
          minHeight: 64,
          borderRadius: 'var(--radius-sm)',
          border: '1px dashed var(--border)',
          opacity: 0.3,
          padding: '0.35rem 0.4rem',
        }}
      >
        <div style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>{cell.dayNum}</div>
      </div>
    );
  }

  const shown = items.slice(0, 3);
  const extra = items.length - shown.length;

  return (
    <Link
      href={`/calendar?date=${cell.date}`}
      style={{
        display: 'block',
        minHeight: 76,
        borderRadius: 'var(--radius-sm)',
        border: cell.isToday ? '1px solid var(--accent)' : '1px solid var(--border)',
        background: cell.isToday ? 'var(--accent-dim)' : 'var(--surface-tool-2)',
        padding: '0.4rem 0.45rem',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      {/* Day name is the loudest label; date number secondary. */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.25rem', marginBottom: '0.35rem' }}>
        <span
          style={{
            fontSize: '0.88rem',
            fontWeight: 700,
            color: cell.isToday ? 'var(--accent)' : 'var(--text)',
          }}
        >
          {cell.isToday ? 'Today' : cell.weekdayShort}
        </span>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-faint)' }}>{cell.dayNum}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.18rem' }}>
        {shown.map((it, i) => {
          const color = it.kind === 'shoot' ? 'var(--brand-cyan)' : BLOCK_TYPE_COLOR[it.blockType ?? 'other'];
          // Timed blocks read "Title 9:00 AM (1h)"; untimed shoots stay bare.
          const time = it.startClock ? clockLabelUpper(it.startClock) : '';
          const dur = it.kind === 'block' ? durationTag(it.durationMin) : '';
          return (
            <div
              key={i}
              style={{
                fontSize: '0.74rem',
                lineHeight: 1.3,
                color: 'var(--text)',
                borderLeft: `3px solid ${color}`,
                paddingLeft: '0.35rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={it.title}
            >
              {it.kind === 'shoot' ? '📷 ' : ''}
              {it.title}
              {time ? (
                <span style={{ color: 'var(--text-faint)' }}>
                  {' '}{time}{dur ? ` (${dur})` : ''}
                </span>
              ) : null}
            </div>
          );
        })}
        {extra > 0 && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>+{extra} more</div>
        )}
      </div>
    </Link>
  );
}
