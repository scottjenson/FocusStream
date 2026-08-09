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
