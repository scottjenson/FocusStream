# Timeline Design — Decision Log (display side)

The spec (`ChromeExtensionSetup.md` §5–§6) holds the **current rules**; this file
holds the dated decisions, the evidence that forced them, and the alternatives
that lost — moved out of CLAUDE.md 2026-07-15 to keep it lean. The live
watch-list is consolidated in spec §6 ("Watch list").

## Score & tiers
- Score v1 (spec §6): `attendedSeconds = max(heartbeats×10, audibleSeconds)` +
  weighted discrete signals. Weights are provisional — inherited from Desktop4's
  demo-tuned values; keep them named constants.
- Score → three tiers/heights (144/115/86, bottom-flush) → picket fence.
  Design ported from the Desktop4 project (`~/Projects/Desktop4 (lifestreams)` —
  its plans/ dir has the rationale; its WebGL/React stack and screenshot/heatmap
  features did NOT port).
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
  Removed white/black/gray + 3 darkest (browns/olive → converge on noise-gray).
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
  blocks, not fences.

## Time axis
- **Hour axis:** whole-hour labels only; ribbon left-pads from the floor hour
  at gap scale so an 8:47 start sits proportionally after the 8am tick.
  Tooltips carry the exact wall-clock span.
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
- Guards for the big-email case: ≥1 foreign child required; individually-HIGH
  events never chain; same-tab HIGH inside span rejects the chain. Registry
  colors + coloredHosts judged PRE-containment.
- Display: 25% wash of host color + 2px full-strength border (border carries
  identity; color weight = saturation × area, and children then sit on
  near-dark ground so the Kelly dark-bg contract holds); hover lifts wash to
  35% instead of brightening (children stay stable).
- §5 note: technically gap-tolerant merging, which §5 forbids — but §5 forbids
  it for *hiding* interruptions; containers keep every interruption visible,
  framed.

## Resumed-read containers — PROPOSED/DEFERRED (2026-07-16)
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

## SPA-continuation merging — DEFERRED
- (2026-07-15, Scott) Continuous Gemini typing fragments into adjacent MEDIUM
  blocks (SPA URL churn >15s apart splits sessions; visit-merge is LOW-only,
  containers need foreign interruptions). Proposal on file in spec §6 (merge
  same-tab spa_navigation-linked MEDIUM+ pairs) — deferred: only 2 SPA
  examples, over-merge risk > fragmentation. Collect SPA endReason/band data
  first.

## Tooltips & snapshots
- Custom tooltip layer (uniform 300ms; native title warm-up uncontrollable)
  implemented 2026-07-15; snapshot previews approved with all knobs decided but
  NOT built. Full roadmap: `plans/tooltip_snapshot_plan.md`.

## Scope holds
- No zoom; day paging shipped 2026-07-16 (see "Day paging"), date-picker
  jumping still deferred.
- `parentId` / opener-tab tracking deferred; no tree/branching view.
