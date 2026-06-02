# The Autism Command Center (ACC) — design plan

> The Ops admin surface, retuned to Dean's own perception. The public sites
> serve the audience; **these pages serve Dean and only Dean.** The goal is
> not decoration — it's to map a color *semantics* Dean already has wired in
> (from years in a code editor) onto the UI, so information lands by instinct
> and a flow state becomes the path of least resistance. It is allowed to
> look slightly alien. That's the point.
>
> Status: PLANNING. Nothing is built yet. This doc is the alignment record.

---

## 0. INVIOLABLE LAW — the calendar colors (never override)

**The calendar's business-blue and imported-green are permanent and must
never be changed, re-themed, or overridden by the ACC palette or any future
work.** This mapping is hardwired in Dean's brain — his calendars have always
been blue (business) and green (imported / behind-the-scenes), for reasons
that are intentional and baked in forever. Any color system layered on top of
Ops routes *around* the calendar, not through it.

- `--cal-business` (blue) — owned/business calendar items. PERMANENT.
- `--cal-external` (green) — imported Google events. PERMANENT.

If a future change ever appears to require touching these, the answer is no.
Find another color.

---

## 1. The source language — One Dark Pro (verified palette)

Atom's One Dark, by Binaryify. The exact hexes (verified 2026-06):

| Token | Hex | What it means IN CODE | Dean's instinct |
| --- | --- | --- | --- |
| Background | `#282C34` | the canvas | — |
| Foreground | `#ABB2BF` | plain text | body copy |
| **Purple** | `#C678DD` | **keywords** (`if`, `class`, `return`, `import`) | "keywords for my business" → headings, top-level concepts |
| **Blue** | `#61AFEF` | **function names** | "the pieces that drive the engine — the OK button" → actions / buttons / interactive |
| **Yellow** | `#E5C07B` | **classes / types** | "the inner workings, inheritance, behind-the-scenes" → structure / scaffolding (TBD, §3) |
| Orange | `#D19A66` | constants / numbers | candidate: literal values, counts, money figures |
| **Red** | `#E06C75` | **variables / properties** (also errors) | "I look for red" → data values? or alerts? (TBD, §3) |
| Green | `#98C379` | strings | **RESERVED — calendar only (see §0)** |
| Cyan | `#56B6C2` | operators / built-ins | candidate: links / inline values (TBD) |

The instinct Dean named: *purple = business keywords (high level), blue =
functions (the engine / the OK button), yellow = the behind-the-scenes
structure.* The job of planning is to turn that instinct into a precise,
consistent element map before a single pixel changes.

---

## 2. The core mapping (draft — to be confirmed)

The semantic spine, as it stands from Dean's description:

- **Purple → the business's "keywords."** Page titles, section headings
  (h1/h2), the proper nouns of Sharp Sighted — Clients, Jobs, the workflow
  names. The high-level vocabulary you scan for first.
- **Blue → functions / drivers.** Buttons, links that *do* something, the
  primary actions, anything you click to make the engine turn. "The OK
  button is the vibe."
- **Yellow → behind-the-scenes structure.** The scaffolding that holds
  content: eyebrows, field labels, section frames, metadata — the "classes
  and inheritance" of the page. (Meaning to be sharpened in §3.)
- **Orange → literal values.** Numbers, counts, money, dates — the constants.
- **Red → (undecided: data vs alert).** See §3.
- **Green → calendar only.** Locked.
- **Cyan → (candidate) inline links / values.**

---

## 3. Resolved decisions (round 1)

- **Axis = TYPE — mirror the editor exactly.** Colors encode what something
  *is*, like One Dark Pro, not what it does. Urgency is shown by other means
  AND by treating "needs me" as its own type (see red).
- **Full editor skin — go all the way.** ACC adopts the One Dark Pro canvas
  (`#282C34` family) and syntax palette. Ops stops resembling the marketing
  sites. Maximum alignment, deliberately alien. The rest of Sharp Sighted is
  untouched — this is Ops-only.
- **Yellow = structural scaffolding.** Eyebrows, field labels, section
  frames, table headers — the "classes/inheritance" that holds content.
  Quiet, ever-present, orienting.
- **Red = "the thing that needs me now."** The one color that means
  attention, used consistently (overdue, money owed, replies waiting). This
  is the resolution of the type-vs-urgency tension: urgency is treated as a
  *type* ("volatile / needs-action"), which keeps the editor purity while
  matching how Dean's eye hunts. Red in One Dark Pro is variables+errors, so
  it already carries that charge.
- **Destructive red is SEPARATE and shocking.** Delete/reject/irreversible
  use a louder, more saturated red than the urgency red — it must visually
  alarm. (In practice Ops has little true destruction: rejecting a prospect,
  deleting a block/payment. Those few get the shocking red; everything
  "needs me" gets the standard urgency red.)
- **Calendar blue/green untouched (see §0).**
- **Colors only, NOT the code aesthetic (round 3).** Steal ONLY the ODP
  palette + semantics. Keep Ops's own design language — Playfair serif
  headings, Montserrat sans, 8px rounded cards, the existing charcoal canvas
  and breathing room. No monospace, no flat-material editor chrome. The
  proof mockup confirmed this direction.

## 4. Resolved decisions (round 2) — the final semantic spine

The complete element map. Mirrors One Dark Pro syntax semantics; this is the
law the build follows.

| Color | One Dark hex | Code meaning | ACC role |
| --- | --- | --- | --- |
| **Purple** | `#C678DD` | keywords | Headings (h1/h2/h3), eyebrows-as-titles, the business's proper nouns: Clients, Jobs, workflow names, page titles. High-level vocabulary. |
| **Blue** | `#61AFEF` | functions | Actions: buttons, action links, anything you click to drive the engine. "The OK button." |
| **Yellow** | `#E5C07B` | classes/types | Structural scaffolding: field labels, section frames, table headers, metadata chrome. The inheritance that holds content. |
| **Orange** | `#D19A66` | constants/numbers | Literal values: **money/dollars**, counts, dates, quantities. |
| **Green** | `#98C379` | strings | **Readable prose**: notes, descriptions, the anecdote you stop to read — text that isn't a heading/label/value. Also **breadcrumbs** (a readable path you follow, string-like — if added). *Distinct job from calendar-green (a category marker); both can be green because they never overlap, exactly like a string vs a calendar in an editor.* |
| **Red — urgency** | `#E06C75` | variables/errors | "The thing that needs me now": overdue, money owed, replies waiting. The calm-but-present attention color. |
| **Red — destruction** | `#BE5046` (or brighter) | — | Delete / reject / irreversible ONLY. Must visually alarm; louder than urgency red. Rare in Ops (reject prospect, delete block/payment). |
| Foreground | `#ABB2BF` | plain text | Default body text where green-prose semantics don't apply. |
| Background | `#282C34` | canvas | The ACC dark surface. |
| **Calendar blue/green** | (existing tokens) | — | **LOCKED, §0. Never touched by ACC.** |

Other decisions:

- **Money = orange** (constant/number), keeping blue pure for actions.
- **Dark-only.** ACC drops light mode in Ops entirely — One Dark Pro is
  inherently dark; the editor skin IS the identity. (Public sites keep their
  system/light/dark toggle — unaffected.)
- **Two reds:** urgency `#E06C75`, destruction `#BE5046`/brighter — visibly
  separate so danger never reads as mere urgency.
- **Build approach: mock ONE screen first.** Palette → reskin the dashboard
  as a proof → Dean lives with it → tune → THEN roll across all admin pages.

## 4b. Layout & motion (round 4)

**Name:** working name **CENTCOM-TISM** — `cent`(er)+`com`(mand) = CENTCOM
(the real "central command" word) + `tism` (au-tism). Holds both readings:
Central Command for the 'tism, and a command center only an autistic mind
would build. Hyphen/punctuation allowed to impart meaning.

**Card backgrounds are accent-driven, not gray.** Every widget's background
is a low-opacity tint of its own accent color — exactly how the (locked)
calendar cards already work. No flat charcoal fills.

**Glass-widget desktop** (from `/reference images/macOS-Liquid-Glass…` +
`opt_nud_thumbnail`):
- Admin pages read as a *desktop of widgets*, not a webpage. A **fat margin**
  all around so the backdrop shows (opt_nud feel).
- Widgets are **glass**: translucent, **low opacity**, **desaturated** —
  calm, not casino. Accessibility caution: easy to overdo; keep contrast of
  text/values well above AA regardless of the glass behind them.
- **Breathing / focus engine** — the whole point:
  - At rest: glassy, slightly receded, lower saturation.
  - Hover: a light breath — subtle scale-up + faint glow.
  - Active (clicked): background goes **fully opaque**, **full ODP color
    saturation**, a clear glow ring, panel grows slightly. Only the active
    panel shows its true colors; everything else waits in glass. That
    contrast IS the focus mechanism.

**Ultrawide command deck (5120×1440, fullscreen):** three distinct columns,
fat gutters between, **heavily rounded** column corners.
- **Left — TIME & FLOW:** day-at-a-glance, calendar, time, what's next.
- **Middle — IN MOTION:** the day-to-day work in action.
- **Right — THE ENGINE:** money, conversions, business drivers — fast,
  glanceable charts.
- Below ultrawide width it reflows (stack/2-col) — responsive, not fixed.

**Visual variety is intended, not uniform.** Panels may differ wildly in
form — a line chart, a bar graph, the accounting balance equation as a
visual identity on an odd grid, a form-like panel. The variety shows the
range; specific placements are TBD per surface.

**Motion:** subtly alive but smooth + responsive. Performance-forward:
CSS transforms/opacity for hover/active (GPU-cheap, no layout thrash); a
**GSAP** touch only where it earns it (a panel waking, a number counting up).
Honor prefers-reduced-motion.

## 4c. Elements, focus & responsive (round 5 — corrections)

**The unit is the ELEMENT, not the column.** "Element" is the official noun;
"widget" is the accepted flow-state synonym (use whichever surfaces). A
single element is what goes active — e.g. the "Conversions" chart lights up,
not its whole column.

**Columns are invisible — organization by negative space, not borders.** The
three columns are implied by fat gutters + alignment + grouping. No drawn
column outlines. Elements themselves have consistent borders so the whole
still reads as a deliberate layout (the now-ui-dashboard principle: varied
element widths + a data-appropriate element TYPE for each kind of data, but
bold front-and-center headers and consistent element borders hold it
together).

**Name:** drop the mashup. Header reads:
`Sharp Sighted` / `Autism Command Center v1.0`.

**Focus model — "my mouse is a mini lantern":**
- **Hover = the lantern.** The element under the cursor (or keyboard focus)
  *starts to wake* — partially brightens/de-glasses — but never fully opaque,
  never "selected." Fades back on mouse-out. Subtle. Lighting, not choosing.
- **Click = pin.** Clicking wakes an element FULLY — full ODP color, opaque
  background, glow ring, slight grow. It stays lit while you work in it.
- **Release.** Clicking another element pins that one instead; clicking empty
  space releases to all-glass. One pinned element at a time.

**Responsive:** ONE design, reflowed — not a separate ultrawide mode.
- 5120×1440 / very wide: the 3 implied columns (Time&Flow · In Motion ·
  Engine), fat gutters.
- Laptop: collapses to 2 columns, then a single column as it narrows.
- Single-column order is the columns flattened **top-to-bottom in reading
  order: all of Left (T→B), then Middle (T→B), then Right (T→B)** — one
  long scroll.

## 5. Implementation plan

The build, sequenced so each phase ships something usable and the riskiest
pieces (focus engine, ultrawide deck) land on a proven base. All Ops-only,
dark-only, additive. No public-site impact. Conventions as ever: tokens in
globals.css, pure helpers unit-tested, tsc+eslint+vitest green per phase,
CHANGELOG entry each.

### Phase 6D-1 — The palette + the element shell
*Feel: the colors and the glass exist; one element proves the language.*
- **ODP tokens in `globals.css`** (dark-only Ops theme), named by SEMANTIC
  ROLE so they retheme from one place and read self-documenting:
  - `--acc-bg #282C34` (canvas — but keep Ops's warmer charcoal option open
    if ODP's blue-grey feels off against the serif; decide in build)
  - `--acc-keyword #C678DD` (purple — headings)
  - `--acc-fn #61AFEF` (blue — actions)
  - `--acc-struct #E5C07B` (yellow — labels/frames/eyebrows)
  - `--acc-const #D19A66` (orange — numbers/money/dates)
  - `--acc-string #98C379` (green — prose, breadcrumbs)
  - `--acc-urgent #E06C75` (calm red — needs me)
  - `--acc-danger #BE5046` (hot red — destruction)
  - `--cal-business`, `--cal-external` — UNCHANGED, §0.
- **The `<Element>` component** — the glass widget primitive: accent-driven
  translucent background (low-opacity tint of the element's role color, like
  the calendar cards), consistent border + radius, a bold front-and-center
  header. Props: `accent`, `title`, `width` (varied widths supported),
  children. This is the atom every panel is built from.
- **Reskin ONE dashboard element** (the cash strip) end-to-end as the proof.
- Accessibility guardrail baked in from line 1: text/value contrast holds at
  AA **over** the glass, never depending on it (verify ratios, as always).

### Phase 6D-2 — The focus engine (lantern hover + click pin)
*Feel: the surface comes alive; my focus has a home.*
- **Hover = lantern:** partial wake (CSS transition: opacity↑, slight
  de-glass, faint glow) on hover/`:focus-visible`; reverts on leave. Never
  full. Pure CSS transforms/opacity — GPU-cheap, no layout thrash.
- **Click = pin:** a small client store holds the pinned element id; the
  pinned element goes fully opaque + full role color + glow ring + slight
  grow. Click another to move the pin; click empty space to release. One at
  a time.
- **`prefers-reduced-motion`:** drop the scale/glow transitions, keep the
  color/opacity state change (focus still legible, just not animated).
- Keyboard-navigable: tab moves the lantern; Enter/Space pins.

### Phase 6D-3 — The implied-column deck (responsive)
*Feel: the command deck, full-width and reflowing.*
- CSS-grid deck, **columns implied by gutters + grouping, no drawn borders.**
  Three groups: **Left = Time & Flow**, **Middle = In Motion**,
  **Right = The Engine**. Fat outer margin (desktop feel) + fat gutters.
- Responsive: 3 cols (ultrawide) → 2 → 1. Single-column order = columns
  flattened L(T→B), M(T→B), R(T→B).
- Varied element widths + a data-appropriate element type per data kind
  (line, bar, the balance-equation identity, form-like) — variety inside the
  consistent-border discipline.

### Phase 6D-4 — Motion polish
*Feel: subtly alive, never janky.*
- **GSAP** (perf-forward, only where it earns it): a panel waking on pin, a
  number counting up when a value lands. Lazy-loaded so it never blocks
  first paint. Everything else stays CSS.
- Hard rule: smooth + responsive > flourish. Cut any animation that costs
  interactivity.

### Phase 6D-5 — Rollout to the other admin surfaces
*Feel: the whole tool speaks the language.*
- Apply the element/glass/focus system across Pipeline, Clients, Jobs,
  Ledger, Books, Reports, Rates, Packages, Corporate, Rank Factors, Scripts,
  Team. Calendar chrome adopts it; calendar blue/green items stay locked.

### Accessibility guardrails (apply to every phase)
- Glass is subtle; **text + numbers stay full-opacity, AA-contrast over it.**
  If effect vs. readability ever conflict, readability wins.
- Honor `prefers-reduced-motion` everywhere.
- The whole point is flow/focus for an autistic operator — if a visual
  flourish adds noise instead of clarity, it's wrong, however cool.

## 6. Backlog (parked, context only)
- A donation-driven web app that helps autistic people align their lives —
  the same color-semantics-to-soul + focus-engine principle, generalized.
  Not in scope; recorded so the idea isn't lost.

---

*Stay Sharp. Stay Seen. Stay Human.*
