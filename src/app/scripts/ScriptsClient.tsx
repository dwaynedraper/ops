'use client';

/**
 * Contact-script editor — interactive.
 *
 * Edits the outreach scripts as a local draft (D-012). List order is the
 * cycle order. DraftGuard catches an attempt to leave with unpublished
 * changes. Existing scripts can be deactivated but not removed (a logged
 * contact references the key); scripts added in this draft can be removed.
 */

import { useMemo, useState } from 'react';
import { DraftGuard } from '@/components/DraftGuard';
import { extractPlaceholders, type ContactChannel } from '@/lib/tracking';
import { publishScripts, type ScriptInput } from './actions';

export interface ScriptInit {
  stageKey: string;
  label: string;
  channel: ContactChannel;
  followupAfterDays: number;
  subject: string;
  body: string;
  active: boolean;
}

interface ScriptDraft {
  localId: string;
  stageKey: string;
  isNew: boolean;
  label: string;
  channel: ContactChannel;
  followupAfterDays: string;
  subject: string;
  body: string;
  active: boolean;
}

const CHANNELS: { value: ContactChannel; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'dm', label: 'Direct message' },
  { value: 'call', label: 'Call' },
];

function newId(): string {
  return `sc-${Math.random().toString(36).slice(2)}`;
}

function toDraft(s: ScriptInit): ScriptDraft {
  return {
    localId: newId(),
    stageKey: s.stageKey,
    isNew: false,
    label: s.label,
    channel: s.channel,
    followupAfterDays: String(s.followupAfterDays),
    subject: s.subject,
    body: s.body,
    active: s.active,
  };
}

function serialize(scripts: ScriptDraft[]): string {
  return JSON.stringify(
    scripts.map((s) => ({
      stageKey: s.stageKey,
      label: s.label,
      channel: s.channel,
      followupAfterDays: s.followupAfterDays,
      subject: s.subject,
      body: s.body,
      active: s.active,
    })),
  );
}

export function ScriptsClient({ scripts: initialScripts }: { scripts: ScriptInit[] }) {
  const initialDrafts = useMemo(() => initialScripts.map(toDraft), [initialScripts]);

  const [scripts, setScripts] = useState<ScriptDraft[]>(initialDrafts);
  const [baseline, setBaseline] = useState<string>(() => serialize(initialDrafts));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = serialize(scripts) !== baseline;

  function patch(localId: string, p: Partial<ScriptDraft>) {
    setScripts((prev) => prev.map((s) => (s.localId === localId ? { ...s, ...p } : s)));
    setSaved(false);
  }
  function removeScript(localId: string) {
    setScripts((prev) => prev.filter((s) => s.localId !== localId));
    setSaved(false);
  }
  function addScript() {
    setScripts((prev) => [
      ...prev,
      {
        localId: newId(),
        stageKey: '',
        isNew: true,
        label: '',
        channel: 'email',
        followupAfterDays: '3',
        subject: '',
        body: '',
        active: true,
      },
    ]);
    setSaved(false);
  }

  function reset() {
    setScripts(initialDrafts);
    setError(null);
    setSaved(false);
  }

  async function publish(): Promise<boolean> {
    setBusy(true);
    setError(null);
    const payload: ScriptInput[] = scripts.map((s) => ({
      stageKey: s.isNew ? '' : s.stageKey,
      label: s.label,
      channel: s.channel,
      followupAfterDays: Math.max(0, Math.floor(Number(s.followupAfterDays) || 0)),
      subject: s.subject,
      body: s.body,
      active: s.active,
    }));
    const res = await publishScripts({ scripts: payload });
    setBusy(false);

    if (res.ok) {
      setBaseline(serialize(scripts));
      setSaved(true);
      return true;
    }
    setError(res.error ?? 'Could not publish the scripts.');
    return false;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <DraftGuard dirty={dirty} onReset={reset} onPublish={publish} what="contact-script changes" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        {scripts.map((s, i) => (
          <ScriptCard
            key={s.localId}
            script={s}
            step={i + 1}
            onPatch={patch}
            onRemove={s.isNew ? removeScript : null}
          />
        ))}
      </div>

      <button className="btn-outline" onClick={addScript} style={{ alignSelf: 'flex-start' }}>
        Add script
      </button>

      {/* Action bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.85rem',
          flexWrap: 'wrap',
          paddingTop: '0.25rem',
        }}
      >
        <button className="btn-primary" disabled={!dirty || busy} onClick={publish}>
          {busy ? 'Publishing…' : 'Publish scripts'}
        </button>
        <button className="btn-outline" disabled={!dirty || busy} onClick={reset}>
          Reset
        </button>
        {dirty && (
          <span style={{ fontSize: '0.78rem', color: 'var(--warn)' }}>
            Unpublished — reps still copy the old scripts.
          </span>
        )}
        {!dirty && saved && (
          <span style={{ fontSize: '0.78rem', color: 'var(--good)' }}>
            Published. The tracking page is current.
          </span>
        )}
        {error && <span style={{ fontSize: '0.78rem', color: 'var(--bad)' }}>{error}</span>}
      </div>
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────

function ScriptCard({
  script,
  step,
  onPatch,
  onRemove,
}: {
  script: ScriptDraft;
  step: number;
  onPatch: (localId: string, p: Partial<ScriptDraft>) => void;
  onRemove: ((localId: string) => void) | null;
}) {
  const s = script;
  const placeholders = extractPlaceholders(s.subject, s.body);

  return (
    <div
      className="surface-tool"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
        opacity: s.active ? 1 : 0.6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span
          style={{
            fontSize: '0.66rem',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: 'var(--accent)',
          }}
        >
          Step {step}
        </span>
        <input
          className="input"
          value={s.label}
          placeholder="Script label — e.g. First touch"
          onChange={(e) => onPatch(s.localId, { label: e.target.value })}
          style={{ flex: 1 }}
        />
        {onRemove && (
          <button
            className="btn-ghost"
            onClick={() => onRemove(s.localId)}
            style={{ padding: '0.2rem 0.4rem' }}
            aria-label="Remove script"
          >
            ✕
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>Channel</span>
          <select
            className="select"
            value={s.channel}
            onChange={(e) => onPatch(s.localId, { channel: e.target.value as ContactChannel })}
            style={{ width: 150 }}
            aria-label="Channel"
          >
            {CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>Follow-up after (days)</span>
          <input
            type="number"
            step="1"
            min={0}
            className="input"
            value={s.followupAfterDays}
            onChange={(e) => onPatch(s.localId, { followupAfterDays: e.target.value })}
            style={{ width: 64, textAlign: 'right' }}
            aria-label="Follow-up after days"
          />
        </label>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.78rem',
            color: 'var(--text-mid)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={s.active}
            onChange={(e) => onPatch(s.localId, { active: e.target.checked })}
            style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer' }}
          />
          Active
        </label>
      </div>

      <label style={{ display: 'block' }}>
        <span className="label">Subject</span>
        <input
          className="input"
          value={s.subject}
          placeholder="Email subject — leave blank for DM / call"
          onChange={(e) => onPatch(s.localId, { subject: e.target.value })}
        />
      </label>

      <label style={{ display: 'block' }}>
        <span className="label">Message body</span>
        <textarea
          className="textarea"
          rows={7}
          value={s.body}
          placeholder="The script. Use {{placeholder}} slots for the parts a rep fills in."
          onChange={(e) => onPatch(s.localId, { body: e.target.value })}
          style={{ fontFamily: 'var(--font-montserrat), sans-serif', lineHeight: 1.5 }}
        />
      </label>

      {placeholders.length > 0 && (
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>Placeholders:</span>
          {placeholders.map((p) => (
            <span
              key={p}
              className="money"
              style={{
                fontSize: '0.7rem',
                color: 'var(--accent)',
                background: 'var(--accent-dim)',
                border: '1px solid var(--border-accent)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.1rem 0.4rem',
              }}
            >
              {`{{${p}}}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
