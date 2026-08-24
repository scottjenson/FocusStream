# Watch List

Living tracker of open concerns about current SPEC.md rules — trade-offs made
deliberately, not bugs, held pending more data or a specimen. Most items arise
AFTER a rule is adopted and working: the rule ships, then real days surface a
doubt about it. This file is **not** part of the spec: SPEC.md holds the rules
as they stand today; this file holds doubts about them. Rule bullets in
SPEC.md that a watch item concerns cross-reference back here; this file does
not restate the rule, only the concern.

**Entry shape:** `**slug (date):**` the concern — the trigger specimen to
watch for — the planned response if it fires. The slug is the entry's stable
ID; other entries reference it by name, never by position. Evidence behind a
*shipped* rule lives in the matching `decisions/` log even while the doubt is
open — an entry carrying evidence should be a pointer, not a copy. When an
item resolves, record the lesson in the relevant `decisions/` log (or confirm
it's already there) and delete the entry — struck-through corpses don't
accumulate here.

Extracted from SPEC.md §6 on 2026-08-07; hygiene pass 2026-08-09 (purge,
grouping, evidence trimmed to pointers).

## Capture (§3–§4)

- **focus-none-blackhole (2026-07-17; downgraded to watch 2026-07-18):** one
  two-hour capture blackout (a Prime movie + its browse/purchase flow, zero
  sessions) whose cause is still unknown — green-button fullscreen did NOT
  reproduce it (NONE fires transiently, refocus follows, capture is fine),
  and the new-tab blind spot found in the same investigation was fixed (tab
  adoption, §3). If it recurs, the fingerprint is `ignoring nav in
  non-tracked tab … (no session, window unfocused)`; the shelved
  fullscreen-rescue design is in `decisions/capture_design.md`.
- **recipient-identity-uncaptured (2026-08-06):** the tooltip's member-title
  list already surfaces *which* thread dominated a container (subject line +
  own account). Who the email was to/from isn't in `title` or `url` at all —
  Gmail thread URLs are opaque hashes — and capturing it would mean
  DOM-scraping Gmail's markup specifically: a bespoke per-site capture
  surface (fragile, no UI contract) the project has otherwise avoided.
  Deliberately punted as its own future decision. See also the broader
  "missing axis" note (SPEC.md §5) — recipient is one instance of social
  context, which activity signals can't reach in general.
- **download-direct-link-miss (2026-08-07):** a download reached by a direct
  link straight to a file — no landing-page click, no heartbeat — still
  fails the click-or-heartbeat presence bar and is dropped, not deferred.
  Narrower than the fixed torrent-tab case; explicitly out of scope for now.
  (Story: `decisions/capture_design.md`, "Download presence gate".)
- **pagetext-intent-gate (2026-08-07, stage-1 prototype):** `pageText`
  extraction rides the same input-cue/heartbeat trigger as snapshots, which
  is a *subset* of the transit filter's admission bar — so the finalize-time
  `pageText` deletion is currently a redundant backstop, not load-bearing.
  If a future capture trigger is ever widened to catch short reads (a
  dwell-only or reading-cue signal weaker than today's), that deletion
  becomes the only thing preventing searchable text for sessions the
  dashboard displays no evidence of — the consistency guarantee must be
  re-verified, not assumed, the moment the trigger changes. Full analysis:
  `decisions/capture_design.md`, "Page-text search capture".

## Display (§5–§6)

### Scoring
(medium-threshold, duration-bias, passive-reading-undercount,
bsky-scroll-premium, and w-nav-single-day were struck 2026-08-09 —
settled-by-silence/superseded, no specimen in weeks of real use; see
HISTORY.md.)

### Assembly (merging, containers, fences)
- **meeting-mute-bridge (2026-07-24):** a meeting platform whose audible
  flag drops mid-gap (Chrome's hysteresis rides short silences, but a long
  mute would break continuity) fails the gap-audio bridge closed — two
  blocks instead of a container. If a real meeting specimen misses its
  frame, the fallback is a tolerance window on continuity, not a return to
  bookend ratios. (Bookend-proxy replacement story:
  `decisions/capture_design.md`, "Audible continuity".)
(resumed-read-deferred and resumed-read-tightening were struck 2026-08-09 —
the resumed-read proposal was closed 2026-07-18 as subsumed by the
continuation-merge/MEDIUM-container rule, so nothing was left pending
implementation; see `decisions/timeline_design.md`, "Resumed-read
containers" and "Continuation merge + MEDIUM containers".)
- **key-email-visibility:** key-email visibility inside merged runs —
  reopened 2026-08-06; the focus-count label suffix that had marked this
  resolved was itself reverted the same day (data showed the count wasn't a
  valid proxy for "earned importance"; see `decisions/timeline_design.md`).
  The earned-HIGH border (SPEC.md §6, Importance) covers a related but
  narrower claim — *that* a container's tier was earned by one concentrated
  fragment, not *which* member that was — so it doesn't fully close this
  item. Still open. Original mitigations (individually-HIGH splits the run;
  tooltip lists members by score) still apply underneath it.
- **covered-high-tree-blind (2026-07-24):** a covered excursion that goes
  individually HIGH shatters the frame that would have contained it —
  including a long, genuinely-contained Figma discussion during a meeting.
  When a real shattered-meeting specimen appears, the candidate re-join
  license is direct evidence, not overlap: a covered HIGH is containable
  only if the anchor's audio testifies through the HIGH's own span (the
  gap-audio shape). Second candidate if same-host cross-tree HIGHs read
  wrong side-by-side: a same-host re-join license. Framing licenses are
  earned per-case with data, never generalized from overlap.
- **contained-low-width-loss (2026-07-24):** a long LOW graze inside a
  container collapses to the same 3px stick as a glance (containers have no
  expand). If a wide graze that mattered goes missing, candidate fix:
  honest-width stick paint (proportional width, stick fill and stature).
  Separate escalation if ping-pong containers still read busy: same-host
  stick aggregation (one stick + "×N" tooltip count) — real machinery,
  deferred for data.
- **anchor-return-debounce (designed, deferred 2026-07-18):** a ~10s return
  to the container's own host splits a same-host excursion into two children
  (observed: Gemini/Phanpy, two 8px sticks separated by a 0.4px return —
  the actor himself didn't remember toggling). Designed rule if specimens
  recur: within a container, an anchor-return of roughly one attention
  quantum doesn't testify as a separation — same-host children join, the
  return stays in container time, nothing is lost numerically. Held on one
  specimen: threshold untuned (this return was *exactly* 10s), and the
  child context line drops the confusion cost to near zero. Side-quest
  protection (foreign A→B→A) is untouched by design.
- **container-chain-gap (2026-08-02):** `CONTAINER_CHAIN_GAP_MS` = 10 min is
  a judgment call, not data-derived — a week's adjacent-container gap
  distribution (55 specimens) was smooth from 9s to 29min with no natural
  cutoff, unlike the fence-bridge histogram's clean cliff. Watch whether it
  over- or under-bridges as specimens accumulate. Evidence and the chosen
  trade: `decisions/timeline_design.md`, "Adjacent-container chaining".
- **fence-bridge-threshold (2026-07-28):** `FENCE_BRIDGE_GAP_MS` = 30 min is
  provisional — chosen mid-dead-zone of one cleanly bimodal morning (grazing
  gaps < 8 min, step-aways at 19–21 min, nothing between), so any value
  ~22–40 min was equivalent on that day. Untested against a real lunch
  walk-away: a habitual 25-min absence would wrongly bridge, a 35-min one
  correctly splits. Watch whether any bridged fence spans something that
  felt like leaving. Histogram + method note:
  `decisions/timeline_design.md`, "Fences bridge breaks, split at departures".
- **lone-sticks-too-quiet:** singleton LOWs collapse to lone sticks
  (2026-07-16, resolving the "reads as clutter" watch — it did). New watch:
  whether lone 3px sticks feel *too* quiet — whether the user misses seeing
  isolated 30–60s glances at full height — sharpened 2026-07-24 by the
  global LOW lowering (86 → 40): sticks are now half their former stature
  everywhere. Revert = `MIN_RUN` back to 2 and/or `TIER_H.low` back up.

### Layout, labels, visuals
(gap-loudness and week-strip-legibility were struck 2026-08-09 —
settled-by-silence through the monochrome redesign and weeks of real use,
no specimen; see HISTORY.md.)
- **fixed-overhead-dilation (2026-07-17):** `MIN_W`/`STICK_W`/`GAP` don't
  scale with `PX_PER_SEC`, so floored blocks (anything under ~3m33s) and
  fence sticks claim a larger share of the ribbon — busy sections shrink
  sublinearly. If dense stretches still read too wide, tune the overhead
  constants, not the scale.
- **container-interior-dilation:** a container renders its SPAN at presence
  scale, so interior time covered by neither fragments nor children is
  dilated ~6× vs gap scale. Negligible on the one real specimen (182s
  uncovered ≈ 14px), but it scales with the audio bridge (a 20-min
  whiteboard case would draw ~20 min of empty container interior).
  Candidate fix if a bloated specimen appears: render uncovered interior
  stretches at gap scale, at the cost of children no longer sitting at
  linearly-proportional positions.
- **contained-child-visibility (2026-07-17; superseded 2026-08-07):** the
  original concern (children paint MEDIUM-dim on a full-brightness container
  fill) no longer applies as stated — contained children now render at one
  uniform height and the same importance-based fill as any other block
  (SPEC.md §6). Whether a genuinely-important excursion still reads as lost
  inside a container is worth re-watching under the new system, but the
  original brightness-follows-true-band fallback no longer maps onto
  current rules.
- **earned-high-second-line (2026-08-06):** earned-HIGH blocks (SPEC.md §6)
  are usually wider than accumulated-HIGH ones — a single fragment rarely
  reaches `HIGH_SCORE` without real dwell. Untested whether the correlation
  holds tightly enough to design against (a short download-heavy burst
  could earn HIGH without much width). If it holds, the extra width is
  spare room for a second label line on earned-HIGH blocks: the dominant
  fragment's own cleaned title plus which raw signal earned it (attended
  time vs. copy/cut/paste vs. download vs. keyboard) — both
  activity-derived, answering "what/how," not "who this mattered to" (see
  **recipient-identity-uncaptured**). Paused pending the correlation
  holding up in practice.
- **invariance-single-doc-host (2026-07-18):** a host visited for only ONE
  document all week ties both segments and the first-position preference
  picks the document name over the app name (e.g. "FocusStream Telemetry"
  instead of "Gemini Notebook"). Accepted: a reasonable label for a
  one-document host, self-correcting when a second document appears.
- **gmail-trailing-address-label (2026-08-07):** the invariance-naming
  trailing-segment fallback occasionally picks the user's own address
  (e.g. "scott@jenson.org -") as the site name on Gmail. Noticed, not
  fixed — deferred as its own specimen rather than folded into the
  google.com multi-app special case. (Story: `decisions/timeline_design.md`.)
- **merged-snapshot-fallback (2026-08-07):** a merged visit or container
  shows text-only in its tooltip if its top-scoring member's capture
  soft-failed, even when a sibling member has a picture. Accepted gap;
  candidate fix (fall back to the best-scoring member that HAS a picture)
  not yet built. (Story: `decisions/snapshot_implementation.md`.)
(horizontal-inblock-labels was struck 2026-08-09 — horizontal HIGH-run
labels shipped, per commit bcb461e "Timeline: revive horizontal HIGH-run
labels"; the watch no longer describes current behavior.)
- **favicon-clip-experiment (2026-08-07):** every real block draws its 16px
  favicon top-left-anchored and lets the block's own edge clip it when too
  narrow/short to fit — chosen over the "lollipop" pin specifically to try
  more-often-visible identity over a geometrically cleaner but rarer
  signal. Untested at scale: a block narrower than ~6-8px may show an
  unrecognizable sliver, and dense fenced-adjacent runs of thin blocks
  could read as visual noise rather than identity. If it reads badly, the
  lollipop approach (SPEC.md §6 favicon rule history) is the fallback to
  revisit, not a third alternative.
- **zoom-tuning (2026-08-08):** `ZOOM_SENSITIVITY` (0.0018),
  `ZOOM_MIN`/`ZOOM_MAX` (0.5–8×), and `ZOOM_IDLE_MS` (150ms) are
  first-guess values, not measured against a real trackpad/mouse-wheel
  session — watch whether the curve feels too twitchy/sluggish, whether 8×
  is too extreme or not enough to make favicons legible on a dense day, and
  whether 150ms is long enough that the `.blk` transition doesn't visibly
  "pop" back on mid-gesture pauses. The cursor-anchor is
  proportional-position, not a true timestamp inversion (SPEC.md §6) —
  untested whether that reads as drifting on a very uneven day (a few huge
  blocks + a long gap) where proportional and wall-clock position diverge
  more than on a typical day.

## Tab Manager (§7)

- **switcher-fixed-root-overlap (2026-08-21):** the live tab strip is
  `position: fixed` with a companion `html { margin-top }` override on the
  page's own root (spec §7 placement) — correct on every `position:
  static` site, but a site whose OWN top-level container is `position:
  fixed`/`absolute` over the full viewport (specimen: Google Voice) can't
  be pushed down by a margin change, so that site's own top ~34px sits
  under the strip. Known countermeasure (detect and nudge same-shape
  fixed/sticky elements at mount) deferred, not built — first move in a
  CSS arms race with no evidence yet of how many real sites it bites.
  Watch for: real specimens beyond Voice (Meet is presumed same-shaped,
  untested) and whether the overlap is annoying enough in practice to
  justify the countermeasure. Story: `decisions/tabmanager.md`, "Voice
  fixed-root specimen".
- **switcher-navigation-flash (2026-08-21):** a real page navigation (any
  link click, not just tab-switching) destroys and rebuilds the entire
  document, including the strip — it re-injects and re-mounts from
  scratch every time, unlike a genuine browser-chrome tab bar, which
  never rebuilds on page navigation. Structural, not a bug: a
  content-script-injected surface cannot live outside the page it's
  injected into. Mitigation identified, not built: inject at
  `document_start` with a synchronous placeholder (reserve the strip's
  space/shell before first paint) instead of `document_idle`, then
  hydrate with real tab data once the background responds — reduces the
  visible jank without eliminating the rebuild. Deferred pending judgment
  on whether the flash is bothersome enough in real use to justify it.
  Story: `decisions/tabmanager.md`, "Navigation-flash structural limit".
- **switcher-phase1-rough-edges (2026-08-21):** two small gaps noted
  during Phase 1 verification, neither blocking: (1) no auto-scroll to
  the active tile if it's off-screen in the strip — a many-tab window
  needs manual horizontal scroll to find the highlighted tab; (2)
  per-window scoping is implemented (`broadcastTabsForWindow`) but only
  ever verified against a single window — a second-window scenario
  (does each window's strip correctly show only its own tabs, does
  switching windows behave sanely) is untested.

## Cross-cutting (capture/display seams)

- **admission-rung2-promotion:** admission rung 2 is display-time — audit
  via the Score table; promote to capture once trusted.
- **spa-debounce-vs-join (2026-07-18):** capture's 15s `SPA_DEBOUNCE_MS`
  and display's machinery join both heal SPA fragmentation. With the
  display join proven, the capture debounce could shrink toward URL honesty
  (more granular URLs, reassembled at display). Not urgent; one knob at a
  time.
- **idle-split-sliver (2026-07-24):** the manufactured gap is
  `resume − (lastActiveTs + 10s)` while the split fires past 5 min, so it
  can land in [4:50, 5:00) — up to one heartbeat window under
  `VISIT_GAP_MS`. In that sliver the absence-bridge join and container
  chaining can bridge a gap capture explicitly judged idle. No specimen
  yet; if one appears, the fix is treating an `idle_split` boundary as
  never-bridgeable — not nudging either threshold.
- **threshold-sprawl (2026-08-06, from the rules-restructure-2 review):**
  eight independently-named gap/duration constants (`TRANSIT_MS` 10s,
  `TERMINAL_KEY_MS` 500ms, `SPA_DEBOUNCE_MS` 15s, the 30s
  machinery/succession sanity bound, `IDLE_SPLIT_MS` 5min, `VISIT_GAP_MS`
  5min, `CONTAINER_CHAIN_GAP_MS` 10min, `FENCE_BRIDGE_GAP_MS` 30min)
  govern capture and five different display joins, spanning three orders of
  magnitude, with no stated relationship to each other even where a reader
  would expect one. Two specific gaps: `VISIT_GAP_MS` does three unrelated
  jobs under one name (LOW-only absence-bridging is a noise-tolerance
  argument; container-return chaining is an intent-credit argument;
  title-run splitting is a third) that happen to share a value, not an
  argument, and would mislead if ever tuned independently; and
  `CONTAINER_CHAIN_GAP_MS` (10min) > `VISIT_GAP_MS` (5min) is justified
  locally ("coarser claims earn longer bridges") but that principle isn't
  checked against `FENCE_BRIDGE_GAP_MS` (30min, the longest bridge gating
  the *least* assembled objects — a seeming counterexample). Not urgent, no
  specimen forcing it — a candidate cleanup pass is grouping the eight by
  evidence-kind (noise-tolerance vs. intent-credit vs. capture-mechanics
  vs. wall-clock judgment) and splitting `VISIT_GAP_MS`'s two display-side
  jobs into two named constants even if they keep the same value for now.
- **two-pass-chaining-seam (2026-08-06, from the rules-restructure-2
  review):** adjacent-container chaining (SPEC.md §6, 2026-08-02) re-runs
  the entire chain-and-qualify pipeline a second time on its own first-pass
  output, at a looser threshold — a reasonable, minimal way to get "coarser
  objects get longer bridges" without a bigger rewrite, but it means there
  are now two kinds of thread-like objects (fragments and
  already-assembled containers) rather than one recursive definition. No
  third-level specimen exists and none is being built for speculatively.
  Watch for: if a third chaining pass is ever proposed (a chain of chained
  containers), that's the signal to stop patching with more passes and
  make assembly genuinely recursive with a threshold that scales with
  assembly depth, not add a third hardcoded pass.
- **eviction-fallback-tedium (2026-08-23):** Phase 3's auto-close is
  licensed by "lightweight opinion + fallback" — the system is *allowed* to
  be wrong about importance because browsing the blocks is always the
  recovery path (full reasoning: `decisions/tabmanager.md`, "Lightweight
  opinion + fallback"). So the concern is NOT that score correlates poorly
  with what you wanted back; that's expected and priced in. The concern is
  that the recovery path is too tedious to actually use, which is the one
  thing that would make being wrong expensive instead of cheap. Sharpened
  by the fact that the opinion and the fallback share one surface: hunting
  a demoted tab means searching a view that rendered it small *because* the
  system was wrong about it. Watch for: wanting a closed tab back and
  finding the hunt tedious — too much zooming/scrolling, or needing to
  already know roughly when it happened to find it at all (Scott's
  specimen: Google Keep, a thin sliver four hours back). The bar to hold
  the design to is that a low-scored sliver stays findable *without*
  knowing its time. Planned response if it fires: it's a browsing problem,
  so the answer is in navigation (cross-day, overview/scan affordances,
  possibly search as a second channel) — not in retuning the score, which
  is not the thing that failed. Blocking: no `chrome.tabs.remove()` should
  ship until retrieval has been exercised by hand on a real day's history.
- **night-break-midnight (2026-08-23):** §7e collapses overnight gaps to a
  fixed-width labeled divider, and puts that break at midnight. Correct for
  a day-shift user, wrong for a night owl: someone working 6pm-2am gets a
  hard break slicing through the middle of active work, since their real
  quiet stretch is 2am-10am. The better answer is already worked out and
  deliberately unbuilt (`decisions/tabmanager.md`, "Cross-day"): collapse
  any gap over a threshold (~3h) wherever it falls, and attach the day
  *label* to the first block after midnight — label boundary stays midnight
  because that is what the label means, visual break follows the real
  absence. Watch for: a divider landing inside a work session, or a day's
  blocks visually split across two dividers. Cheap to switch — both
  versions are just "how wide is this gap and what is drawn in it," so the
  upgrade is local to the gap-rendering path and needs no other change.
- **band-drop-cliff (2026-08-23):** §7e's band ladders end by DROPPING the
  band, and that last rung is a cliff — 131 LOW blocks vanish on one zoom
  tick, 70 MEDIUM on another, while the 8-5-3 rungs before them shift a 4px
  block to 3px. Predicted before it shipped ("it may feel like a large
  jump") and shipped simple anyway, to be judged by use rather than
  pre-engineered (`decisions/tabmanager.md`, "Band floor ladders"). It may
  well be fine: the cliff lands at an explicit "show me only what mattered"
  gesture, not somewhere a user drifts into. Watch for: the drop reading as
  a glitch or data loss rather than a zoom level, or zooming back and forth
  across the threshold feeling unstable. Planned response, already designed:
  make the last rungs filter progressively BY DURATION (drop LOW under 30s,
  then under 2min, then all) so the disappearances spread across three ticks
  in a principled order — shortest first, keeping the odd long-LOW visits
  longest. Do not respond by softening the ladder into more rungs; the rungs
  are transition frames and adding more does not change where the mass is.
- **band-drop-absence (2026-08-23):** dropping LOW/MEDIUM entirely at low
  zoom means a day of nothing but low-value activity renders nearly empty —
  a day divider with little between it. Honest under "lightweight opinion"
  (see `eviction-fallback-tedium`), but it is the one place §7e can make the
  fallback silently incomplete: a user hunting a demoted tab at 6-day zoom
  sees no trace of it and may conclude it is not there, rather than that it
  is below the current zoom. Watch for: concluding "that tab isn't in my
  history" while zoomed out, then finding it on zoom-in. Candidate
  responses if it fires: a faint density hint in the emptied stretch, a
  count affordance ("+38 not shown"), or an explicit zoom-to-reveal cue —
  all deliberately unbuilt, since the staged fade (LOW first, MEDIUM well
  after) may already teach the rule well enough on its own.
- **pan-ramp-tuning (2026-08-24, §7h):** the dead-zone
  width, curve exponent and max rate are declared provisional play-test
  knobs with no data behind them. The shape is argued (one threshold, felt
  as motion starting; everything past it a smooth curve) but the numbers are
  guesses. Watch for: the dead zone reading as dead space rather than rest,
  max rate overshooting so the target is repeatedly passed, or the curve
  feeling like it "catches" partway out. Response: turn one knob at a time
  (project rule for provisional constants). Do NOT respond by reintroducing
  discrete zones — that trade was made deliberately and the exponent already
  expresses "slow across most of the band, fast at the edge."
- **pan-load-burst (2026-08-24, §7h):** proximity
  loading means a sustained fast pan left can pull several days in a few
  seconds, each one a full `render()`. §7e chose one-day-per-relayout
  explicitly as "a calming action... spread the load out across multiple
  scrolls," and panning is a much higher-frequency driver of `paint()` than
  zoom ticks were. Watch for: frame drops or visible hitching during a long
  fast pan, or the ribbon deforming under the cursor as several days land in
  quick succession. Candidate responses: a minimum interval between loads,
  or suppressing loads above a rate threshold and letting them land as the
  pan slows. Both deliberately unbuilt — `MAX_WINDOW_DAYS` (7) caps the
  worst case at six loads total, which may simply never be a problem. Scott
  reported "an occasional glitch or a stutter" during 2026-08-24 testing,
  not chased at the time — this is the first suspect if it persists.
- **pan-hover-suppression (2026-08-24, §7h):** §7h has
  panning suppress tooltips/`cardHoverText`/gap plates outright, on the
  argument that navigation and inspection are not simultaneous intents. The
  risk is the converse: the outer bands are where panning lives, so any
  block reachable only by panning to it becomes inspectable only after
  returning the cursor to the dead zone — which may read as the ribbon
  refusing to explain itself exactly where the user is hunting. Watch for:
  chasing a block toward centre just to read its tooltip. Candidate
  response: suppress only while the rate is above some floor, so the slow
  inner band stays inspectable.
