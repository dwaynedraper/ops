/**
 * Tutorial content — keyed by workflow_key.
 *
 * V2 ships real-estate (revised with the F9 block variety, D-059) and
 * corporate headshots (new draft, D-060). Story Portraits, Saga, and
 * 10% backlog to post-V2 per V2-PLAN §7. Workflows without content
 * render as "coming soon" cards on the index. Same Claude-draft,
 * Dean-revises pattern as the help modals (D-029).
 *
 * Reuses the `HelpBlock` types from help-content.ts so the renderer
 * is the same shape on both surfaces.
 */

import type { HelpBlock } from './help-content';

export interface TutorialSection {
  id: string;
  title: string;
  body: HelpBlock[];
}

export interface TutorialEntry {
  /** URL slug — matches `workflow_key` for now. */
  slug: string;
  /** Workflow display name. */
  workflowName: string;
  title: string;
  subtitle: string;
  /** Rough read time, shown in the header. */
  readMinutes: number;
  sections: TutorialSection[];
}

/* ── Real-estate walkthrough ──────────────────────────────────────── */

const realEstateTutorial: TutorialEntry = {
  slug: 'real_estate',
  workflowName: 'Real Estate Media',
  title: 'From a public ranking to a signed agent',
  subtitle:
    'The full real-estate motion in ops — source agents off a list, qualify the strong ones, work the contact cycle, close.',
  readMinutes: 8,
  sections: [
    {
      id: 'overview',
      title: 'What this walkthrough covers',
      body: [
        {
          kind: 'paragraph',
          text: "Sharp Sighted's sales pipeline runs on a simple four-step flow: **Source** names, **Qualify** the ones worth time, **Contact** them through a cycle, then **close**. This walkthrough shows the whole motion using the Real Estate Media workflow — the one with a concrete public source ([RealTrends](https://www.realtrends.com/ranking/best-real-estate-agents-southlake-texas/individuals-by-sides/)) to pull from.",
        },
        {
          kind: 'callout',
          tone: 'info',
          text: "The system favors **rep judgment**. The pre-score badge advises; the rep decides. The Pursue/Reject toggle on Sourcing is your triage call — it decides whether the prospect is worth qualifying. The Qualify/Reject toggle on the Qualify page is the formal qualification. The system asks for a reason if your call disagrees with the math, but it never forces a decision.",
        },
        {
          kind: 'paragraph',
          text: 'A first run through the cycle takes roughly **30 minutes** from sourcing to first email sent. By the third agent, you should be at about 10.',
        },
      ],
    },

    {
      id: 'source',
      title: 'Step 1 — Source names from a list',
      body: [
        { kind: 'heading', text: 'Open the surface' },
        {
          kind: 'paragraph',
          text: 'Open [/sourcing](/sourcing). The workflow picker at the top selects the column set — pick **Real Estate Media**. The spreadsheet that appears has columns for the intake fields RealTrends gives you plus the hard qualifiers you can read off a quick scan.',
        },
        { kind: 'heading', text: 'Working a row, top to bottom' },
        {
          kind: 'steps',
          items: [
            "Open a RealTrends individuals-by-sides ranking for a market in our corridor (Southlake, Frisco, Plano, McKinney).",
            "Pick one agent — start with the top of the list and work down. Drop their name into the empty row at the bottom of the Sourcing table.",
            "Fill in **Agency** and **Market** from the RealTrends listing.",
            'Drop in **Gross Volume** if it shows on the source.',
            'Open the agent on Zillow or Realtor.com in a new tab. Check whether they have a **target listing** (active, $500K–$2M) and whether their **current photos are weak**. Toggle the gates.',
            "Estimate their in-band **listings per year** — RealTrends gives you total sides, but you want the $500K–$2M slice. The 'How to read it' link on the listings header shows you the math.",
            "Set **Status** to Pursue, Reject, or leave it Undecided. The pre-score badge on the left is your hint — you can agree or override with a reason.",
          ],
        },
        { kind: 'heading', text: 'How the row reads after you save' },
        {
          kind: 'callout',
          tone: 'info',
          text: 'Clicking the **row body** opens it for in-place edit (name + agency are exceptions — the name is a link to the per-agent Qualify page). The little **→ button on the left** of every row also jumps to Qualify; that column header reads "Qualify selection."',
        },
        {
          kind: 'paragraph',
          text: 'Rows you **Reject** stay visible (faded) so you don\'t accidentally re-source the same agent. Rows you **Pursue** keep stage at Researching and land at the top of the Qualify queue, waiting for the deep-work step before they enter the active pipeline.',
        },
      ],
    },

    {
      id: 'qualify',
      title: 'Step 2 — Qualify the strong ones deeply',
      body: [
        { kind: 'heading', text: 'Opening the deep page' },
        {
          kind: 'paragraph',
          text: 'Once a row looks promising on Sourcing, click the **→ Qualify button** on the left of the row (or click the agent\'s name). The per-agent Qualify page opens with everything pre-filled. This is where you finish the supporting factors — the smaller-weight items that bring an agent from the gates-only floor (around 2.0) up toward a 10.',
        },
        { kind: 'heading', text: 'The supporting factors' },
        {
          kind: 'list',
          items: [
            "**Active on social** — check Instagram or wherever they post. The 'How to read it' link has the breakdown.",
            "**Pro website** — own domain, real content. Brokerage templates don't count.",
            "**Uses video** — check Reels and any listings with video tours.",
            "**Weak current photos** — observation field. Click through 2–3 of their active listings and judge the cover shots.",
          ],
        },
        {
          kind: 'paragraph',
          text: 'The live score panel on the right updates as you type. Cross **8.0** and the band flips to Qualified; under **6.0** and it reads Below the bar. A "Qualify this prospect" shortcut button appears on the score panel as soon as you cross 7.0 — one click commits the qualification.',
        },
        { kind: 'heading', text: 'When your call disagrees with the math' },
        {
          kind: 'callout',
          tone: 'warn',
          text: "If your call disagrees with the band (you want to Reject a Qualified-band agent, or Qualify someone Below the bar), the page asks for a **reason** — at least 20 characters. This isn't bureaucracy; it's a paper trail for future-you. Real-estate is full of 'I just had a feeling' moments, and the reason field lets you record the feeling.",
        },
        {
          kind: 'paragraph',
          text: "Click **Save** when you're done. The score recomputes server-side and the agent's lifecycle stage updates to match the status (Qualify → stage = qualified; Reject → stage = rejected). This is the **only path to qualified** — Pursue on Sourcing flags a prospect as worth qualifying but does not qualify them.",
        },
      ],
    },

    {
      id: 'track',
      title: 'Step 3 — Work the contact cycle',
      body: [
        { kind: 'heading', text: 'The working surface' },
        {
          kind: 'paragraph',
          text: 'Once an agent is Qualified, they show up on [/contact](/contact). The Contact page is the **daily working surface** — every Qualified agent gets a card with a pre-filled contact script ready to send. Cards carry a **left-side urgency dot**: green = act now, yellow = due within 24h, red = more than a day overdue.',
        },
        { kind: 'heading', text: 'Sending a touch' },
        {
          kind: 'steps',
          items: [
            'Open [/contact](/contact). Cards are grouped by where they are in the contact cycle.',
            "Pick a card. The right pane shows the **next script** (First touch / Follow-up 1 / Follow-up 2 / Final touch).",
            'Click **Copy**. The script is on your clipboard with placeholders already replaced — agent name, agency name, your booking link.',
            "Paste into the channel you're using (email, Instagram DM, whatever).",
            "Back on Contact, click **Log contact**. The card moves into 'Waiting for reply.' If a follow-up is due, the system surfaces it on the next pass.",
          ],
        },
        { kind: 'heading', text: 'The 20-second window' },
        {
          kind: 'callout',
          tone: 'info',
          text: "Every lifecycle move on Contact has a **20-second Undo**. If you mark a touch and immediately realize you grabbed the wrong card, the toast at the bottom lets you cancel before anything commits. Click **Commit now** on the toast if you're sure and don't want to wait the full window.",
        },
        { kind: 'heading', text: 'Navigating the cycle' },
        {
          kind: 'paragraph',
          text: 'The cycle has four stages — **First touch**, **Follow-up 1**, **Follow-up 2**, and **Final touch**. The tabs above the composer are all clickable; click a past tab to see the message **as it was sent** (with all the placeholders filled), or a future tab to preview the template. After close-out with no reply, the agent moves to **Dormant** and leaves the active board. You can always re-qualify them later.',
        },
      ],
    },

    {
      id: 'email',
      title: 'Step 4 — Send the email',
      body: [
        {
          kind: 'paragraph',
          text: "v1 keeps sending **manual** on purpose — you copy the script from Contact, paste into your own email client, and send. Ops doesn't auto-send. Two reasons: you keep ownership of the relationship, and you can adjust the wording before it leaves your hands.",
        },
        {
          kind: 'paragraph',
          text: 'Once they reply, click **They replied** on Contact. The card moves into the Responded column. From there, you either run a discovery call (and build a quote on [/calculator](/calculator)), or close them out.',
        },
        {
          kind: 'callout',
          tone: 'info',
          text: 'Quote-building is a separate motion — open the per-prospect record at `/prospects/[id]` for the mini-CRM and the embedded calculator. Saving a quote attaches it to the prospect, so the quote history follows them through the rest of the cycle.',
        },
      ],
    },

    {
      id: 'next',
      title: 'What happens next',
      body: [
        {
          kind: 'paragraph',
          text: 'After signed, the agent becomes a **Client**. They stay on [/clients](/clients) — searchable, with their full history attached. The pipeline funnel on the Dashboard counts them; the supervisor report (admin only) gives Dean the across-team view.',
        },
        {
          kind: 'list',
          items: [
            'If they **sign** — congrats. Run the shoot, deliver the media, ask for the referral.',
            "If they **no-reply** through the cycle — log Dormant. Don't fret it. Real estate is a long game.",
            "If they **pass on Sourcing or Qualify** — that's data too. The row stays for the team's reference.",
          ],
        },
        {
          kind: 'paragraph',
          text: 'Every step of this is **editable config**. Rank-factor weights, contact scripts, the bands — all live in [/rank-factors](/rank-factors), [/scripts](/scripts), and the seed file. Talk to Dean if the system needs to learn something new.',
        },
        {
          kind: 'callout',
          tone: 'info',
          text: 'Stay Sharp. Stay Seen. Stay Human.',
        },
      ],
    },
  ],
};

/* ── Corporate Headshots walkthrough (D-060) ──────────────────────── */

const corporateTutorial: TutorialEntry = {
  slug: 'corporate',
  workflowName: 'Corporate Headshots',
  title: 'From a mismatched team grid to a booked Team Day',
  subtitle:
    'How to source firms whose team photos are due for a refresh, qualify the ones with real intent, and book a single on-site session that fixes the whole grid.',
  readMinutes: 7,
  sections: [
    {
      id: 'overview',
      title: 'What this walkthrough covers',
      body: [
        {
          kind: 'paragraph',
          text: "The corporate-headshots motion uses the same four-step flow as the rest of ops: **Source** firms, **Qualify** the ones with real intent, **Contact** them through a four-touch cycle, then **close** into a Team Day booking. The motion lives under [Sharp Sighted Photos](https://sharpsighted.photos) — corporate headshots are portrait work, not media work.",
        },
        {
          kind: 'callout',
          tone: 'info',
          text: "There's no single public ranking like real-estate's RealTrends. Sources for corporate are more varied — **LinkedIn searches**, the Dallas Business Journal's growing-companies coverage, professional networking groups, and your own walking-radius (law firms, agencies, medical practices in the 121 corridor). Plan to source in **small batches** — five firms at a time, not fifty.",
        },
        {
          kind: 'paragraph',
          text: 'A first run takes about **35 minutes** from sourcing to first email sent. The hardest part is finding the **decision-maker** — usually an HR lead, office manager, or a partner — so plan extra time on that.',
        },
      ],
    },

    {
      id: 'source',
      title: 'Step 1 — Source firms',
      body: [
        { kind: 'heading', text: 'Where to look' },
        {
          kind: 'list',
          items: [
            '**LinkedIn search** — filter by industry (law, finance, agency, healthcare, consulting), company size 8–100, geography in the 121 corridor. The "Posts" tab on a firm reveals recent hiring or rebrand activity.',
            "**Dallas Business Journal & D Magazine** — they publish growing-companies and Best Places to Work lists every year. A firm on those lists has the budget and the visibility-mindset.",
            '**Your own walking-radius** — drive any commercial street in Plano, Frisco, Southlake. Note the firm names on the suite signs. Office buildings are dense with prospects.',
            '**Referrals from real-estate clients** — agents do business with mortgage, title, law firms. Two networks for the price of one.',
          ],
        },
        { kind: 'heading', text: 'Working a row, top to bottom' },
        {
          kind: 'steps',
          items: [
            "Open [/sourcing](/sourcing), pick **Corporate Headshots** in the workflow picker.",
            "Drop the **firm name** (the company, not a person) into the empty row at the bottom of the table.",
            "Fill in **Market** — the city or suburb the office sits in.",
            "Open the firm's site in a new tab. Pull up the team page. Toggle **Has a team that needs headshots** if you count roughly 8 or more staff with their photo on the site or LinkedIn. Toggle **Current team photos are weak or mismatched** if the headshots are dated, inconsistent across team members, or DIY.",
            'Set **Status** to Pursue if both gates land and the firm looks like a fit. Reject if the team is too small or the photos are already polished. Leave Undecided if you need more time on Qualify to decide.',
          ],
        },
        { kind: 'heading', text: 'When the gates are easy vs. hard' },
        {
          kind: 'callout',
          tone: 'info',
          text: 'The gates are **easier to verify** on Corporate than on real-estate. A team-page glance answers both questions in under a minute. The harder work is downstream — finding the decision-maker who can actually book the shoot.',
        },
      ],
    },

    {
      id: 'qualify',
      title: 'Step 2 — Qualify the firm deeply',
      body: [
        { kind: 'heading', text: 'The headcount math' },
        {
          kind: 'paragraph',
          text: 'On the per-firm Qualify page, **Team size (headcount)** is the heaviest factor — weighted 3, with full credit at 40+. Count the actual people on the team page, not the marketing copy. A "50-person firm" with only 20 photo-bearing staff scores 20, not 50.',
        },
        { kind: 'heading', text: 'The supporting factors' },
        {
          kind: 'list',
          items: [
            "**A professional-services firm** — law, finance, agency, medical, consulting. The categories where image is part of the product.",
            "**Hiring or growing** — new faces every quarter mean new headshots every quarter. A growing firm rebooks; check the Careers page for open roles.",
            "**Brand refresh or new website underway** — a redesign is the natural trigger for new team photos. LinkedIn announcements or a `coming soon` banner are the tells.",
            "**In the 121 corridor / DFW** — inside the service area means no travel premium. Outside is still bookable, just at a higher rate.",
            "**A clear contact who can book it** — HR lead, office manager, partner. If the team page lists who runs Operations, you have your name.",
          ],
        },
        { kind: 'heading', text: 'The override-with-reason rule' },
        {
          kind: 'callout',
          tone: 'warn',
          text: "Same rule as real-estate: if your call disagrees with the pre-score band, the page asks for a **reason** of at least 20 characters. Corporate qualifications often hinge on whether you know the decision-maker — that's the most common reason to push a Below-the-bar firm to Qualify (\"I have an in via the office manager\") or to reject a Qualified-band firm (\"large but already contracted with a competitor\").",
        },
        {
          kind: 'paragraph',
          text: "Cross 7.0 and the **one-click Qualify button** appears on the score panel. Save when you're done — the firm advances to stage = qualified and surfaces on [/contact](/contact).",
        },
      ],
    },

    {
      id: 'track',
      title: 'Step 3 — Work the contact cycle',
      body: [
        { kind: 'heading', text: 'The Corporate scripts' },
        {
          kind: 'paragraph',
          text: 'Open [/contact](/contact). Corporate firms get the **violet workflow color**. Each card shows the contact name (the decision-maker you identified on Qualify), the firm, and an urgency dot driven by the cycle clock.',
        },
        {
          kind: 'list',
          items: [
            '**First touch** — addresses the team-page-mismatch problem head-on. Subject: "{first_name} — the headshots on the {company} site." Body builds the pitch around the booking link.',
            '**Follow-up 1** — gentle re-surface a few days later. Mentions the $600 + per-person Team Day pricing so the rep knows what they\'re committing to before the discovery call.',
            "**Follow-up 2** — frames it around hiring, rebranding, or the mismatched grid. Different angle from Follow-up 1.",
            '**Final touch** — closes the loop politely. The door stays open; the booking link is still there.',
          ],
        },
        { kind: 'heading', text: 'Sending a touch' },
        {
          kind: 'steps',
          items: [
            'Pick a card. The next script appears in the right pane.',
            'Click **Copy**. Placeholders (first name, company, your booking link) are filled in.',
            'Paste into your email client or the channel you use for the decision-maker.',
            'Back on Contact, click **Log contact**. The card moves into "Waiting for reply."',
          ],
        },
        { kind: 'heading', text: 'When they reply' },
        {
          kind: 'paragraph',
          text: 'A reply on Corporate almost always leads to a **booking call** — short, scoped to scheduling and the on-site logistics. Click **They replied** on the card to advance to Responded, then move to a quote on [/calculator](/calculator) if the call goes well.',
        },
      ],
    },

    {
      id: 'email',
      title: 'Step 4 — Send the email',
      body: [
        {
          kind: 'paragraph',
          text: "Same manual-send rule as real-estate. Copy the filled script from Contact, paste into your own inbox, send. You keep the relationship; you can tune wording before it goes out. The system tracks **what** was sent and **when**, not the send itself.",
        },
        {
          kind: 'callout',
          tone: 'info',
          text: "The Corporate Team Day quote on [/calculator](/calculator) starts at **$600 base + a per-person rate** (currently $70–$90 depending on team size). The whole job is one on-site session, same-day-clean turnaround. Most teams hit the math the first time a new client looks them up online.",
        },
      ],
    },

    {
      id: 'next',
      title: 'What happens next',
      body: [
        {
          kind: 'paragraph',
          text: 'Corporate has more **retainer potential** than real-estate. A firm you shoot once tends to rebook — new hires every year or two need to match the existing grid. Keep the relationship warm; log the shoot date so the system can surface a re-shoot reminder when the team has turned over enough to need one.',
        },
        {
          kind: 'list',
          items: [
            'If they **book** — congrats. Schedule the Team Day, deliver the headshots, ask for an intro to a partner firm.',
            "If they **no-reply** — log Dormant after the cycle. Corporate is slower than real-estate; cold-cycle quiet often turns into a six-month-later inbound.",
            "If they **pass** — note the reason on the rejection. Mismatched timing today can be a yes next quarter.",
          ],
        },
        {
          kind: 'paragraph',
          text: 'Story Portraits, Saga, and the 10% Rule walkthroughs are queued for **post-V2**. For now, the per-field help on the Qualify page covers what those workflows score on; the tutorials will land once the motions have run live a few times.',
        },
        {
          kind: 'callout',
          tone: 'info',
          text: 'Stay Sharp. Stay Seen. Stay Human.',
        },
      ],
    },
  ],
};

/* ── Registry ─────────────────────────────────────────────────────── */

export const TUTORIALS: TutorialEntry[] = [
  realEstateTutorial,
  corporateTutorial,
];

export function getTutorial(slug: string): TutorialEntry | null {
  return TUTORIALS.find((t) => t.slug === slug) ?? null;
}

/** Returns a list of every active workflow with whether a tutorial
 * exists. The index page uses this to render both "ready" cards and
 * "coming soon" cards. Caller supplies the workflows; we don't query
 * here so the lib stays pure. */
export function tutorialIndexFor(
  workflows: Array<{ workflowKey: string; name: string; accent: string }>,
): Array<{
  workflowKey: string;
  name: string;
  accent: string;
  tutorial: TutorialEntry | null;
}> {
  return workflows.map((w) => ({
    workflowKey: w.workflowKey,
    name: w.name,
    accent: w.accent,
    tutorial: getTutorial(w.workflowKey),
  }));
}
