import { describe, it, expect } from 'vitest';
import { getHelpEntry, HELP_CONTENT } from './help-content';

/**
 * `getHelpEntry` mode-lookup tests (D-041 / F2.6 + F9).
 *
 * The lookup runs in two modes:
 *   • mode='qualify' (default) — keyed `{workflow}.{factor}`
 *   • mode='sourcing'           — keyed `sourcing.{workflow}.{factor}`
 *
 * Each surface (HelpBox on Qualify, HelpBox on Sourcing) reads from
 * its own namespace, so a sourcing-time blurb on `gross_volume` never
 * collides with a qualify-time blurb on the same factor.
 *
 * Tests assert keys exist where authored, modes don't leak across,
 * and unknown keys return null. The actual content is the author's
 * (Dean's) call; these tests pin the contract, not the prose.
 */

describe('getHelpEntry — default (qualify) mode', () => {
  it('finds an existing real-estate factor entry', () => {
    // `has_target_listing` is in the V1 qualify-time registry.
    const entry = getHelpEntry('real_estate', 'has_target_listing');
    expect(entry).not.toBeNull();
    expect(entry?.title).toBeTruthy();
  });

  it('returns null for an unknown factor key', () => {
    expect(getHelpEntry('real_estate', 'no_such_factor')).toBeNull();
  });

  it('returns null for an unknown workflow', () => {
    expect(getHelpEntry('no_such_workflow', 'has_target_listing')).toBeNull();
  });

  it('does NOT fall through to sourcing-mode entries (mode-isolated)', () => {
    // `start` is the F2.8.4 onboarding entry — only authored in
    // sourcing mode. The default (qualify) lookup must miss it.
    expect(getHelpEntry('real_estate', 'start')).toBeNull();
  });
});

describe('getHelpEntry — explicit sourcing mode', () => {
  it('finds an authored sourcing entry', () => {
    // The F2.6 batch wrote `sourcing.real_estate.gross_volume`.
    const entry = getHelpEntry('real_estate', 'gross_volume', 'sourcing');
    expect(entry).not.toBeNull();
    expect(entry?.title).toBeTruthy();
  });

  it('finds the F2.8.4 onboarding "start" entry', () => {
    const entry = getHelpEntry('real_estate', 'start', 'sourcing');
    expect(entry).not.toBeNull();
  });

  it('returns null when the sourcing-mode entry is missing', () => {
    // Corporate doesn't have a sourcing-mode entry for has_target_listing.
    expect(getHelpEntry('corporate', 'has_target_listing', 'sourcing')).toBeNull();
  });

  it('does NOT fall through to qualify-mode entries', () => {
    // A factor that exists in qualify-mode but NOT sourcing-mode
    // (e.g. `has_photo_need` if no sourcing entry was authored) must
    // return null when looked up under mode='sourcing'.
    const qualifyKey = 'real_estate.has_photo_need';
    const sourcingKey = 'sourcing.real_estate.has_photo_need';
    if (qualifyKey in HELP_CONTENT && !(sourcingKey in HELP_CONTENT)) {
      expect(getHelpEntry('real_estate', 'has_photo_need', 'sourcing')).toBeNull();
    }
  });
});

describe('getHelpEntry — explicit qualify mode behaves the same as default', () => {
  it('finds the same entry as the implicit default', () => {
    const implicit = getHelpEntry('real_estate', 'has_target_listing');
    const explicit = getHelpEntry('real_estate', 'has_target_listing', 'qualify');
    expect(explicit).toBe(implicit);
  });
});

describe('HELP_CONTENT registry shape', () => {
  // Defensive — registry shape changes are usually intentional but
  // worth catching.
  it('every entry has a non-empty title and at least one section', () => {
    for (const [key, entry] of Object.entries(HELP_CONTENT)) {
      expect(entry.title, `entry ${key} title`).toBeTruthy();
      expect(
        entry.sections.length,
        `entry ${key} sections`,
      ).toBeGreaterThan(0);
    }
  });

  it('every section has a stable id + title + (body or tabs)', () => {
    for (const [key, entry] of Object.entries(HELP_CONTENT)) {
      for (const section of entry.sections) {
        expect(section.id, `entry ${key} section id`).toBeTruthy();
        expect(section.title, `entry ${key} section title`).toBeTruthy();
        // Either body[] or tabs[] — never both empty.
        const hasBody = (section.body?.length ?? 0) > 0;
        const hasTabs = (section.tabs?.length ?? 0) > 0;
        expect(
          hasBody || hasTabs,
          `entry ${key} section ${section.id} has no body or tabs`,
        ).toBe(true);
      }
    }
  });
});
