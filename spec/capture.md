# Capture Spec — §3–§4

Half of SPEC.md, split out 2026-08-09 to shrink the read cost of any capture-
side change (`SPEC.md` was 301 lines; this half alone is ~140). Section
numbers (§3, §4) are unchanged from the original single-file SPEC.md — every
existing `§3`/`§4` cross-reference in the codebase and other docs still
resolves correctly without edits. `SPEC.md` itself stays at the repo root as
the short index; read it first. The display-side half (§5–§6) is
`spec/display.md`. Reasoning/history for these rules lives in
`decisions/capture_design.md`; open doubts live in `WATCHLIST.md`.

## 3. Core Concepts & Data Structures

### The "Session Block"
A Session Block represents a **continuous period of focus** on a specific URL in a specific tab.

    interface SessionBlock {
      id: string;           // Opaque unique ID (counter or random — NOT Date.now();
                            //   rapid SPA navigations can collide on milliseconds)
      url: string;          // Full URL of the page
      title: string;        // Document title (see title-timing note below)
      favIconUrl: string;   // From tab.favIconUrl — free to capture, and demoted
                            //   timeline slivers may show only the favicon
      tabId: number;        // Which tab hosted the session (needed to route
                            //   heartbeats while live; persisted for debugging)
      startTime: number;    // Epoch ms — explicit, not overloaded onto id
      endTime: number;      // Epoch ms; duration = endTime - startTime
      activity: Record<string, number>;
                            // PER-SIGNAL totals, NEVER summed to one score —
                            //   the dashboard weights signals independently.
                            //   Units differ by signal kind (see Heartbeat):
                            //   discrete signals total raw events
                            //   (keyboard: 87 keystrokes, copy: 12 copies);
                            //   continuous signals total active 10s windows
                            //   (scroll: 9 windows; media: 90 ≈ 15 min).
                            //   Keys come from the content script's snapshot;
                            //   new signals require no schema change.
      heartbeats: number;   // Total active 10s windows (any signal). NOT derivable
                            //   from per-signal counts (those overcount windows
                            //   where several signals fired). attendedSeconds =
                            //   heartbeats × 10 — drives the timeline score (§6).
                            //   Implemented 2026-07-15.
      audibleMs: number;    // Total ms the tab was audible during the session
      audibleSinceTs?: number; // Gap-audio testimony (2026-07-24): when the tab's
                            //   unbroken audible stretch began, stamped at session
                            //   start — display bridges a long container gap only
                            //   if it predates the previous fragment's end (§6).
                            //   (event-driven via tabs.onUpdated — catches
                            //   cross-origin embeds the content script can't
                            //   see). Attention credit uses
                            //   max(heartbeats × 10, audibleMs/1000).
                            //   Implemented 2026-07-15.
      scrollable?: boolean; // Can the page scroll? Measured at each heartbeat
                            //   (last value wins — SPAs change page height);
                            //   absent if no heartbeat ever arrived. Lets the
                            //   dashboard weight scroll fairly (Edge Case 2).
      endReason: string;    // "navigated" | "spa_navigation" | "tab_hidden" |
                            //   "tab_closed" | "idle_split" (2026-07-24) —
                            //   boundary testimony: drives display joins and
                            //   framing (§5 taxonomy, §6 thread assembly);
                            //   no longer droppable
      openerTabId?: number; // The tab that SPAWNED this session's tab
                            //   (middle-click, target=_blank, window.open),
                            //   recorded at tab creation and stamped onto
                            //   every session the tab hosts (2026-07-19;
                            //   supersedes the deferred parentId stub).
                            //   Absent for cold tabs (new-tab button,
                            //   bookmarks, external apps, restarts) and all
                            //   pre-2026-07-19 data — absent means exactly
                            //   the old flat behavior. Raw edge only; tree
                            //   assembly is display-time (§6).
      lastKeyGapMs?: number;// Terminal-keystroke evidence (2026-07-24): ms
                            //   between the session's last counted keydown
                            //   and the flush-on-hidden that ended it.
                            //   Pure evidence — counts are never mutated;
                            //   the judgment (admission rung 2) is
                            //   display-time. Absent if no flush or no
                            //   keydown ever happened.
      pageText?: string;    // Page-text search capture, stage 1 (2026-08-07):
                            //   Readability-extracted plain text, capped at
                            //   5000 chars, extracted at most once per session
                            //   on the same trigger as the snapshot (first
                            //   qualifying heartbeat/signal cue) — never on
                            //   flush-on-hidden. Search-only; never rendered
                            //   in the UI. Deleted at finalize alongside the
                            //   snapshot if the session fails the transit
                            //   predicate (§3 admission filter, §6 snapshots).
    }

### Session lifecycle semantics
* **Admission filter (unified 2026-07-18; rungs agreed 2026-07-15):** one principle — *only what we measured is displayed* — at two rungs.
  * **Rung 1, capture-time (< 2s, `BLIP_MS`):** at finalize, sessions shorter than 2s with zero heartbeats, zero activity, and no audible time are discarded (logged, never stored) — the fingerprint of redirect machinery. Conservative: one click or one heartbeat keeps a session; A → redirect → B tells the same story as A → B.
  * **Rung 2, display-time (< 10s):** sessions shorter than one heartbeat window (10s — the attention quantum, the only principled rung height) with **no high-intent discrete signal** (keyboard, cut, copy, paste, download) are dropped at display. Clicks/mouse/scroll do NOT save a session — a click is how you *leave* a page (covers SSO hoppers, consent interstitials, shortener hops; no host special-casing). A flushed partial-window heartbeat doesn't save it (the click's flush artifact). Audible time doesn't save it (amended 2026-07-18 — autoplay is the page's action, not the user's). Typing a password keeps it ("logged into Figma" is journey). Honest cost: sub-10s purely-visual glances drop. **Amended 2026-07-24 — terminal-keystroke discount:** when `lastKeyGapMs` ≤ `TERMINAL_KEY_MS` (500ms, provisional), ONE keystroke is discounted before the exemption test — the keystroke that killed the session (Cmd+W) is how you *leave* a page, the keyboard form of the click rule. A glance closed by chord drops; real typing before a close chord still exempts. (Story: `decisions/timeline_design.md`, transit filter.) **Predicate home (2026-07-24):** `isTransit` and its knobs live in `shared/transit.js` (`FS_TRANSIT`), loaded by both the dashboard and the worker — the same rule that admits a session to display governs whether its snapshot survives finalize (§6 snapshots).
  * Rung 2 is display-time deliberately: sessions stay in storage and the Score table so the rule can be audited against real data; promote to capture once trusted.
* **Only web documents are captured (agreed 2026-07-15):** sessions start only for `http`, `https`, and `file` URLs. Browser-internal pages (`chrome://newtab`, `chrome://settings`, `about:`, extension pages — including our own dashboard) are skipped at capture: content scripts cannot run there, so they are *guaranteed* zero-attention blocks — pure noise with no future display-time value. Accepted trade-off: time in browser UI renders as a timeline gap, not a block.
* **Tab adoption on navigation (2026-07-18):** when a main-frame navigation commits while no session is current, and the navigating tab is the active tab of the focused window, a session starts for it (URL filter applies). Closes the new-tab blind spot (fresh tab → filtered `chrome://newtab` → first real navigation was ignored). Navigations in background tabs stay ignored.
* **Opener capture (2026-07-19):** `tabs.onCreated` records `tabId → openerTabId` into a map in `chrome.storage.session` (per the MV3 worker invariant; `storage.session` also empties on browser restart, which is exactly right — tabIds don't survive restarts), pruned when the tab itself closes. At session start the tab's edge, if any, is stamped onto the session. `onCreated` is the capture point deliberately: Chrome drops `openerTabId` from the Tab object once the opener closes, so querying later loses edges. Capture records the edge and nothing else — no tree logic in the worker.
* **Switching tabs finalizes the session.** Returning to a tab starts a *new* block with the same URL. Journey A → B → A is three blocks, in order — this is what makes full journey recreation possible.
* **Idle split (2026-07-24):** the unfinalized session carries `lastActiveTs`, refreshed on every heartbeat and pinned to now while the tab is audible. A heartbeat arriving more than `IDLE_SPLIT_MS` (5 min) after `lastActiveTs` finalizes the current session with `end = lastActiveTs + 10s` (reason `idle_split`) and starts a fresh session for the same tab/URL; ordinary finalize applies the same clamp to a trailing gap. A focused-but-idle tab renders as absence, not presence. Pre-existing sessions lack `lastActiveTs` and are not repaired. (Story: `decisions/capture_design.md`.)
* **Lock intervals (2026-08-08):** `chrome.idle.onStateChanged` (new `idle` permission) is the one signal outside browser activity this extension captures — deliberately narrow: only the `locked` state is recorded, never `idle`/`active` polling. A `locked → active` transition closes an interval and appends `{start, end}` (epoch ms) to a `lockIntervals` array in `chrome.storage.local`, pruned at the same finalize-time retention pass as sessions (§2). This is evidence consumed by display-time gap classification (§6 fence), not a presence log — no lock timestamp is rendered or exposed anywhere in the UI. `idle`/`active` states and `queryState` polling are NOT used — `locked` alone is the only unambiguous ground truth (an OS screen lock), so nothing else is captured. (Story: `decisions/capture_design.md`.)
* Repeated-URL blocks are expected; the dashboard aggregates per-URL attention at display time (a simple sum).
* Session end triggers: real navigation, SPA navigation, tab hidden (switch/minimize), tab closed, idle split (2026-07-24).

### The 10-Second Heartbeat
* **Iframe relay (2026-07-18):** the content script injects into all frames. Cross-origin subframes (ads) self-destruct at birth — no listeners, no messages. Same-origin subframes (app plumbing: Docs' hidden input iframe, Slides' present view) register the same listeners and forward batched counts to the top frame at most once per second; the top frame folds them in and remains the **sole heartbeat sender** — one heartbeat per active window, background traffic unchanged.

The Content Script evaluates activity in 10-second windows. Signals come in two kinds, counted differently because their raw event rates mean different things:

* **Discrete signals — raw event counts per window:** `keyboard` (keydowns), `click` (mousedowns), `cut`, `copy`, `paste` (each clipboard type is its own signal — they are semantically distinct and may be weighted differently). Counts capture intensity: 12 copies in a window records as 12, not 1. Only counts are recorded — never keystroke identity or clipboard contents. **Amended 2026-07-24:** pure-modifier keydowns (`Meta`/`Control`/`Alt`/`Shift` alone) don't count — a lone modifier press is half a chord, not typing; the chord's action key still counts (Cmd+F is one keystroke). (Story: `decisions/capture_design.md`.)
* **Continuous signals — active/inactive boolean per window:** `mouse` (movement), `scroll` (scroll/wheel), `media` (unpaused `<video>`). Their raw event rates measure hardware sampling (~60+ mousemove events/sec; one wheel flick emits dozens of events), not attention, so each window contributes at most 1.

*If ANY signal is nonzero during the window, the content script sends one heartbeat carrying the snapshot (e.g. `{ keyboard: 87, copy: 2, mouse: true, ... }`) plus the page's `scrollable` state, then resets the snapshot. If all signals are zero, nothing is sent. The background folds the snapshot into the session's per-signal totals: counts add; booleans increment by 1.*

* **Terminal-keystroke evidence (2026-07-24):** the content script tracks the timestamp of the last counted keydown (relay frames forward theirs; the top frame keeps the max). The `flush-on-hidden` heartbeat carries `lastKeyGapMs` — how long before the hide that keystroke landed — stamped onto the session. Evidence only: no count is mutated; the judgment lives in admission rung 2. (Story: `decisions/capture_design.md`.)

### Snapshot capture (2026-07-16; unified with the transit filter 2026-07-24)

Moved here from §6 on 2026-08-25 — these are capture-side rules; §6 keeps only
how a snapshot is DISPLAYED. Story: `decisions/snapshot_implementation.md`.

* **One capture per session, at first qualification.** Every session that
  survives the transit filter gets an attempt. `chrome.tabs.captureVisibleTab()`
  fires the moment the session first qualifies — one trigger per
  transit-exemption arm: the first interval heartbeat, the first
  transit-qualifying signal (keyboard/cut/copy/paste via a content-script cue,
  downloads background-side), or the session's **10-second birthday on glass**
  (a one-shot worker timer armed at session start, `TRANSIT_MS`). The duration
  rung qualifies with zero signals, so hands-off survivors — cross-origin
  embeds, motionless reads — still photograph.
* **Whichever wins, exactly one fires,** via an explicit `snapped` flag — never
  the heartbeat count, since a flush beat consumes slot #1 while being barred
  from capture.
* **`flush-on-hidden` beats never capture:** they fire exactly while the *next*
  tab becomes visible (the wrong-page trap).
* **Heartbeat- and signal-triggered captures are awaited in the event queue**
  so finalize can never outrun the store — an unawaited store could land after
  finalize's deletion and leak a rejected session's picture past the sweep. The
  age trigger cannot race by construction: a 10s-old session has already
  out-aged the filter.
* **Finalize deletes** the `snap:`/`snapErr:` keys of any session the transit
  predicate rejects — the session stays stored for audit, only the picture
  goes. The predicate lives in `shared/transit.js` (`FS_TRANSIT`), one source
  of truth for capture and display.
* **Capture is best-effort;** all failures soft-fail to a `snapErr:`
  breadcrumb.
* **Opportunistic re-capture at the 3rd heartbeat (2026-08-14):** the first
  capture can fire before a slow-loading page has painted real content (Google
  Meet's join/lobby flow, observed specimen). A session's 3rd real heartbeat
  (`current.heartbeats === 3`, same `flush-on-hidden` exclusion) unconditionally
  overwrites `snap:<sessionId>`. Deliberately not hardened — a nice-to-have,
  not a second admission rung; sessions dying at heartbeat 1-2 correctly never
  get a second attempt.
* **Page text rides the original trigger only (2026-08-07):** `pageText` is
  extracted at the identical first-qualifying-signal moment, and a
  transit-rejected session has it deleted at finalize the same way its snapshot
  is — one admission bar, two artifacts. See `WATCHLIST.md`
  `pagetext-intent-gate`.
* **Downscale** in the worker: JPEG capture → `createImageBitmap` →
  `OffscreenCanvas` → JPEG at 640px width, quality 0.6 (~20-40KB); stored as a
  `data:` URL under `snap:<sessionId>` (storage/retention: §2).

## 4. Technical Implementation Details & Edge Cases

### Edge Case 1: Passive Video Consumption (YouTube, Netflix)
Users watching a 15-minute video will have zero mouse/keyboard events.
* **Chosen solution (Content Script):** Run `Array.from(document.querySelectorAll('video')).some(v => !v.paused)` during the 10-second check. This folds into the existing heartbeat and lets the service worker sleep.
* **Audible tracking (implemented 2026-07-15):** the content-script check misses players in cross-origin iframes (a YouTube embed inside Bluesky slipped through in the wild). Fix: `chrome.tabs.onUpdated` fires an *event* when a tab's audible state flips — no polling, the worker wakes on its own. The background timestamps audible-on/off for the tracked tab and accumulates `audibleMs` on the session (an open interval folds in at finalize; a session that starts in an already-audible tab starts the clock immediately). Attention credit is `max(heartbeats × 10, audibleSeconds)` — max, not sum, so same-frame video already counted by the `media` signal isn't double-counted. **Audible continuity, ALL tabs (2026-07-24):** the same transitions maintain `audibleContinuity` in `storage.session` — one timestamp per tab, when its current unbroken audible stretch began (set on audible-on, cleared on audible-off; seeded at startup/install from `tabs.query({audible:true})`, continuity from NOW — fails closed). Session start stamps it as `audibleSinceTs`. No polling and no background heartbeats: a meeting talking through a 20-minute gap costs zero events; a stopping video costs one.
* *Known limitation:* **muted** playback in a cross-origin iframe is still invisible (no sound → no audible flag; no DOM access → no video check). The iframe relay (§3, 2026-07-18) does inject `all_frames`, but cross-origin frames self-destruct at birth **by design** — an ad iframe's muted autoplay video would register as false attention — so the blind spot stands. Revisit only if muted viewing proves to matter.

### Edge Case 2: Short Pages (No Scroll Possible)
Do not penalize pages that fit entirely on the screen.
* **Reality check:** activity is an OR of independent signals — scroll was never a *requirement* — so short pages lose nothing at capture time. The risk is at dashboard weighting: a page that cannot scroll can never earn scroll counts, so weighting scroll would unfairly demote it.
* **Solution:** the content script measures `document.documentElement.scrollHeight > window.innerHeight` at each heartbeat and sends it as `scrollable`; the session stores the last value so the dashboard can normalize scroll weighting for non-scrollable pages.

### Edge Case 3: Single Page Applications (SPAs)
Sites like Gmail, Slack, and Notion change content dynamically without page reloads.
* **Solution:** The Background Script listens to `chrome.webNavigation` events:
    * `onHistoryStateUpdated` (HTML5 History pushes — Slack/Discord).
    * `onReferenceFragmentUpdated` (hash changes — Gmail).
* **Action:** Finalize the current Session Block, save it, start a new one for the new URL.
* **⚠ Noise filter required:** `onHistoryStateUpdated` fires multiple times for one logical navigation on some SPAs, sometimes with the *same* URL. The background must compare the event URL against the current session's URL and ignore no-op fires, or sites like YouTube will produce dozens of zero-duration fragments.
* **⚠ Debounce required (URL-churn sites):** some sites encode *view state* in the URL — Google Maps fires `onHistoryStateUpdated` with a genuinely different URL on every pan/zoom, fragmenting one interaction into ~90 micro-blocks (observed 2026-07-14). Rule: an SPA URL change arriving within `SPA_DEBOUNCE_MS` (15s, tunable) of the session's previous URL change is **absorbed** — the current session's URL updates in place (last URL wins, so a timeline click reopens roughly where the user left off) and activity keeps accruing. Only a URL change after ≥15s of settled URL splits a new block. Real navigations (`onCommitted`) always split. Accepted trade-off: rapid bursts of intentional hops (skimming several Gmail messages in seconds) merge into one block — sub-10s bounces are demotable noise anyway. Bookkeeping: the live session carries `lastUrlChange` (epoch ms; falls back to `startTime`), stripped before the block is persisted.

### Edge Case 4: Data Loss on Tab Close / Worker Sleep
* **Solution:** The Content Script listens to `visibilitychange`. When `document.visibilityState === 'hidden'`, immediately flush the final heartbeat to the background (`chrome.runtime.sendMessage` wakes a sleeping worker). Worker-side, the unfinalized session lives in `chrome.storage.session` (see Architecture), so a killed worker loses nothing.

### Dev Workflow: Injecting into already-open tabs
Content scripts only load into pages opened *after* the extension is (re)loaded, so every extension reload silently stops tracking in existing tabs.
* **Solution:** on `onInstalled`, the background injects `content.js` into all existing http(s) tabs via `chrome.scripting.executeScript` (requires the `scripting` permission and `host_permissions: ["<all_urls>"]`). chrome:// and Web Store pages cannot be injected — logged, non-fatal.
* **Hardening (agreed 2026-07-15, from code review):**
    * **Duplicate-injection guard:** a tab that finishes loading between an extension reload and the injection loop gets the manifest injection AND the executeScript injection — two live instances, every signal double-counted (silently corrupting score-tuning data). `content.js` sets `window.__fsLoaded` in its isolated world and bails if it's already set. The guard is per extension lifetime (a reload creates a fresh isolated world), so it never blocks legitimate re-injection.
    * **Orphan self-destruct:** orphaned instances (extension reloaded out from under the page) previously kept their 10s timer and all eight listeners running forever — one zombie per reload accumulating in every long-lived tab, the one real path by which capture could weigh on pages. Now every listener registers through one `AbortController`; the instance tears itself down (abort + clearInterval) on its first tick without an extension context (`chrome.runtime.id` gone) or on a failed send.

### Edge Case 5: Title capture timing
`document.title` is often empty at navigation time, and SPAs update the title *after* the history event fires (Gmail, YouTube).
* **Solution:** Never grab the title only at session start. Refresh it on each heartbeat and/or at finalize, keeping the last non-empty value.

