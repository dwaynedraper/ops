/**
 * Help-modal content — keyed by `{workflow_key}.{factor_key}`.
 *
 * Each entry follows the structure Dean asked for in P5: a left-rail
 * table of contents (sections) and a right pane whose content swaps
 * when the rep clicks a section. Sections can optionally hold tabs
 * for multi-angle topics (e.g. "via Zillow" / "via Realtor.com").
 *
 * v1 content is real-estate only — that's the workflow we have a
 * concrete source for (RealTrends). Other workflows fall back to no
 * help link until their content lands. Drafted by Claude, revised by
 * Dean (D-029).
 */

export type HelpBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'callout'; tone: 'info' | 'warn'; text: string }
  | { kind: 'steps'; items: string[] }
  | { kind: 'link'; url: string; label: string };

export interface HelpSection {
  /** Stable id used by the ToC. */
  id: string;
  /** Heading shown in the ToC and as the right-pane header. */
  title: string;
  /** A simple section uses `body`. A complex section uses `tabs`. */
  body?: HelpBlock[];
  tabs?: Array<{
    id: string;
    label: string;
    body: HelpBlock[];
  }>;
}

export interface HelpEntry {
  /** Header at the top of the modal. */
  title: string;
  /** Optional sub-line shown under the title. */
  subtitle?: string;
  sections: HelpSection[];
}

/* ── Real-estate workflow ──────────────────────────────────────── */

const realEstate: Record<string, HelpEntry> = {
  has_target_listing: {
    title: 'Has a current target listing',
    subtitle:
      'A live listing right now in the $500K–$2M range — the kind of property worth shooting properly.',
    sections: [
      {
        id: 'what-counts',
        title: 'What counts as a target listing',
        body: [
          {
            kind: 'paragraph',
            text: "A 'target listing' has three traits at once: it's currently active (not pending or closed), it's priced in the $500K to $2M band, and it's the kind of property where good media changes the offer.",
          },
          {
            kind: 'list',
            items: [
              'Active status — not pending, not closed, not coming-soon.',
              'List price between $500K and $2M (you can stretch a bit on either side; the band is a guide, not a rule).',
              "Single-family detached, townhomes, or modern condos. Lots and tear-downs don't count.",
            ],
          },
          {
            kind: 'callout',
            tone: 'info',
            text: "An agent with a great listing in the band who's spending money on it is your buyer. Without an active listing in-band, there's nothing to sell to right now — wait until they have one.",
          },
        ],
      },
      {
        id: 'where-to-look',
        title: "Where to find their listings",
        tabs: [
          {
            id: 'zillow',
            label: 'Zillow',
            body: [
              {
                kind: 'steps',
                items: [
                  "Search Zillow for the agent's name (top-right Find an Agent, or just paste the name into search).",
                  "Open their agent profile.",
                  "Scroll to 'For Sale' — these are their currently-active listings.",
                  "Filter or scan for the $500K–$2M band.",
                ],
              },
              {
                kind: 'paragraph',
                text: "Zillow's a fast first read but the agent has to claim the profile for the listings to show up there reliably. If the profile looks abandoned, jump to Realtor.com or the brokerage site.",
              },
            ],
          },
          {
            id: 'realtor',
            label: 'Realtor.com',
            body: [
              {
                kind: 'steps',
                items: [
                  'Use realtor.com/realestateagents — search by name + market area.',
                  'Open the profile.',
                  "Look at the 'Active Listings' tab.",
                ],
              },
              {
                kind: 'paragraph',
                text: 'Realtor.com pulls from MLS, so the active set tends to be the most complete.',
              },
            ],
          },
          {
            id: 'brokerage',
            label: 'Brokerage / personal site',
            body: [
              {
                kind: 'paragraph',
                text: "Top-producing agents usually maintain their own listings page on their personal site (or their brokerage's profile). Search the agent's name + 'listings' if Zillow/Realtor are thin.",
              },
              {
                kind: 'callout',
                tone: 'info',
                text: 'A polished personal listings page is itself a signal — it means they care about presentation, which makes them a better fit for premium media.',
              },
            ],
          },
        ],
      },
    ],
  },

  has_photo_need: {
    title: 'Has a visible photo need',
    subtitle:
      "Current listing photos are weak, missing, or off-brand — the kind of gap that's an opportunity, not a problem.",
    sections: [
      {
        id: 'tells',
        title: 'Tells of weak media',
        body: [
          {
            kind: 'list',
            items: [
              "Phone photos — visible vertical aspect, distortion, or 'iPhone wide-angle' lens curve.",
              'Clutter — personal items in shot, beds unmade, kitchen counters loaded.',
              'Bad lighting — flash bounce, blown-out windows, dark corners.',
              'Stitched HDR with halos around the windows and the ceiling.',
              "Same exterior shot used as the listing cover for every property — they're not investing per-listing.",
              'No aerial — for properties over $750K this is now baseline.',
              'No twilight shot — same.',
              'No floor plan.',
            ],
          },
        ],
      },
      {
        id: 'what-good-looks-like',
        title: "What good media looks like",
        body: [
          {
            kind: 'paragraph',
            text: 'A property where the listing photos look like they were art-directed: clean composition, balanced lighting, consistent color, an aerial that places the property in context, a twilight shot that makes the home glow, and a floor plan that helps a buyer imagine living there.',
          },
          {
            kind: 'callout',
            tone: 'info',
            text: "When you see good media on an agent's other listings, that's usually a 'no' for sourcing — they already have a media partner. Move on.",
          },
        ],
      },
    ],
  },

  annual_volume: {
    title: 'Listings per year ($500K–$2M)',
    subtitle:
      'Count of homes the agent closes annually in our target price band. 10 listings/year is the meaningful floor; 30+ is a full-volume relationship.',
    sections: [
      {
        id: 'why-this-matters',
        title: 'Why the band matters',
        body: [
          {
            kind: 'paragraph',
            text: "Sub-$500K listings are usually high-volume / low-budget. Above $2M the agents tend to already have established media partners. The middle band is the sweet spot — agents with enough volume to need help and enough margin to justify investing.",
          },
          {
            kind: 'paragraph',
            text: 'An agent at 10–12 listings per year (roughly one a month) is in the growth phase where a retainer can give them the boost. 30+ is a high-volume relationship where the Visibility Retainer makes the most sense.',
          },
        ],
      },
      {
        id: 'where-to-count',
        title: 'Where to find the count',
        tabs: [
          {
            id: 'realtrends',
            label: 'RealTrends',
            body: [
              {
                kind: 'paragraph',
                text: 'realtrends.com publishes annual rankings of individual agents by sides and by volume. Their per-market lists include the full sides count for each agent — the cleanest single source.',
              },
              {
                kind: 'callout',
                tone: 'warn',
                text: "RealTrends reports total sides, not just $500K–$2M sides. An agent with 50 sides total might only have 12 in the target band. Pair the RealTrends number with a quick Zillow / Realtor scan to estimate the in-band fraction.",
              },
              {
                kind: 'link',
                url: 'https://www.realtrends.com/ranking/best-real-estate-agents-southlake-texas/individuals-by-sides/',
                label: 'RealTrends rankings (example: Southlake)',
              },
            ],
          },
          {
            id: 'zillow',
            label: 'Zillow',
            body: [
              {
                kind: 'steps',
                items: [
                  "Open the agent's Zillow profile.",
                  "Look at 'Past Sales' — Zillow lists transactions by year.",
                  'Scan for closings in the $500K–$2M band.',
                  'Multiply roughly by the months elapsed in the year to estimate the annual rate.',
                ],
              },
            ],
          },
          {
            id: 'mls',
            label: 'MLS (if you have access)',
            body: [
              {
                kind: 'paragraph',
                text: 'The cleanest source — filter by agent, year, and price range. Available if you have an MLS account.',
              },
            ],
          },
        ],
      },
    ],
  },

  weak_current_photos: {
    title: 'Current listing photos are weak',
    subtitle:
      "Like the photo-need gate, but observation-driven — what you actually see walking their active listings.",
    sections: [
      {
        id: 'walking-listings',
        title: 'Walking the listings',
        body: [
          {
            kind: 'paragraph',
            text: "On the Sourcing table you mark whether they have a photo need based on a quick eyeball. Here on Qualify you're confirming — actually clicking through 2–3 of their current listings and judging the media.",
          },
          {
            kind: 'steps',
            items: [
              "Open each of their active listings on Zillow or Realtor.com.",
              "Look at the cover shot, the gallery flow, and the aerial / twilight / floor plan presence.",
              'Compare to what good listing media looks like in the same market.',
              "If 2 of 3 are noticeably weak, mark this true.",
            ],
          },
          {
            kind: 'callout',
            tone: 'info',
            text: "Look at the cover shot first. If it's a phone photo or a flat exterior, that tells you most of what you need to know.",
          },
        ],
      },
    ],
  },

  active_social: {
    title: 'Active on social (last 30 days)',
    subtitle:
      'Posts regularly — a sign they value visibility and will value the media you sell.',
    sections: [
      {
        id: 'where-to-look',
        title: 'Where to check',
        tabs: [
          {
            id: 'instagram',
            label: 'Instagram',
            body: [
              {
                kind: 'paragraph',
                text: 'Search the agent on Instagram. Look at their last 9 posts (the visible grid). If 3 or more are within the last 30 days, mark active.',
              },
            ],
          },
          {
            id: 'facebook',
            label: 'Facebook',
            body: [
              {
                kind: 'paragraph',
                text: 'Many agents use a Facebook business page. Check post dates on the timeline.',
              },
            ],
          },
          {
            id: 'tiktok',
            label: 'TikTok',
            body: [
              {
                kind: 'paragraph',
                text: 'For agents under ~40, TikTok is increasingly the primary channel. Check post recency.',
              },
            ],
          },
          {
            id: 'linkedin',
            label: 'LinkedIn',
            body: [
              {
                kind: 'paragraph',
                text: "Useful for the corporate-adjacent end of real estate, less so for residential. Don't over-weight a quiet LinkedIn.",
              },
            ],
          },
        ],
      },
    ],
  },

  pro_website: {
    title: 'Has a real personal website',
    subtitle:
      "A proper site on their own domain — they invest in their brand.",
    sections: [
      {
        id: 'what-counts',
        title: 'What "real" means',
        body: [
          {
            kind: 'list',
            items: [
              'Their own domain — janedoe.com, not janedoe.kw.com.',
              'Real content beyond contact info — a bio, current listings, neighborhood pages, market reports.',
              'A modern look (this decade, not 2014).',
              'Mobile-responsive.',
            ],
          },
          {
            kind: 'callout',
            tone: 'info',
            text: "An agent with a real personal site has already decided to invest in being seen. They're a much warmer lead for media work than someone running on the brokerage template.",
          },
        ],
      },
    ],
  },

  uses_video: {
    title: 'Already uses video in listings',
    subtitle:
      "Comfortable with video — an easier sell for reels and walkthroughs.",
    sections: [
      {
        id: 'where-to-look',
        title: 'Where to look',
        body: [
          {
            kind: 'paragraph',
            text: "Look at their last 3–4 listings on Zillow or Realtor.com. If any of them have a 3D walkthrough, a video tour, or a property reel in the media set, mark true.",
          },
          {
            kind: 'paragraph',
            text: "Also check their Instagram for Reels of listings — an agent posting their own walkthroughs is a near-certain match for what we sell.",
          },
        ],
      },
    ],
  },
};

/* ── The combined registry ───────────────────────────────────────── */

export const HELP_CONTENT: Record<string, HelpEntry> = {
  ...Object.fromEntries(
    Object.entries(realEstate).map(([factorKey, entry]) => [
      `real_estate.${factorKey}`,
      entry,
    ]),
  ),
  // Other workflows can land their entries here as their sources
  // emerge. For now, missing keys render no help link.
};

/** Look up a help entry by workflow + factor. Returns `null` if no
 * content exists yet for that combination. */
export function getHelpEntry(
  workflowKey: string,
  factorKey: string,
): HelpEntry | null {
  return HELP_CONTENT[`${workflowKey}.${factorKey}`] ?? null;
}
