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
  | { kind: 'link'; url: string; label: string }
  /** D-058 — short H2/H3-style header inside a section's body. Default
   * level is 2; level 3 renders smaller. Authors use this to break up
   * long sections into named beats without having to introduce a new
   * top-level HelpSection. Inline markdown isn't parsed on heading
   * text — keep it short and literal. */
  | { kind: 'heading'; text: string; level?: 2 | 3 };

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

/* ── Sourcing-time content (D-041) ───────────────────────────────────
 *
 * A SECOND pass of help content, written for the batch-triage mindset
 * on /sourcing — different angle from the qualify-time entries above.
 * Qualify is a deep read of one prospect; Sourcing is fifty rows in
 * one sitting from a public ranking. The voice here is "you've got 50
 * names, spend 30 seconds, defer the deep stuff to Qualify."
 *
 * Keys are the same as the qualify-time set (`has_target_listing`,
 * `annual_volume`, etc.) plus first-class intake fields that earn a
 * help blurb (`gross_volume`, `source_url`). HelpBox is looked up with
 * `mode='sourcing'` from the table headers and the add-prospect form;
 * fields without a sourcing-mode entry render no help link.
 */

const sourcingRealEstate: Record<string, HelpEntry> = {
  start: {
    title: 'Where to start',
    subtitle:
      "First time sourcing real estate, or coming back after a break? Three steps from a public ranking to a populated row.",
    sections: [
      {
        id: 'get-the-list',
        title: '1. Get the list',
        body: [
          {
            kind: 'paragraph',
            text: "Sourcing is fastest when you work off a public ranking. RealTrends publishes them by city — pick the corridor city you're targeting and the page gives you the top producers, sorted by sides or volume.",
          },
          {
            kind: 'steps',
            items: [
              "Open the RealTrends ranking for your target city (link below).",
              "Stay on the by-sides ranking — sides is the count that maps to our hard qualifier.",
              'Skim the top 30–50 names. Keep the tab open; you\'ll reference it as you fill rows.',
            ],
          },
          {
            kind: 'link',
            url: 'https://www.realtrends.com/ranking/best-real-estate-agents-southlake-texas/individuals-by-sides/',
            label: 'RealTrends rankings (example: Southlake)',
          },
          {
            kind: 'callout',
            tone: 'info',
            text: "Don't have a ranking in front of you? A brokerage's agent page works too — Compass, Briggs Freeman, Allie Beth — just pull the top producers and start filling rows.",
          },
        ],
      },
      {
        id: 'fill-each-row',
        title: '2. Fill each row',
        body: [
          {
            kind: 'paragraph',
            text: "Paste the agent's name, their agency, and the market they work. Fill the hard qualifiers as you can — every column has a per-field help link that explains what to look for in 30 seconds or less.",
          },
          {
            kind: 'list',
            items: [
              '**Name** — required. Paste exactly as it appears.',
              '**Agency** — required. Pulls in from the ranking too.',
              '**Market** — the city or corridor. "Southlake," "121 Corridor," etc.',
              '**Gross volume** — the dollar figure from RealTrends. Strip the $ and commas.',
              '**Source URL** — paste the RealTrends page (or wherever you found them). Future-you will thank you.',
              '**Hard qualifiers** — fill what you can see fast. Defer the rest to Qualify.',
            ],
          },
          {
            kind: 'paragraph',
            text: 'Then set the **status** — Pursue / Undecided / Reject. Pursue lands the row in the Qualify queue. The pre-score badge is advisory, not binding.',
          },
        ],
      },
      {
        id: 'keep-moving',
        title: '3. Keep moving',
        body: [
          {
            kind: 'paragraph',
            text: "Sourcing is a rapid-fire surface. Aim for 30 seconds per row — 60 if a qualifier needs a click. Anything that takes longer than that belongs on Qualify, where you do the deep read of the prospects you actually committed to pursue.",
          },
          {
            kind: 'callout',
            tone: 'info',
            text: "If you find yourself reading a Zillow profile for two minutes, stop. Save what you have, toggle Pursue (or Undecided if you're not sure), and move on. The whole list will take 45–90 minutes if you keep the cadence.",
          },
        ],
      },
    ],
  },

  gross_volume: {
    title: 'Gross volume',
    subtitle:
      "The total sales volume from the source list — the headline number on RealTrends. Not commission.",
    sections: [
      {
        id: 'what-to-paste',
        title: 'What to paste',
        body: [
          {
            kind: 'paragraph',
            text: "Paste the agent's total sales volume for the period the list covers — the dollar figure RealTrends puts next to the name.",
          },
          {
            kind: 'list',
            items: [
              'Total volume — the homes sold × the prices. Big number.',
              "Not GCI, not commission, not net. The headline figure.",
              'Strip the dollar sign and commas. The cell takes raw numbers.',
            ],
          },
          {
            kind: 'callout',
            tone: 'info',
            text: 'This is a triage cue, not the qualifier. The hard qualifier "annual volume" lives in its own column and is the one that actually scores the row.',
          },
        ],
      },
      {
        id: 'when-blank',
        title: "When to leave it blank",
        body: [
          {
            kind: 'paragraph',
            text: "If the source list doesn't break out a per-agent volume — team rankings sometimes pool it — leave the cell blank. You'll backfill from Realtor.com or the brokerage page on Qualify.",
          },
        ],
      },
    ],
  },

  source_url: {
    title: 'Source URL',
    subtitle:
      "Where the name came from. Link discipline now saves you twenty minutes later on Qualify.",
    sections: [
      {
        id: 'why-it-matters',
        title: 'Why this earns its column',
        body: [
          {
            kind: 'paragraph',
            text: "Two days from now you're on Qualify, looking at a row, asking yourself: why did I add this person? The source URL answers that in one click.",
          },
          {
            kind: 'list',
            items: [
              "The RealTrends page for this agent's segment.",
              "The brokerage profile if you scraped from there.",
              "An Instagram post that flagged them.",
            ],
          },
        ],
      },
      {
        id: 'rapid-discipline',
        title: 'Rapid discipline',
        body: [
          {
            kind: 'steps',
            items: [
              'Open the source page in a tab.',
              'Copy the URL of THAT specific page (not the parent ranking) when you can.',
              'Paste, hit add, move on.',
            ],
          },
          {
            kind: 'callout',
            tone: 'info',
            text: "Cell takes any URL. Don't fuss with whether it's the canonical page; just save your future self the re-search.",
          },
        ],
      },
    ],
  },

  has_target_listing: {
    title: 'Has a current target listing',
    subtitle:
      "Yes/no triage call. Thirty-second skim — depth comes on Qualify.",
    sections: [
      {
        id: 'the-30-second-read',
        title: 'The 30-second read',
        body: [
          {
            kind: 'paragraph',
            text: "On Sourcing you're answering a yes/no, not building the case. Look once at their active listings page — Zillow or Realtor.com profile, brokerage site — and decide.",
          },
          {
            kind: 'steps',
            items: [
              "Search the name + 'realtor' on Google.",
              'Open the first profile that loads in <5 seconds.',
              "Eyeball the active listings. Anything in the $500K–$2M range? Check the box. Nothing in band? Leave it.",
              "Don't read the listing. Don't price-check. Just yes or no.",
            ],
          },
        ],
      },
      {
        id: 'when-to-skip',
        title: 'When to skip the check entirely',
        body: [
          {
            kind: 'paragraph',
            text: "If the agent's profile takes more than 30 seconds to find, leave this blank and move on. A row with a great volume number but no target listing yet still belongs on the list — they'll get one. The check resolves on Qualify when you do the real read.",
          },
          {
            kind: 'callout',
            tone: 'info',
            text: 'Blank ≠ no. Blank means "deferred." Reject is reserved for active listings you saw and ruled out.',
          },
        ],
      },
    ],
  },

  annual_volume: {
    title: 'Listings per year ($500K–$2M)',
    subtitle:
      "Count of homes the agent closes in our target price band per year. Not dollars — the listings count.",
    sections: [
      {
        id: 'the-rapid-read',
        title: 'The rapid read',
        body: [
          {
            kind: 'paragraph',
            text: "RealTrends ranks agents by total sides — that's the count we want, restricted to the $500K–$2M band. The cell takes a whole number: 10, 22, 30.",
          },
          {
            kind: 'list',
            items: [
              '10 listings/yr ≈ growth-phase agent, retainer fits.',
              '20+/yr ≈ a known producer in the band.',
              '30+/yr ≈ full-volume relationship; the Visibility Retainer makes the most sense.',
            ],
          },
          {
            kind: 'callout',
            tone: 'info',
            text: "The score curve gives full credit at 30+, partial credit between 10 and 30, and zero below 10. Entering 30 lands the row in the top band on volume alone.",
          },
        ],
      },
      {
        id: 'estimating-the-in-band-share',
        title: 'Estimating the $500K–$2M share',
        body: [
          {
            kind: 'paragraph',
            text: "RealTrends reports TOTAL sides — all price bands combined. You need the in-band fraction, not the total. Eyeball it from their Past Sales on Zillow.",
          },
          {
            kind: 'steps',
            items: [
              "Note the RealTrends total sides for the year.",
              "Open the agent's Zillow profile, scroll Past Sales.",
              "Glance at the price column for the most recent ~20 closings — what fraction sits between $500K and $2M?",
              'Multiply: total sides × in-band fraction = the number you enter. Round.',
            ],
          },
          {
            kind: 'callout',
            tone: 'warn',
            text: "Don't deep-research this on Sourcing. A close-enough estimate is what the cell wants. The exact count gets refined on Qualify.",
          },
        ],
      },
      {
        id: 'when-to-defer',
        title: "When to leave it blank",
        body: [
          {
            kind: 'paragraph',
            text: "If the agent isn't on RealTrends and Zillow Past Sales is thin, leave the cell at 0 and let the row ride on the other qualifiers. The deep count happens on Qualify when you can pull MLS or do a longer Zillow scan.",
          },
        ],
      },
    ],
  },

  pro_website: {
    title: 'Has a real personal site',
    subtitle: "Five-second visual judgment. Modern personal site beats brokerage template, every time.",
    sections: [
      {
        id: 'how-to-decide',
        title: 'How to decide in five seconds',
        body: [
          {
            kind: 'paragraph',
            text: "Click the agent's website (their bio link on Realtor.com / Zillow, or the URL on their card). Look at it for five seconds. Decide.",
          },
          {
            kind: 'list',
            items: [
              "Yes: own domain, modern type, real photography, distinct personality. They invested.",
              "Yes: lives on a brokerage subdomain BUT clearly custom — their own visual language, not the template.",
              "No: bare brokerage template with their headshot dropped in. Cookie-cutter.",
              "No: link is broken / 404s / loads in 30 seconds. Treat as no.",
            ],
          },
        ],
      },
      {
        id: 'why-this-matters',
        title: 'Why this matters in batch',
        body: [
          {
            kind: 'paragraph',
            text: "An agent who paid for a real site is the same agent who'll pay for real photography. This factor disqualifies a stunning number of high-volume but low-investment producers.",
          },
        ],
      },
    ],
  },

  uses_video: {
    title: 'Already uses video',
    subtitle: "If they're posting reels or 3D tours, they're already half-sold on what we do.",
    sections: [
      {
        id: 'where-to-look',
        title: 'Where to look in 30 seconds',
        body: [
          {
            kind: 'steps',
            items: [
              "Pull up their last 3-4 listings on Zillow or Realtor.com.",
              "Look at the listing media — is there a 3D walkthrough, a property video, or a vertical reel?",
              "If yes on any: check the box.",
              "If you can't tell in 30 seconds, leave it blank — defer to Qualify.",
            ],
          },
        ],
      },
      {
        id: 'the-instagram-tell',
        title: 'The Instagram tell',
        body: [
          {
            kind: 'paragraph',
            text: "Search their name on Instagram. If they're posting reels OF their own listings, that's a yes regardless of what's on Zillow. Reels of *their* properties are the highest-intent signal there is.",
          },
          {
            kind: 'callout',
            tone: 'info',
            text: "Generic content reels (selfies, market updates) don't count. The signal is reels of THEIR listings — meaning they know video sells homes.",
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
  ...Object.fromEntries(
    Object.entries(sourcingRealEstate).map(([factorKey, entry]) => [
      `sourcing.real_estate.${factorKey}`,
      entry,
    ]),
  ),
  // Other workflows can land their entries here as their sources
  // emerge. For now, missing keys render no help link.
};

export type HelpMode = 'qualify' | 'sourcing';

/** Look up a help entry by workflow + factor. The `mode` param picks
 * between the qualify-time and sourcing-time content — different
 * angles for the same factor key. Defaults to `qualify` so existing
 * callers (the /qualify page) keep working without changes. Returns
 * `null` if no content exists for that combination. */
export function getHelpEntry(
  workflowKey: string,
  factorKey: string,
  mode: HelpMode = 'qualify',
): HelpEntry | null {
  if (mode === 'sourcing') {
    return HELP_CONTENT[`sourcing.${workflowKey}.${factorKey}`] ?? null;
  }
  return HELP_CONTENT[`${workflowKey}.${factorKey}`] ?? null;
}
