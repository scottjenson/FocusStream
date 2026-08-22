# Active Tab Manager — Decision Log

Reasoning/story behind `spec/tabmanager.md` (§7). One accumulating file
across all phases, like `decisions/timeline_design.md` holds the ribbon's
entire multi-month history in one place — new phases append dated entries
here rather than spawning per-phase files.

## Origin (2026-08-21)

A Google Doc ("FocusStream Active Switcher Specification") proposed a full
architectural pivot: moving FocusStream from passive, retrospective
telemetry (SPEC.md §1 — "we do not care about tab management") to an
**agentic, self-evicting tab-management system** — the background script
would actively call `chrome.tabs.remove()` on low-scoring tabs in real
time, promoting the display-time Rung 2 admission filter (`capture.md` §3)
to a capture-time eviction invariant.

**Why this wasn't adopted whole:** the doc's scoring formula is the same
Score v1 that SPEC.md §6 itself flags as `⚠ Provisional: all
weights/thresholds are Desktop4-inherited`. Auto-closing a real browser tab
is destructive and irreversible from the extension's point of view — an
untuned formula making that call in real time risks closing tabs the user
actually wanted, with no way to validate the formula against real usage
before it starts acting. Building the full agentic system in one pass was
considered and rejected for exactly this reason.

**What was separately confirmed as originally-lost context motivating this
whole redesign (not from the doc — from the user directly):** an earlier
detour into an apps/SQLite-backed model with a different display had lost
three things the ribbon view had: visible event *duration*, visible
*contained* items, and — because that display had to stay always-visible
on screen at once — enough space to browse comfortably. The tab-manager
redesign is partly a way to reclaim browsability (a live view doesn't need
to show a whole day at once; a history view can zoom into hours instead)
while keeping duration/containment intact from the existing ribbon.

## Phase breakdown (adopted 2026-08-21)

Scoped down from the doc's single-pass proposal into four phases, each a
separate go/no-go decision rather than one committed build:

1. **Live tab strip (spec §7, this phase — building now):** an on-page,
   shadow-DOM UI showing currently open tabs, click-to-switch. Pure
   display layer over the *existing* unchanged capture pipeline — no
   scoring, no eviction, no new persistence. Validates the on-page
   injection mechanism and the live-tab data flow before anything
   destructive is built on top of it.
2. **Full card/ribbon view, integrated:** expand the same surface into
   something closer to today's dashboard ribbon (duration, containment,
   the full taxonomy) — but reachable from the live view rather than only
   the standalone dashboard tab. Exact expansion mechanism (in-page
   overlay? triggered panel? still the separate dashboard tab, just
   fed differently?) is undecided — to be designed when Phase 1 is
   stable.
3. **Auto-close eviction:** the doc's original core proposal —
   `chrome.tabs.remove()` on low-scoring tabs, Keep-Alive scoring,
   Self-Eviction Invariant (close only after the session's `snap:id`/
   `snapErr` is confirmed in `storage.local`, so a closed tab never loses
   its capture). Undesigned in detail; when it's picked up, the question
   raised in Phase 1 planning — dry-run/log-only first vs. live from day
   one — needs a real answer before any `chrome.tabs.remove()` call ships.
4. **Active→historical reconciliation:** how a tab closed by eviction (or
   just closed normally) folds into the existing container/thread
   assembly in the historical ribbon (§6) — e.g. does closing an actively-
   tracked tab make it join an existing container the way a departure or
   absence would today? Undesigned; explicitly the open question the user
   raised when confirming this roadmap ("closing a tab could have it join
   an existing container").

## Rejected alternatives

* **Build the full doc as one pass** (scoring + live eviction + new
  display, all at once) — rejected: no way to validate the scoring
  formula against real usage before it starts closing tabs (see Origin).
* **Phase 1 as overlay (fixed-position, floats on top of page content)**
  — rejected in favor of push-down layout: an overlay would cover a
  site's own fixed header/nav; push-down reserves real space instead,
  closer to a genuine second tab bar. Trade-off noted in
  `WATCHLIST.md` (sticky-header collision risk on the *document* reflow
  even though layout is otherwise correct).
* **Phase-1-only spec file (`spec/switcher.md`, scoped to just the strip)**
  — rejected in favor of one growing `spec/tabmanager.md` spanning all
  phases, matching how `capture.md`/`display.md` are themselves
  append-only rule sets rather than phase-numbered files.
