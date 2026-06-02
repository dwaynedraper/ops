'use client';

/**
 * Calendar — interactive (Phase 6A). Day + week views, a date stepper, and
 * the block editor. The accessibility north star drives the look: the time
 * is the loudest thing, one clear view at a time, click a slot to place a
 * concrete block. Drag-to-resize + recurrence UI are 6B; this is fixed-hour
 * creation done well.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CalendarItem } from '@/lib/calendar-db';
import {
  addDays,
  weekDays,
  weekdayLong,
  weekdayShort,
  weekdayIndex,
  dayNum,
  minutesOfDay,
  clockLabel,
  endClock,
  blockBox,
  BLOCK_TYPES,
  BLOCK_TYPE_LABEL,
  type BlockType,
} from '@/lib/calendar';
import { fromRRule, toRRule, type Recurrence, type Freq } from '@/lib/recurrence';
import { createBlock, updateBlock, deleteBlock, setBlockStatus, skipOccurrence } from './actions';

const WEEKDAY_PICKER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const DAY_START_HOUR = 7; // grid renders 7am–9pm; blocks outside still clamp in
const DAY_END_HOUR = 21;
const PX_PER_HOUR = 48;

type View = 'day' | 'week';

interface EditorState {
  open: boolean;
  id: string | null; // null = create; else the master id to edit
  date: string;
  startClock: string;
  durationMin: number;
  title: string;
  blockType: BlockType;
  notes: string;
  /** The recurring master this instance came from (for skip/edit choice). */
  recurring: boolean;
  rrule: string | null;
}

export function CalendarView({
  view,
  focus,
  today,
  items,
  jobOptions,
  timeZone,
}: {
  view: View;
  focus: string;
  today: string;
  items: CalendarItem[];
  jobOptions: { id: string; label: string }[];
  timeZone: string;
}) {
  const router = useRouter();
  const [editor, setEditor] = useState<EditorState | null>(null);

  const days = view === 'week' ? weekDays(focus) : [focus];
  const prevHref = `/calendar?view=${view}&date=${addDays(focus, view === 'week' ? -7 : -1)}`;
  const nextHref = `/calendar?view=${view}&date=${addDays(focus, view === 'week' ? 7 : 1)}`;

  const itemsByDate = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of items) {
      const list = m.get(it.date) ?? [];
      list.push(it);
      m.set(it.date, list);
    }
    return m;
  }, [items]);

  function openCreate(date: string, startClock = '09:00') {
    setEditor({
      open: true,
      id: null,
      date,
      startClock,
      durationMin: 60,
      title: '',
      blockType: 'record',
      notes: '',
      recurring: false,
      rrule: null,
    });
  }
  function openEdit(it: CalendarItem) {
    if (it.kind !== 'block' || !it.startClock) return; // shoots open their job page
    setEditor({
      open: true,
      id: it.masterId, // edit the master; instances carry master:date ids
      date: it.date,
      startClock: it.startClock,
      durationMin: it.durationMin,
      title: it.title,
      blockType: (it.blockType ?? 'other') as BlockType,
      notes: it.notes ?? '',
      recurring: it.recurring,
      rrule: it.rrule,
    });
  }

  const headingDate = new Date(`${focus}T12:00:00Z`);
  const headingLabel =
    view === 'week'
      ? `Week of ${new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${weekDays(focus)[0]}T12:00:00Z`))}`
      : new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(headingDate);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header: title + view toggle + date stepper */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: '0.3rem' }}>Calendar</div>
          <h1 style={{ fontFamily: 'var(--font-playfair), serif', fontSize: 'clamp(1.4rem, 3vw, 2rem)', fontWeight: 400, letterSpacing: '-0.01em', margin: 0 }}>
            {headingLabel}
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* View toggle */}
          <div style={{ display: 'inline-flex', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', overflow: 'hidden' }}>
            {(['day', 'week'] as View[]).map((v) => (
              <Link
                key={v}
                href={`/calendar?view=${v}&date=${focus}`}
                style={{
                  padding: '0.4rem 0.85rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  textDecoration: 'none',
                  background: v === view ? 'var(--accent-dim)' : 'transparent',
                  color: v === view ? 'var(--text)' : 'var(--text-mid)',
                }}
              >
                {v === 'day' ? 'Day' : 'Week'}
              </Link>
            ))}
          </div>
          {/* Stepper */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Link href={prevHref} className="btn-ghost" style={{ padding: '0.3rem 0.5rem' }}>‹</Link>
            <Link href={`/calendar?view=${view}&date=${today}`} className="btn-ghost" style={{ padding: '0.3rem 0.6rem', fontSize: '0.76rem' }}>Today</Link>
            <Link href={nextHref} className="btn-ghost" style={{ padding: '0.3rem 0.5rem' }}>›</Link>
          </div>
          <button className="btn-primary" onClick={() => openCreate(focus)}>+ New block</button>
        </div>
      </div>

      {/* The grid */}
      <div style={{ display: 'grid', gridTemplateColumns: `3rem repeat(${days.length}, 1fr)`, gap: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
        {/* Column headers */}
        <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }} />
        {days.map((d) => (
          <div
            key={`h-${d}`}
            style={{
              borderBottom: '1px solid var(--border)',
              borderLeft: '1px solid var(--border)',
              padding: '0.4rem 0.5rem',
              textAlign: 'center',
              background: d === today ? 'var(--accent-dim)' : 'var(--surface)',
            }}
          >
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: d === today ? 'var(--accent)' : 'var(--text)' }}>
              {d === today ? 'Today' : weekdayShort(d)}
            </div>
            <div style={{ fontSize: '0.64rem', color: 'var(--text-faint)' }}>{dayNum(d)}</div>
          </div>
        ))}

        {/* Hour rows + day columns share one positioned area per day */}
        <div style={{ position: 'relative' }}>
          {hourLabels().map((h, i) => (
            <div key={h} style={{ height: PX_PER_HOUR, borderBottom: '1px solid var(--border)', fontSize: '0.6rem', color: 'var(--text-faint)', textAlign: 'right', paddingRight: '0.25rem', paddingTop: i === 0 ? 0 : 0 }}>
              {clockLabel(`${String(h).padStart(2, '0')}:00`)}
            </div>
          ))}
        </div>
        {days.map((d) => (
          <DayColumn
            key={`c-${d}`}
            date={d}
            isToday={d === today}
            items={(itemsByDate.get(d) ?? []).filter((it) => it.startClock !== null || it.kind === 'shoot')}
            onSlotClick={(clock) => openCreate(d, clock)}
            onItemClick={openEdit}
          />
        ))}
      </div>

      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>
        Click an empty slot to block an hour. Click a block to edit it. Shoots come from Jobs — click one to open the job.
      </p>

      {editor?.open && (
        <BlockEditor
          state={editor}
          jobOptions={jobOptions}
          timeZone={timeZone}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            router.refresh();
          }}
        />
      )}

      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', textAlign: 'center' }}>
        Stay Sharp. Stay Seen. Stay Human.
      </p>
    </div>
  );
}

function hourLabels(): number[] {
  const out: number[] = [];
  for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h++) out.push(h);
  return out;
}

function DayColumn({
  date,
  isToday,
  items,
  onSlotClick,
  onItemClick,
}: {
  date: string;
  isToday: boolean;
  items: CalendarItem[];
  onSlotClick: (clock: string) => void;
  onItemClick: (it: CalendarItem) => void;
}) {
  const hours = hourLabels();
  const gridHeight = hours.length * PX_PER_HOUR;

  // Untimed shoots → a band pinned at the top of the column.
  const allDay = items.filter((it) => it.startClock === null);
  const timed = items.filter((it) => it.startClock !== null);

  return (
    <div style={{ position: 'relative', borderLeft: '1px solid var(--border)', background: isToday ? 'rgba(194,95,62,0.04)' : 'transparent' }}>
      {/* clickable hour slots */}
      {hours.map((h) => (
        <button
          key={h}
          onClick={() => onSlotClick(`${String(h).padStart(2, '0')}:00`)}
          aria-label={`Add a block at ${clockLabel(`${String(h).padStart(2, '0')}:00`)} on ${weekdayLong(date)}`}
          style={{
            display: 'block',
            width: '100%',
            height: PX_PER_HOUR,
            borderBottom: '1px solid var(--border)',
            background: 'transparent',
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}

      {/* all-day band — job shoots (links) + external all-day events (static) */}
      <div style={{ position: 'absolute', top: 2, left: 2, right: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {allDay.map((it) => {
          if (it.kind === 'external') {
            return (
              <div
                key={it.id}
                style={{
                  fontSize: '0.62rem',
                  fontWeight: 600,
                  color: 'var(--text-mid)',
                  border: '1px solid var(--cal-external)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.1rem 0.3rem',
                  background: 'color-mix(in srgb, var(--cal-external) 10%, transparent)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={`${it.externalCalendar ? it.externalCalendar + ' · ' : ''}${it.title} (from Google)`}
              >
                {it.title}
              </div>
            );
          }
          return (
            <Link
              key={it.id}
              href={`/jobs/${it.jobId}`}
              style={{
                fontSize: '0.62rem',
                fontWeight: 600,
                color: 'var(--cal-business)',
                border: '1px solid var(--cal-business)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.1rem 0.3rem',
                textDecoration: 'none',
                background: 'color-mix(in srgb, var(--cal-business) 16%, transparent)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={it.title}
            >
              📷 {it.title}
            </Link>
          );
        })}
      </div>

      {/* timed blocks, absolutely positioned */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: gridHeight, pointerEvents: 'none' }}>
        {timed.map((it) => {
          const startMin = minutesOfDay(it.startClock as string);
          const { top, height } = blockBox(startMin, it.durationMin || 60, PX_PER_HOUR, DAY_START_HOUR);
          const isShoot = it.kind === 'shoot';
          const isExternal = it.kind === 'external';
          // Two layers: imported Google events = green; everything I own
          // (blocks + shoots) = business blue. Theme-token colors, AA-checked.
          const color = isExternal ? 'var(--cal-external)' : 'var(--cal-business)';
          const done = it.status === 'done';
          return (
            <button
              key={it.id}
              disabled={isExternal}
              onClick={() =>
                isExternal ? undefined : isShoot ? (window.location.href = `/jobs/${it.jobId}`) : onItemClick(it)
              }
              style={{
                position: 'absolute',
                top: Math.max(top, 0),
                left: 3,
                right: 3,
                height,
                pointerEvents: 'auto',
                textAlign: 'left',
                borderRadius: 'var(--radius-sm)',
                // Fully outlined + low-opacity fill, both layers. External
                // (green) reads a touch lighter so it sits behind work (blue).
                border: `1px solid ${color}`,
                borderLeft: `3px solid ${color}`,
                background: `color-mix(in srgb, ${color} ${isExternal ? 10 : 16}%, transparent)`,
                padding: '0.15rem 0.35rem',
                cursor: isExternal ? 'default' : 'pointer',
                overflow: 'hidden',
                opacity: done ? 0.55 : 1,
              }}
              title={
                isExternal
                  ? `${it.externalCalendar ? it.externalCalendar + ' · ' : ''}${it.title} (from Google)`
                  : `${clockLabel(it.startClock as string)}–${clockLabel(endClock(it.startClock as string, it.durationMin || 60))} · ${it.title}`
              }
            >
              <div style={{ fontSize: '0.64rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1.15, textDecoration: done ? 'line-through' : 'none' }}>
                {clockLabel(it.startClock as string)}
              </div>
              <div style={{ fontSize: '0.66rem', color: isExternal ? 'var(--text-mid)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                {isShoot ? '📷 ' : ''}{it.recurring ? '↻ ' : ''}{it.title}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Block editor ─────────────────────────────────────────────────────

function BlockEditor({
  state,
  jobOptions,
  timeZone,
  onClose,
  onSaved,
}: {
  state: EditorState;
  jobOptions: { id: string; label: string }[];
  timeZone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(state.title);
  const [blockType, setBlockType] = useState<BlockType>(state.blockType);
  const [date, setDate] = useState(state.date);
  const [startClock, setStartClock] = useState(state.startClock);
  const [durationMin, setDurationMin] = useState(state.durationMin);
  const [notes, setNotes] = useState(state.notes);
  const [jobId, setJobId] = useState<string>('');
  const [rec, setRec] = useState<Recurrence>(() => fromRRule(state.rrule));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = state.id !== null;

  async function onSave() {
    setBusy(true);
    setError(null);
    const rrule = toRRule(rec);
    const res = isEdit
      ? await updateBlock({ id: state.id as string, title, blockType, date, startClock, durationMin, notes, timeZone, rrule })
      : await createBlock({ title, blockType, date, startClock, durationMin, notes, jobId: jobId || null, timeZone, rrule });
    if (res.ok) onSaved();
    else {
      setError(res.error ?? 'Could not save.');
      setBusy(false);
    }
  }

  /** Delete the whole series (or a one-off). */
  async function onDeleteSeries() {
    if (!isEdit) return;
    setBusy(true);
    const res = await deleteBlock({ id: state.id as string });
    if (res.ok) onSaved();
    else {
      setError(res.error ?? 'Could not delete.');
      setBusy(false);
    }
  }

  /** Skip just this occurrence of a recurring series (an EXDATE). */
  async function onSkipThis() {
    if (!isEdit) return;
    setBusy(true);
    const res = await skipOccurrence({ masterId: state.id as string, occurrenceDate: date });
    if (res.ok) onSaved();
    else {
      setError(res.error ?? 'Could not remove this occurrence.');
      setBusy(false);
    }
  }

  async function onMarkDone() {
    if (!isEdit) return;
    setBusy(true);
    const res = await setBlockStatus({ id: state.id as string, status: 'done' });
    if (res.ok) onSaved();
    else {
      setError(res.error ?? 'Could not update.');
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="surface-tool"
        style={{ width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="eyebrow" style={{ marginBottom: '0.9rem' }}>
          {isEdit ? 'Edit block' : 'New block'}
        </div>

        <label style={{ display: 'block', marginBottom: '0.6rem' }}>
          <span className="label">Title</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Record Reel, LinkedIn post…" autoFocus />
        </label>

        <label style={{ display: 'block', marginBottom: '0.6rem' }}>
          <span className="label">Type</span>
          <select className="select" value={blockType} onChange={(e) => setBlockType(e.target.value as BlockType)}>
            {BLOCK_TYPES.map((t) => (
              <option key={t} value={t}>{BLOCK_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.6rem', marginBottom: '0.6rem' }}>
          <label style={{ display: 'block' }}>
            <span className="label">Date</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label style={{ display: 'block' }}>
            <span className="label">Start</span>
            <input className="input" type="time" value={startClock} onChange={(e) => setStartClock(e.target.value)} step={900} />
          </label>
          <label style={{ display: 'block' }}>
            <span className="label">Minutes</span>
            <input className="input" inputMode="numeric" value={durationMin} onChange={(e) => setDurationMin(Math.max(1, Math.floor(Number(e.target.value) || 0)))} />
          </label>
        </div>

        {/* Live "the when" readout — the loudest confirmation */}
        <p style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600, marginBottom: '0.6rem' }}>
          {clockLabel(startClock)}–{clockLabel(endClock(startClock, durationMin))}
        </p>

        {!isEdit && jobOptions.length > 0 && (
          <label style={{ display: 'block', marginBottom: '0.6rem' }}>
            <span className="label">Link to a job (optional)</span>
            <select className="select" value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">— none —</option>
              {jobOptions.map((j) => (
                <option key={j.id} value={j.id}>{j.label}</option>
              ))}
            </select>
          </label>
        )}

        {/* Recurrence — set the rhythm once (the accessibility win). */}
        <RecurrenceControl rec={rec} setRec={setRec} startDate={date} />

        <label style={{ display: 'block', marginBottom: '0.85rem' }}>
          <span className="label">Notes</span>
          <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn-primary" disabled={busy || !title.trim()} onClick={onSave}>
            {busy ? 'Saving…' : isEdit ? 'Save' : 'Create block'}
          </button>
          {isEdit && (
            <button className="btn-outline" disabled={busy} onClick={onMarkDone}>Mark done</button>
          )}
          {/* Delete: a one-off has a single Delete; a series offers both
              "just this one" (skip) and "whole series." */}
          {isEdit && !state.recurring && (
            <button className="btn-ghost" disabled={busy} onClick={onDeleteSeries} style={{ color: 'var(--bad)' }}>
              Delete
            </button>
          )}
          {isEdit && state.recurring && (
            <>
              <button className="btn-ghost" disabled={busy} onClick={onSkipThis} style={{ color: 'var(--bad)' }}>
                Delete this one
              </button>
              <button className="btn-ghost" disabled={busy} onClick={onDeleteSeries} style={{ color: 'var(--bad)' }}>
                Delete series
              </button>
            </>
          )}
          <button className="btn-ghost" onClick={onClose} style={{ marginLeft: 'auto' }}>Cancel</button>
        </div>
        {isEdit && state.recurring && (
          <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: '0.5rem' }}>
            Editing saves the whole series. To change just this day, delete this one and add a single block.
          </p>
        )}
        {error && <p style={{ fontSize: '0.78rem', color: 'var(--bad)', marginTop: '0.6rem' }}>{error}</p>}
      </div>
    </div>
  );
}

// ─── Recurrence control ───────────────────────────────────────────────

function RecurrenceControl({
  rec,
  setRec,
  startDate,
}: {
  rec: Recurrence;
  setRec: (r: Recurrence) => void;
  startDate: string;
}) {
  type EndMode = 'never' | 'count' | 'until';
  const endMode: EndMode = rec.count ? 'count' : rec.until ? 'until' : 'never';

  function setFreq(freq: Freq) {
    if (freq === 'none') {
      setRec({ freq: 'none', interval: 1, byDay: [], count: null, until: null });
    } else if (freq === 'weekly') {
      // Default the weekly day to the block's own start weekday.
      setRec({ ...rec, freq, byDay: rec.byDay.length ? rec.byDay : [weekdayIndex(startDate)] });
    } else {
      setRec({ ...rec, freq, byDay: [] });
    }
  }
  function toggleDay(d: number) {
    const set = new Set(rec.byDay);
    if (set.has(d)) set.delete(d);
    else set.add(d);
    setRec({ ...rec, byDay: [...set] });
  }
  function setEndMode(mode: EndMode) {
    if (mode === 'never') setRec({ ...rec, count: null, until: null });
    else if (mode === 'count') setRec({ ...rec, count: rec.count ?? 8, until: null });
    else setRec({ ...rec, until: rec.until ?? addDays(startDate, 90), count: null });
  }

  const FREQS: { key: Freq; label: string }[] = [
    { key: 'none', label: 'Once' },
    { key: 'daily', label: 'Daily' },
    { key: 'weekly', label: 'Weekly' },
  ];

  return (
    <div style={{ marginBottom: '0.85rem', padding: '0.7rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface-tool-2)' }}>
      <span className="label">Repeats</span>
      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.3rem' }}>
        {FREQS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFreq(f.key)}
            style={{
              padding: '0.35rem 0.8rem',
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${rec.freq === f.key ? 'var(--accent)' : 'var(--border)'}`,
              background: rec.freq === f.key ? 'var(--accent-dim)' : 'transparent',
              color: rec.freq === f.key ? 'var(--text)' : 'var(--text-mid)',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {rec.freq !== 'none' && (
        <div style={{ marginTop: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {/* Interval */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-mid)' }}>
            Every
            <input
              type="number"
              min={1}
              className="input"
              value={rec.interval}
              onChange={(e) => setRec({ ...rec, interval: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
              style={{ width: 56, textAlign: 'center' }}
            />
            {rec.freq === 'daily' ? (rec.interval > 1 ? 'days' : 'day') : rec.interval > 1 ? 'weeks' : 'week'}
          </label>

          {/* Weekly day pills */}
          {rec.freq === 'weekly' && (
            <div style={{ display: 'flex', gap: '0.3rem' }}>
              {WEEKDAY_PICKER.map((d, i) => {
                const on = rec.byDay.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    aria-label={weekdayLong(addDays('2026-06-07', i))}
                    aria-pressed={on}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: '50%',
                      border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                      background: on ? 'var(--accent)' : 'transparent',
                      color: on ? '#fff' : 'var(--text-mid)',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          )}

          {/* End */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--text-mid)' }}>
            <span>Ends</span>
            <select className="select" value={endMode} onChange={(e) => setEndMode(e.target.value as EndMode)} style={{ width: 'auto' }}>
              <option value="never">never</option>
              <option value="count">after N times</option>
              <option value="until">on a date</option>
            </select>
            {endMode === 'count' && (
              <input
                type="number"
                min={1}
                className="input"
                value={rec.count ?? 8}
                onChange={(e) => setRec({ ...rec, count: Math.max(1, Math.floor(Number(e.target.value) || 1)), until: null })}
                style={{ width: 64, textAlign: 'center' }}
              />
            )}
            {endMode === 'until' && (
              <input
                type="date"
                className="input"
                value={rec.until ?? ''}
                onChange={(e) => setRec({ ...rec, until: e.target.value || null, count: null })}
                style={{ width: 'auto' }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
