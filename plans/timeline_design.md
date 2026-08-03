# Timeline Design — Decision Log (display side)

The spec (`SPEC.md` §5–§6) holds the **current rules**; this file
holds the dated decisions, the evidence that forced them, and the alternatives
that lost — moved out of CLAUDE.md 2026-07-15 to keep it lean. The live
watch-list is consolidated in spec §6 ("Watch list").

## Score & tiers
- Score v1 (spec §6): `attendedSeconds = max(heartbeats×10, audibleSeconds)` +
  weighted discrete signals. Weights are provisional — inherited from Desktop4's
  demo-tuned values; keep them named constants.
- Score → three tiers/heights (144/92/40 since 2026-07-24 — see the container-calming
  entry; originally 144/115/86, bottom-flush) → picket fence.
  Design ported from the Desktop4 project (`~/Projects/Desktop4 (lifestreams)` —
  see its `plans/three_tier_focus_plan.md` and
  `src/components/canvas/TimelineView.jsx`; its WebGL/React stack and
  screenshot/heatmap features did NOT port).
- Sub-issue (2026-07-15): band is duration-biased — 30s of intense typing scores
  LOW; density rescue (keystrokes/sec) is a future scoring knob.
- **W_SCROLL=5, gated on scrollable (2026-07-15) — "the read":** §5's missing
  fourth taxonomy member (quickly-consumed article the user wants findable
  later; specimen: Time article, scroll 11/11 windows, score 110 LOW). First
  weight tuned with the data-first method: scroll/click/mouse/scrollable
  columns added to the Score table, a full real day (119 sessions) pasted and
  re-scored offline — W=5 flipped exactly one block (the article, 110→165);
  W=3 rescued nothing; W=10 added nothing. The scrollable gate proved
  load-bearing: app-style SPAs scroll inner containers (documentElement never
  grows) so LinkedIn/Phanpy feeds, Gemini churn, and all Maps wheel-zoom read
  scrollable=false and stayed LOW — the exact feared false positives, excluded
  by architecture. Merged visits + containers inherit scrollable as OR of
  members. Watch: bsky.app scrolls the document, so long grazes there earn
  the premium.
- MEDIUM=150 may be too permissive on real data — thresholds deliberately held
  until label gating is evaluated (one knob at a time).

## Labels
- **Importance-gated** (2026-07-15): MEDIUM+ runs only; collisions resolved by
  score (higher wins, loser dropped, never nudged — a nudged label misaligns
  with its block). Desktop4's first-occurrence-always titling is deleted —
  wrong for the web's hostname cardinality (20+ hosts/session, not ~6 apps).
- **Labels are title-derived site names** ("Google Maps", not google.com): most
  common trailing title segment across a run's pages, hostname fallback.
  Identity (color/grouping) stays hostname-keyed. Known misfire: Meet titles
  ("Scott"). SUPERSEDED 2026-07-18 by host-level invariance naming (below).
- **(2026-07-18) Host-level invariance naming — per-run trailing rule
  superseded.** Two triggers the same day: (1) three NotebookLM visits drew
  two different labels — one run caught a suffixed document title
  ("… - Gemini Notebook") and resolved the name, its siblings only saw the
  bare app title and fell back to hostname; same host, same hue, two names
  breaks self-legending. (2) Scott flagged Google Voice: its "Voice - (29)
  Messages" titles put the site name FIRST, so the trailing rule extracted
  the unread counter as the label. Redesign: the label names the HOST, so
  one name per host per render, derived from all admitted titles across the
  stored week; the site name is the segment that stays INVARIANT while page
  parts vary. Candidates = first + last segments only (middle segments
  excluded — Gmail's "scott@jenson.org" lurks there); winner = most titles,
  majority required; tie prefers first-position (App-page house style is
  invariant-first; classic page-Site never ties since leading segments
  vary). Validated offline against nine real shapes: Voice → "Voice",
  Meet → "Meet" (the watch-listed misfire self-fixed), YouTube, Gmail
  workspace name, NotebookLM consistent, Phanpy, single-title and
  no-separator fallbacks. Named risk (watch-listed): a one-document host
  ties toward the document name — accepted, self-corrects with a second
  document. Titles no longer collected per run in groupRuns; render calls
  computeHostNames(sessions) once (raw sessions, so merged-visit member
  titles are covered).
- **(2026-07-19) Hostname match wins outright — the WorkFlowy tagline
  crown.** Specimen: WorkFlowy's document title is the invariant
  "Organize your brain. - WorkFlowy" (SPA, never changes), so both
  segments appeared in every title — a perfect tie — and the
  first-position tie-break (built for Voice/Meet's App-page style)
  crowned the TAGLINE. The tooltip confirmed the inversion: clean()
  stripped "Organize your brain." as boilerplate and listed "WorkFlowy"
  as the page. Scott's framing, adopted over a tie-break-only fix: a
  title segment that names the domain is the site declaring its own
  name — that's not a hint to break ties with, it's the answer. Rule: a
  candidate whose normalized form (lowercase, non-alphanumerics
  stripped) EXACTLY equals a hostname label (TLD dropped) wins outright,
  bypassing count contest and majority guard; counts arbitrate among
  multiple matches. Two guards, both probed in review: (1) equality
  never containment — "googledocs" must not match "docs", which is
  precisely how docs.google.com still resolves to "Google Docs" (no
  segment is ever bare "Docs"/"Google", so no match fires and the count
  contest runs untouched); (2) recurrence — a matched candidate needs
  ≥2 titles (waived for a lone parted title) so a one-off doc literally
  named "Docs" can't claim the host for a week. Beyond the tie fix,
  outright-win also rescues minority matches: a site name appearing in
  only a few of many separator-free titles used to fail the majority
  guard and fall back to the raw hostname; now one recurring matching
  segment upgrades "workflowy.com" to "WorkFlowy" with the site's own
  capitalization.

## Color = identity, rationed by importance
- Curated palette for hosts holding a MEDIUM+ block; LOW-only hosts and
  collapsed sticks are gray. **Fence-open relaxation:** members of an expanded
  fence get colors and label eligibility (collision rules still apply).
- **Color registry (2026-07-15):** hash assignment replaced — the 20-hue wheel
  produced near-collisions (adjacent greens/pinks on real data; more hues ≠
  more distinguishable hues). Now a persisted first-seen registry
  (`hostColorOrder` in storage.local): a host's first-ever MEDIUM+ block claims
  the next palette slot, permanent across days ("yesterday's important pink
  document is still pink today"). Clear data resets the registry.
- **Palette = Kelly's max-contrast sequence, cut to 16 (2026-07-15):** a
  hand-built 6-families × 2-lightness palette failed in a day (light/dark
  variants adjacent; hover-brightening faked identities). Kelly's ORDER is the
  point — first N entries always maximally contrast, matching slot claiming.
  Removed white/black/gray + 3 darkest — reddish brown `#882D17`, yellowish
  brown `#654522`, dark olive green `#2B3D26` (converge on noise-gray).
  Hover = glow + mild brighten, never a strong brightness filter; run labels
  use the rim mix (65% color + white) for legibility.
- **Transient colors CONTINUE the Kelly sequence** past the registry
  (first-appearance order, per-render, never persisted) — visible colors always
  form a Kelly prefix, mutually max-contrast by construction. Two hash-based
  fallbacks failed in one day first (probe = funnel: linkedin/gmail/bsky all
  drew vivid red; free-slot hash = sampled late entries, which sit close to
  early ones: gmail's orange-yellow beside gemini's orange). **Rule: non-prefix
  subsets of Kelly void the contrast warranty, and hashing structurally
  produces non-prefixes.** MEDIUM+ gets hard guarantees; LOW gets best-effort.
- **(2026-07-18) HIGH anchoring + tombstones — MEDIUM rationing superseded.**
  Trigger: Scott flagged "a LOT of blue on 3 different websites." Ground
  truth recovered by parsing the extension's LevelDB from disk (the 7-day
  Score table can't reconstruct the cumulative registry): 20 registered
  hosts in four days of use, wrap already begun — youtube (#3) and
  notebooklm (#19) literally shared light blue; docs/gemini shared orange,
  voice/phanpy purple, semble/google yellow. The old comment's bet ("wrap
  pairs are temporally distant in practice") was falsified on day four.
  Compounding: MEDIUM's 50% mix pushes light blue toward the slate noise-
  gray, so collision blue + mixed blue + gray converged.
- Constraint discussion (Scott): ~19 distinguishable hues is a human
  ceiling; patterns were discarded in an earlier session; opacity is
  already spent on tier and is weak anyway. So relax the *demand* side:
  color only what matters. First-cut recycling proposal (tombstone the
  registry at 7 days) treated the symptom; Scott's counter — color only
  hosts with important events, letting their MEDIUMs keep the hue and rare
  MEDIUMs fall to uniform gray — removes the cause. Adopted with two
  data-driven amendments:
  1. **Anchor at chain level, not session level** — raw sessions produced
     ONE high all week (fragmentation), while chain-level (merged visits +
     containers) produced 6 anchored hosts/week, 0–5 per day.
  2. **Anchor over the stored week, not the viewed day** — day-scoping
     would render mornings monochrome (Sat had 0 HIGHs by 9am) and flicker
     hosts across day pages. Week-scoping also turns the 7-day retention
     window into the definition of "recently mattered."
  Tombstones: released slots are nulled IN PLACE (indices are identities);
  new anchors fill the earliest null. Subsets of the 16-Kelly prefix stay
  mutually max-contrast, so sparseness is safe. Migration fell out free:
  anchored hosts keep their existing slots (mail stays pink, youtube keeps
  light blue), the other ~14 entries tombstone on first render.
  Also retired: transient colors and the fence-open/contained-child color
  relaxations (colorOf is now only reached for registered hosts; gray
  fallback is defensive, never a lazy claim). Costs accepted and
  watch-listed: side-quest hue loss (a Paysera payment renders gray —
  fences/labels/height must carry it) and active-host (not forever)
  permanence.

## Fences
- EVERY run of consecutive LOW collapses to 3px sticks — including singletons
  (2026-07-16, was ≥2); MEDIUM+ never fences (§5 side-quest rule — nothing
  important is structurally hideable).
- **Singleton fences (2026-07-16):** the original MIN_RUN=2 rationale ("a
  singleton low is visible without a click") proved to be the noise itself —
  a real day showed isolated LOWs at full height and identity color (worst
  specimen: a score-0, attended-0s 2-min calendar glance drawn as a full blue
  block beside the meeting container; it was a singleton because a >5-min gap
  split on one side and the container flushed the run on the other). Guideline
  adopted (Scott): **opinionated demoting with user exploration** — demoting
  too much occasionally is fine as long as the event stays findable (stick
  keeps hover plate + click-to-expand). Replay of the real day: 7 → 17 fences,
  10 formerly-full LOW blocks now lone sticks. Singleton plates tooltip the
  host, not "1 rapid events". Revert = MIN_RUN back to 2. Watch: whether lone
  sticks feel too quiet.
- **Fence clicks (2026-07-15):** expanded members NAVIGATE like any block
  (click-to-recollapse made fence contents un-clickable). Collapse = expand bar
  (16px hit zone, 4px visual via ::after) or Escape. Click-away rejected
  (navigate + collapse firing together is busy). Collapsing is low-priority by
  design — day-paging will reset fences.
- **Fence runs split at VISIT_GAP_MS** (a fence straddling a 4h absence claimed
  the hole as "5 rapid events") — sprinkled >5-min LOWs render as singleton low
  blocks, not fences. Residual freak case, documented + accepted as not worth
  machinery: two LOWs <5 min apart straddling an hour boundary put one
  gap-scale hour slot INSIDE a fence, where the fence plate wins hover (the
  tick still draws).

## Time axis
- **Hour axis:** whole-hour labels only; ribbon left-pads from the floor hour
  at gap scale so an 8:47 start sits proportionally after the 8am tick.
  Tooltips carry the exact wall-clock span. (Replaced the inherited Desktop4
  behavior — start tick pinned to the ribbon edge with the floored hour label —
  which made an 8:47 start read as 8:00.)
- **PX_PER_SEC recalibrated 0.15 → 0.075 (2026-07-16):** 540px/hr was never
  chosen — it was whatever made the first render legible, and that render was
  a light day (~91 min presence). Scott's thesis, confirmed by projection: the
  lightness was elevating small events, and a normal 3–4-meeting day
  (~4–6h presence) hits 2,500–3,500px. Guideline: **size the scale to a
  normal day so a light day reads light.** Key architectural point: "width =
  time" is a proportionality thesis, not a scale — everything (ticks, gap
  plates, container children) is linear in this one constant. Rejected:
  per-day fit-to-viewport (inflates light days by design — the exact
  complaint — and widths stop meaning the same thing across days, plus live
  re-compression as the day accrues); nonlinear width (log/sqrt breaks tick
  interpolation and width comparability). MIN_W=8 absorbs the small end
  (<~107s renders at the floor). GAP_HOUR_PX held at 44 — one knob at a
  time; presence:absence is now 6:1, watch gap loudness (revert: 44 → 22).
- **Both scales halved: PX_PER_SEC 0.075 → 0.0375, GAP_HOUR_PX 44 → 22
  (2026-07-17):** first full REAL day showed 270px/hr still oversized for a
  one-glance day overview — a 21m35s Gemini block rendered ~97px and read
  much too wide (Scott). Halving both together is a pure 2× zoom-out of the
  layout validated the day before: presence:absence stays 6:1, so the
  gap-loudness watch carries over instead of resetting (the pre-agreed
  44 → 22 knob spent as a ratio-preserver, not a revert). Analysis surfaced
  in discussion: the busy-section dilation Scott flagged is mostly FIXED
  overhead — MIN_W 8 + GAP 2 per floored block, STICK_W 3 + STICK_GAP 1 per
  fence stick — which px/hour cannot shrink, so busy sections compress
  sublinearly and overhead's share of ribbon width grows; if dense stretches
  still read wide, the next knob is overhead, not scale. Floor threshold
  doubles to ~213s (3m33s). Rejected: single-knob 0.05 (absence at 4:1 —
  louder gaps for less zoom-out); shrinking MIN_W/STICK_W in the same change
  (6px blocks hurt hoverability; one step at a time).
- **Crowded hour labels drop the meridiem (2026-07-17):** direct fallout of
  the halving — a 22px gap slot can't hold "12pm" (~28px at 12px font), so
  every multi-hour absence shingled its labels. Noon flips in crowded runs
  are implied by context (Scott). Backstop: greedy left-to-right label
  thinning — a label overlapping the last survivor (+LABEL_CLEARANCE) is
  dropped, never nudged (block-title philosophy on the axis). Ticks are
  never thinned (countable hours are tick-borne). Rejected: tick-only gaps
  (long absences go mute, Scott's first idea, superseded by his bare-number
  refinement); bare numbers axis-wide with 12am/12pm anchors (axis-wide
  format change for a gap-local problem).
  **Revised same day — room-keyed, not gap-keyed:** the first cut labeled
  bare whenever the hour landed in a gap slot; real data immediately showed
  the flaw (four instances): a 10-min tab-away puts an hour in a "gap" that
  has a full presence-hour of empty axis around it — region type isn't room.
  Now every mark tries the full form and drops to bare only when its
  MEASURED width + LABEL_CLEARANCE would cross the next mark's label
  position (last mark always full). No gap tag, no new constants; geometry
  recomputed per render, so future scale turns need no axis changes.

## Day paging
- (2026-07-16) The ribbon is bounded to ONE local calendar day, replacing the
  rolling 24h window — required the moment a second day of data existed
  (a rolling window splices yesterday evening onto this morning). ‹ Today ›
  control in the header; bounds = [oldest stored session's day, today]
  (paging reach = the 7-day retention window, by construction). A session
  belongs to the day it ENDS in (midnight-straddlers are rare and short —
  tab switches finalize). The axis still spans first→last activity of the
  viewed day, never a forced midnight-to-midnight canvas. Paging resets open
  fences — anticipated by the fence design ("day-paging naturally resets
  fences"). Viewing today live-updates; a past day stays put across
  re-renders. Deferred: date-picker jumping; skipping empty days (day-by-day
  stepping shows "No sessions on this day" — honest, and empty days within
  a 7-day window are rare).
- **Two time scales (2026-07-15):** presence at PX_PER_SEC (~540px/hr), absence
  at GAP_HOUR_PX (44px) per absent hour (~1/12) — every gap gets width
  proportional to true duration, ticks interpolate through gaps like through
  blocks, hour boundaries have NO width effect, and the leading pad is
  gap-scaled too. 4h away = 4 evenly spaced countable ticks. Superseded rules,
  same day: tick clamping (shingled labels after a real 4h absence) →
  break-glyph + threshold (glyphs need decoding; thresholds arbitrary) →
  uniform 44px hour slots (binary: a 10-min pause straddling 11am outweighed an
  invisible 40-min boundary-free errand). Label stacking structurally
  impossible; gap hover plate (≥6px) carries the exact away-span.

## Week strip & debug-list removal (2026-07-17, spec'd — not yet implemented)
- **Debug list removed:** its jobs were already covered (worker console dump
  for raw inspection, Score table for tuning, tooltips for per-block detail).
  Hidden-toggle option rejected: an unseen renderer still taxes every schema
  change. Freed space stays open as snapshot-tooltip clearance.
- **What to do with the space — options weighed:** whitespace only (baseline),
  day-summary stat line (cheap, deferred), pinned click-to-inspect detail
  panel (deferred — conflicts with click-opens-page semantics, needs its own
  decision), week strip (chosen — Scott: "high risk/high reward", most
  aligned with the Lifestreams pivot).
- **The core design finding: a mini ribbon must be an abstraction, not a
  miniature.** 7 cells in ~1600px ≈ 14px/hour — below even the gap scale;
  every block lands under MIN_W, so a scaled pipeline draws only floored
  noise (Scott's legibility concern, confirmed by arithmetic before any
  code). The cell therefore draws only the ribbon's top edge — the
  importance contour: per 15-min bin, a bottom-flush bar at the max band of
  any overlapping session, tier proportions 0.6/0.8/1.0 (~18/24/30px on a
  30px strip). Evolution within the discussion: started as a pure heat/
  intensity strip; Scott asked to keep the ribbon's tier heights; reframed
  as skyline/contour — height is the one encoding variable, single neutral
  color (host hue unreadable at ~2px/bin; intensity+height double-encodes).
- **Linear time, one shared trimmed window across cells** so hours align
  vertically across days (cross-day rhythm is the payoff two-scale can't
  give). Accepted consequence: cells match the ribbon vertically, never
  horizontally — strip answers WHEN, ribbon answers WHAT. Scott's three
  concerns → answers: legibility (abstraction, not miniature), horizontal
  fit (fixed cells, grows 3→7 with retention), day boundaries (bordered
  cells + weekday labels, structural).
- **Raw bands via FS_SCORING, never the display pipeline:** the strip must
  not fork/invoke merging+containers to harvest tiers. Accepted divergence:
  container days skyline lower (meeting = MEDIUM fragments raw, HIGH
  container in ribbon) — watch-listed; candidate fix is extracting banding
  (not layout) into a shared step.
- Interaction: click cell = jump day paging there; ‹/› retained (strip not
  load-bearing on day one). Today's cell live-updates on the local-area
  repaint.

## Visit merging
- (2026-07-15) Consecutive same-host LOW blocks merge into one visit block
  scored on MERGED totals, before fencing — repairs SPA-debounce fragmentation
  (10 Maps minutes = one MEDIUM, not 11 fenced slivers). MEDIUM+ never merges:
  the visit splits around it (a long email inside a Gmail hour stands alone).
  **Max-gap rule:** members must be <5 min apart (VISIT_GAP_MS) — a 2s re-peek
  9 min later must NOT stretch the visit's span.

## Container events
- (2026-07-15) A tab the user keeps RETURNING to is a journey context
  (evidence: a 30-min meeting rendered as 4 disconnected MEDIUMs — tab-switch
  fragmentation + "MEDIUM+ never merges" compose wrong for recurring contexts).
  Same-tabId fragments chain (gap < VISIT_GAP_MS, or < AUDIO_BOOKEND_GAP_MS
  30min when both bookends are audible-dominated ≥50% — a meeting's audio
  testifies through a long whiteboard excursion; chosen over a background
  audible log: same power, no capture change). Summed score ≥ HIGH → container:
  width = SPAN (the width-rule exception), children = foreign events inside,
  drawn on top, colored, tier capped at MEDIUM, no fences/labels inside,
  hover+click everywhere.
- Guards for the big-email case: ≥1 interruption required (see revision below);
  individually-HIGH events never chain; same-tab HIGH inside span rejects the
  chain. Registry colors + coloredHosts judged PRE-containment.
- **(2026-07-16) Guard 1 revised: departure-boundaries count as interruptions.**
  Evidence: a real 43-min Jitsi meeting — 14 same-tab fragments, every gap
  < 5 min, summed score 2492 — chained perfectly and died on "≥1 foreign
  child": every tab-away went to another app or the extension's own dashboard,
  both invisible by design (finalize as `tab_hidden`, render as gaps, not
  events). The old rationale ("else visit-merging applies") was false for
  MEDIUM fragments — visit-merging refuses MEDIUM+ — so meetings fragmented
  into MEDIUMs fell into a structural crack between the two mechanisms. And
  the chain already *proves* the interruptions: 13 departures-and-returns,
  returning being the intent signal. New rule: interruption = foreign child
  OR a non-final fragment ending `tab_hidden`. `spa_navigation`/`navigated`
  boundaries never count (attention stayed; the page turned over), so
  continuous same-tab reading still can't self-containerize — verified with
  a control replay (same 14 fragments, spa_navigation reasons → 0 containers;
  the real reasons → 1 container). Merged visits now carry their last
  member's `endReason` so merged-LOW fragments testify too. Zero-children
  containers tooltip as "(interruptions outside the browser)". This also
  resolved the watch-list "all-transit-interruptions gap" — the stronger
  specimen (zero visible events at all) arrived first.
- Display: 25% wash of host color + 2px full-strength border (border carries
  identity; color weight = saturation × area, and children then sit on
  near-dark ground so the Kelly dark-bg contract holds); hover lifts wash to
  35% instead of brightening (children stay stable).
- §5 note: technically gap-tolerant merging, which §5 forbids — but §5 forbids
  it for *hiding* interruptions; containers keep every interruption visible,
  framed.
- **(2026-07-17) Zero-children containers render solid.** Evidence: a real
  Jitsi meeting drew as an empty 25% wash — a style that reads as "excursions
  inside" with nothing inside (Scott flagged it as an apparent rules
  conflict). Resolution separates two decisions that had been conflated:
  *grouping* (the departure-boundary rule — structurally correct, kept) and
  *fill style* (the wash + 2px border exists to give contained children
  near-dark ground so the Kelly dark-bg contract holds — a rendering
  contract, not an attention claim). With zero visible children the contract
  never activates, so the block takes the normal solid fill/rim/hover.
  Rejected alternative: keeping the wash as an "attention was interrupted"
  signal — the tooltip already tells that story, and an empty wash reads as
  a bug, not a signal. One-line gate in the render loop: `isCont` requires
  `children.length`, not just the (always-truthy) `children` array.
- **(2026-07-17, later same day) Wash retired entirely; tier brightness +
  cut-out children.** The zero-children rule above is SUPERSEDED — solid is
  now how every container paints. Scott's driving discomfort: a container
  looked "substantially different" from a non-container HIGH even though
  both are equally important. Two coupled decisions:
  1. **Tier brightness** — HIGH = full host color, colored blocks below
     HIGH = `color-mix(in srgb, host 50%, page bg)` (`MEDIUM_MIX_PCT`).
     Deliberately OPAQUE paint rather than alpha: color-mix against the
     page background computes what 50% opacity *would look like* over the
     ground but is ground-independent, so a contained MEDIUM matches its
     standalone twin exactly and nothing alpha-blends with the container
     fill beneath it. (Alpha was also viable once the ribbon grid was
     dropped — grid conflicted with the variable x-axis — but opaque is
     the principled choice.)
  2. **Cut-out children** — containers paint identically to any HIGH
     block; children keep their own tier paint and are separated by a 2px
     page-background border seam (`.cut`), "cut out from the interior of
     the meeting" (Scott's framing). This replaces the wash's near-dark
     ground as the mechanism keeping children legible.
  Child brightness follows the DISPLAY tier (capped MEDIUM → dimmed), not
  the true band — chosen for consistency over salience; the fallback if
  HIGH excursions get lost (brightness-follows-true-band, height cap
  stays) is watch-listed along with palette compression at 50%.

## Resumed-read containers — PROPOSED 2026-07-16, CLOSED 2026-07-18 (subsumed)
- (2026-07-18) Closed during the rules restructure: the general container
  path now fires at sum ≥ MEDIUM with anchor dominance, covering the
  out-and-back read without the special same-URL trigger. The same-URL-
  anchor restriction survives as a spec watch-list tightening knob.
- The out-and-back read (article-M → detour → same-article-M) as a second
  container trigger. Key insight (Scott): containers map the **journey's
  shape**, tier maps importance — orthogonal axes, so sub-HIGH containers are
  legitimate. Rule on file in spec §6: same tabId + same URL anchor (a
  document, not a site — tabId alone over-collapses news-portal daisy-chains),
  ≥2 MEDIUM+ fragments, <5-min gaps, ≥1 foreign child, **anchor dominance**
  (anchor sum > children sum — when detours outweigh the anchor, the anchor is
  a launcher and the children are the story). Tier = bandFor(sum), floor
  MEDIUM. Dominance deliberately NOT retrofitted onto the HIGH/meeting path.
- Method note: first rule designed AND validated entirely offline — chain
  columns (tabId/start/reason/url) added to the Score table, a real day
  replayed. Zero fires, zero misfires; one genuine launcher specimen
  (email → keltas purchase flow → email) dominance-rejected 162-vs-21.
- Deferred for lack of a positive specimen (SPA-merge precedent). Also on
  record: a false alarm during this analysis — the replay script tested the
  candidate rule and its failure was wrongly extrapolated to the live rule;
  running the REAL pipeline showed the audio-bookend bridge containerizing
  the 2026-07-15 meeting correctly (5 visits + 6 excursions). Lesson: replay
  the actual pipeline, not a reimplementation, before claiming a defect.

## Transit filter (display side of capture filtering)
- (2026-07-15) Display-time, deliberately NOT capture — auditable via the Score
  table; promote once trusted. Sessions <10s (one heartbeat window = the
  attention quantum) with no audible and no high-intent discrete signals
  (kbd/cut/copy/paste/download) are dropped in parseSessions. Clicks/mouse/
  scroll don't save it (a click is how you leave a page); neither does a
  flush-artifact heartbeat. Catches OAuth hops, SSO choosers, consent bounces —
  no host special-casing. Cost: a sub-10s purely-visual glance drops too.
- (2026-07-18) **Audible no longer saves a sub-10s session.** Trigger: a 4s
  YouTube autoplay bounce (clicked from a Gmail message, 3s audible) rendered
  in the timeline but could never get a snapshot (sessions ending before the
  first 10s heartbeat only send flush-on-hidden, which is barred from
  capturing — wrong-tab trap). Question raised: if it can't snapshot, should
  it display? Answer: display is about intent, not snapshot mechanics — but
  audible failed the intent test. Autoplay is the *page's* action, not the
  user's (same logic as clicks-don't-save, only stronger). Score-table audit
  of 7 days (576 sessions): only 5 sub-10s sessions were audible-saved, all
  autoplay/join noise (2× Jitsi join blips, LinkedIn feed autoplay, YouTube
  bounce, Google Voice chirp); zero deliberate short listens. The one real
  short YouTube interaction (8s, aud=8 kbd=1) survives via keyboard.
- (2026-07-18) **Threshold stays 10s — Scott's tightening question examined
  and declined with data.** Hypothesis: most sub-10s drops are <6s, so the
  rule could shrink. Reality: 207 sub-10s sessions distributed nearly flat
  (per-sec 1–9s: 20/35/32/26/29/16/15/19/13), with 63 (30%) in the 6–9s band
  and the decay continuing smoothly above 10s (5–13/sec at 10–15s) — no
  natural boundary anywhere; the heartbeat quantum is the only principled
  rung. Content check of all 63 in 6–9s: overwhelmingly inbox glances,
  notification checks (LinkedIn/Bluesky/Phanpy), keltas.lt booking hops,
  Paysera payment interstitials, calendar peeks — exactly the machinery the
  filter exists to drop. Purposeful visits in that band already survive via
  discrete signals (keltas form hops kbd=2, Phanpy reply kbd=1 click=3).
- (2026-07-24) **Terminal-keystroke discount.** Specimen (Scott, tab-cleanup
  after a walk): a 1s OpenStreetMap glance closed with Cmd+W rendered as a
  LOW stick, score 11, attended 10s. The Cmd+W keydown reached the page
  before the tab died, stamping `kbd=1` — the exact signal that exempts a
  session from this filter. The keyboard exemption was admitting the act of
  leaving.
  - **Rejected: ignore chorded keydowns at capture** (Claude's first
    proposal). Scott's counter: chords ARE engagement — Cmd+F is searching
    within the page; cut/copy/paste being tracked proves chords can be
    high-intent. Rejected outright.
  - **Rejected: require kbd ≥ 2.** A count-threshold proxy; punishes a
    genuine lone keystroke and, applied at capture, would miscount chords in
    every session's score, not just transit-length ones.
  - **The reframe:** what distinguishes the close chord is WHEN, not WHICH —
    a signal coincident with the session's death testifies to departure, not
    engagement (the click rule's timing-based generalization). That timing is
    unknowable at display from stored counts, so: **capture records the
    evidence, display makes the judgment** (matching this filter's
    "auditable via Score table" philosophy — the earlier idea of silently
    decrementing the count at capture destroys the evidence).
  - **Mechanics:** content script tracks the last counted keydown's
    timestamp (relay frames forward theirs); flush-on-hidden carries
    `lastKeyGapMs`; the worker stamps it on the session. Display discounts
    exactly ONE keystroke when `lastKeyGapMs` ≤ `TERMINAL_KEY_MS` (500ms,
    provisional) before the exemption test. Typing-then-Cmd+W keeps its real
    keystrokes; Cmd+F engagement is untouched (no flush follows a mid-session
    chord). Audit column `keyGap` added to the Score table.
  - **Companion capture fix** (pure-modifier keydowns no longer count —
    without it a fresh Cmd+W is TWO keydowns, Meta then W, and a one-key
    discount can't drop it): story in `plans/capture_design.md`.
  - **Known edge, accepted:** a held auto-repeating key ending the session
    leaves kbd > 1 with only the last gap recorded — discount lifts one,
    session may still admit. Rare; revisit with keyGap data if it shows up.
  - Old data has no `lastKeyGapMs` and keeps the old behavior until pruned.

## SPA-continuation merging — CLOSED 2026-07-18 (subsumed)
- (2026-07-15, Scott) Continuous Gemini typing fragments into adjacent MEDIUM
  blocks (SPA URL churn >15s apart splits sessions; visit-merge is LOW-only,
  containers need foreign interruptions). Proposal on file in spec §6 (merge
  same-tab spa_navigation-linked MEDIUM+ pairs) — deferred: only 2 SPA
  examples, over-merge risk > fragmentation. Collect SPA endReason/band data
  first.
- (2026-07-18) Subsumed by the continuation merge rule — see "Continuation
  merge + MEDIUM containers" below. The awaited data arrived at scale: 318
  of 652 sessions in a week were continuation fragments.

## Continuation merge + MEDIUM containers (2026-07-18)
- Trigger (Scott): three back-to-back YouTube videos and a set of Phanpy
  visits rendering as separate slivers; only 1 HIGH event on most days felt
  overly restrictive ("2–3 important a day would be more helpful"). Chose
  fixing grouping over lowering score thresholds (one knob at a time).
- Reframed "never join runs" from the original §5 arguments: the ban was
  never on combining, only on combining-ACROSS-something (A→B→A must keep
  its interruption). Two cases fall through the existing mechanisms' crack
  (visit merge = LOW-only; containers = same-tab sum≥HIGH):
  1. **Unbroken run** (machinery boundaries, attention never left) → JOIN.
     Defined by boundary REASON, not gap size: `spa_navigation`/`navigated`
     merge; `tab_hidden` never does (a real departure → container
     territory). Same fact the container guard already trusts, read
     forward as a merge license. Individually-HIGH splits the run
     ("MEDIUM+ never merges" narrowed to "HIGH never merges" — a same-host
     continuation is one thread, not a side-quest; side-quests are foreign
     by nature).
  2. **Broken run** (real departures) → containerize at sum ≥ MEDIUM
     (Scott's own orthogonality insight from resumed-reads: shape vs
     importance). Sub-HIGH chains require anchor dominance (anchor sum >
     children sum), imported from the resumed-read design where it was
     built for exactly this launcher risk. HIGH path untouched.
- Offline replay of both rules against a full week (scores6.tsv, 652
  sessions; approximation of the pipeline — eyeball the live dashboard
  against these numbers): rule 1 fired 103 times (318 fragments → 103
  visits), 18 band promotions incl. three new HIGHs (9-page Gmail morning
  1228; 6-page YouTube 1041; a 22-page/23-min YouTube run 1569 that had
  rendered as 22 slivers). No misfires on eyeball (keltas/Paysera payment
  hops merged into tidy LOW groups). Rule 2 at MEDIUM fired 24 raw;
  dominance rejected exactly the 5 launcher patterns (two weak keltas
  containers framing 21 and 5 children, Gmail-as-launcher 293-vs-814,
  LinkedIn hop, Google-search springboard — incl. the interleaved
  shop/pay ping-pong where keltas and Paysera each tried to containerize
  the other's fragments); 19 legitimate MEDIUM containers survived
  (~5/day: Phanpy sets, YouTube clusters, a 15-min Zoom, calendar checks).
  Combined effect: 1–3 HIGH-level events per day (was 0–1) with no
  threshold change.
- Cost accepted, watch-listed (Scott): a MEDIUM email composition inside a
  long Gmail run now merges into the run — the "show key email" case.
  Kept mitigations: individually-HIGH splits; click opens top-scoring
  member; tooltip page count. Candidate fix if data demands: surface
  MEDIUM+ members inside merged blocks.
- Implementation: `mergeVisits` gained the second license (CONTINUATION_
  GAP_MS = 30s sanity bound, MACHINERY_BOUNDARY set; runs may now mix
  bands, HIGH pushed straight through); `detectContainers` threshold
  HIGH→MED_SCORE, dominance guard for sub-HIGH chains, `band:
  bandFor(sum)` instead of hardcoded "high". Render side needed nothing —
  paint is band-driven (a MEDIUM container gets the 50% mix; children cut
  out as before).

## Tooltips & snapshots
- Custom tooltip layer (uniform 300ms; native title warm-up uncontrollable)
  implemented 2026-07-15; snapshot previews implemented 2026-07-16. Full story
  (reasoning, knobs, as-built shape): `plans/snapshot_implementation.md`.

### Two-section tooltip (2026-07-18)
Scott: as the demo matures, the tooltip's debug soup has to go — "they want
the important stuff to be important... they don't need to know how the
sausage is made." The split: a user section (bold invariant site name, start
time + duration — no end time — then the thread's pages) and a debug section
(smaller/grayer: activity counts, score/band, attended, thread counts, exact
span, URL) gated by a `TIP_DEBUG` constant, on through the demo.

Decisions along the way:
- **Intent-in-words rejected.** I proposed translating signals to plain
  language ("typed here · copied something"); Scott argued even interpretable
  signals give users nothing actionable — the tiers should carry the
  judgment. All activity stays compact, debug-only.
- **Member pages ARE user-facing.** The one addition Scott wanted: a
  container/merged thread (YouTube run, Gmail run) showed only its
  top-scoring member's title. Naive ideal ("watched 12 videos", "read 17
  emails") needs an unknowable verb — site-specific logic, refused. The
  generic noun is free: the members list already holds one title per page
  that survived capture. Titles are deduped (best score wins), listed
  **sorted by score descending** — importance order, chronology stays the
  ribbon's job — capped at 8 with "+N more". LOW pages render dimmed
  (the ribbon's brightness-equals-tier vocabulary carried inside the
  tooltip); scores append to each title only under `TIP_DEBUG`, which is
  the evaluation period for whether fragment score is a trustworthy
  key-email proxy (interaction scores surface a replied-to email; a
  silently-read important one only earns scroll + duration).
- This gives the watch-listed **key-email use case its first home**: the
  ribbon shows that Gmail mattered; hover shows *which* email, no ribbon
  machinery needed.
- Undercount accepted as philosophy: the page list counts pages that
  *held* attention (survived SPA debounce + admission), so inbox-skimming
  Gmail reads ~7 when 17 were touched, while YouTube counts are near-exact.
  Same rule as everywhere: we count what attention held, not what flipped
  past.
- First specimen (a 22-page YouTube merge) demanded two refinements: strip
  leading unread counters ("(379) " on every title — churning counters also
  defeat dedupe) and the boilerplate site-name segment ("- YouTube") the
  bold headline already states — both generic patterns (the Voice/Gmail
  counter class), no site-specific logic; and one-line CSS ellipsis per
  title (the debug score sits in its own flex span so long titles can't
  truncate it away).
- **Child context line (2026-07-18, same day):** a Phanpy container showed
  two adjacent Gemini children — actually two separate excursions split by a
  10-second return to Phanpy that renders at 0.4px (sub-pixel at presence
  scale; both children floored to MIN_W). All rules fired correctly, but
  Scott — the person who did it — was confused: "I literally did not
  remember going back and forth." Framing that stuck: capture's fidelity
  exceeds memory's, so the display's job includes reconciling the two, and
  the tooltip is where the system explains itself. The ribbon provoked the
  right question and the tooltip failed to answer it — fixed by giving
  contained children a context line ("↩ interruption inside Phanpy · visit
  2 of 2"), wired via a `parent` ref on child segs.
  Discussed and DEFERRED: collapsing the toggles themselves. The system has
  an asymmetry — a sub-quantum foreign glance isn't even an event
  (admission filter), yet a barely-quantum anchor-return splits an
  excursion in two. The debounce rule writes itself (sub-quantum
  anchor-returns don't testify as separations; same-host children join;
  the return stays in container time) and Scott's non-memory of the toggle
  is evidence it's sub-event — but held on ONE specimen with an untuned
  threshold (this return was exactly 10s, so a strict `<10s` rule wouldn't
  have caught it). Watch-listed; the context line buys the waiting time.
- Mechanics: `tipDataOf()` replaces the flat `tooltip()` string; blocks
  carry the structure as a JS element property (`_tipData`) with `data-tip`
  kept as the empty hover marker; gaps/plates/bars keep plain strings via
  the `fillTip` fallback. One div per line, all `textContent` — the
  injection rule survives the formatting upgrade.

## Scope holds
- No zoom; day paging shipped 2026-07-16 (see "Day paging"), date-picker
  jumping still deferred.
- `parentId` / opener-tab tracking deferred; no tree/branching view.
- Expandable visit blocks: possible later addition (visit merging bullet).
- The spec's original "Final timeline (for later implementation)" sketch
  (weighted-sum display score → CSS size, massive high-value nodes,
  favicon-only slivers, click-to-open) was removed 2026-07-17 during the
  rules-only slim-down — fully superseded by the implemented Phase 3b
  design; text in git history.

## Display rules restructured thread-first (2026-07-18)
- SPEC §5/§3/§6 rewritten around the boundary taxonomy + thread-as-atom
  model; blip+transit unified as the two-rung admission filter; resumed-read
  containers closed as subsumed. Full verdict, alternative rule set,
  amendments, and loose ends: `plans/rules_restructure.md` (ADOPTED). This log's older sections describe the pre-restructure rule
  names; the rules themselves are unchanged.

## Post-restructure code review (2026-07-18)
- Re-read timeline.js against the thread-first rulebook. Verdict: behavior
  already thread-shaped; no rewrite. Four findings, all acted on:
  1. **Absence-bridge join ignores tabId** — genuine rules/code divergence
     (the LOW merge predates tab-thinking). Decided: spec amended, code
     unchanged — LOW grazing is site-level behavior; requiring same-tab
     would fragment noise for purity's sake. Recorded as the one licensed
     exception to the thread's one-tab definition.
  2. **Thread definition overstated departure joining** — sub-qualifying
     departure chains don't assemble (correctly; the guards exist to
     refuse weak frames). Spec sentence now says "by framing only."
  3. **Assembly had no name** — extracted `assembleThreads(events, quiet)`
     (= detectContainers∘mergeVisits) + `threadsByDay(sessions)`;
     `computeAnchoredHosts` decomposed into threadsByDay +
     `anchoredHostsFrom`. The viewed day still assembles separately and
     loud, so worker-console transit/container logs stay tied to the day
     on screen (accepted double assembly, ~1ms).
  4. **Week strip was the last thread-blind surface** — Scott visually
     confirmed the skyline diverged from the ribbon the same day. The
     strip now bins thread bands from the shared threadsByDay step
     (rank from `t.band`, no re-scoring); meeting/container days skyline
     like their ribbon. Watch item resolved.
- Follow-on bug (same day, Scott's screenshot): a "Jenson.org Mail" label
  floated over Thursday's 8-hour away gap. Not stale data — groupRuns
  merged morning and evening Gmail clusters into one title run because
  they're ADJACENT in seg order (nothing renders between them), centering
  the label mid-gap; the "rectangle" was just the away plate's designed
  hover whisper. Pre-dated the day's changes; first layout extreme enough
  to expose it. Fix: runs split at gaps ≥ VISIT_GAP_MS (same constant and
  logic as fence splitting), via a lastEnd timestamp on the run.

## Doc structure (2026-07-17)
- Spec §6 rewritten rules-only (44KB → ~21KB): evidence, history, and
  rejected alternatives moved here; #### subsection anchors added for
  targeted partial reads. Discipline going forward: a new decision lands as
  2–4 rule sentences + date in the spec, full story in plans/ — never both.

## Own-host HIGH chaining (2026-07-19)
- **The specimen (Scott's morning, 2026-07-19):** composing a thoughtful
  Bluesky reply 7:44–8:14 while ping-ponging to Gemini for help. One lived
  story — "it really was a Bluesky chain and I just used Gemini a lot" —
  but the rules produced two rival containers and gave the territory to
  the tool: gemini 7:59–8:05 (sum 924) containerized with two *Bluesky*
  fragments as its children, backwards from intent.
- **Mechanism:** atomicity guard 1 ("individually-HIGH never chains")
  removed the Bluesky thread's two HIGHs (1290 + 1025 = 2315 points)
  before chain-building, leaving a rump chain of 455 that lost the
  overlap contest 455 v 924. The third rump fragment (8:05, score 175)
  ended 9s past the winner's edge — not a member (chain rejected), not a
  child (not fully inside the span), not joinable to the HIGH next door —
  and rendered as an orphan block, which is what Scott noticed and asked
  about. Guard 1's own success decapitated the true anchor.
- **Scott's framing:** "as soon as one run becomes important it now stands
  apart" — wanted one important thread able to subsume another, worried
  this needed a top-down mechanism over the bottom-up assembly.
- **Resolution — no new mechanism:** guard 1 conflated "a HIGH must never
  be hidden/framed by something foreign or weaker" (the big-email
  protection, correct) with "a HIGH may never associate at all" (the
  decapitation). Split them: a HIGH may seed or join **its own host's
  chain in its own tab**; a foreign-host same-tab HIGH now CLOSES the
  chain (previously it was skipped and a chain could bridge across it,
  caught only by the span-cover rejection — that rejection is now
  structural). Territory contests are then fought with full evidence and
  the overlap rule already picks the right winner: bsky 2881 v gemini 924.
- **Validation (same method as the dominance guard):** replayed the whole
  stored week from the Score-table TSV, current v variant. Two days
  unchanged; three diffs, each a truer reading:
  - 07-19: one bsky container 7:44–8:14 (7 frags, 2 HIGHs, 3 gemini
    children, sum 2881) replacing the backwards gemini frame — exactly
    the session as lived.
  - 07-18: gemini 16:33–17:11 (2 HIGHs, 6 children, 3812) absorbing the
    smaller 16:51–17:00 container — one long working session.
  - 07-16: mail 6:12–6:32 (1 HIGH, 4 children, 1419) — morning triage
    framing calendar checks; the big-email case's own territory, behaving
    (interruptions still required, so an uninterrupted composition still
    can't self-containerize).
  No pathological fusions of two distinct HIGH stories appeared.
- **Risks & knobs (watch list, container entry widened):** two distinct
  HIGH watches on one host can now fuse — the audio-bookend bridge is the
  main exposure (two long videos < 30 min apart). Knobs held in reserve:
  HIGH joins via `VISIT_GAP_MS` only, or the resumed-read same-URL
  restriction.
- **Display trade accepted:** the two HIGH towers become one HIGH-tier
  container at span width; the compositions stay distinguishable in the
  tooltip's score-sorted page list. The return IS the story.

## Overlap trim-and-retest (2026-07-19, same session as own-host HIGH chaining)
- **The specimen (07-18, 17:12–17:46):** Scott's layered afternoon —
  started in Bluesky, took what he learned to Gemini, acted on THAT in
  Google Sheets, eventually returned to Bluesky. The bsky chain
  17:12–17:25 (7 frags, sum 1453) qualified but lost the overlap contest
  to gemini 17:21–17:37 (sum 1619) — and winner-take-all rejected it
  WHOLESALE: a 13-minute chain destroyed over a ~4-minute seam. The
  fragments inside the gemini span became its children (correct); the
  uncontested 9 minutes before 17:21 shattered into unframed sticks
  (the thing Scott noticed).
- **Scott's read, adopted:** no über-container nesting the whole episode —
  "it really was a Bluesky block that then went into a Gemini block, and I
  just happened to return. That's the calmer, less complicated way to
  interpret what I was doing." Sequential handoffs, flush blocks. The
  Sheets visits stay children of Gemini (he went there to act on Gemini's
  output — framed, not peer).
- **Rule:** when a qualifying chain loses an overlap contest, trim instead
  of discard — drop fragments overlapping any accepted container, split
  the survivors into runs wherever an accepted container sits between
  consecutive fragments, re-sum each run of ≥2, and re-insert into the
  score-ordered worklist. Boundary-straddling fragments (overlap the
  winner but aren't span-covered) drop out of the chain and render as
  standalone blocks — rare, accepted. Termination: an overlap guarantees
  every trimmed piece is strictly smaller than its chain.
- **Validation (week replay, current v trim):** exactly two new containers
  all week, both true positives — bsky 17:12–17:21 x6 sum=1221 (the
  specimen, now flush against its Gemini successor) and mail 08:23–08:24
  sum=212 on 07-16 (recovered from a chain that lost to keltas.lt). All
  other days byte-identical, including 07-19's morning mega-container.
  No fragment-dust containers appeared; the losing bsky return-chain
  (17:35–17:46) correctly failed re-qualification and stays as blocks.
- **Relation to the morning's HIGH fix:** same root phenomenon (interleaved
  threads contesting a seam), two different failure modes — decapitation
  fixed by own-host HIGH chaining, shattering fixed by trim-and-retest.
  Between them, ping-pong episodes now read as: biggest thread frames the
  overlap, neighbors frame their own uncontested runs, handoffs sit flush.

## Contained LOW children collapse to sticks (2026-07-24)
- **The specimen (07-23 screenshot):** the Activitypub Groups container and
  the Jenson.org Mail container both shredded by evenly-spaced gray bars — a
  frequent-toggling morning where every brief glance away landed back inside
  the anchor's span. Every bar was LOW, yet together they read as a wall of
  significant events. Scott: "if everything becomes important, the value is
  lost."
- **Diagnosis — display, not scoring:** nothing was being promoted. The
  container display rule ("no fences or labels inside") made containers the
  ONE surface where the LOW vocabulary is violated: a glance that anywhere
  else on the ribbon collapses to a 3px stick instead got `MIN_W` block
  width at full LOW height plus a 2px seam per side. A dozen glances = a
  dozen framed gray blocks slicing the anchor into ribbons. The original
  intent ("an interruption during a HIGH task is significant") is already
  handled correctly by the taxonomy: a side-quest carries its own MEDIUM+
  signal and keeps cut-out prominence; a LOW child is a graze that happened
  to land inside a span.
- **Why the fence objection dissolved:** the first instinct was to fence the
  lows, rejected because interspersed children aren't consecutive — fences
  group runs, and anchor returns separate every child. But singleton fencing
  (2026-07-16) means a lone LOW already collapses to a lone stick: no
  grouping is needed, just per-child demotion to the existing stick
  vocabulary. Non-sequentiality is moot.
- **Rule (spec §6):** LOW children keep the cut-out mechanics
  (time-proportional position, seam, z-order, context line) but render at
  `STICK_W` interior width, stick-gray (`STICK_FILL`) regardless of host
  color, LOW stick stature. Unlike collapsed fence sticks they stay live
  blocks — full tooltip, snapshot, click-to-open — because hover IS the
  recovery path ("opinionated demoting with user exploration"). MEDIUM+
  children untouched (§5 side-quest rule / atomicity guard 2).
- **Rejected alternatives:** drop LOW children entirely (violates §5 —
  interruptions are framed, never hidden); click-to-expand container with a
  "+9" badge (a second expand interaction duplicating what hover already
  gives); repetition-decay significance heuristics (solves a problem scoring
  doesn't have — the inflation was purely display).
- **Escalation path (watch list):** if ping-pong containers still read busy,
  same-host stick aggregation (one stick + "×N") is next; independently, the
  deferred sub-quantum anchor-return debounce would reduce stick count by
  joining same-host children split by ~10s returns.

### Same-day revision (2026-07-24, after Scott verified round 1)
- **Sticks alone barely calmed the comb:** per glance the dark material went
  from an 8px block to a 7px seam+stick slit at unchanged height — pitch
  down ~12%, texture intact. Scott: "it's better... just not by much."
- **Two knobs turned, one idea rejected:** the proposed contained-only notch
  height was rejected on vocabulary grounds — two LOW heights imply FOUR
  importance levels, not three. Adopted instead: (1) **global LOW lowering**
  (`TIER_H.low` 86 → 40) — one height per tier stays invariant, and every
  LOW surface (collapsed sticks, expanded fence members, contained sticks)
  calms together; (2) **transparent seam** — the stick's 2px `.cut` border
  goes `transparent` with `background-clip: padding-box` (without the clip
  the fill would paint under the border), so the container's color shows
  through and the visible slit is 3px while the hover box stays 7px.
- **Width-inflation trade accepted explicitly:** the 7px hover box inflates
  dense containers vs a true 3px footprint, but "this issue is centered
  around visual clutter... we haven't had too much trouble with things
  being overly wide yet" (Scott). Revisit under the existing
  fixed-overhead-dilation watch if that changes.
- **Escalation C (same-host stick aggregation) stays in reserve** on the
  watch list — count is the one variable height and seam can't touch.
- **Third knob, same day:** with LOW at 40, MEDIUM 115 read too close to
  HIGH 144 — re-seated at the LOW/HIGH midpoint (92), making the three
  tiers equidistant (40 / 92 / 144, 52px steps).

## Fence split goes plate-based (2026-07-24, round 3 of the calming session)
- **The specimen (07-24 screenshot, 6–7am):** two stick clusters flanking
  localhost, each visually one group but internally split into multiple
  fences by 5–15 min member gaps — expanding "one" cluster took several
  fiddly clicks on adjacent small plates.
- **The insight:** the 5-min fence split (`VISIT_GAP_MS`) was protecting a
  hover plate that doesn't exist. Gap plates skip slivers (< 6px), and at
  22px/hr a gap needs ~16.4 min to render 6px — so every 5–16 min gap split
  the fence while rendering as a plateless sliver: all cost (shattered
  targets), zero benefit.
- **Rule:** fences split at member gaps whose RENDERED width earns a plate
  (≥ `GAP_PLATE_MIN_PX` = 6, shared with the gap-plate sliver rule;
  `FENCE_SPLIT_GAP_MS` derives from it, so the threshold self-adjusts with
  `GAP_HOUR_PX`). "Never steal a gap's hover plate" now holds by
  construction: a fence can only span gaps that were untargetable anyway.
  Away detail inside a merged fence reappears on expansion (members lay out
  normally, gap plates return).
- **Vocabulary casualty:** plate tooltip "N rapid events" → "N brief
  visits" — a fence can now span quiet minutes, and members are visits in
  the §6 sense anyway. `VISIT_GAP_MS` itself untouched (absence-bridge
  merging, label-run splitting).
- **Scott's framing, adopted:** "expanding two adjacent fences has little
  downside and makes for a bigger easier target" — opinionated grouping,
  recoverable by expand.

## Fences bridge breaks, split at departures (2026-07-28)

**The specimen (07-28 screenshot, 6:35–8:53am):** a scattered grazing
morning — mail/calendar/localhost sticks with breaks between — rendering as
three separate fences. Scott: "it's a bit tedious to open a range of low
fence items with breaks. It's a fairly common pattern."

- **The insight:** the 07-24 rule above tied two things that don't have to
  be tied — (1) the gap stays hoverable, (2) the fence doesn't span it.
  Only (1) is load-bearing; (2) was just the mechanism that guaranteed it.
  A fence plate and a gap plate can coexist in one span if precedence is
  explicit, so the guarantee can move from *geometry* to *layering*.
- **Scott's distinction, which set the threshold:** there are two kinds of
  break — a step away, and an intentional walk away from the machine
  (lunch). The hover-plate protection matters for the second and is
  pointless for the first. That makes the constant a fact about the USER,
  not about the render — hence wall-clock `FENCE_BRIDGE_GAP_MS` = 30 min,
  deliberately NOT derived from `GAP_HOUR_PX` the way its predecessor was.
  Retuning the absence scale must not silently redefine "lunch".
- **The evidence (Score-table TSV, 2120 sessions):** the 07-28 morning has
  exactly three gaps over the old ~16min split — 19.0 and 20.9 min (plus a
  14.1 that already didn't split). Everything else across 2h18m is under
  8 min. The histogram is cleanly **bimodal**: grazing rhythm < 8 min,
  genuine step-away 19–21 min, nothing in between. So any threshold from
  ~22 to ~40 min produces an identical result on this day; 30 sits
  mid-dead-zone rather than on an edge. Three fences → one.
- **Method note worth keeping:** the pixel estimate off the screenshot said
  "50–110 min gaps, probably won't all collapse" and was wrong — those wide
  blanks were mostly neighbors' *presence* width, not absence. Reading the
  TSV flipped the answer. Measure the absence scale, don't eyeball it.
- **Rule:** fence spans any member gap < `FENCE_BRIDGE_GAP_MS`, splits at
  anything longer. The same constant gates the gap hover plate, so a
  collapsed fence owns its entire span as ONE hover target by construction.
- **Rejected first cut — plate layering (same day):** the initial fix kept
  the gap plates and painted them *over* the fence plate, on the theory that
  "never steal a gap's hover plate" (07-24) still had to hold. Scott, on
  the 7am fence: "it seems to alternate between hovering on the gaps and
  hovering on the fence… I would think there would only be one hover target
  for the entire fence." Correct — `allocGap` runs per fence member, so a
  bridged fence emits a gap region between every pair of sticks, and
  layering made the cursor cross away/visits/away/visits across the run.
- **The lesson worth keeping:** the old invariant was imported without
  re-testing its premise. It was free only while fences spanned solely
  *untargetable* slivers — a spanned gap had no plate to lose. The moment a
  fence bridges real absence, "preserve the gap's plate" directly
  contradicts "the fence is one target", which was the whole point of the
  change. Preserving the letter of an invariant broke the thing it
  protected. When a rule's enabling condition changes, re-derive the rule.
- **Recovery, unchanged in spirit from 07-24:** away detail reappears on
  expansion. Structurally free — an expanded run pushes to `bars`, never
  `plates`, so its gaps fall outside every plate span and get their tooltips
  back. Gap *rendering* never varied: absence occupies proportional width in
  both states (a 19-min gap is ~7px at 22px/hr — visible, if subtle; whether
  bridged breaks read clearly enough when open is a watch item, and its knob
  is the gap scale, not this rule).
- **Vocabulary:** plate tooltip gains a span note when span ≥ 2× attended +
  1 min — `7 brief visits · 4m 12s over 2h 18m`. A bridged fence can cover
  hours, and the bare attended figure would imply continuous activity.

### Only departures earn an away plate (same day, third cut)

Suppressing gap plates *inside fences* fixed the alternation but left the
mechanism arbitrary — two thresholds, one for splitting (30 min, wall-clock)
and one for hovering (`GAP_PLATE_MIN_PX`, 6px ≈ 16 min, render-derived).
Scott: "you have to wonder why we need to hover the gaps… there's no real
value other than knowing the duration, which is implied already." Then the
sharpening that set the scope: **"I'm not trying to get rid of gaps at all.
I'm saying that small gaps are tedious and I'm trying to remove them."**

- **The week's gap census (2120 sessions, 5 days):** 658 boundaries with no
  gap at all, 1306 under 16 min (already plateless), **14** in 16–30 min,
  and **14** over 30 min (6 at 30–60m, 6 at 1–3h, 2 at 3h+). So the hover
  layer fired ~28 times a week, half of which the fence change had just
  suppressed.
- **The asymmetry that decided it:** the plate is informative only where the
  gap is already obvious, and tedious only where the gap is small. A 19-min
  gap renders ~7px — a slit you don't care about. A 2-hour gap renders ~44px
  — plainly visible, and its *clock times* ("away 12:04 – 1:38") are the one
  fact width genuinely cannot carry. Hence: keep the ~14 departures, drop
  the rest.
- **Rule:** `FENCE_BRIDGE_GAP_MS` gates the gap plate too. `GAP_PLATE_MIN_PX`
  deleted — the duration test subsumes both the old sliver test and the
  collapsed-fence suppression (a gap inside a fence is sub-threshold by
  construction), so ~20 lines of special-casing collapsed into one condition.
- **Considered and not taken:** dropping gap plates entirely. Simpler still,
  but it costs the clock times on real departures for no gain — the tedium
  was never in the 14 big gaps. Trivial to do later if they prove noisy.
- **Untested, on the watch list:** no real lunch walk-away exists in the
  specimen morning. A habitual 25-min absence would wrongly bridge; a 35-min
  one correctly splits. The 19-min gap inside today's bridged fence is the
  specimen to hover when checking whether a bridge ever spans something that
  *felt* like leaving.

## The traversal term — W_NAV (2026-07-24)

**The specimen:** the Airbnb booking container (9:21 AM, 10m17s, 4 visits +
3 excursions, 8 distinct pages) scored 623 MEDIUM while every other MEDIUM
that day sat ~200. It *felt* HIGH — the morning's important activity,
paired with the United booking — and Scott's diagnosis was structural:
traversal breadth (multiple page views within a domain) scored nothing.

**Why the formula couldn't see it:** clicks deliberately weigh 0 (they
contribute via attendedSeconds only — "a click is how you leave a page"),
and a container/merged visit scores as the plain SUM of member signal
totals. The structure the display proudly renders — 4 visits, 3
returns — was worth zero points. Scott's reframe, which won: a navigation
event is a *higher-level click* — the click that created a committed page
change rather than a scroll — and the capture pipeline already filters it
for intent (SPA debounce absorbs Maps-pan churn, blip filter eats
redirects, transit filter drops bounce hops). Count the survivors.

**Rejected on the way (in order):**
- *Lowering HIGH_SCORE to ~600* — Scott's instinct said risky; the replay
  agreed (the 600–1000 band held YouTube watches and a Claude chat, not
  just the trip cluster).
- *Raw click weighting (W_CLICK)* — noisy counter (every Maps drag-pan is
  a mousedown), and the replay showed nav counting covers the target case
  without it. Held in reserve: the one thing only clicks caught was the
  Google Vids editing session (click-heavy in-page work) — watch list.
- *User-act gate on navigation counting* (a nav counts only if the
  departing member had a discrete signal) — tested on real data and failed
  BOTH ways: passed 15/16 YouTube-Shorts swipes (the swipe IS one
  keystroke — the terminal-keystroke problem in a new hat) while killing
  Kayak's genuine search navigation (the act landed in a boundary window
  the departing member didn't report). No gate.

**Validation (2026-07-24, ONE day, 202 sessions, post-schema-change data
only):** offline Score-table TSV replay mirroring the display pipeline
(transit → machinery join → absence-bridge → chain approximation).
Candidates W_NAV ∈ {50, 100, 150} × (joins + returns) vs W_CLICK ∈
{3, 5, 10}. Findings:
- The trip-planning cluster rose coherently at every W_NAV: United
  Reservations (4 navs, 902) → HIGH at W=50; the Airbnb container
  (~8 navs + 3 returns on 623) → ~1170 HIGH at W=50. Goal met at the
  conservative end.
- W=100 additionally flipped single-nav glances to MEDIUM (Amazon "Your
  Orders" 70→170, a Gmail inbox hop 71→171) — rejected as too hot.
- Residual W=50 noise flips (LinkedIn feed 221, Akademy browse 227,
  Simplenote verify 198) all land just over the 150 line — the
  pre-existing "MEDIUM=150 may be too permissive" threshold question, not
  a navigation problem.
- The Shorts run (16 navs, 0 clicks, kbd=1/member) was ALREADY HIGH at
  baseline 1577 via attended time — nav points inflate it invisibly
  (three tiers have no display above HIGH). Latent, on the watch list.

**As built:** `W_NAV = 50`. Merged visits: `scoreSession(merged) +
W_NAV × (members − 1)` — machinery navigations and absence-bridge returns
count alike (every join is a committed page view). Chains: `chainScore =
Σ fragment scores + W_NAV × (fragments − 1)` — fragments already carry
their internal bonuses, the chain adds only its returns; the term flows
into container qualification (sum ≥ MEDIUM) and anchor dominance, both
deliberate (returning strengthens the anchor's claim). Week strip inherits
via threadsByDay.

**Retest required (~2026-07-28):** tuned on one day. Replay a full week's
TSV before touching the weight; check for Shorts-style inflation
specimens, feed-graze MEDIUMs, and whether the Vids case argues clicks
back in.

## The succession join (2026-07-24)

**The specimen:** after the traversal term shipped, the ribbon showed the
midday YouTube binge as a HIGH block followed by two un-merged MEDIUM
visits. Diagnosis: the tabs were a middle-click batch — Scott queues
videos into tabs from the feed, then watches each and closes it, landing
on the next queued tab. Every internal boundary was `tab_closed`, which
(a) is not `tab_hidden`, so guard 1 saw no departures → no container
(correctly: there was no interruption to frame), and (b) had no merge
license: machinery is same-tab only, absence-bridge is LOW-only. Three
same-host zero-gap blocks stood apart. Scott's call: one YouTube session
across the tabs it spawned — the guard was over-protective.

**The rule:** a third merge license. Same-TREE same-host neighbors whose
boundary is `tab_closed` (< `CONTINUATION_GAP_MS`) merge regardless of
band — closing a finished tab to advance to the next queued same-host tab
is cross-tab machinery, not departure. The tree key (opener edges,
2026-07-19) is the intent test: the middle-clicked tabs all root at the
feed tab, while a stray same-host tab in another window/tree never joins.
The boundary taxonomy stays clean: spa/navigated = same-tab machinery,
tab_closed + same-tree successor = cross-tab machinery, tab_hidden =
genuine departure (container territory, unchanged — a mid-binge Gmail
check still frames as interruption). Individually-HIGH events still stand
alone; each succession join earns the traversal term.

**Replay (same one-day TSV):** the 11:49–12:23 binge fuses to one
24-member HIGH (3364); the post-lunch resumption fuses to its own HIGH
(2091) across a real 7-minute absence boundary. One imperfection observed
and accepted: a transit-dropped 3s stub can carry the run's tab_closed
boundary away with it (the surviving neighbor ends spa_navigation in a
different tab), leaving a small visit un-joined ("Castella Cake",
12:24–12:28). Boundary evidence lost to the transit filter — rare, fails
toward showing structure, not worth a rule.

**Same-day follow-up — exit inheritance:** the "Castella" imperfection
above didn't survive contact with Scott ("almost — one of the trailing
tabs was merged but not the last one?"). Rule: the transit filter drops a
stub's PRESENCE, never its boundary testimony — a dropped stub that would
have machinery-joined its same-tab predecessor (machinery boundary, <30s)
bequeaths its endReason to that predecessor, since a visit's exit is its
last member's exit. Precedent: opener edges already read from
transit-filtered sessions ("a filtered hop can be the link between
grandchild and root") — the boundary is a fact, the stub's screen time is
the noise. Symmetric bonus: a stub exiting tab_hidden bequeaths honest
departure testimony for container guard 1. Implemented as an overlay map
in parseSessions (stored sessions untouched). Replay: the full binge is
now ONE 26-member HIGH run (11:49–12:28, 3579); the post-lunch resumption
stays separate across its real 7-minute absence.

**Audit fix (same day, from the doc↔code audit):** the
as-built overlay omitted the same-HOST condition that "would have
machinery-joined" implies — it tested tab + machinery boundary + <30s
only, so a foreign-host stub (a link-out bounce closed in 3s) could
bequeath its `tab_closed`/`tab_hidden` to a predecessor it never could
have joined, manufacturing succession licenses and false departure
testimony (the exact evidence-strictness the covered-HIGH work was about).
`runTail` now carries the keeper's host and inheritance requires the stub
to match; a foreign stub falls into the existing didn't-continue branch,
which already blocks inheritance across it.

## Gap-audio testimony replaces the audio-bookend bridge (2026-07-24)

**The specimen:** the succession join armed the watch-listed audio-bookend
false positive the same day it shipped. The fused binge visit (82%
audible) and the post-lunch resumption (99%) both passed the ≥50%
audible-dominated bookend test, so the 7-minute lunch gap bridged and the
container swallowed the WorkFlowy + Claude recipe work as contained
children — "completely independent events" (Scott) framed as YouTube
sub-events.

**Dead ends worth recording:** every cheap discriminator fails this pair —
Scott returned to the same TAB and even the same VIDEO as the
meeting-whiteboard pattern would; a browser-empty-gap displacement test
(first proposal) assumed whiteboards live outside the browser, which
Scott rejected (browser-based whiteboards exist). His counter-hypothesis —
YouTube audio is stop-start, meeting audio is continuous — was tested
against the day's TSV: individual video sessions are ~100% audible
(inter-video pauses vanish into session splits + Chrome's audible
hysteresis), but the silence concentrates in browse/paused fragments (the
homepage 0%, the pre-gap paused-video fragment 4%), yielding bookend
ratios of 82% vs 99%. A ~95% continuity threshold would have worked for
THIS specimen but fails a clean binge that's 100% audible up to the gap —
ratio is proxy, not fact.

**The rule:** bridge a long gap (VISIT_GAP_MS < gap < AUDIO_BOOKEND_GAP_MS)
only on gap-audio testimony — the resuming fragment's `audibleSinceTs`
(capture-side continuity stamp, `plans/capture_design.md`) predates the
previous fragment's endTime. The tab demonstrably played through the gap.
No thresholds, no ratios; audibleDominated deleted. Merged visits carry
their FIRST member's stamp (the fragment that resumed). Old sessions lack
the stamp and never long-bridge — fails closed, which today's specimen
says is the right default. Watch: a meeting whose audible flag drops
mid-gap loses its frame (two blocks, not wrong framing); fallback if a
real specimen appears is a tolerance window on continuity, never a return
to bookend ratios.

## Covered-HIGH guard goes tree-blind (2026-07-24)

**The finding:** a doc↔code audit (2026-07-24, working file since
retired) surfaced a spec-internal contradiction: Atomicity guard 1 said a
chain covering an individually-HIGH session is rejected — unqualified —
while the 2026-07-19 keying entry said the covered-HIGH guard "widened to
trees," and the code implemented the tree-scoped version: a HIGH in a
*different* tab tree covered by a chain's span was silently absorbed as a
contained child, display-capped at MEDIUM.

**The discussion:** the initial audit lean was to bless the tree-scoped
code (three passages + the MEDIUM cap + a watch-list entry all implied
HIGH children could exist). Scott overruled on product grounds: the only
*validated* containment-across-activity case is the meeting (Figma
discussed while the call runs — earned by audio evidence, the gap-audio
work above), and the tree-scoped guard had quietly generalized from that
one case to ALL cross-tree overlap with nothing backing the general case.
Containment is a demotion; for a data-gathering product the safe default
is that an important object always breaks a frame that would cover it —
important things must never get lost — and specific re-join licenses get
earned back with specimens, exactly as gap-audio was.

**The YouTube worry, resolved:** Scott's concern was losing the same-day
succession-join win ("I do not want to lose a YouTube session to another
YouTube session that is also HIGH"). Structurally unfounded: the guard
tests only covered NON-members, and a HIGH YouTube video in the batch's
tree is a *fragment* of its own host's chain (2026-07-19 relaxation,
untouched), never a child. Joining ("is this part of the thread?" — host +
tree + boundary evidence) and framing ("what does the span cover that
ISN'T the thread?") are disjoint questions; the tree rule lives entirely
in the first, this guard entirely in the second. A YouTube session cannot
break its own YouTube container in any version of the rule.

**What actually changes:** a foreign-host HIGH inside a container's span
(the shape of the same morning's binge-swallows-Claude specimen, had that
Claude session been HIGH) now rejects the chain wholesale instead of being
demoted to a medium-capped child. Known costs, both watch-listed: a
meeting whose covered discussion goes individually HIGH shatters the
meeting's frame (re-join candidate: anchor audio testifying through the
HIGH's own span — direct evidence, the gap-audio shape); a same-host
HIGH in a *different* tree breaks a container rather than reading as
"YouTube interrupting YouTube" (side-by-side is the conservative render).
Rejection stays wholesale — split-at-the-HIGH (preserving the frame on
either side) is a refinement that also waits for a specimen. Individually-
HIGH ≈ 17+ attended minutes in ONE unmerged session, so typical 5–10 min
discussion hops stay MEDIUM children and never trigger any of this.

## Spawn-edge dominance discount (2026-07-25)

**The specimen:** a 9-minute morning scheduling shuffle (07:02–07:11):
Gmail → cal.com (opened FROM the Gmail tab) → Calendar → back to Gmail.
Scott's read: "a Gmail container with small trips to cal.com and
Calendar." The pipeline's read: nothing — three chains each tried to
qualify and each failed anchor dominance independently (Gmail 517 vs
627, cal.com 280 vs 397), the emergent three-way version of the
keltas/Paysera standoff the guard was validated on. Note dominance is
one-sided per chain ("do you outweigh what you'd frame?"), never
pairwise; standoffs are emergent, not fought.

**The insight:** the Gmail anchor was being outvoted partly by its own
dispatches — the cal.com tab carried a stored opener edge back to the
Gmail tab. A spawn edge is *recorded intent* ("I opened this trip from
there"), the same evidence-over-proxy standard as gap-audio: demotion to
"trip taken from the anchor" isn't inferred from time-overlap, it's
testified by the edge. The pinned Calendar tab (edgeless, own tree)
rightly keeps full dominance weight — the anchor must still outweigh all
genuinely foreign material.

**Rejected: max-child dominance** (anchor > largest single child) — would
re-admit the validated 2026-07-18 rejections of weak keltas containers
framing 21 and 5 tiny children.

**Rejected: same-tree discount** (my first formulation) — "same tree"
includes the anchor's own tab, and foreign hosts land in your own tab
with zero intent (payment redirects, SSO hops). Under it, keltas and
Paysera would each discount the *other's* same-tab fragments, both would
pass dominance, and the contest would crown a false container. Hence the
≥ 1-edge clause: landing in the anchor's own tab traverses zero opener
edges and testifies nothing.

**Rejected: full spawn discount without the individual cap** — the week
replay produced two vacuous-denominator containers (all children spawned,
dominance tested against 0): apple.com 525 framing a craigslist read
scoring 649, and news.google.com 305 framing three feed reads including
variety.com at 325 — the Gmail-as-launcher pattern reborn through the
spawn door. Both are exactly the "children are the story" pathology.
The fix: a spawn drops out of the collective denominator but must still
be individually outscored by the anchor — a hub returns to something
bigger than each errand; a launcher dispatches things bigger than itself.

**Validation (offline replay, scores TSV 2026-07-24 + 07-25, 234 display
events; harness reproduced all 24 live containers on the A side; no
audibleSinceTs in the TSV so audio bridges didn't replay — shared by both
modes, diff unaffected):** exactly two changes. (1) The target specimen
frames: Gmail container MEDIUM 517, Calendar a visible MEDIUM cut-out
child, the cal.com pair discounted (denominator 627 → 397). (2) One
winner flip on 07-24 08:46–08:53 — another scheduling ping-pong, where
calendar.google.com 348 (4 fragments) now frames the episode instead of
google.com 320, its spawned google child discounted (denominator 412 →
202); the higher-sum chain wins, judged more truthful (Scott approved).
No new HIGHs; every demoted child stays a visible cut-out or stick.
One-week caveat, same as W_NAV: fold into the ~2026-07-28 full-week
retest.

## Middle segments join the hostname match (2026-07-25) — SUBSUMED 2026-07-28

*(Superseded by "Every segment declares the name" below: all positions now
participate in the hostname match, so the asymmetric middles carve-out and
its watch item are gone. Kept for the specimen and the reasoning.)*

**The specimen:** Gmail and Calendar both labeled around "Jenson.org" —
Gmail correctly as "Jenson.org Mail" (invariant last segment of the
Workspace `page - account - Jenson.org Mail` shape), Calendar wrongly as
bare "Jenson.org": its house style is `Jenson.org - Calendar - Week of
August 2, 2026`, the last segment varies weekly, and the invariant first
segment is the Workspace domain. The kicker: "Calendar" — the one
segment the 2026-07-19 hostname-match rule was built for, exactly
equal to the `calendar` label of calendar.google.com — is a MIDDLE
segment, and candidates were only ever first + last. The rule's own
specimen class, structurally invisible to it.

**The fix, deliberately asymmetric:** middle segments become candidates
for the hostname-equality test ONLY — all existing guards intact
(normalized exact equality, never containment; recurrence ≥ 2; counts
arbitrate) — and stay out of the invariance contest, where recurring
middle noise could win a popularity contest that the URL never
corroborates. Week check: no other stored host even has a spaced-
separator middle segment except Meet's participant name, which matches
no label. Calendar → "Calendar"; Gmail unchanged.

**Watch:** on `*.google.com` hosts a recurring middle segment exactly
"Google" would claim the name "Google" (current Google suffixes are
compounds — "Google Docs", "Google Maps" — which fail equality). If a
real misfire appears, the tightening is to exclude the registrable-
domain label from MIDDLE matching only — a subdomain label ("calendar",
"docs") is the specific claim; first/last matching keeps all labels.

## Every segment declares the name (2026-07-28)

**The specimen:** the 10:22 rutracker.org block labeled **"Smart Girl"** —
a torrent listing, not a site name. Scott: "That appears to be a local page
title and not the site name."

**Two independent gaps, both in the hostname-match rule:**

1. **The separator filter hid the evidence.** `siteNameOf` opened with
   `titles.filter(p => p.length > 1)` — only separator-bearing titles ever
   reached any contest. Of rutracker's 15 admitted titles that week, ten say
   `RuTracker.org` / `rutracker.org` / `Tracker` with no separator and were
   discarded before the hostname match could look. The four survivors were
   all torrent listings, and "Smart girl" (visited twice) cleared the
   `n*2 >= parted` majority guard 2-of-4. The site's own name was in the data
   ten times and was structurally unreachable.
2. **The TLD mismatch.** `norm("RuTracker.org")` = `rutrackerorg`, but the
   candidate labels were `host.split(".").slice(0,-1)` = `rutracker` — the
   TLD is stripped from the hostname and kept in the title, so exact equality
   failed. Same for `Amazon.com` (105 titles, unnamed) and `social.coop`
   (labeled "social").

**Scott's constraint, which shaped the fix:** "I'm trying to keep this rule
simple… I just get worried when you say multiple passes." Right instinct —
the function had accreted five passes because each new specimen widened the
hostname match one position at a time (first/last → +middles in 07-25).

**The restructure:** stop widening and separate the two rules that were
sharing one candidate set.

- *Hostname match* asks "does the host declare its own name?" — the right
  candidate set is **every segment of every title**, where a separator-free
  title is a one-segment title. Match against a hostname label **or the full
  hostname**.
- *Invariance contest* asks "which segment stays put while pages vary?" —
  that genuinely needs an `App - page` structure, so the `parted` filter and
  the first/last candidates move here, where they belong.

Net: the 07-25 middles carve-out, the `midCounts` map, and the `matchable`
merge all **delete** — three concepts collapse into "every segment is a
candidate." One loop over titles building two maps, then two scans. Fewer
passes than before, and one less rule in the spec. The deletion is the tell
that this is simplification rather than another patch.

**Week replay (137 label keys, transit-filtered as the dashboard does):**
123 unchanged, **14 changed, zero regressions.** Five outright bugs fixed —
gemini.google.com "Bike Light Lumens Explained" → **Gemini** (85 titles!),
app.plex.tv "E1" → **Plex**, scatterpad.com "July 26" → **Scatterpad**,
vercel.com "Usage" → **Vercel**, rutracker.org "Smart girl" →
**RuTracker.org** — plus nine hosts that had no name at all: Amazon.com,
Perplexity, memeorandum, Simplenote, Flight Network, OpenStreetMap, The
Atlantic, Laws of Software Engineering, and social.coop (was truncated to
"social"). Every prior specimen holds: Calendar, Meet, WorkFlowy, Phanpy,
the google.com Search/Maps split.

**Method note:** the first replay ran on RAW sessions and showed rutracker
already correct — the bug vanished. `computeHostNames` filters with
`isTransit` first, and re-running on transit-filtered titles reproduced
"Smart girl" exactly. Replay the pipeline's actual input, not the raw table.

**Verbatim names, decided deliberately:** the match returns the most frequent
spelling as written — `Amazon.com`, not "Amazon"; `memeorandum`, not
"Memeorandum". Stripping a TLD or fixing case would be *inventing* a name,
which is the failure mode this whole rule exists to prevent.

**Noticed, not fixed:** mail.google.com labels as `"scott@jenson.org -"`
(trailing separator, an email address as a site name). Pre-existing, produced
identically by both versions — a separate specimen for a separate day.

## google.com label split (2026-07-25)

**The specimen:** the 7:11 Sintra Maps exploration labeled "Google
Search". google.com is two apps in one hostname this week — a pile of
"… - Google Search" titles and a pile of "… - Google Maps" — and labels
are one-name-per-host by design, so the week's invariance contest
crowned Search and every google.com block inherited it. The host = one
app assumption is simply false for google.com (Search, Maps, Flights,
Finance, all path-namespaced); it holds almost everywhere else because
the modern idiom is subdomains, which hostname keying already handles.

**Rejected: the general multi-app mechanism** (designed first, then
dropped on Scott's simplicity challenge): week-level "app-name sets"
(last-position candidates, recurrence ≥2, normalized label containment)
with render-time per-run picks. It worked on paper — containment guards
kept Meet's "Scott" and Gmail's "Jenson.org Mail" safe — but it adds a
second naming mechanism whose guards defend only against enumerable
hosts, and exactly one host on the planet exhibits the problem. Kept in
this log as the escalation path if multi-app specimens accumulate.

**The special case, taken deliberately:** for hosts in
`LABEL_SPLIT_HOSTS` (= {google.com}), the LABEL grouping key appends the
URL's first path segment — google.com/maps, google.com/search — at all
three label surfaces (week-name computation, run segmentation for
titling, tooltip headline). No new naming logic: the existing invariance
machinery, fed honest groups, names them "Google Maps" / "Google Search"
by itself, and unseen segments (/travel, /finance) would self-name from
their own titles with no code change. Identity is untouched — color,
merging, chains stay hostname-keyed, so Search↔Maps interleaves still
thread as one journey; only the name stops lying. Philosophy match:
licenses are earned per-case with data — one specimen, one recorded
special case, generality only when specimens demand it.

**Accepted costs:** a list to maintain (possibly a list of one,
forever); one-off Google paths (/url redirect stubs) form tiny groups
that fall back to the trailing rule or bare hostname — a stray block may
label "google.com", honest if inelegant; a container's label keys on its
click-target URL (top-scoring member), so a genuinely mixed
Search/Maps container is named by its strongest member.

## Word-boundary hostname match fallback (2026-08-02)

**The specimen:** the 6:57 Avis rental block labeled "Car Rentals from
Avis" — accurate but far too long for a site name. Avis's titles never
carry a segment that's *exactly* "Avis" (always embedded: "Car Rentals
from Avis", "Reservation Details | Avis Rental Cars", "Avis Rent a
Car..."), so the equality-based hostname match never fires and the
invariance contest picks the most-repeated first-segment instead —
correct by its own rules, just the wrong tool for a brand-in-the-middle
title.

**The fix:** the hostname match gets a second, weaker pass — whole-word
containment — tried only when equality finds nothing. "Car Rentals from
Avis" contains "Avis" as a whole word; the returned name is that word as
spelled in the title, not a hostname-derived form (same verbatim
principle as the equality match). Whole-word (regex boundary) keeps the
`googledocs`/`docs` guard intact — a containment match without a
boundary would defeat the reason equality-only was chosen in the first
place.

**Rejected: hostname-derived casing.** Deriving "Avis" from `avis.com`
directly (capitalize the label) was simpler but breaks the "never
invent, always verbatim" principle already established for equality
matches — a lowercase-brand site would get a wrong-cased name no title
ever displayed.

## Floor-attended copy/cut discount (2026-08-02)

**The specimen:** the 6:58am Google Voice container child (a 9s SMS
security-code check, one copy click) rendered MEDIUM and visually
dominated the Avis container it interrupted — Scott's original
hypothesis was "the Voice visit shouldn't be MEDIUM." First pass wrongly
suspected `W_PASTE` (the Avis session, not Voice, had the paste); Scott
redirected to check both signals properly.

**The data:** every `copy=1, attended≤20s` row in the week's Score
Table scores exactly 160 or 161 — `W_COPY(150) + attended(10 or 20)` —
regardless of host or context: a Voice message check, a WorkFlowy
glance, a YouTube page, an Amazon audiobook listing, a Perplexity
search. `W_COPY` alone crosses `MED_SCORE` (150) on its own. Contrast
with `paste=1` rows at the same attended range: they top out around
90-121, staying LOW — paste was never the actual problem at these
durations.

**Ruled out: a `kbd` co-condition.** Sessions with `copy=1` and real
composition activity (Phanpy replies, Gemini conversations — kbd in the
tens to thousands) score correctly high and look nothing like the
noise cases. But `kbd` itself forms a smooth continuum (0, 1, 2, 3, 4,
… 913) with no gap to split "noise click" from "real typing" — any
threshold would be arbitrary. Attended time turned out to be the clean
discriminator: every copy-inflated MEDIUM sits at attended≤20s, and
composition-heavy sessions clear that floor by construction (real
typing takes measurable time, which shows up as heartbeats). So the
gate is attended-time alone, matching the existing terminal-keystroke
discount's shape (a time/attention-based gate, not a signal-count
threshold).

**Magnitude:** discounted copy/cut land at `W_PASTE`'s tier (80), not
zero — a copy-in-passing still represents something happened, symmetric
with how paste is already treated at these durations. Zeroing was
considered (mirroring the terminal-keystroke discount, which does drop
its keystroke to nothing) but rejected: a keystroke that closes the tab
(Cmd+W) is definitionally the user leaving, whereas a copy click's
content is unknown — it could still be minor real work, just not enough
to independently promote a floor-attended session to MEDIUM.
