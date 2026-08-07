# FocusStream (Lifestreams Telemetry Chrome Extension)

Personal Chrome Extension (Manifest V3) that tracks attention per URL and renders a
chronological, activity-weighted "Lifestreams" timeline.

**The full specification lives in `SPEC.md` — read it before implementing
anything.** This file is orientation only; the spec is the source of truth for rules,
data structures, and edge cases. The *reasoning* behind each rule (evidence, rejected
alternatives, dated history) lives in `plans/` — see the index below. Open concerns
about those rules (trade-offs, provisional thresholds, unresolved edge cases) live in
`WATCHLIST.md`, not the spec.

## Workflow
- **Spec changes are proposed and approved BEFORE code changes.** Never backfill.
- Never `git commit`/`git push` without explicit approval.
- **Docs discipline (2026-07-17; extended to Status + CLAUDE.md/SPEC.md line
  2026-08-07; extended to the SPEC.md/WATCHLIST.md split same day):** the
  spec holds RULES ONLY — a new decision lands there as 2–4 sentences + a
  date tag; the full story (evidence, rejected alternatives, history) goes in
  the matching `plans/` log; open doubts about a rule (not the rule itself)
  go in `WATCHLIST.md`. Never write the same content in two of these three
  places. **The same bar applies to this file's own Status section**: one
  line per dated entry — headline + spec section + plans/ file — never
  mechanism, specimens, or rejected alternatives (Status drifted into
  repeating them once already, which is what necessitated the 2026-08-07
  trim). If a Status entry is growing past one line, that detail belongs in
  spec + plans/, not here.
  **CLAUDE.md vs. SPEC.md test:** CLAUDE.md holds only what changes HOW you
  approach any task — workflow, stack, file map, design philosophy. A
  specific behavioral rule with its own truth-value (does X happen, what's
  the threshold, what triggers what) belongs in SPEC.md, even if that means
  a one-line pointer here instead of restating it. "Load-bearing invariants"
  used to restate 7 SPEC.md §3/§4 rules near-verbatim — same drift as Status,
  fixed the same day; don't recreate a second copy of a spec rule here.

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

## Load-bearing invariants
The full list of capture/session behavioral rules — active-tab accrual, session
storage lifecycle, the heartbeat model, URL filtering, injection hardening,
attention formula, title timing — is SPEC.md §3/§4; read it before touching
capture code. One workflow-only note that isn't a spec rule: score weights are
provisional (Desktop4-inherited) — keep them named constants, turn one knob at
a time (thresholds held until label gating is evaluated).

## Status (2026-08-07)
A third thing, neither process (Workflow) nor rule (SPEC.md): a **chronological
changelog/index** over the same underlying facts SPEC.md organizes topically —
read once when picking up the project cold, not needed for most individual
tasks. Full mechanism/specimen detail for every entry below lives in spec §3/§6
(rules) and the matching `plans/` log (story) — never repeated here. One line
per dated entry: what shipped, when, where to read the rule and the reasoning.
- **Phases 1–3b live:** capture loop + edge cases, horizontal timeline (fences,
  visit merging, containers, two time scales, day paging, tooltips, transit
  filter, importance-gated labels) — spec §3/§6.
- **Snapshot previews live (2026-07-16, unified with transit filter 2026-07-24):**
  `plans/snapshot_implementation.md`.
- **2026-07-17:** timeline visual pass (scales, week strip, dark page) + spec §6
  rewritten rules-only — `plans/timeline_design.md`.
- **2026-07-18:** capture holes closed (tab adoption, iframe relay), continuation
  merge, color re-rationed to HIGH anchoring — spec §3/§6; `plans/timeline_design.md`,
  `plans/capture_design.md`.
- **2026-07-19:** atomicity guard 1 relaxed, overlap trim-and-retest, opener-edge
  capture, hostname-label site naming — spec §2/§3/§6; `plans/timeline_design.md`,
  `plans/capture_design.md`.
- **2026-07-24:** contained-LOW→stick collapse, plate-based fence split,
  terminal-keystroke discount, snapshot/transit-filter unification, `W_NAV`
  traversal term, succession join + exit inheritance, gap-audio testimony —
  spec §3/§6; `plans/timeline_design.md`, `plans/snapshot_implementation.md`,
  `plans/capture_design.md`.
- **2026-07-25:** spawn-edge dominance discount, middle-segment hostname
  matching, google.com label split — spec §6; `plans/timeline_design.md`.
- **2026-07-28:** `FENCE_BRIDGE_GAP_MS` departure-split (retires
  `FENCE_SPLIT_GAP_MS`/gap plates), site-naming simplified to
  every-segment/full-hostname matching — spec §6; `plans/timeline_design.md`.
- **2026-08-02:** word-boundary containment site-naming fallback, floor-attended
  copy/cut discount, adjacent-container chaining — spec §6; `plans/timeline_design.md`.
- **2026-08-06:** same-tab HIGH pass-through in continuation merge — spec §6
  Atomicity; `plans/timeline_design.md`.
- **2026-08-07:** page-text search capture, stage 1 (vendored Readability.js,
  intent-gated, plain text, not yet privacy-hardened) — `plans/capture_design.md`.
- **2026-08-07:** earned-HIGH atomicity in adjacent-container chaining (two
  back-to-back Meet calls no longer fuse into one container) — spec §6;
  `plans/timeline_design.md`.
- **Deferred:** zoom, date-picker day jumping (week strip is the only day picker).
- **Watch list:** `WATCHLIST.md` (extracted from spec §6 on 2026-08-07) — the
  single home for every "watch with data" item; SPEC.md holds rules only.
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
