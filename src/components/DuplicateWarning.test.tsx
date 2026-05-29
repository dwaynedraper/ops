// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DuplicateWarning } from './DuplicateWarning';
import type { DuplicateProspect } from '@/app/sourcing/actions';

/**
 * DuplicateWarning component tests (D-057).
 *
 * The panel is shared between Sourcing's AddProspectForm and Qualify's
 * QualifyForm. These tests assert on the shape it presents and the
 * callbacks it wires — not on the styling.
 *
 * jsdom environment is set via the `@vitest-environment` directive at
 * the top of this file (vitest.config.ts also has an `environmentMatchGlobs`
 * entry so any `.test.tsx` runs under jsdom by default).
 */

function fixture(overrides: Partial<DuplicateProspect> = {}): DuplicateProspect {
  return {
    id: 'p-1',
    contactName: 'Jordan Avery',
    workflowKey: 'real_estate',
    workflowName: 'Real Estate Media',
    stage: 'qualified',
    sourcingStatus: 'qualify',
    ...overrides,
  };
}

describe('DuplicateWarning — rendering', () => {
  it('renders the typed-name in the header', () => {
    render(
      <DuplicateWarning
        duplicates={[fixture()]}
        contactName="Jordan Avery"
        onContinue={() => {}}
        onCancel={() => {}}
        busy={false}
      />,
    );
    // The lead-line includes the typed contact name verbatim, in
    // smart-quoted form (the JSX uses &ldquo;…&rdquo;).
    const region = screen.getByRole('region', { name: /possible duplicate/i });
    expect(region).toBeInTheDocument();
    expect(region).toHaveTextContent('Jordan Avery');
  });

  it('lists every duplicate with workflow + stage', () => {
    const dupes = [
      fixture({ id: 'p-1', contactName: 'Jordan Avery', workflowName: 'Real Estate Media', stage: 'qualified' }),
      fixture({ id: 'p-2', contactName: 'Jordan Avery', workflowName: 'Corporate Headshots', stage: 'researching' }),
    ];
    render(
      <DuplicateWarning
        duplicates={dupes}
        contactName="Jordan Avery"
        onContinue={() => {}}
        onCancel={() => {}}
        busy={false}
      />,
    );
    // Two `<li>` items, one per duplicate.
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Real Estate Media');
    expect(items[0]).toHaveTextContent(/stage · qualified/i);
    expect(items[1]).toHaveTextContent('Corporate Headshots');
    expect(items[1]).toHaveTextContent(/stage · researching/i);
  });

  it('singular vs plural copy switches at 1 vs >1 duplicates', () => {
    const { rerender } = render(
      <DuplicateWarning
        duplicates={[fixture()]}
        contactName="Jordan"
        onContinue={() => {}}
        onCancel={() => {}}
        busy={false}
      />,
    );
    expect(screen.getByRole('region')).toHaveTextContent('a prospect');

    rerender(
      <DuplicateWarning
        duplicates={[fixture({ id: 'p-1' }), fixture({ id: 'p-2' })]}
        contactName="Jordan"
        onContinue={() => {}}
        onCancel={() => {}}
        busy={false}
      />,
    );
    expect(screen.getByRole('region')).toHaveTextContent('2 prospects');
  });

  it('each row has an `open →` link pointing at /qualify/{id}', () => {
    render(
      <DuplicateWarning
        duplicates={[fixture({ id: 'abc-123' })]}
        contactName="Jordan"
        onContinue={() => {}}
        onCancel={() => {}}
        busy={false}
      />,
    );
    const link = screen.getByRole('link', { name: /open/i });
    expect(link).toHaveAttribute('href', '/qualify/abc-123');
  });
});

describe('DuplicateWarning — interactions', () => {
  it('Cancel fires onCancel exactly once', () => {
    const onCancel = vi.fn();
    render(
      <DuplicateWarning
        duplicates={[fixture()]}
        contactName="Jordan"
        onContinue={() => {}}
        onCancel={onCancel}
        busy={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Continue anyway fires onContinue exactly once', () => {
    const onContinue = vi.fn();
    render(
      <DuplicateWarning
        duplicates={[fixture()]}
        contactName="Jordan"
        onContinue={onContinue}
        onCancel={() => {}}
        busy={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /continue anyway/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('busy=true disables both buttons + flips Continue label to Adding…', () => {
    const onContinue = vi.fn();
    const onCancel = vi.fn();
    render(
      <DuplicateWarning
        duplicates={[fixture()]}
        contactName="Jordan"
        onContinue={onContinue}
        onCancel={onCancel}
        busy
      />,
    );
    const cancel = screen.getByRole('button', { name: /cancel/i });
    const adding = screen.getByRole('button', { name: /adding/i });
    expect(cancel).toBeDisabled();
    expect(adding).toBeDisabled();
    fireEvent.click(cancel);
    fireEvent.click(adding);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
  });
});
