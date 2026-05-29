import { describe, it, expect } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { renderInline } from './inline-markdown';

/**
 * Inline-markdown parser tests (D-058 / F9).
 *
 * The parser returns one of two shapes:
 *
 *   • the input string verbatim, when no inline pattern matched
 *   • an array of strings + React elements, when at least one matched
 *
 * Tests assert on:
 *   - bold rendering (`**word**` → <strong>)
 *   - link rendering (`[label](url)` → <a href=url target=_blank>)
 *   - mixed text + markup
 *   - absence of false positives on plain prose
 *   - `lastIndex` doesn't leak across calls (defensive — the regex is
 *     a module-level singleton)
 */

// Cheap node helpers — we don't pull in @testing-library here because
// the parser returns a flat React-node array. Tests inspect the array
// structure directly.

function asArray(out: ReactNode): ReactNode[] {
  return Array.isArray(out) ? out : [out];
}

function isElement(n: ReactNode): n is ReactElement {
  return (
    typeof n === 'object' &&
    n !== null &&
    !Array.isArray(n) &&
    'type' in (n as object)
  );
}

describe('renderInline — bold', () => {
  it('plain text passes through unchanged', () => {
    expect(renderInline('hello world')).toBe('hello world');
  });

  it('a single **word** becomes a <strong>', () => {
    const out = asArray(renderInline('this is **bold** here'));
    expect(out.length).toBe(3);
    expect(out[0]).toBe('this is ');
    expect(isElement(out[1])).toBe(true);
    if (isElement(out[1])) {
      expect(out[1].type).toBe('strong');
      expect((out[1].props as { children: string }).children).toBe('bold');
    }
    expect(out[2]).toBe(' here');
  });

  it('two **bolds** in one string render both', () => {
    const out = asArray(renderInline('**one** and **two**'));
    const strongs = out.filter(isElement).filter((e) => e.type === 'strong');
    expect(strongs.length).toBe(2);
  });

  it('an unclosed ** does not match', () => {
    expect(renderInline('this **never closes')).toBe('this **never closes');
  });
});

describe('renderInline — link', () => {
  it('a `[label](url)` renders as <a href=url>', () => {
    const out = asArray(renderInline('see [the docs](https://example.com) here'));
    expect(out.length).toBe(3);
    expect(isElement(out[1])).toBe(true);
    if (isElement(out[1])) {
      const props = out[1].props as {
        href: string;
        children: string;
        target: string;
        rel: string;
      };
      expect(out[1].type).toBe('a');
      expect(props.href).toBe('https://example.com');
      expect(props.children).toBe('the docs');
      expect(props.target).toBe('_blank');
      expect(props.rel).toBe('noopener noreferrer');
    }
  });

  it('a relative URL still works', () => {
    const out = asArray(renderInline('open [/contact](/contact)'));
    expect(isElement(out[1])).toBe(true);
    if (isElement(out[1])) {
      expect((out[1].props as { href: string }).href).toBe('/contact');
    }
  });

  it('a malformed link `[label]( no close` does not match', () => {
    expect(renderInline('this [label]( has no close')).toBe(
      'this [label]( has no close',
    );
  });
});

describe('renderInline — mixed + edge cases', () => {
  it('mixed bold + link in one string renders both', () => {
    const out = asArray(
      renderInline('**Important:** open [the page](/contact) now'),
    );
    const elementTypes = out
      .filter(isElement)
      .map((e) => e.type);
    expect(elementTypes).toEqual(['strong', 'a']);
  });

  it('text before, between, and after markup all survive', () => {
    const out = asArray(renderInline('before **bold** middle [link](/x) end'));
    expect(out[0]).toBe('before ');
    expect(out[out.length - 1]).toBe(' end');
  });

  it('empty string returns empty string', () => {
    expect(renderInline('')).toBe('');
  });

  it('a string of only **bold** has no surrounding text', () => {
    const out = asArray(renderInline('**hi**'));
    expect(out.length).toBe(1);
    expect(isElement(out[0])).toBe(true);
    if (isElement(out[0])) {
      expect(out[0].type).toBe('strong');
    }
  });

  it('two calls in a row do not leak regex state', () => {
    // Defensive: the module-level INLINE_MD_RE has the `g` flag and a
    // `lastIndex` cursor. The parser resets it; verify two consecutive
    // calls with the same input produce the same shape.
    const a = asArray(renderInline('**x** and **y**'));
    const b = asArray(renderInline('**x** and **y**'));
    expect(a.length).toBe(b.length);
    expect(a.filter(isElement).length).toBe(b.filter(isElement).length);
  });

  it('does not mistake stand-alone `[` or `*` for markup', () => {
    expect(renderInline('rate: 3*5 = 15')).toBe('rate: 3*5 = 15');
    expect(renderInline('an array[0] reference')).toBe('an array[0] reference');
  });
});
