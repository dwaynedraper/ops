/**
 * Tutorial content — keyed by workflow_key.
 *
 * v1 content is real-estate-only — it's the workflow with a concrete
 * source for end-to-end walkthroughs (RealTrends → Sourcing →
 * Qualify → Tracking → Email). Other workflows render as "coming
 * soon" cards on the index until their walkthroughs land. Same
 * Claude-draft, Dean-revises pattern as the help modals (D-029).
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
    'The full real-estate motion in ops — how to source agents off a list, qualify the strong ones, work the contact cycle, and close.',
  readMinutes: 8,
  sections: [
    {
      id: 'overview',
      title: 'What this walkthrough covers',
      body: [
        {
          kind: 'paragraph',
          text: "Sharp Sighted's sales pipeline runs on a simple four-step flow: Source names, Qualify the ones worth time, Track them through a contact cycle, then close. This walkthrough shows the whole motion using the Real Estate Media workflow — the one with a concrete public source (RealTrends) to pull from.",
        },
        {
          kind: 'callout',
          tone: 'info',
          text: "The system favors rep judgment. The pre-score badge advises; the rep decides. The Pursue/Reject toggle on Sourcing is your triage call — it decides whether the prospect is worth qualifying. The Qualify/Reject toggle on the Qualify page is the formal qualification. The system asks for a reason if your call disagrees with the math, but it never forces a decision.",
        },
        {
          kind: 'paragraph',
          text: 'A first run through the cycle takes roughly 30 minutes from sourcing to first email sent. By the third agent, you should be at about 10.',
        },
      ],
    },

    {
      id: 'source',
      title: 'Step 1 — Source names from a list',
      body: [
        {
          kind: 'paragraph',
          text: 'Open /sourcing. The workflow picker at the top selects the column set — pick Real Estate Media. The spreadsheet that appears has columns for the intake fields RealTrends gives you plus the hard qualifiers you can read off a quick scan.',
        },
        {
          kind: 'steps',
          items: [
            "Open a RealTrends individuals-by-sides ranking for a market in our corridor (Southlake, Frisco, Plano, McKinney).",
            "Pick one agent — start with the top of the list and work down. Drop their name into the empty row at the bottom of the Sourcing table.",
            "Fill in Agency and Market from the RealTrends listing.",
            'Drop in Gross Volume if it shows on the source.',
            'Open the agent on Zillow or Realtor.com in a new tab. Check whether they have a target listing (active, $500K–$2M) and whether their current photos are weak. Toggle the gates.',
            "Estimate their in-band listings per year — RealTrends gives you total sides, but you want the $500K–$2M slice. The 'Where do I find this?' link on the listings field shows you the math.",
            "Set Status to Pursue, Reject, or leave it Undecided. The pre-score badge on the left is your hint — you can agree or override with a reason.",
          ],
        },
        {
          kind: 'callout',
          tone: 'info',
          text: "Every field locks after you blur out of it. The little ✎ pencil in the top-right of a locked cell reopens it for editing. Clicking the locked area of the row opens the per-agent Qualify page.",
        },
        {
          kind: 'paragraph',
          text: 'Rows you Reject stay visible (faded) so you don\'t accidentally re-source the same agent. Rows you Pursue get a green status badge and surface on the Qualify queue, waiting for the deep-work step before they enter the active pipeline.',
        },
      ],
    },

    {
      id: 'qualify',
      title: 'Step 2 — Qualify the strong ones deeply',
      body: [
        {
          kind: 'paragraph',
          text: "Once a row looks promising on Sourcing, click anywhere on the locked area to open the per-agent Qualify page. This is where you fill in the supporting factors — the smaller-weight items that bring an agent from the gates-only floor (around 2.0) up toward a 10.",
        },
        {
          kind: 'list',
          items: [
            "Active on social — check Instagram or wherever they post. The Where-do-I-find link has the breakdown.",
            "Pro website — own domain, real content. Brokerage templates don't count.",
            "Uses video — check Reels and any listings with video tours.",
            "Weak current photos — observation field. Click through 2–3 of their active listings and judge the cover shots.",
          ],
        },
        {
          kind: 'paragraph',
          text: 'The live score panel on the right updates as you type. Cross 8.0 and the band flips to Qualified; under 6.0 and it reads Below the bar.',
        },
        {
          kind: 'callout',
          tone: 'warn',
          text: "If your call disagrees with the band (you want to Reject a Qualified-band agent, or Qualify someone Below the bar), the page asks for a reason — at least 20 characters. This isn't bureaucracy; it's a paper trail for future-you. Real-estate is full of 'I just had a feeling' moments, and the reason field lets you record the feeling.",
        },
        {
          kind: 'paragraph',
          text: 'Click Save when you\'re done. The score recomputes server-side and the agent\'s lifecycle stage updates to match the status (Qualify → stage = qualified; Reject → stage = rejected). This is the only path to qualified — Pursue on Sourcing flags a prospect as worth qualifying but does not qualify them.',
        },
      ],
    },

    {
      id: 'track',
      title: 'Step 3 — Work the contact cycle',
      body: [
        {
          kind: 'paragraph',
          text: "Once an agent is Qualified, they show up on /contact. The Contact page is the daily working surface — every Qualified agent gets a card with a pre-filled contact script ready to send.",
        },
        {
          kind: 'steps',
          items: [
            'Open /contact. Cards are grouped by where they are in the contact cycle.',
            "Pick a card. The right pane shows the next script (first touch, follow-up 1, follow-up 2, close-out).",
            "Click Copy. The script is on your clipboard with placeholders already replaced — agent name, agency name, your booking link.",
            "Paste into the channel you're using (email, Instagram DM, whatever).",
            "Back on Contact, click Log contact. The card moves into 'Waiting for reply.' If a follow-up is due, the system surfaces it on the next pass.",
          ],
        },
        {
          kind: 'callout',
          tone: 'info',
          text: "Every lifecycle move on Contact has a 20-second Undo. If you mark a touch and immediately realize you grabbed the wrong card, the toast at the bottom lets you cancel before anything commits.",
        },
        {
          kind: 'paragraph',
          text: "The cycle has four stages — first touch, follow-up 1, follow-up 2, and close-out. After close-out with no reply, the agent moves to Dormant and leaves the active board. You can always re-qualify them later.",
        },
      ],
    },

    {
      id: 'email',
      title: 'Step 4 — Send the final email',
      body: [
        {
          kind: 'paragraph',
          text: "v1 keeps sending manual on purpose — you copy the script from Tracking, paste into your own email client, and send. Ops doesn't auto-send. Two reasons: you keep ownership of the relationship, and you can adjust the wording before it leaves your hands.",
        },
        {
          kind: 'paragraph',
          text: 'Once they reply, mark Replied on Tracking. The card moves into the Responded column. From there, you either run a discovery call (and build a quote on /calculator), or close them out.',
        },
        {
          kind: 'callout',
          tone: 'info',
          text: "Quote-building is a separate motion — open the per-prospect record at /prospects/[id] for the mini-CRM and the embedded calculator. Saving a quote attaches it to the prospect, so the quote history follows them through the rest of the cycle.",
        },
      ],
    },

    {
      id: 'next',
      title: 'What happens next',
      body: [
        {
          kind: 'paragraph',
          text: "After signed, the agent becomes a Client. They stay on /clients — searchable, with their full history attached. The pipeline funnel on the Dashboard counts them; the supervisor report (admin only) gives Dean the across-team view.",
        },
        {
          kind: 'list',
          items: [
            "If they sign — congrats. Run the shoot, deliver the media, ask for the referral.",
            "If they no-reply through the cycle — log Dormant. Don't fret it. Real estate is a long game.",
            "If they pass on Sourcing or Qualify — that's data too. The row stays for the team's reference.",
          ],
        },
        {
          kind: 'paragraph',
          text: 'Every step of this is editable config. Rank-factor weights, contact scripts, the bands — all live in /rank-factors, /scripts, and the seed file. Talk to Dean if the system needs to learn something new.',
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

export const TUTORIALS: TutorialEntry[] = [realEstateTutorial];

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
