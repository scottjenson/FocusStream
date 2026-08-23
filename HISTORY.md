# History

Chronological changelog/index over the same underlying facts SPEC.md organizes
topically — read once when picking up the project cold, not needed for most
individual tasks. Moved out of CLAUDE.md 2026-08-09 to keep that file to pure
how-to-work content (see CLAUDE.md's file-purpose table).

Full mechanism/specimen detail for every entry below lives in SPEC.md (rules)
and the matching `decisions/` log (story) — never repeated here. One line per
dated entry: what shipped, when, where to read the rule and the reasoning.

**Before adding a line here:** did this change have a reason someone might
question later — evidence, a specimen that forced it, an alternative that
lost? If yes, write that reasoning into `decisions/<file>.md` (and update
SPEC.md if a rule's truth-value changed) FIRST — this file only ever points
at those two, it never carries the reasoning itself. A new line here with
nothing in SPEC.md or `decisions/` to point at is incomplete, not just
terse — write the entry there, then come back and add the one-line pointer.

- **Phases 1–3b live:** capture loop + edge cases, horizontal timeline (fences,
  visit merging, containers, two time scales, day paging, tooltips, transit
  filter, importance-gated labels) — spec §3/§6.
- **Snapshot previews live (2026-07-16, unified with transit filter 2026-07-24):**
  `decisions/snapshot_implementation.md`.
- **2026-07-17:** timeline visual pass (scales, week strip, dark page) + spec §6
  rewritten rules-only — `decisions/timeline_design.md`.
- **2026-07-18:** capture holes closed (tab adoption, iframe relay), continuation
  merge, color re-rationed to HIGH anchoring — spec §3/§6; `decisions/timeline_design.md`,
  `decisions/capture_design.md`.
- **2026-07-19:** atomicity guard 1 relaxed, overlap trim-and-retest, opener-edge
  capture, hostname-label site naming — spec §2/§3/§6; `decisions/timeline_design.md`,
  `decisions/capture_design.md`.
- **2026-07-24:** contained-LOW→stick collapse, plate-based fence split,
  terminal-keystroke discount, snapshot/transit-filter unification, `W_NAV`
  traversal term, succession join + exit inheritance, gap-audio testimony —
  spec §3/§6; `decisions/timeline_design.md`, `decisions/snapshot_implementation.md`,
  `decisions/capture_design.md`.
- **2026-07-25:** spawn-edge dominance discount, middle-segment hostname
  matching, google.com label split — spec §6; `decisions/timeline_design.md`.
- **2026-07-28:** `FENCE_BRIDGE_GAP_MS` departure-split (retires
  `FENCE_SPLIT_GAP_MS`/gap plates), site-naming simplified to
  every-segment/full-hostname matching — spec §6; `decisions/timeline_design.md`.
- **2026-08-02:** word-boundary containment site-naming fallback, floor-attended
  copy/cut discount, adjacent-container chaining, narrowed cut-out seam +
  contained-child insets — spec §6; `decisions/timeline_design.md`.
- **2026-08-03:** week-strip bars colored by the ribbon's own fill rule
  (gray/hue-mix, not neutral) — spec §6.
- **2026-08-06:** same-tab HIGH pass-through in continuation merge, dashboard
  title/URL search (find-and-go, independent of day paging) — spec §6;
  `decisions/timeline_design.md`.
- **2026-08-07:** page-text search capture, stage 1 (vendored Readability.js,
  intent-gated, plain text, not yet privacy-hardened) — `decisions/capture_design.md`.
- **2026-08-07:** same-tab HIGH pass-through bug fix — an incoming-only
  machinery edge now joins its predecessor's run (was splitting) — spec §6
  Atomicity.
- **2026-08-07:** succession join's HIGH exclusion fixed to match the
  machinery join's incoming/outgoing edge symmetry — spec §6 merging.
- **2026-08-07:** earned-HIGH atomicity in adjacent-container chaining (two
  back-to-back Meet calls no longer fuse into one container) — spec §6;
  `decisions/timeline_design.md`.
- **2026-08-08:** OS lock intervals captured, fence reinstated with a
  lock-aware confirmed-break/implied-break split — spec §3/§6;
  `decisions/capture_design.md`, `decisions/timeline_design.md`.
- **2026-08-09:** docs restructure — `HISTORY.md` split out of CLAUDE.md
  (this file), `decisions/rules_restructure2.md` retired (two open findings moved
  to `WATCHLIST.md`), `decisions/visual_redsign.md` retired (fully superseded by
  SPEC.md §6's monochrome/favicon rules), `plans/` renamed `decisions/`.
- **2026-08-09:** SPEC.md split into a ~40-line root index plus
  `spec/capture.md` (§3–§4) and `spec/display.md` (§5–§6) — the single file
  had grown to 301 lines, most of it §6 alone, so any change forced reading
  content irrelevant to it. Section numbers carried over unchanged; every
  existing `§N` reference elsewhere in the repo still resolves without edits.
- **2026-08-09:** `WATCHLIST.md` hygiene pass — resolved/retired entries
  purged (lessons verified present in `decisions/`), evidence for shipped
  rules trimmed to pointers at the `decisions/` sections that already held
  it, entries grouped Capture/Display/Cross-cutting under stable slugs,
  entry shape codified in the file header. Follow-up same day: 11 more
  entries struck as stale (settled-by-silence or superseded by a shipped
  rule) — the resumed-read pair (subsumed 2026-07-18, no longer live),
  horizontal-inblock-labels (shipped per commit bcb461e), and 8 early
  scoring/visual watches unheard-from since the monochrome redesign.
  44 → 26 entries net.
- **2026-08-14:** audible-continuity flicker tolerance — a real 90-minute
  Meet call rendered as 3 containers because `chrome.tabs.audible` blips
  false for ~1s mid-call with no real interruption, defeating gap-audio
  testimony's `audibleSinceTs` on every gap over 5 minutes (never exposed
  before: every prior meeting's gaps stayed under the plain gap threshold).
  Live-reproduced on both a solo and a real two-device call. Capture-side
  only, future sessions only — `decisions/capture_design.md`.
- **2026-08-14:** container qualification weak-bridge guard — when a real
  excursion fills a gap, at least one side's own edge fragment (not a
  container endpoint's summed band) must be MEDIUM+ to bridge; closes a
  case where a chain's later strength retroactively legitimized an
  unrelated excursion swept in as children of a near-zero-intent opener,
  caught recurring one layer up in the adjacent-container pass before the
  final fix — spec §6; `decisions/timeline_design.md`.
- **2026-08-15:** card-deck ribbon (`plans/stack-ribbon.md`) Stage 5 —
  single-traveling-card hover-gap effect (cursor over `#ribbon` opens a gap
  around the card it's over), plus same-day follow-ups: riffle lift
  removed, gap re-centered on the cursor, animated open, gap-label flicker
  fixed (stale-hit-box `pointerover`/`pointerout` was fighting the
  gap-authoritative label), rotation pivot moved to one shared absolute
  height across tiers (fixes LOW cards reading as "over-rotated"), LOW
  demotion scrim removed, LOW rotates 10° less than other tiers.
  Experimental, deliberately NOT folded into `spec/display.md` yet — see
  that plan doc's own top-of-file status note.
- **2026-08-15:** gap-active card highlight (navy border + blue glow,
  disambiguates the handoff between traveling cards) and three related
  bugs fixed — highlight riding down with an expanding card, close-click
  misrouted to a stale `gapKey` card, and the expanded card still getting
  `translateX`'d by resumed scanning (root cause: `lastCardSegs` must
  exclude the expanded card, kept in sync immediately at click time, not
  just at the next repaint) — `decisions/timeline_design.md`.
- **2026-08-15:** card-deck ribbon bug fix — closing an expanded container
  while parked on a child carousel item left that child's screenshot/tipData
  stranded on the deck face. Fixed by snapping back to the container (index
  0) via `selectCarouselItem` before collapsing; that call's own async
  snapshot fetch needed its staleness guard rewritten from a
  `cardExpandedKey` re-check (wrong: legitimately null by the time the fetch
  resolves) to a per-call token stamped on the element.
- **2026-08-21:** Active Tab Manager adopted as a third spec pillar — Phase 1
  (live, on-page tab-switcher strip; capture unchanged) designed, Phases 2–4
  (full view integration, auto-close eviction, active→historical
  reconciliation) roadmapped but not yet designed — spec §7;
  `decisions/tabmanager.md`.
- **2026-08-21:** Native Messaging debug bridge (dual-write to the
  native-capture project's SQLite store, 2026-08-13) paused — web-only
  pivot, native-capture not being validated against right now. Code kept
  in place behind `NATIVE_BRIDGE_ENABLED = false`, not deleted —
  `decisions/capture_design.md`.
- **2026-08-21:** Active Tab Manager Phase 1 built and verified — live
  tab-switcher strip (`switcher.js`, top-frame shadow DOM), per-window
  broadcast/switch protocol in `background.js`. Placement bug found and
  fixed same day: plain push-down rendered invisibly on any
  position:fixed-rooted site (specimen: Google Voice) — switched to fixed
  overlay + `html margin-top` compensation, verified against real open
  tabs (Gmail, Calendar, Voice) — spec §7; `decisions/tabmanager.md`.
- **2026-08-21:** Tile close box added to the live tab strip (`×`,
  hover-revealed, `FS_CLOSE_TAB` message → `chrome.tabs.remove`) — reuses
  the existing per-window broadcast, no new sync mechanism needed since
  `onRemoved` already fires for any close regardless of source. Tiles also
  gained a short site-name label (reusing the dashboard's `siteNameOf`
  logic) in place of the raw, truncated `document.title`. Required
  promoting that logic out of `dashboard/assembly.js` into a new
  `shared/utility.js` and converting `background.js` to a module worker
  (`"type": "module"`) so it can import from `shared/` directly — spec §7;
  `decisions/tabmanager.md`.
- **2026-08-21:** Active Tab Manager Phase 2 (ribbon overlay) designed —
  in-page shadow-DOM overlay reusing the existing ribbon renderer
  unmodified (DOM-root parameterization + dynamic-import module loading +
  shared-CSS-file delivery into the shadow root), new right-anchor zoom
  mode pinned to "now," open-tabs data filter, always-on clipped block
  label, day-paging retired from the UI (code kept, dormant). Retargeted
  mid-build same day from the screenshot card deck (`paintCards()`/
  `.card`, confirmed zoom-inert) to the classic block ribbon (`paint()`/
  `.blk`, confirmed genuinely zoom-reactive) once the mismatch was found —
  `decisions/tabmanager.md`. Snap open/closed only — tile→ribbon morph
  animation deferred as the confirmed next goal. Spec §7b.
- **2026-08-22:** Active Tab Manager Phase 2 rebuilt from the ground up
  around real animation (the 2026-08-21 snap-open/closed overlay's two
  separate hosts/DOM trees/color systems couldn't animate into each
  other — user review caught it live). New model: ONE shadow host, one
  shared `.blk` element per open tab (keyed `"tab:"+tabId`, not the
  historical `assembleThreads()` scheme, which isn't stable across this
  transition), two pure layout functions (`layoutStripGeom`/
  `layoutRibbonGeom`) over the identical element set — `.blk`'s
  pre-existing CSS transition then animates each element for free between
  states, no animation code written. Introduces the "incomplete
  container" placeholder for tabs with no finalized session yet (forced
  LOW, unstyled). Right-anchor zoom mode and the day-paging-omission
  design from 2026-08-21 are retired — this view never calls the
  historical render()/zoom pipeline at all. Spec §7b (rewritten);
  `decisions/tabmanager.md` "Animation architecture rework."
- **2026-08-22 (same day, later):** Active Tab Manager Phase 2 unified with
  real history — the hyperlocal `tabId`-keyed side-pipeline above is
  retired in favor of routing every open tab through the ONE real
  `render()`/`assembleThreads()`/`paint()` pipeline (why mouse-wheel zoom
  had been completely dead: it repaints from `lastAssembly`, which that
  side-pipeline never populated). Open tabs are now genuine session-shaped
  records (`syntheticSessionsForOpenTabs`) spliced in alongside real
  finalized sessions — real container/thread/tier treatment, right-
  anchored to "now" (`__fsTimelineAnchor: "right"`), with real closed
  history revealed to the left on zoom/pan. Collapsed vs. expanded becomes
  a HEIGHT-ONLY toggle (`heightMode: "uniform"|"tiered"`, inside `paint()`
  itself) — zoom/horizontal geometry is untouched by expand/collapse and
  only responds to the wheel once expanded. New per-open-tab exemptions
  needed once real data flowed through real assembly: no fence-collapse,
  a wider width floor (`OPEN_TAB_MIN_W`) than closed history's sliver
  floor, `isOpenTab`/`openTabId` propagated through `assembleThreads()`'s
  merge/container construction so click-to-switch survives merging. Also
  resolves `WATCHLIST.md`'s former `overlay-shows-only-finalized-visits`
  entry (deleted, resolved). Spec §7b (rewritten again); `decisions/
  tabmanager.md` "Open-tabs/history unification."
- **2026-08-22 (same day, later still):** two visual bugs fixed on the
  unified ribbon — `.blk-label` dropping to the block's bottom edge on
  expand (now one unconditional favicon-adjacent position, both height
  modes) and a redundant floating `.rtitle` run-title (now suppressed
  entirely in this overlay — real closed history was affected too, not
  just open tabs) — spec §7b; `decisions/tabmanager.md` "Visual cleanup
  pass on the unified ribbon."
- **2026-08-22 (same day, built):** strip ordering rethink shipped —
  replaced the `now`-anchor with a literal Chrome-tab-order strip
  (categorical, pinned-first, `tabIndex` field) and gave the ribbon its
  own independent default resting window (last-12-top-level-blocks
  lookback, `applyDefaultZoomWindow`), since the `now`-anchor was
  conflating "currently open" with "recently attended" (specimen: an idle
  pinned tab always rendered as if freshly active). Fences also retired
  entirely in this view (previously exempted for open tabs only), matching
  the card-view's own prior fence retirement. Full reasoning and the design
  discussion: `decisions/tabmanager.md` "Strip ordering rethink"; shipped
  rules: spec §7c.
- **2026-08-22 (same day, later, three implementation bugs found + fixed):**
  (1) strip initially rendered in TIME order, not Chrome order —
  `assembleThreads()`'s final pass always re-sorts by `startTime`, silently
  discarding the array order `stripLayout()` assumed; fixed via a real
  `tabIndex` field propagated through `mergeVisits`/`detectContainers`.
  (2) four genuinely pinned tabs still showed full labels — `pinned` was
  never added to those same two constructors when `isOpenTab`/`openTabId`/
  `tabIndex` were; fixed identically. (3) an idle tab rendered with an
  ~8-hour, day-spanning duration — `parseSessions`' day filter only checks
  `endTime` (always "now" for a synthetic record), never `startTime`; fixed
  by clamping to `viewDayStart` (Pass 1 of 2 — real cross-day zoom-out
  deferred, separate discussion). The same corrupted duration also
  explained a second-reported symptom (23 blocks shown instead of 12) —
  one root cause, two visible bugs. Separately, `applyDefaultZoomWindow`
  itself was rewritten from a time-span ESTIMATE (vulnerable to `ZOOM_MAX`
  clamping) to two real `layout()`-measurement passes, still O(n). Full
  specimens and fixes: `decisions/tabmanager.md` "Strip-ordering bugs found
  during implementation"; spec §7c (updated in place, not a new section).
- **2026-08-22/23: open-tab duration was fabricated, not real attention —
  found, investigated, and fixed.** A real specimen (5-6 blocks starting
  within minutes of each other, each ~2hrs wide) led to a real
  investigation: two false leads (Chrome tabId reuse; a `viewDayStart`
  clamp collision) were raised and ruled out against real data (a direct
  `chrome.storage.local` console query) before finding the true, deeper
  issue — `durMs = now - priorSession.startTime` measured "time since
  last visit began," not attention, violating spec §1. Also found: a
  tab WITH real history got a duplicate synthetic object alongside its
  real session (no dedup). Fixed by replacing
  `syntheticSessionsForOpenTabs` with `markOpenTabs` — tags real sessions
  in place (no fabricated timing), synthesizes only for a tab with zero
  real history (`durMs: 0`, honest). Closes the remaining "active tab
  lags" gap with a real flush (`FS_FLUSH_CURRENT`, `background.js`) that
  reuses the exact `finalizeCurrent`/`startSession`/`"tab_hidden"` path a
  real tab switch already uses, by deliberate choice (User: safer to
  reuse the well-tested departure/return container logic than teach it a
  new `endReason`). Fixing this then surfaced two more real, independent,
  pre-existing bugs: the strip's tile list was built from the same
  day-filtered array as the ribbon (silently dropping any open tab not
  used today — fixed with `stripEventsFromOpenTabs`, bypassing the day
  filter for the strip entirely) and uniform mode's scroll position was
  right-justified (hiding pinned tabs by default — fixed to always rest
  left). Finally, `applyDefaultZoomWindow`'s one-shot gate was found
  firing at the wrong moment TWICE, in two rounds (first: on the
  overlay's pre-expand mount render; second, found only via temporary
  console logging: against expand()'s pre-flush data instead of its real
  post-flush data) — fixed by removing the double-render
  (`setHeightMode`'s new `skipPaint` param) rather than re-arming the gate.
- **2026-08-23: ribbon zoom anchors right instead of left** — spec §7d;
  `decisions/tabmanager.md` ("Zoom anchors right, not left"). The expanded
  overlay now rests pinned to "now" at the viewport's right edge with
  history running back to the left, motivated by the coming cross-day
  zoom-out (there is no natural left edge once the ribbon reaches past
  today). Cursor-anchored zoom survives unchanged, now clamped at both
  ends — the pin is what the clamp does when the anchor runs out of room,
  so the `min()` is the whole regime switch. An underflow `marginLeft` pad
  covers the one case `scrollLeft` cannot express (content too narrow to
  scroll); it is 0 whenever content overflows, which is what separates it
  from the permanent lead spacer reverted 2026-08-08. The collapsed strip
  stays left-justified — categorical axis, no "now" to pin to (found live
  during testing). `applyDefaultZoomWindow`'s left-edge `scrollLeft` snap
  deleted as redundant under the pin, and better-degrading without it when
  zoom clamps. `ZOOM_MAX` 8 -> 16, provisional (at 8x a 30-second visit
  was ~9px, against `MIN_W`'s 8px floor).
- **2026-08-23: cross-day ribbon + band floor ladders** — spec §7e;
  `decisions/tabmanager.md` ("Cross-day", "Scroll anchoring", "Fence
  retirement re-tested", "Band floor ladders"). The ribbon now starts at
  today and reaches back through history as the user zooms out, capped at 7
  days. The feared bug (time-vs-datetime math mixing 9am yesterday with 9am
  today) did not exist — `layout()` was always epoch-based, so this was a
  data-windowing change, not a geometry one. Overnight gaps collapse to a
  fixed-width vertical day divider (the one deliberate exception to §6's
  absence-proportional rule) so a day costs O(1) px instead of hours-asleep.
  Scroll anchoring switched to right-relative (`fromRight`), which survives
  prepending a day untouched and subsumes §7d's pin as `fromRight === 0`.
  Day loading triggers on CAPACITY, not scroll position — the first cut used
  an infinite-scroll `scrollLeft` test that could never fire in the underflow
  regime zoom-out lands in. Reach was then capped at ~3 days by `MIN_W`, not
  the zoom range: fences were measured as the fix and rejected (+0.46 days
  for 111 blocks made hover-only), and LOW/MEDIUM instead got offset 8-5-3-drop
  floor ladders whose last rung filters the band out of `layout()` entirely —
  a zero floor alone did nothing, since real width always beat it. HIGH never
  descends, so zoom-out sharpens the importance hierarchy rather than
  flattening it. Measured reach 6 days, up from 1.75. Two open watch items:
  `band-drop-cliff`, `band-drop-absence`.
- **2026-08-23 (same day, follow-on): `OPEN_TAB_MIN_W` (96px) retired** —
  spec §7b/§7e; `decisions/tabmanager.md` ("OPEN_TAB_MIN_W retired"). Found
  from a screenshot: five open tabs with minutes-long durations all rendering
  identically wide, because every `isOpenTab` seg was floored at 96px — 12x
  closed history's `MIN_W`, checked before the band ladder and with no zoom
  awareness. Harmless while the ribbon showed one day; actively harmful once
  zoom-out mattered, since those blocks claimed hundreds of px exactly where
  the new band ladders were reclaiming it. Open tabs now take ordinary
  `MIN_W` and show honest duration, keeping their exemption from the
  band-drop filter (reachable now = stays visible) without extra width for
  it. Marking a block as open is a visual job, not a geometric one; the
  `.open-tab` class is the hook, and the replacement treatment is left to the
  pending strip→ribbon animation rework.
  Full story, every false lead, every specimen: `decisions/tabmanager.md`
  "Open-tab duration was fabricated, not real attention" and its three
  follow-on entries; spec §7c (rewritten in place).
- **Deferred:** zoom, date-picker day jumping (week strip is the only day picker).
- **Watch list:** `WATCHLIST.md` (extracted from spec §6 on 2026-08-07) — the
  single home for every "watch with data" item; SPEC.md holds rules only.
- Old-schema data (pre-`heartbeats`) scores attended-time 0 — clear stored data when
  validating.

## decisions/ index
- `decisions/timeline_design.md` — display-side decision log: score/tiers, labels, the
  color/Kelly saga, fences, two time scales, visit merging, containers, transit
  filter, continuation merge + MEDIUM containers.
- `decisions/capture_design.md` — capture-side decision log: session model, heartbeat
  hybrid counting, filters, audible, SPA debounce, injection hardening, retention.
- `decisions/tabmanager.md` — active tab manager decision log: origin (the
  source doc's full agentic proposal), why it was scoped down to a phased
  build, the four-phase roadmap, rejected alternatives.
- `decisions/snapshot_implementation.md` — the whole tooltip + snapshot story:
  original reasoning and knobs (plan doc folded in 2026-07-18), the five file
  changes, the review fixes (flush-on-hidden trap, `getKeys()`, decode-then-position,
  chunked base64), and the two-layer cleanup.
- Retired 2026-07-18 (text in git history): `code_review_2026-07-15.md` (P0s/P1s
  fixed, remaining P2s not planned), `tooltip_snapshot_plan.md` (merged into
  the snapshot doc), `rules_restructure.md` (ADOPTED 2026-07-18: thread-first
  rewrite of the display rulebook — boundary taxonomy, thread as the display
  atom, atomicity guards, two-rung admission filter — merged into SPEC
  §5/§3/§6 with five amendments recorded in the file header; already deleted
  from the repo by the time this index entry was audited, 2026-08-09).
- Retired 2026-08-09 (text in git history): `rules_restructure2.md` (a
  "pause and re-read the rulebook" review — most findings already adopted or
  superseded by the time it was read; two still-open findings, threshold
  sprawl and two-pass container-chaining risk, moved to `WATCHLIST.md`),
  `visual_redsign.md` (an early raw design proposal predating the decision-log
  convention — fully superseded by SPEC.md §6's monochrome/favicon rules,
  nothing left to carry forward).
