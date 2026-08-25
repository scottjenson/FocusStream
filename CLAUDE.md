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
| `decisions/README.md` | Index of the decision logs — one line each, plus retired ones | It describes a decision FILE's scope, not a change |

**Read `SPEC.md` before implementing anything** — it's the source of truth
for rules, data structures, and edge cases, and the index into its sub-files
(first split 2026-08-09; one 301-line file was too much to read for any
single change). Section numbers carry over unchanged through every split, so
every existing `§N` reference elsewhere still resolves:
| file | covers | status |
|---|---|---|
| `spec/capture.md` | §3–§4, capture-side | current |
| `spec/display.md` | §5–§6, display-side | current |
| `spec/ribbon.md` | §7c–§7h, ribbon navigation (zoom, cross-day, panning) | **temporary — drains into §6** |
| `spec/parkinglot.md` | §8, the parking lot | current, nothing built yet |
| `spec/tabmanager.md` | §7, the injected tab strip | **CLOSED, historical** |

**Two tracks (2026-08-25).** Track A (live surface: extension icon, parking
lot — §8) is phased; Track B (history surface: the ribbon — §5–§6 + §7c–§7h)
is ongoing and unphased. They are orthogonal; the only coupling is §8 Phase
1's handoff. **`spec/ribbon.md` and `spec/tabmanager.md` both disappear
eventually** — the end state is one display spec (`spec/display.md`) and one
display decision log (`decisions/timeline_design.md`). `ribbon.md` drains
into §6 as Track B resolves the three §6/§7e conflicts; do not merge it
early, since those conflicts are why it is separate. Full statement:
`SPEC.md`, "7c–7h. Ribbon navigation".
`decisions/` is not for in-flight drafts: a proposal either gets adopted
(fold into SPEC.md/spec/ + its matching decisions/ log) or gets abandoned
(delete; note it in the relevant `decisions/` log if worth a record).

**When closing out a change that involved real reasoning (evidence, an
alternative that lost, a specimen that forced it):** update SPEC.md and/or
the relevant `decisions/` log. There is no separate changelog to update —
`git log` is the change history (`HISTORY.md` was deleted 2026-08-25 as 470
lines duplicating it; see `decisions/timeline_design.md`).

## Workflow
- **Understand in code, then write it down** (revised 2026-08-25, replacing
  "spec before code, never backfill"). Most changes here need a coding loop or
  two before the real rule is even knowable — speccing first meant speccing a
  guess. Explore and test in code, THEN record what turned out to be true.
  Still true: don't ship a rule change silently, and don't write the spec from
  what you intended rather than what you verified. Use `/updatedocs` to close out.
- **Docs earn their length.** They are ~16:1 reasoning-to-rules and too long to
  be read, which makes them worse than shorter ones. Record what a future
  reader needs and can't recover from the code — not how the answer was found.
  Three skills cover the lifecycle: **`/newfeature`** starts an exploration
  (spec stub + decision log), **`/updatedocs`** records each session (adds
  only, never restructures), **`/docaudit`** is the occasional deep pass that
  deletes accumulated drift.
- **Starting a new exploration: `/newfeature`.** It runs the framing
  questions, then creates `spec/<feature>.md` (a stub, before building) and
  `decisions/<feature>.md` (origin + phase roadmap). **Write the spec stub
  even when the idea might be reverted** — that is exactly when it matters.
  The card deck skipped it as appropriate humility, and its rules ended up
  with nowhere to live but a plan doc (`decisions/card_deck.md`).
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
- **Before changing an assembly rule (chaining, merging, containers), replay it
  against real data:** `testing/replay-rules.mjs` runs the actual pipeline
  (`dashboard/assembly.js` is a pure ES module) over an exported
  `chrome.storage.local` dump and reports how many containers changed and
  which ones. Plain Node, no dependencies; usage in `testing/README.md`.
  The standing acceptance test is that the specimen splits while the total
  block/container count barely moves — **a large increase means the rule is
  shattering containers elsewhere.** Reaches back only as far as the 7-day
  retention window. Worked example: `decisions/timeline_design.md`,
  "Back-to-back same-host events".
- **The timeline is the PRIMARY view** see SPEC.md §5 for
  the intent/duration rules this stance motivates.

## Picking up cold
`decisions/README.md` indexes the decision logs — read it first to see which
subsystem holds what. For when a change happened, use `git log`.
