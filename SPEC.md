# Project Specification: Lifestreams Telemetry Chrome Extension

**Split 2026-08-09** (was one 301-line file) to shrink the read cost of any
single change: §1–§2 (overview + architecture) stay here since both capture
and display need them; §3–§4 (capture rules) live in `spec/capture.md`; §5–§6
(display rules) live in `spec/display.md`. Section numbers are unchanged from
before the split — every `§3`/`§4`/`§5`/`§6` reference elsewhere in the repo
still resolves correctly. Read this file first, then the half you need —
capture-side work (`content.js`, `background.js`) needs `spec/capture.md`;
display-side work (`dashboard/`) needs `spec/display.md`. Rules only in all
three files; the reasoning lives in `decisions/`, open doubts in
`WATCHLIST.md` (see CLAUDE.md's Documentation map).

## 1. Project Overview & Philosophy
**Goal:** Build a personal Chrome Extension (Manifest V3) that tracks user activity across web pages to determine the relative "importance" of each visited URL.
**Vision:** Recreate the 1990s "Lifestreams" concept for modern web browsing. The UI will present a flattened, chronological timeline of visited URLs where the physical size/weight of each node is directly proportional to the user's activity on that page.
**Constraints & Scope:**
- This is a personal tool/prototype. No Chrome Web Store privacy reviews are needed, allowing for developer workarounds.
- We do not care about tab management (how many tabs are open). The focus is entirely on URLs and attention/activity.
- No semantic analysis of content (e.g., boss vs. mechanic emails). Activity is the sole proxy for importance.
- **Only active (visible, focused) tabs accrue activity.** Inactive tabs are by definition not doing anything. (This may be revisited later.)

**The captured data must be sufficient to:**
1. Display the title + URL of each visit so the dashboard can open the page on click.
2. Recreate the user's entire web journey, in chronological order.
3. Let the dashboard promote high-attention pages and demote noise (derivable from the per-signal `activity` totals; per-URL aggregation happens at display time, not capture time).

## 2. System Architecture (Manifest V3)
The extension relies on a hybrid "Batch and Flush" messaging architecture to ensure data integrity without throttling browser performance or violating privacy (no keylogging).

* **Content Script (`content.js`):** Runs on every page. Tracks DOM events (scroll, click, keypress, video state) and generates a boolean "Heartbeat" every 10 seconds. **Only active heartbeats are sent** — silent windows send nothing (duration is derived from timestamps at finalize, so inactive heartbeats carry no information and would only wake the service worker).
* **Service Worker / Background Script (`background.js`):** The session lifecycle manager. Listens to Chrome-level events (navigation, tab close, tab switch) and receives heartbeats from the Content Script. Constructs Session Blocks and finalizes them to storage.
* **Storage:**
    * `chrome.storage.session` holds the **current (unfinalized) session** — MV3 service workers are killed after ~30s idle and in-memory state dies with them; `storage.session` survives worker restarts. No keepalive hacks or alarms.
    * `chrome.storage.local` is the database of **finalized Session Blocks**. **Retention (agreed 2026-07-15):** blocks older than 7 days are pruned at finalize time — the array is rewritten in full on every finalize, so unbounded growth would make every tab switch serialize the entire history and walk toward the 10MB quota. 7 days keeps headroom for the ribbon's cross-day reach (live since 2026-07-16 — that reach is exactly the retention window). **Snapshots (agreed 2026-07-16)** live under separate `snap:<sessionId>` keys — never inside SessionBlocks, which are read in full on every render — and die with their session (a failed capture leaves a `snapErr:<sessionId>` breadcrumb — `{when, message}` — instead, same lifecycle; added 2026-07-16 because worker-console logs rarely survive long enough to diagnose a missing screenshot): pruned in the same finalize pass, plus an **orphan sweep** on worker startup (`getKeys()`, names only — never `get(null)`, which would deserialize every stored image) so no snapshot can outlive its session even across long browser-closed stretches. The `unlimitedStorage` permission lifts the 10MB cap (~20MB steady state at 7 days).
* **Dashboard (`dashboard/index.html`):** Opens in a **full tab** (via the toolbar icon), not a popup — a timeline needs the space, and a tab is easy to keep open and refresh while testing. Reads Session Blocks from `storage.local` and renders the time-ordered, activity-weighted Lifestreams UI.

## 3–4. Capture rules
Session Block data structure, admission filter, session lifecycle, the
10-second heartbeat, and every capture-side edge case — **`spec/capture.md`**.

## 5–6. Display rules
Design philosophy, the boundary/thread taxonomy, atomicity guards, Score v1,
tiers, containers, fences, the horizontal timeline, tooltips/snapshots, and
the UI/UX directives — **`spec/display.md`**.

## Where the product is going (status, 2026-08-25, revised same day)

**The Parking Lot (§8) is the direction.** It supersedes the Active Tab
Manager (§7) as the live-surface product. Earlier the same day this section
named §7 as the direction; that was revised by the design session recorded in
`decisions/parkinglot.md`, "Origin" — the injected tab strip was an
exploration of "what does it mean for tabs to transition into a ribbon," and
it returned a clear negative result: **they don't, because half of them were
never history.**

The project is now **two products with one capture pipeline**:
| product | tense | ordering | retrieval | where |
|---|---|---|---|---|
| **Ribbon** (§5–§6) | past — what you did | time | temporal | the dashboard tab |
| **Parking lot** (§8) | future — what you meant to do | none | semantic (eventually) | the extension icon |

Every §7 attempt to bridge them was joining a to-do list to a diary through
a time axis only one of them has.

**Two orthogonal tracks, one capture pipeline.** Neither gates the other;
the only coupling is §8 Phase 1's handoff (remove the strip, flip the
dashboard's defaults).
| track | surface | spec | decisions | shape |
|---|---|---|---|---|
| **A — live** | extension icon, parking lot | §8 `spec/parkinglot.md` | `decisions/parkinglot.md` | phased (each gate licenses something destructive) |
| **B — history** | the ribbon, in the dashboard | §5–§6 `spec/display.md` + §7c–§7h `spec/ribbon.md` | `decisions/timeline_design.md` | ongoing, unphased |

`spec/tabmanager.md` (§7) is **closed** — historical strip content only. Its
ribbon content was split out to `spec/ribbon.md` (§7c-ribbon–§7h) on
2026-08-25, keeping the §7x numbering because ~85 code comments cite it; those
rules fold into §6 later, as a follow-on to §8 Phase 1 rather than part of it.

**§8 Phase 1 shipped 2026-08-25; Phases 2-4 are unstarted** — the parking
lot itself does not exist. One display path remains, down from three:
| path | status |
|---|---|
| block ribbon (`paint()`, §6 + §7c–§7h) | **the only path** — right-anchored, cross-day, the dashboard's default |

The §7 strip (`switcher.js`) was deleted in Phase 1; the card deck
(`paintCards()`) was deleted 2026-08-25, along with its view toggle. Its
layout ideas were NOT harvested: uniform-width-per-tier contradicts the
ribbon's core claim that width is duration. Reasoning:
`decisions/timeline_design.md`.

## 7. Active Tab Manager — CLOSED
The injected tab strip — **`spec/tabmanager.md`**, historical. Terms:
**strip** (collapsed, Chrome-tab-bar-like), **block** (one item). Retired by
§8 Phase 1. Phase 3 (score-ranked eviction) and Phase 4 (active→historical
reconciliation) are retired outright, not deferred — see that file's status
header.

## 7c–7h. Ribbon navigation (temporary file — drains into §6)
Zoom, cross-day reach, the coordinate system, panning — **`spec/ribbon.md`**.
Live, current ribbon behaviour (Track B), split out of `spec/tabmanager.md`
2026-08-25. **Two known conflicts with §6** — overnight gap compression vs.
absence-proportional gaps, and band-dropping at zoom-out vs. LOW blocks
staying browsable — are real design work, tracked in `WATCHLIST.md`.

**Target end state: one display spec and one display decision log.** Each
conflict resolved moves content permanently into §6; when `spec/ribbon.md` is
empty it is deleted along with `spec/tabmanager.md`, and the `§7x` code
comments are renumbered in that pass. Do not merge earlier — the conflicts
are the reason the files are separate, not an accident of filing.

## 8. Parking Lot
Tabs the user opened and never finished, displaced out of the tab bar into a
count on the extension icon — **`spec/parkinglot.md`**. Retires the injected
strip, moves the ribbon to the dashboard, and replaces §7's eviction model.
Phase roadmap and reasoning: `decisions/parkinglot.md`. **Phase 1 done
2026-08-25; Phases 2-4 unstarted.**
