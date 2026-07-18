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
- **Deferred:** `parentId`/opener tracking, zoom, date-picker day jumping (the
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
- `plans/rules_restructure_proposal.md` — PROPOSAL (2026-07-18, undecided):
  thread-first rewrite of the display rulebook (boundary taxonomy, thread as
  the display atom, atomicity guards); spec untouched until compared.
- `plans/tooltip_snapshot_plan.md` — custom tooltip + snapshot previews: the original
  reasoning and decided knobs (both parts live as of 2026-07-16).
- `plans/snapshot_implementation.md` — snapshot previews as built: the five file
  changes, the review fixes (flush-on-hidden trap, `getKeys()`, decode-then-position,
  chunked base64), and the two-layer cleanup.
- `plans/code_review_2026-07-15.md` — prioritized code/doc review; P0s + P1s fixed
  2026-07-15, P2s deliberately skipped for the demo.
