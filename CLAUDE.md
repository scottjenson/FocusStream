# FocusStream (Lifestreams Telemetry Chrome Extension)

Personal Chrome Extension (Manifest V3) that tracks attention per URL and renders a
chronological, activity-weighted "Lifestreams" timeline.

**The full specification lives in `SPEC.md` — read it before implementing
anything.** This file is orientation only; the spec is the source of truth for rules,
data structures, and edge cases. The *reasoning* behind each rule (evidence, rejected
alternatives, dated history) lives in `plans/` — see the index below.

## Workflow
- **Spec changes are proposed and approved BEFORE code changes.** Never backfill.
- Never `git commit`/`git push` without explicit approval.
- **Docs discipline (2026-07-17):** the spec holds RULES ONLY — a new decision
  lands there as 2–4 sentences + a date tag; the full story (evidence, rejected
  alternatives, history) goes in the matching `plans/` log. Never write the
  story in both places.

## Stack & debugging
- Vanilla JS, no build step, no framework, no dependencies. Load unpacked via
  `chrome://extensions` (Developer mode).
- Files: `manifest.json`, `background.js` (service worker), `content.js`,
  `dashboard/` (full-tab UI; `timeline.js` is the primary view's pipeline),
  `shared/` (code loaded by both worker and dashboard — `transit.js` holds
  `FS_TRANSIT`, the transit predicate + knobs).
- **Logging convention (keep it):** liberal `console.log` with prefixes — `[FS bg]`,
  `[FS content]`, `[FS dash]`, `[FS timeline]` — so consoles are filterable. Log every
  lifecycle transition, heartbeat, and quiet window.
- Debug tools: the toolbar icon opens the dashboard AND console.tables all sessions in
  the worker console. The dashboard's **Score table** button scores every session with
  the live §6 formula (`window.FS_SCORING`, exported by timeline.js — single source of
  truth) and copies TSV — the tool for threshold/weight tuning sessions.

## Design philosophy (spec §5)
- **Importance = intent, not duration.** Taxonomy: bounce (demote), side-quest (short
  but high-intent — highlight, never absorb), dwell. Interruptions are meaningful:
  grouping uses STRICT adjacency; gap-tolerant merging is forbidden (containers are the
  one principled exception — they frame interruptions, never hide them).
- **The timeline is the PRIMARY view** (Scott, 2026-07-15). The debug session
  list was removed 2026-07-17 — debug surfaces are the worker console dump and
  the Score table.
- Eventual pivot: horizontal Lifestreams — width = time, salience = intent.

## Load-bearing invariants (rationale in spec + plans/)
- Only active (visible, focused) tabs accrue activity; tab switch finalizes the session.
- The unfinalized session lives in `chrome.storage.session`, never worker memory (MV3
  workers die ~30s idle). Finalized blocks go to `chrome.storage.local`, pruned past
  7 days at finalize.
- Only *active* heartbeats are sent (10s windows); duration comes from timestamps.
  Activity is per-signal totals, never one summed score; discrete signals count raw
  events, continuous signals count active windows.
- Only http/https/file URLs are captured; browser-internal pages render as gaps.
- Auto-inject on install/reload, with a duplicate-injection guard (`window.__fsLoaded`);
  orphaned instances self-destruct via AbortController on their first post-reload tick.
- Attention = max(heartbeats×10, audibleSeconds) — audible is event-driven, no polling.
- Titles refresh on every heartbeat (SPAs set them late); `id` is opaque, never a
  timestamp.
- Score weights are provisional (Desktop4-inherited) — keep them named constants, and
  turn one knob at a time (thresholds held until label gating is evaluated).

## Status (2026-07-17)
- **Phases 1–3b live:** capture loop + edge cases (SPA debounce + noise filter, media,
  audible, downloads, blip filter, auto-inject) and the horizontal timeline (color
  registry + Kelly-16 palette, fences incl. singletons, visit merging, containers,
  two time scales, day paging, custom tooltips, transit filter, importance-gated
  labels).
- **Snapshot previews live (2026-07-16):** capture on first heartbeat only (never on
  flush-on-hidden — wrong-tab trap), 640px JPEG `data:` URLs under `snap:<id>` keys,
  tooltip image with decode-then-position, two-layer cleanup (finalize prune + startup
  orphan sweep via `getKeys()`, never `get(null)`). Spec §6 has the condensed rules;
  as-built details in `plans/snapshot_implementation.md`.
- **2026-07-17:** both time scales halved (135px/hr presence, 22px/hr absence),
  room-keyed hour-label meridiem dropping, week strip header (skyline cells,
  click-to-jump paging), debug session list removed, full-dark page, and spec §6
  rewritten rules-only (history moved to `plans/timeline_design.md`).
- **2026-07-18:** two capture holes closed (tab adoption on navigation, iframe
  input relay — spec §3); audible no longer saves sub-10s sessions from the
  transit filter; continuation merge (same-tab machinery-boundary runs join
  regardless of band) + containers lowered to sum ≥ MEDIUM with anchor
  dominance — SPA-continuation merging closed as subsumed (spec §6); color
  re-rationed to week-scoped HIGH anchoring with registry tombstones
  (transient colors retired — spec §6).
- **2026-07-19:** atomicity guard 1 relaxed — a HIGH may seed/join its *own host's*
  chain in its own tab (foreign-host HIGHs now close the chain); fixes the ping-pong
  decapitation where the tool's chain framed the work's fragments; overlap contests
  now trim-and-retest the loser instead of winner-take-all, so sequential handoffs
  frame as flush containers rather than shattering the loser's uncontested run
  (spec §6; stories + week replays in `plans/timeline_design.md`). Opener-edge
  capture shipped (was deferred as `parentId`): sessions carry `openerTabId`, and
  chains key on the (tab-tree, host) pair — a feed tab and its spawned tabs read as
  one thread (spec §2/§3/§6; story in `plans/capture_design.md`; audit via the Score
  table's new `opener` column — old data has no edges and stays flat). Site naming:
  a title segment exactly matching a hostname label wins outright (WorkFlowy was
  labeled by its tagline — spec §6; story in `plans/timeline_design.md`).
- **2026-07-24:** contained LOW children collapse to fence sticks (spec §6) —
  containers were the one surface granting LOW block stature; "containment
  frames, never confers" is now bidirectional. Same-day revision after visual
  verification: LOW height lowered globally (86 → 40; one height per tier —
  a contained-only stature would read as a fourth tier) and the stick seam
  made transparent (visible slit 3px, hover box 7px). Story in
  `plans/timeline_design.md`; escalation path — same-host stick
  aggregation — on the watch list. Same day: fence split went plate-based
  (`FENCE_SPLIT_GAP_MS` ≈ 16 min derives from `GAP_PLATE_MIN_PX`; was the
  5-min `VISIT_GAP_MS`) — adjacent stick runs merge into one big expand
  target, and a fence can only span gaps too small to hover; plate wording
  is now "N brief visits". Same day: terminal-keystroke discount — a Cmd+W
  glance no longer survives the transit filter (the close chord's keydown
  was counting as engagement); capture records `lastKeyGapMs` on
  flush-on-hidden + pure-modifier keydowns no longer count, display
  discounts one terminal keystroke (`TERMINAL_KEY_MS` 500ms); `keyGap`
  audit column in the Score table (spec §3; stories split
  capture/display across the two plans logs). Same day: snapshot capture
  unified with the transit filter — every session that survives transit has
  a screenshot: capture fires on first interval heartbeat OR first
  qualifying-signal cue (whichever wins, deduped by an explicit `snapped`
  flag), finalize deletes the picture of rejected sessions, and the transit
  predicate moved to `shared/transit.js` (`FS_TRANSIT`, loaded by worker +
  dashboard) so capture and display can never drift (spec §3/§6; story in
  `plans/snapshot_implementation.md`). Same day: the traversal term —
  `W_NAV` 50 per thread-assembly join (merged-visit navigations/returns +
  container returns), the Airbnb-booking specimen's fix; user-act gate and
  raw click weighting rejected on a one-day TSV replay; **retest with a
  full week ~2026-07-28** (spec §6 Score v1 + watch list; story in
  `plans/timeline_design.md`). Same day: the succession join — third merge
  license (same-tree same-host across `tab_closed`, <30s): a middle-click
  tab batch reads as ONE session; `tab_hidden` stays container territory
  (spec §6; story in `plans/timeline_design.md`) — plus exit inheritance:
  a transit-dropped stub bequeaths its `endReason` to the same-tab
  machinery run it would have joined, so boundary testimony survives the
  filter (spec §6, same story). Same day: gap-audio testimony — the
  container audio-bookend bridge (≥50% bookends) replaced by direct
  evidence: capture keeps a per-tab audible-continuity timestamp (event
  transitions only, zero background polling) stamped as `audibleSinceTs`;
  a long gap bridges only if the resuming fragment's audio predates the
  gap. Kills the YouTube-binge-swallows-Claude false positive; meetings
  still frame; additive schema, no history wipe (spec §2/§3/§6; stories in
  both plans logs).
- **2026-07-25:** spawn-edge dominance discount — a contained child whose tab's
  opener path reaches a chain member's tab (≥1 edge; same-tab interleaves keep
  full weight) drops out of the dominance denominator, but the anchor must still
  individually outscore every discounted spawn. Fixes the Gmail↔Calendar↔cal.com
  scheduling-shuffle standoff (three chains mutually failing dominance); week
  replay showed exactly two changes, both approved (spec §6; story + rejected
  variants in `plans/timeline_design.md`; retest with the ~07-28 `W_NAV` week).
  Same day: middle title segments join the hostname match (naming only, never
  the invariance contest) — Workspace's `domain - App - page` style had Calendar
  labeled "Jenson.org"; now "Calendar" (spec §6; story in the same plans log).
  Same day: google.com label split — the one recorded multi-app host; for LABELS
  ONLY the grouping key appends the first path segment (`google.com/maps` vs
  `google.com/search`, `LABEL_SPLIT_HOSTS`), so Maps blocks stop labeling
  "Google Search"; identity stays hostname-keyed; general multi-app mechanism
  designed and rejected (spec §6; story in `plans/timeline_design.md`).
- **2026-07-28:** fences bridge breaks, split at departures —
  `FENCE_BRIDGE_GAP_MS` (30 min, wall-clock and deliberately NOT derived from
  `GAP_HOUR_PX`; replaces the ~16 min `FENCE_SPLIT_GAP_MS`) encodes "a step
  away vs. a walk away from the machine". A scattered grazing morning is now
  one expand target instead of three. The same constant now gates the away
  hover plate — only departures get one, `GAP_PLATE_MIN_PX` retired — so a
  collapsed fence is one hover target by construction and small gaps stop
  being tedious targets (a week had ~28 plated gaps, half inside fences).
  Retires "never steal a gap's hover plate"; layering the gap plates over
  the fence was tried first and made hovering alternate stick by stick
  (story in plans). Gap rendering never changed. Threshold picked
  off a bimodal histogram (07-28: grazing < 8 min, step-aways 19–21 min,
  nothing between — the 22–40 min dead zone is recorded); untested against a
  real lunch break, on the watch list (spec §6; story in
  `plans/timeline_design.md`). Same day: site naming simplified — the
  hostname match now reads EVERY segment of EVERY title (a separator-free
  title is a one-segment title) and matches a hostname label **or the full
  hostname**; the invariance contest keeps the separator/first-last filters
  it actually needs. Subsumes the 07-25 middles carve-out (`midCounts` and
  the `matchable` merge deleted — fewer passes, one less rule). Fixes
  rutracker labeled "Smart Girl" (ten `RuTracker.org` titles were filtered
  out before the match could see them) plus Gemini/Plex/Vercel/Scatterpad,
  and names 9 previously-unnamed hosts incl. Amazon.com. Week replay: 137
  keys, 123 unchanged, 14 changed, zero regressions (spec §6; story in
  `plans/timeline_design.md`).
- **2026-08-02:** site naming gained a word-boundary containment fallback —
  when no segment equality-matches a hostname label, a segment may still
  contain one as a whole word ("Car Rentals from Avis" contains "Avis"),
  returning the verbatim-cased word; tried only after equality fails (spec
  §6; story in `plans/timeline_design.md`). Same day: floor-attended
  copy/cut discount — a lone copy/cut on a session at or below 20s attended
  time (≤2 heartbeats) was crossing `MED_SCORE` on that single click alone
  regardless of context (a 9s SMS 2FA copy, a WorkFlowy glance, a YouTube
  page); `W_COPY`/`W_CUT` now discount to `W_PASTE`'s tier (80) at that
  floor — gate is attended-time only, since keyboard count had no natural
  noise/signal split across a week's data (spec §6 Score v1; story in
  `plans/timeline_design.md`). Same day: adjacent-container chaining —
  `detectContainers` never reconsidered its own output, so same-host
  containers/visits a few minutes apart (a returning-to-LinkedIn pattern
  with brief step-aways) rendered as unrelated blocks under one
  collision-avoided label; `assembleThreads` now runs the identical
  chain-and-qualify logic a second time on its own output at a new, looser
  `CONTAINER_CHAIN_GAP_MS` (10 min, no natural cliff in a week's gap
  distribution — judgment call, watch list). Verified against live data on
  the LinkedIn specimen and an unrelated same-day Gemini cluster (spec §6;
  story in `plans/timeline_design.md`).
- **Deferred:** zoom, date-picker day jumping (the
  week strip is the only day picker as of 2026-07-17; ‹/› header nav removed).
- **Watch list:** consolidated in spec §6 ("Watch list") — the single home for every
  "watch with data" item.
- Old-schema data (pre-`heartbeats`) scores attended-time 0 — clear stored data when
  validating.

## plans/ index
- `plans/timeline_design.md` — display-side decision log: score/tiers, labels, the
  color/Kelly saga, fences, two time scales, visit merging, containers, transit
  filter, continuation merge + MEDIUM containers.
- `plans/capture_design.md` — capture-side decision log: session model, heartbeat
  hybrid counting, filters, audible, SPA debounce, injection hardening, retention.
- `plans/rules_restructure.md` — ADOPTED 2026-07-18: thread-first
  rewrite of the display rulebook (boundary taxonomy, thread as the display
  atom, atomicity guards, two-rung admission filter), merged into SPEC
  §5/§3/§6 with five amendments recorded in the file header.
- `plans/snapshot_implementation.md` — the whole tooltip + snapshot story:
  original reasoning and knobs (plan doc folded in 2026-07-18), the five file
  changes, the review fixes (flush-on-hidden trap, `getKeys()`, decode-then-position,
  chunked base64), and the two-layer cleanup.
- Retired 2026-07-18 (text in git history): `code_review_2026-07-15.md` (P0s/P1s
  fixed, remaining P2s not planned), `tooltip_snapshot_plan.md` (merged into
  the snapshot doc).
