# Timeline Design — Decision Log (display side)

The spec (`SPEC.md` §5–§6) holds the **current rules**; this file
holds the dated decisions, the evidence that forced them, and the alternatives
that lost — moved out of CLAUDE.md 2026-07-15 to keep it lean. The live
watch-list is consolidated in spec §6 ("Watch list").

## Score & tiers
- Score v1 (spec §6): `attendedSeconds = max(heartbeats×10, audibleSeconds)` +
  weighted discrete signals. Weights are provisional — inherited from Desktop4's
  demo-tuned values; keep them named constants.
- Score → three tiers/heights (144/115/86, bottom-flush) → picket fence.
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
  ("Scott").

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
  implemented 2026-07-15; snapshot previews approved with all knobs decided but
  NOT built. Full roadmap: `plans/tooltip_snapshot_plan.md`.

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
  amendments, and loose ends: `plans/rules_restructure_proposal.md`
  (ADOPTED). This log's older sections describe the pre-restructure rule
  names; the rules themselves are unchanged.

## Doc structure (2026-07-17)
- Spec §6 rewritten rules-only (44KB → ~21KB): evidence, history, and
  rejected alternatives moved here; #### subsection anchors added for
  targeted partial reads. Discipline going forward: a new decision lands as
  2–4 rule sentences + date in the spec, full story in plans/ — never both.
