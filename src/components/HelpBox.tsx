'use client';

/**
 * HelpBox — the "Where do I find this?" modal (P5).
 *
 * Renders a small text trigger next to a qualifying field. Click opens
 * a two-pane modal: left rail is the section ToC, right pane is the
 * active section's content. Sections with multiple angles use tabs.
 *
 * Content lives in `lib/help-content.ts` keyed by
 * `{workflow_key}.{factor_key}`. If no content exists for a given
 * pair, the trigger renders nothing — so the qualify pages naturally
 * grow help coverage as content lands.
 */

import { useEffect, useId, useMemo, useState } from 'react';
import {
  getHelpEntry,
  type HelpBlock,
  type HelpEntry,
  type HelpMode,
} from '@/lib/help-content';

export function HelpBox({
  workflowKey,
  factorKey,
  label = 'Where do I find this?',
  mode = 'qualify',
}: {
  workflowKey: string;
  factorKey: string;
  label?: string;
  /** Which content angle to load — qualify-time (deep read of one
   * prospect, default) or sourcing-time (batch triage). Different
   * entries live under different keys; missing entries render no
   * trigger. (D-041.) */
  mode?: HelpMode;
}) {
  const entry = useMemo(
    () => getHelpEntry(workflowKey, factorKey, mode),
    [workflowKey, factorKey, mode],
  );
  const [open, setOpen] = useState(false);

  if (!entry) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="help-trigger"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3rem',
          background: 'transparent',
          border: 'none',
          padding: '0.1rem 0.25rem',
          fontSize: '0.7rem',
          fontStyle: 'italic',
          color: 'var(--accent)',
          textDecoration: 'underline',
          textDecorationStyle: 'dotted',
          textUnderlineOffset: '0.2rem',
          cursor: 'pointer',
          letterSpacing: 'normal',
          textTransform: 'none',
        }}
      >
        <span aria-hidden style={{ fontStyle: 'normal', opacity: 0.7 }}>?</span>
        {label}
      </button>
      {open && <HelpModal entry={entry} onClose={() => setOpen(false)} />}
    </>
  );
}

/* ── Modal chassis ─────────────────────────────────────────────────── */

function HelpModal({
  entry,
  onClose,
}: {
  entry: HelpEntry;
  onClose: () => void;
}) {
  const dialogId = useId();
  const [activeSectionId, setActiveSectionId] = useState(entry.sections[0]?.id ?? '');
  const [activeTabBySection, setActiveTabBySection] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of entry.sections) {
      if (s.tabs && s.tabs.length > 0) init[s.id] = s.tabs[0].id;
    }
    return init;
  });

  // Esc to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const activeSection =
    entry.sections.find((s) => s.id === activeSectionId) ?? entry.sections[0];

  if (!activeSection) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${dialogId}-title`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius)',
          width: '100%',
          maxWidth: 820,
          maxHeight: 'calc(100vh - 3rem)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '0.85rem',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ marginBottom: '0.25rem' }}>
              Field help
            </div>
            <h2
              id={`${dialogId}-title`}
              style={{
                fontFamily: 'var(--font-playfair), serif',
                fontSize: '1.2rem',
                fontWeight: 400,
                margin: 0,
                color: 'var(--text)',
              }}
            >
              {entry.title}
            </h2>
            {entry.subtitle && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-mid)', marginTop: '0.25rem', lineHeight: 1.45 }}>
                {entry.subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              width: 30,
              height: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-mid)',
              cursor: 'pointer',
              fontSize: '0.95rem',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body — ToC + active section */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(160px, 200px) 1fr',
            gap: 0,
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* ToC */}
          <nav
            aria-label="Help sections"
            style={{
              padding: '0.85rem',
              borderRight: '1px solid var(--border)',
              background: 'var(--steel-dim)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.2rem',
              overflowY: 'auto',
            }}
          >
            {entry.sections.map((s) => {
              const isActive = s.id === activeSection.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveSectionId(s.id)}
                  style={{
                    textAlign: 'left',
                    padding: '0.45rem 0.6rem',
                    fontSize: '0.78rem',
                    background: isActive ? 'var(--accent-dim)' : 'transparent',
                    border: `1px solid ${isActive ? 'var(--border-accent)' : 'transparent'}`,
                    color: isActive ? 'var(--text)' : 'var(--text-mid)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    fontWeight: isActive ? 600 : 400,
                    transition: 'background 0.12s, color 0.12s',
                  }}
                >
                  {s.title}
                </button>
              );
            })}
          </nav>

          {/* Active section */}
          <div
            style={{
              padding: '1.25rem 1.4rem',
              overflowY: 'auto',
              minWidth: 0,
            }}
          >
            <h3
              style={{
                fontFamily: 'var(--font-playfair), serif',
                fontSize: '1.05rem',
                fontWeight: 400,
                margin: '0 0 0.85rem',
                color: 'var(--text)',
              }}
            >
              {activeSection.title}
            </h3>

            {activeSection.tabs && activeSection.tabs.length > 0 ? (
              <TabbedSection
                section={activeSection}
                activeTabId={activeTabBySection[activeSection.id]}
                onTabChange={(tabId) =>
                  setActiveTabBySection((prev) => ({ ...prev, [activeSection.id]: tabId }))
                }
              />
            ) : (
              <BlockList blocks={activeSection.body ?? []} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Tabbed section ──────────────────────────────────────────────── */

function TabbedSection({
  section,
  activeTabId,
  onTabChange,
}: {
  section: HelpEntry['sections'][number];
  activeTabId: string | undefined;
  onTabChange: (tabId: string) => void;
}) {
  const tabs = section.tabs ?? [];
  const activeTab =
    tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  if (!activeTab) return null;

  return (
    <div>
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: '0.25rem',
          flexWrap: 'wrap',
          marginBottom: '1rem',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {tabs.map((t) => {
          const isActive = t.id === activeTab.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onTabChange(t.id)}
              style={{
                padding: '0.4rem 0.7rem',
                fontSize: '0.74rem',
                fontWeight: 600,
                letterSpacing: '0.05em',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                color: isActive ? 'var(--accent)' : 'var(--text-mid)',
                cursor: 'pointer',
                marginBottom: '-1px',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <BlockList blocks={activeTab.body} />
    </div>
  );
}

/* ── Block renderer — paragraph / list / callout / steps / link.
   Exported as `HelpBlockList` so the /tutorials pages can reuse the
   same renderer for long-form content. ── */

export function HelpBlockList({ blocks }: { blocks: HelpBlock[] }) {
  return <BlockList blocks={blocks} />;
}

function BlockList({ blocks }: { blocks: HelpBlock[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}

/** D-058 — tiny inline-markdown parser. Recognizes two patterns
 * inside paragraph / list-item / steps-item / callout text:
 *
 *   **bold**           → <strong>bold</strong>
 *   [label](url)       → <a target="_blank" rel="noopener…">label</a>
 *
 * Anything else passes through as plain text. No nesting, no
 * regex backtracking pitfalls — the parser walks the input
 * left-to-right and emits a React fragment of mixed text + nodes.
 * Authors stay in source-text mode (TypeScript string literals)
 * without needing JSX in the content registry. */
const INLINE_MD_RE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;

function renderInline(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  INLINE_MD_RE.lastIndex = 0;
  while ((match = INLINE_MD_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      nodes.push(<strong key={key++}>{match[1]}</strong>);
    } else if (match[2] !== undefined && match[3] !== undefined) {
      nodes.push(
        <a
          key={key++}
          href={match[3]}
          rel="noopener noreferrer"
          target="_blank"
          style={{ color: 'var(--accent)', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '0.2rem' }}
        >
          {match[2]}
        </a>,
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes.length === 0 ? text : nodes;
}

function Block({ block }: { block: HelpBlock }) {
  if (block.kind === 'paragraph') {
    return (
      <p
        style={{
          fontSize: '0.86rem',
          lineHeight: 1.55,
          color: 'var(--text)',
          margin: 0,
        }}
      >
        {renderInline(block.text)}
      </p>
    );
  }
  if (block.kind === 'heading') {
    // Level 2 default; level 3 reads as a sub-beat.
    const level = block.level ?? 2;
    const isLevel3 = level === 3;
    const Tag = isLevel3 ? 'h4' : 'h3';
    return (
      <Tag
        style={{
          fontFamily: 'var(--font-playfair), serif',
          fontWeight: 500,
          margin: 0,
          fontSize: isLevel3 ? '0.95rem' : '1.05rem',
          color: 'var(--text)',
          letterSpacing: '-0.005em',
          marginTop: '0.25rem',
        }}
      >
        {block.text}
      </Tag>
    );
  }
  if (block.kind === 'list') {
    return (
      <ul style={{ paddingLeft: '1.1rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {block.items.map((it, i) => (
          <li
            key={i}
            style={{
              fontSize: '0.85rem',
              lineHeight: 1.5,
              color: 'var(--text)',
            }}
          >
            {renderInline(it)}
          </li>
        ))}
      </ul>
    );
  }
  if (block.kind === 'steps') {
    return (
      <ol style={{ paddingLeft: '1.25rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {block.items.map((it, i) => (
          <li
            key={i}
            style={{
              fontSize: '0.85rem',
              lineHeight: 1.5,
              color: 'var(--text)',
            }}
          >
            {renderInline(it)}
          </li>
        ))}
      </ol>
    );
  }
  if (block.kind === 'callout') {
    const color = block.tone === 'warn' ? 'var(--warn)' : 'var(--accent)';
    return (
      <div
        style={{
          padding: '0.7rem 0.85rem',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--steel-dim)',
          borderLeft: `3px solid ${color}`,
          fontSize: '0.82rem',
          lineHeight: 1.5,
          color: 'var(--text-mid)',
        }}
      >
        {renderInline(block.text)}
      </div>
    );
  }
  // link
  return (
    <a
      href={block.url}
      rel="noopener noreferrer"
      target="_blank"
      style={{
        display: 'inline-block',
        fontSize: '0.82rem',
        color: 'var(--accent)',
        textDecoration: 'underline',
        textUnderlineOffset: '0.2rem',
      }}
    >
      {block.label} ↗
    </a>
  );
}
