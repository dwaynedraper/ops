/**
 * Tiny inline-markdown parser (D-058 / F9).
 *
 * Recognizes two patterns inside HelpBlock paragraph / list / steps /
 * callout text:
 *
 *   **bold**       → <strong>bold</strong>
 *   [label](url)   → <a target="_blank" rel="noopener…">label</a>
 *
 * Anything else passes through as plain text. No nesting, no regex
 * backtracking pitfalls — the parser walks the input left-to-right
 * and emits a React fragment of mixed text + nodes. Authors stay in
 * source-text mode (TypeScript string literals) without needing JSX
 * in the content registry.
 *
 * Lives in `src/lib/` so it's importable by both the renderer
 * (`components/HelpBox.tsx`) and the unit test
 * (`src/lib/inline-markdown.test.ts`).
 */

import type { ReactNode } from 'react';

const INLINE_MD_RE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;

export function renderInline(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let hadMatch = false;
  let match: RegExpExecArray | null;
  // Reset state — `.lastIndex` on the shared RegExp can carry across calls.
  INLINE_MD_RE.lastIndex = 0;
  while ((match = INLINE_MD_RE.exec(text)) !== null) {
    hadMatch = true;
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
          style={{
            color: 'var(--accent)',
            textDecoration: 'underline',
            textDecorationStyle: 'dotted',
            textUnderlineOffset: '0.2rem',
          }}
        >
          {match[2]}
        </a>,
      );
    }
    lastIndex = match.index + match[0].length;
  }
  // Fast path: no markup in the input — return the raw string so callers
  // can `=== inputText` to detect "nothing to render" and skip wrapping.
  if (!hadMatch) return text;
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}
