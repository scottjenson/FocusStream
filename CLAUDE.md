# FocusStream (Lifestreams Telemetry Chrome Extension)

Personal Chrome Extension (Manifest V3) that tracks attention per URL and renders a
chronological, activity-weighted "Lifestreams" timeline.

## Documentation map

**Five files, five jobs — never write the same content in two.**

| File | Job | Belongs here if... |
|---|---|---|
| `CLAUDE.md` (this file) | How to work on this project | It would be true even with the project's history erased — workflow, stack, file map, design philosophy |
| `SPEC.md` + `spec/capture.md` + `spec/display.md` | What the system currently does | It has a truth-value today (does X happen, what's the threshold) — rules only, 2-4 sentences + date tag, no story |
| `WATCHLIST.md` | Open doubts about current SPEC.md rules | It's a live trade-off, not yet a bug, not yet resolved |
| `decisions/*.md` | Permanent per-subsystem reasoning archive — evidence, rejected alternatives, dated story | It's the durable "why" behind an *adopted* SPEC.md rule |
| `HISTORY.md` | Chronological index — what shipped when, pointing at the SPEC.md rule and the decisions/ story | It's a dated pointer entry, not content itself |

**Read `SPEC.md` before implementing anything** — it's the source of truth
for rules, data structures, and edge cases, and the ~40-line index into its
two sub-files (split 2026-08-09, one 301-line file was too much to read for
any single change): `spec/capture.md` (§3–§4, capture-side) and
`spec/display.md` (§5–§6, display-side) — section numbers carried over
unchanged, so every existing `§N` reference elsewhere still resolves.
`decisions/` is not for in-flight drafts: a proposal either gets adopted
(fold into SPEC.md/spec/ + its matching decisions/ log) or gets abandoned
(delete; note in `HISTORY.md` if worth a one-line record).

**Order when closing out a change that involved real reasoning (evidence,
an alternative that lost, a specimen that forced it):** update SPEC.md
and/or `decisions/` FIRST, `HISTORY.md` LAST — HISTORY.md only ever points at
the other two, it never carries the reasoning itself. A HISTORY.md line
with nothing in SPEC.md or decisions/ to point at is incomplete; see the
checklist at the top of `HISTORY.md` before appending there.

## Workflow
- **Spec changes are proposed and approved BEFORE code changes.** Never backfill.
- Never `git commit`/`git push` proactively. If asked to commit directly you can 
  proceed without further confirmation.
- **Score weights are provisional** (Desktop4-inherited) — keep them named
  constants, turn one knob at a time.

## Stack & debugging
- Vanilla JS, no build step, no framework, no dependencies. Load unpacked via
  `chrome://extensions` (Developer mode).
- Files: `manifest.json`, `background.js` (service worker), `content.js`,
  `dashboard/` (full-tab UI; `timeline.js` is the primary view's pipeline),
  `shared/` (code loaded by both worker and dashboard — `transit.js` holds
  `FS_TRANSIT`, the transit predicate + knobs; `utility.js` holds other
  cross-boundary pure functions, e.g. site-name derivation). `background.js`
  is a module worker (`"type": "module"`, manifest.json) so it can import
  `shared/` directly.
- **Logging convention (keep it):** liberal `console.log` with prefixes — `[FS bg]`,
  `[FS content]`, `[FS dash]`, `[FS timeline]` — so consoles are filterable. Log every
  lifecycle transition, heartbeat, and quiet window.
- Debug tools: the toolbar icon opens the dashboard AND console.tables all sessions in
  the worker console. The dashboard's **Score table** button scores every session with
  the live §6 formula (`window.FS_SCORING`, exported by timeline.js — single source of
  truth) and copies TSV — the tool for threshold/weight tuning sessions.
- **The timeline is the PRIMARY view** see SPEC.md §5 for
  the intent/duration rules this stance motivates.

## History
`HISTORY.md` holds the full chronological changelog and the `decisions/` index —
read it once when picking up the project cold; not needed for most individual
tasks. Append new dated entries there, never here.
