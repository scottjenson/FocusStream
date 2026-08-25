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
| `timeline_design.md` | Display side: score/tiers, labels, the color/Kelly saga, fences, two time scales, visit merging, containers, transit filter, MEDIUM containers. Also the doc-structure decisions (2026-08-25). |
| `capture_design.md` | Capture side: session model, heartbeat hybrid counting, filters, audible continuity, SPA debounce, injection hardening, retention. |
| `tabmanager.md` | Active Tab Manager (§7): origin (the source doc's agentic proposal), why it was scoped to a phased build, the four-phase roadmap, rejected alternatives. **Holds the phase roadmap** — phases never get their own file. |
| `snapshot_implementation.md` | Tooltips + snapshots: original reasoning and knobs, the review fixes (flush-on-hidden trap, `getKeys()`, decode-then-position), the 3rd-heartbeat re-capture. |
| `card_deck.md` | The stack-ribbon card deck: why it was attempted, what each stage delivered, and its migration status. Merged from the dissolved `plans/` directory 2026-08-25. |

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
