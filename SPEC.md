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
    * `chrome.storage.local` is the database of **finalized Session Blocks**. **Retention (agreed 2026-07-15):** blocks older than 7 days are pruned at finalize time — the array is rewritten in full on every finalize, so unbounded growth would make every tab switch serialize the entire history and walk toward the 10MB quota. 7 days keeps headroom for day paging (live since 2026-07-16 — paging reach is exactly the retention window). **Snapshots (agreed 2026-07-16)** live under separate `snap:<sessionId>` keys — never inside SessionBlocks, which are read in full on every render — and die with their session (a failed capture leaves a `snapErr:<sessionId>` breadcrumb — `{when, message}` — instead, same lifecycle; added 2026-07-16 because worker-console logs rarely survive long enough to diagnose a missing screenshot): pruned in the same finalize pass, plus an **orphan sweep** on worker startup (`getKeys()`, names only — never `get(null)`, which would deserialize every stored image) so no snapshot can outlive its session even across long browser-closed stretches. The `unlimitedStorage` permission lifts the 10MB cap (~20MB steady state at 7 days).
* **Dashboard (`dashboard/index.html`):** Opens in a **full tab** (via the toolbar icon), not a popup — a timeline needs the space, and a tab is easy to keep open and refresh while testing. Reads Session Blocks from `storage.local` and renders the time-ordered, activity-weighted Lifestreams UI.

## 3–4. Capture rules
Session Block data structure, admission filter, session lifecycle, the
10-second heartbeat, and every capture-side edge case — **`spec/capture.md`**.

## 5–6. Display rules
Design philosophy, the boundary/thread taxonomy, atomicity guards, Score v1,
tiers, containers, fences, the horizontal timeline, tooltips/snapshots, and
the UI/UX directives — **`spec/display.md`**.

## 7. Active Tab Manager
Live, on-page tab-switcher UI — a third pillar alongside capture and the
historical ribbon, covering live display, interactivity, and (as later
phases land) how an active tab's state folds into the historical container
view — **`spec/tabmanager.md`**. Terms: **strip** (collapsed, Chrome-tab-
bar-like), **ribbon** (expanded, full-history), **block** (one item in the
list, either state). Phase roadmap and reasoning: `decisions/tabmanager.md`.

**Read this before judging any tab-manager trade-off.** The product goal is
that the user *stops managing tabs*: the system closes them aggressively
(Phase 3), and everything else exists to make that safe. So the dependency
runs — auto-close is the product → it is only acceptable if retrieval is
trustworthy → the ribbon is the retrieval mechanism → **ribbon quality gates
the product.** Zoom, cross-day reach, and legibility at range are not
visualization polish alongside eviction; they are what earns the right to
ship it. The system is allowed to be *wrong* about importance, because
browsing is always the fallback — which makes the failure mode to watch
**tedium, not inaccuracy**. Full statement: `decisions/tabmanager.md`, "The
product goal, stated plainly" and "Lightweight opinion + fallback"; the
blocking watch item is `eviction-fallback-tedium`.
