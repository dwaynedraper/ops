'use client';

/**
 * Script + handoff-link editor — interactive, per workflow.
 *
 * Pick a workflow, then edit its outreach scripts and handoff links as a
 * local draft (D-012). A script references a handoff link by placeholder
 * — {{link_key}} — so editing a link updates every script that uses it.
 * DraftGuard catches a page-leave; switching workflow is blocked while a
 * draft is dirty.
 */

import { useState } from 'react';
import { DraftGuard } from '@/components/DraftGuard';
import { extractPlaceholders, type ContactChannel } from '@/lib/tracking';
import { publishScripts, type ScriptInput, type LinkInput } from './actions';

export interface ScriptInit {
  stageKey: string;
  label: string;
  channel: ContactChannel;
  followupAfterDays: number;
  subject: string;
  body: string;
  active: boolean;
}

export interface LinkInit {
  linkKey: string;
  label: string;
  url: string;
}

export interface WorkflowScripts {
  key: string;
  name: string;
  accent: string;
  scripts: ScriptInit[];
  links: LinkInit[];
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

interface LinkDraft {
  localId: string;
  linkKey: string;
  isNew: boolean;
  label: string;
  url: string;
}

const CHANNELS: { value: ContactChannel; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'dm', label: 'Direct message' },
  { value: 'call', label: 'Call' },
];

function newId(): string {
  return `x-${Math.random().toString(36).slice(2)}`;
}

function toScriptDraft(s: ScriptInit): ScriptDraft {
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

function toLinkDraft(l: LinkInit): LinkDraft {
  return { localId: newId(), linkKey: l.linkKey, isNew: false, label: l.label, url: l.url };
}

function serialize(scripts: ScriptDraft[], links: LinkDraft[]): string {
  return JSON.stringify({
    scripts: scripts.map((s) => ({
      stageKey: s.stageKey,
      label: s.label,
      channel: s.channel,
      followupAfterDays: s.followupAfterDays,
      subject: s.subject,
      body: s.body,
      active: s.active,
    })),
    links: links.map((l) => ({ linkKey: l.linkKey, label: l.label, url: l.url })),
  });
}

export function ScriptsClient({ workflows }: { workflows: WorkflowScripts[] }) {
  const [selectedKey, setSelectedKey] = useState(workflows[0]?.key ?? '');
  const wf = workflows.find((w) => w.key === selectedKey) ?? workflows[0] ?? null;

  const [scripts, setScripts] = useState<ScriptDraft[]>(() =>
    (workflows[0]?.scripts ?? []).map(toScriptDraft),
  );
  const [links, setLinks] = useState<LinkDraft[]>(() =>
    (workflows[0]?.links ?? []).map(toLinkDraft),
  );
  const [baseline, setBaseline] = useState<string>(() =>
    serialize(
      (workflows[0]?.scripts ?? []).map(toScriptDraft),
      (workflows[0]?.links ?? []).map(toLinkDraft),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = serialize(scripts, links) !== baseline;

  if (!wf) {
    return (
      <div className="surface-card">
        <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
          No workflows configured yet — seed the database first.
        </p>
      </div>
    );
  }

  function selectWorkflow(key: string) {
    if (dirty) return;
    const next = workflows.find((w) => w.key === key);
    if (!next) return;
    const sd = next.scripts.map(toScriptDraft);
    const ld = next.links.map(toLinkDraft);
    setSelectedKey(key);
    setScripts(sd);
    setLinks(ld);
    setBaseline(serialize(sd, ld));
    setError(null);
    setSaved(false);
  }

  function patchScript(localId: string, p: Partial<ScriptDraft>) {
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

  function patchLink(localId: string, p: Partial<LinkDraft>) {
    setLinks((prev) => prev.map((l) => (l.localId === localId ? { ...l, ...p } : l)));
    setSaved(false);
  }
  function removeLink(localId: string) {
    setLinks((prev) => prev.filter((l) => l.localId !== localId));
    setSaved(false);
  }
  function addLink() {
    setLinks((prev) => [
      ...prev,
      { localId: newId(), linkKey: '', isNew: true, label: '', url: '' },
    ]);
    setSaved(false);
  }

  function reset() {
    setScripts(wf!.scripts.map(toScriptDraft));
    setLinks(wf!.links.map(toLinkDraft));
    setError(null);
    setSaved(false);
  }

  async function publish(): Promise<boolean> {
    setBusy(true);
    setError(null);
    const scriptPayload: ScriptInput[] = scripts.map((s) => ({
      stageKey: s.isNew ? '' : s.stageKey,
      label: s.label,
      channel: s.channel,
      followupAfterDays: Math.max(0, Math.floor(Number(s.followupAfterDays) || 0)),
      subject: s.subject,
      body: s.body,
      active: s.active,
    }));
    const linkPayload: LinkInput[] = links.map((l) => ({
      linkKey: l.linkKey,
      label: l.label,
      url: l.url,
    }));
    const res = await publishScripts({
      workflowKey: selectedKey,
      scripts: scriptPayload,
      links: linkPayload,
    });
    setBusy(false);

    if (res.ok) {
      setBaseline(serialize(scripts, links));
      setSaved(true);
      return true;
    }
    setError(res.error ?? 'Could not publish the scripts.');
    return false;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <DraftGuard dirty={dirty} onReset={reset} onPublish={publish} what="script + link changes" />

      {/* Workflow picker */}
      <div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {workflows.map((w) => {
            const active = w.key === selectedKey;
            return (
              <button
                key={w.key}
                onClick={() => selectWorkflow(w.key)}
                disabled={dirty && !active}
                style={{
                  padding: '0.5rem 0.95rem',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${active ? w.accent : 'var(--border-strong)'}`,
                  background: active ? `${w.accent}22` : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-mid)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: dirty && !active ? 'not-allowed' : 'pointer',
                  opacity: dirty && !active ? 0.5 : 1,
                }}
              >
                {w.name}
              </button>
            );
          })}
        </div>
        {dirty && (
          <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: '0.5rem' }}>
            Publish or reset your changes to switch workflow.
          </p>
        )}
      </div>

      {/* Scripts */}
      <div className="eyebrow">{wf.name} · scripts</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        {scripts.map((s, i) => (
          <ScriptCard
            key={s.localId}
            script={s}
            step={i + 1}
            onPatch={patchScript}
            onRemove={s.isNew ? removeScript : null}
          />
        ))}
      </div>
      <button className="btn-outline" onClick={addScript} style={{ alignSelf: 'flex-start' }}>
        Add script
      </button>

      {/* Handoff links */}
      <div className="surface-tool">
        <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>
          {wf.name} · handoff links
        </div>
        <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '0.85rem' }}>
          Reference a link in a script with its placeholder — e.g.{' '}
          <code>{'{{booking_link}}'}</code>. Edit the URL here and every script that
          uses it updates.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {links.map((l) => (
            <LinkRow key={l.localId} link={l} onPatch={patchLink} onRemove={removeLink} />
          ))}
          {links.length === 0 && (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>
              No handoff links for this workflow yet.
            </p>
          )}
        </div>
        <button className="btn-outline" onClick={addLink} style={{ marginTop: '0.85rem' }}>
          Add link
        </button>
      </div>

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
          {busy ? 'Publishing…' : `Publish ${wf.name}`}
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
            Published. Contact is current.
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

function LinkRow({
  link,
  onPatch,
  onRemove,
}: {
  link: LinkDraft;
  onPatch: (localId: string, p: Partial<LinkDraft>) => void;
  onRemove: (localId: string) => void;
}) {
  const l = link;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
      {l.isNew ? (
        <input
          className="input"
          value={l.linkKey}
          placeholder="key"
          onChange={(e) => onPatch(l.localId, { linkKey: e.target.value })}
          style={{ width: 130 }}
          aria-label="Link key"
        />
      ) : (
        <span
          className="money"
          style={{
            width: 130,
            fontSize: '0.74rem',
            color: 'var(--accent)',
            background: 'var(--accent-dim)',
            border: '1px solid var(--border-accent)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.3rem 0.4rem',
            textAlign: 'center',
            flexShrink: 0,
          }}
        >
          {`{{${l.linkKey}}}`}
        </span>
      )}
      <input
        className="input"
        value={l.label}
        placeholder="Label — e.g. Connection-call booking"
        onChange={(e) => onPatch(l.localId, { label: e.target.value })}
        style={{ flex: '1 1 160px', minWidth: 0 }}
      />
      <input
        className="input"
        value={l.url}
        placeholder="https://…"
        onChange={(e) => onPatch(l.localId, { url: e.target.value })}
        style={{ flex: '1 1 200px', minWidth: 0 }}
      />
      <button
        className="btn-ghost"
        onClick={() => onRemove(l.localId)}
        style={{ padding: '0.2rem 0.4rem' }}
        aria-label="Remove link"
      >
        ✕
      </button>
    </div>
  );
}
