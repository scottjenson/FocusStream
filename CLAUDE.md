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
  `dashboard/` (full-tab UI; `timeline.js` is the primary view's pipeline).
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
  is now "N brief visits".
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
