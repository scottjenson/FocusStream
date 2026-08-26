# Decision logs — index

One log per subsystem, each an accumulating dated archive of *why* a rule in
`SPEC.md`/`spec/` is the way it is: evidence, rejected alternatives, the
specimen that forced it. Rules themselves live in the spec; this directory
never states current behavior.

**This index describes FILES, not changes.** It goes stale only when a log is
created, retired, or changes scope — roughly six times in three months. Do
not append per-session entries here: that is what `HISTORY.md` did (470 lines
duplicating 116 commits) and why it was deleted 2026-08-25. Session work is
recorded in the relevant log itself, and `git log` is the change history.

| Log | Covers |
|---|---|
| `timeline_design.md` | Display side (Track B): score/tiers, labels, the color/Kelly saga, fences, two time scales, visit merging, containers, transit filter, MEDIUM containers. Also the doc-structure decisions (2026-08-25) and, since 2026-08-25, the ribbon-navigation entries moved from `tabmanager.md` (zoom, cross-day, band ladders, coordinate system, panning — rules in `spec/ribbon.md`). |
| `capture_design.md` | Capture side: session model, heartbeat hybrid counting, filters, audible continuity, SPA debounce, injection hardening, retention. |
| `tabmanager.md` | **CLOSED 2026-08-25.** The injected tab strip (§7, §7b, §7c-strip, §7f, §7i): origin, the phased build, and the closing entry recording what the exploration returned. Its ribbon-side entries moved to `timeline_design.md`; its successor is `parkinglot.md`. |
| `snapshot_implementation.md` | Tooltips + snapshots: original reasoning and knobs, the review fixes (flush-on-hidden trap, `getKeys()`, decode-then-position), the 3rd-heartbeat re-capture. |
| `parkinglot.md` | The Parking Lot (§8): why the §7 tab/ribbon merge returned a negative result, the three tab populations, closure-not-attention as the discriminator, displacement over classification, and the four-phase roadmap. **Supersedes `tabmanager.md` as the live-surface direction.** |

## Retired logs (text recoverable from git history)

- **2026-07-18:** `code_review_2026-07-15.md` (P0s/P1s fixed, remaining P2s
  not planned); `tooltip_snapshot_plan.md` (merged into
  `snapshot_implementation.md`); `rules_restructure.md` (ADOPTED — thread-first
  rewrite of the display rulebook: boundary taxonomy, thread as the display
  atom, atomicity guards, two-rung admission filter; merged into SPEC §5/§3/§6).
- **2026-08-09:** `rules_restructure2.md` (a re-read review; most findings
  already adopted or superseded, two open findings moved to `WATCHLIST.md`);
  `visual_redsign.md` (early design proposal, fully superseded by §6's
  monochrome/favicon rules).
- **2026-08-25:** `plans/stack-ribbon.md` → merged into `card_deck.md`;
  `plans/ribbon-toggle.md` → deleted (unapproved proposal, superseded by §7).
- **2026-08-25:** `card_deck.md` (with the `plans/stack-ribbon.md` text it
  had absorbed) — the card view was deleted from the code, leaving the block
  ribbon as the one display path. Its layout ideas were NOT harvested:
  uniform-width-per-tier contradicts the ribbon's claim that width is
  duration, so it is rejected, not pending. The deletion's own reasoning is
  in `timeline_design.md`; earlier entries there still cite `card_deck.md`
  for build-facing stage detail, recoverable from git.
