# Project Specification: Lifestreams Telemetry Chrome Extension

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
    * `chrome.storage.local` is the database of **finalized Session Blocks**.
* **Dashboard (`dashboard/index.html`):** Opens in a **full tab** (via the toolbar icon), not a popup — a timeline needs the space, and a tab is easy to keep open and refresh while testing. Reads Session Blocks from `storage.local` and renders the time-ordered, activity-weighted Lifestreams UI.

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
                            //   "tab_closed" — for debugging; droppable later
      parentId?: string;    // DEFERRED to a later phase (needs opener-tab
                            //   bookkeeping; the flat timeline doesn't use it)
    }

### Session lifecycle semantics
* **Blip filter (agreed 2026-07-15):** at finalize, sessions shorter than 2s with zero heartbeats, zero activity, and no audible time are discarded (logged, never stored). This is the fingerprint of transition machinery — redirect hops (`go.bsky.app/redirect?…`), instant bounces — not user activity. Conservative: one click or one heartbeat keeps a session. The journey reads correctly without them (A → redirect → B tells the same story as A → B).
* **Only web documents are captured (agreed 2026-07-15):** sessions start only for `http`, `https`, and `file` URLs. Browser-internal pages (`chrome://newtab`, `chrome://settings`, `about:`, extension pages — including our own dashboard) are skipped at capture: content scripts cannot run there, so they are *guaranteed* zero-attention blocks — pure noise with no future display-time value. Accepted trade-off: time in browser UI renders as a timeline gap, not a block.
* **Switching tabs finalizes the session.** Returning to a tab starts a *new* block with the same URL. Journey A → B → A is three blocks, in order — this is what makes full journey recreation possible.
* Repeated-URL blocks are expected; the dashboard aggregates per-URL attention at display time (a simple sum).
* Session end triggers: real navigation, SPA navigation, tab hidden (switch/minimize), tab closed.

### The 10-Second Heartbeat
The Content Script evaluates activity in 10-second windows. Signals come in two kinds, counted differently because their raw event rates mean different things:

* **Discrete signals — raw event counts per window:** `keyboard` (keydowns), `click` (mousedowns), `cut`, `copy`, `paste` (each clipboard type is its own signal — they are semantically distinct and may be weighted differently). Counts capture intensity: 12 copies in a window records as 12, not 1. Only counts are recorded — never keystroke identity or clipboard contents.
* **Continuous signals — active/inactive boolean per window:** `mouse` (movement), `scroll` (scroll/wheel), `media` (unpaused `<video>`). Their raw event rates measure hardware sampling (~60+ mousemove events/sec; one wheel flick emits dozens of events), not attention, so each window contributes at most 1.

*If ANY signal is nonzero during the window, the content script sends one heartbeat carrying the snapshot (e.g. `{ keyboard: 87, copy: 2, mouse: true, ... }`) plus the page's `scrollable` state, then resets the snapshot. If all signals are zero, nothing is sent. The background folds the snapshot into the session's per-signal totals: counts add; booleans increment by 1.*

## 4. Technical Implementation Details & Edge Cases

### Edge Case 1: Passive Video Consumption (YouTube, Netflix)
Users watching a 15-minute video will have zero mouse/keyboard events.
* **Chosen solution (Content Script):** Run `Array.from(document.querySelectorAll('video')).some(v => !v.paused)` during the 10-second check. This folds into the existing heartbeat and lets the service worker sleep.
* **Audible tracking (implemented 2026-07-15):** the content-script check misses players in cross-origin iframes (a YouTube embed inside Bluesky slipped through in the wild). Fix: `chrome.tabs.onUpdated` fires an *event* when a tab's audible state flips — no polling, the worker wakes on its own. The background timestamps audible-on/off for the tracked tab and accumulates `audibleMs` on the session (an open interval folds in at finalize; a session that starts in an already-audible tab starts the clock immediately). Attention credit is `max(heartbeats × 10, audibleSeconds)` — max, not sum, so same-frame video already counted by the `media` signal isn't double-counted.
* *Known limitation:* **muted** playback in a cross-origin iframe is still invisible (no sound → no audible flag; no DOM access → no video check). Fixing it would need `all_frames` injection, which was considered and rejected for now: it injects into every ad iframe, where muted autoplay video would register as false attention, and needs heartbeat dedup. Revisit only if muted viewing proves to matter.

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
* **Solution:** on `onInstalled`, the background injects `content.js` into all existing http(s) tabs via `chrome.scripting.executeScript` (requires the `scripting` permission and `host_permissions: ["<all_urls>"]`). chrome:// and Web Store pages cannot be injected — logged, non-fatal. Orphaned scripts from before a reload keep ticking but can no longer send; content.js catches and logs this ("extension context gone").

### Edge Case 5: Title capture timing
`document.title` is often empty at navigation time, and SPAs update the title *after* the history event fires (Gmail, YouTube).
* **Solution:** Never grab the title only at session start. Refresh it on each heartbeat and/or at finalize, keeping the last non-empty value.

## 5. Design Philosophy: The Noise/Signal Tightrope (agreed 2026-07-15)

**The thesis of this experiment:** when is a series of quick visits noise to hide, and when is one an important moment to highlight? The answer: **importance is evidenced by intent, not duration.** Duration tells you where attention *sat*; discrete signals (copy, paste, keystrokes, downloads) tell you where attention *acted*. A 15-second visit with a `copy` is a fundamentally different object than a 15-second bounce. This is why activity is captured as per-signal, per-type counts and never summed.

### Block taxonomy (derived at display time from captured data)
* **Bounce** — short, no discrete signals (empty activity, or mouse-only). Demote hard: the sliver.
* **Side-quest** — short, but carrying discrete intent (cut/copy/paste, meaningful keystrokes, a download). Highlight *despite* brevity; never absorb into a neighbor. Canonical case: a long Google Docs session, a brief tab-out to fetch/copy an image, return to Docs — that side-step is a key event, even though it splits the Docs session in two.
* **Dwell** — long, activity-accumulating. Size follows duration/activity.

### Consequences
* **Interruptions are meaningful.** Display-time grouping must use **strict adjacency** — merge only *consecutive* same-hostname blocks into a "visit" row. Gap-tolerant merging is forbidden: it would erase exactly the interruptions we want to surface. The A→B→A sandwich stays three blocks (two visits of A, one side-quest B), and could later be rendered as a resumed stream with the side-quest riding above it.
* **Visit grouping decisions:** key = hostname (not registrable domain — `mail.google.com` ≠ `docs.google.com`); duration = sum of member durations; label = hostname + page count (member pages, individually clickable, shown on expand). Runs of length 1 render as plain session lines.
* **SPA debounce stance:** the 15s debounce (Edge Case 3) is correct at the high level — there is a lot of uninteresting navigation inside SPAs — but it blurs *which page within a site* a quick action happened on (signal counts survive; URL granularity is lost). Accepted for now; **actively watch for over-collapse exceptions** (e.g., composing a reply inside Bluesky disappearing into surrounding churn) and stay flexible about tuning or exempting high-intent windows.
* **Horizontal Lifestreams rendering (the eventual pivot):** width = time, salience (height/brightness/badge) = intent. A side-quest is honestly thin but visually bright, so brief-but-important punches above its width.

### Capture roadmap addition: `download` signal (implemented)
Copying an image we see; "Save image as…" fires no DOM event and is invisible to the content script. `chrome.downloads.onCreated` in the background (requires the `downloads` permission) increments the current session's `download` count — likely the strongest single intent signal we have. Background-observed: it does not ride the heartbeat.

## 6. UI/UX Directives

### Phase 3a — Primitive debug dashboard (implemented)
A data-validation tool, not the final UI: `dashboard/index.html`, opened in a full tab by the toolbar icon (which also still prints the console dump). One line per session, **newest first**: start time · duration · favicon · clickable title (opens the URL) · nonzero signal counts only (`kbd 87 · copy 2`) · endReason · no-scroll tag. Zero-activity bounces render dimmed. The live (unfinalized) session is pinned at top; the page re-renders on `chrome.storage.onChanged`; a Clear button (with confirm) wipes stored sessions. A **Score table** button (added 2026-07-15 for threshold tuning) scores every stored session with the live §6 formula — via `window.FS_SCORING`, the same functions the timeline renders with, so diagnostics can't drift — logs a `console.table` sorted by score with band counts, and copies the table to the clipboard as TSV for pasting into tuning discussions.
**Self-exclusion:** the extension's own pages are never tracked — since 2026-07-15 this is subsumed by the web-documents-only capture rule (§3 lifecycle semantics), which skips all non-http(s)/file URLs.

### Phase 3b — Horizontal Timeline (design adopted from Desktop4, agreed 2026-07-15)
The rendering model is ported from the Desktop4 (lifestreams) demo — `~/Projects/Desktop4 (lifestreams)`, see `plans/three_tier_focus_plan.md` and `src/components/canvas/TimelineView.jsx` there. Its WebGL/React stack does NOT come along; the pipeline is pure functions that port to vanilla DOM/CSS. Its screenshot/heatmap features are explicitly out of scope.

**Layout & scope**
* A single horizontal ribbon: X = chronological time; block width = true duration × scale, floored at a minimum visible width (large blocks stay near-proportional; only slivers stretch the day).
* No zooming (vanilla DOM for now). Displays a single backward look (the most recent activity window); paging / jumping between days is a later phase.
* Keep Desktop4's visual identity: dark background with subtle grid, flat color-filled blocks with a lighter border rim, hover glow, rotated run titles above the band, short white hour ticks + dim hour labels below.
* **The timeline is the PRIMARY view (agreed 2026-07-15).** The vertical session list below it is a debug tool only and must never drive the visual design. Size the ribbon generously — big band, legible type; the page belongs to it.
* **Color = identity, rationed by importance (agreed 2026-07-15).** Color's job is what height cannot show: revisit structure ("these three tall blocks are the same place"). But hue-as-identity only reads at low cardinality, so it obeys the same gate as everything else: only hosts that earned a MEDIUM+ block get an identity hue; LOW-only hosts render neutral gray, so the day's noise is quiet texture. Hues come from a curated palette (~20 designed colors, hash-assigned, stable across days) rather than raw HSL hashing. Collisions are possible but rare in practice (2026-07-15): visiting behavior is temporally local — a handful of sites for a stretch, then another handful — so only *nearby* colored blocks need distinct hues, and ~20 slots keeps that probability low. Self-legending: every hue that appears is named by its label. Redundant tier-coloring and score-gradients were rejected (they restate height); single-color is the fallback if this still reads busy.
* **Fence-open relaxation (agreed 2026-07-15):** expanding a fence relaxes both gates for its members — they get identity colors and become label-eligible (it's a tight domain, so cardinality stays sane, and there's more room). Label collision rules still apply: draw only when there's no conflict, higher score wins. Collapsed sticks stay gray.
* **Expand bar** keeps its job (marks which blocks came from a fence + collapse target) but lives in its own lane: bar snug under the band, clear gap, then hour ticks/labels below — no vertical overlap.
* **Hour axis (agreed 2026-07-15):** labels are whole hours ONLY — no minute labels. The ribbon left-pads from the floor hour at the normal time scale, so a session starting at 8:47 begins ~78% of the way from the "8am" tick toward 9am. (The inherited Desktop4 behavior — pinning the start tick to the ribbon edge labeled with the floored hour — made an 8:47 start read as 8:00.) Interior gaps still compress to near-zero width, so ticks remain positional *hints* there; block tooltips carry the exact wall-clock span (`8:47 AM – 8:58 AM`) as ground truth.
* **Same-host visit merging (agreed 2026-07-15):** before fencing, consecutive same-host LOW blocks merge into one "visit block", scored and banded on the **merged totals** (attended time and signals sum). **Max-gap rule:** members must be separated by less than `VISIT_GAP_MS` (5 min) — a brief tab-away stays the same visit, but returning after minutes of absence is a *new* visit (interruption-by-absence, same §5 reasoning). Evidence: a real 11-minute contiguous Maps session plus one 2-second re-peek 9 minutes later merged into a block whose span read as an hour — ten fragmented Google Maps minutes become one MEDIUM block instead of eleven fenced slivers (the SPA debounce splits on >15s settled pauses, so engaged-but-intermittent sessions fragment at capture; that's fine, this repairs it at display). Display-time only; capture stays granular. **MEDIUM+ blocks never merge — the visit splits around them:** an hour of Gmail puttering collapses, but a long email written inside it stands alone at full stature (§5's side-quest rule generalized; structurally nothing important can be swallowed, *provided the score sees it* — detection quality rests entirely on score calibration). A merged visit that is still LOW stays fence-eligible (noise stays noise). Click opens the top-scoring member page; the tooltip reports the page count. Expandable visit blocks are a possible later addition.
* **Labels are title-derived site names (agreed 2026-07-15):** a hostname is often not a site — google.com hosts both Maps and Search. Pages suffix their titles with the site name ("Coffee - **Google Maps**", "Inbox - **Gmail**", "Post by X — **Bluesky**"), so a run's label is the most common trailing title segment (split on spaced `- – — | · /`) across its member pages: majority agreement required for multi-page runs, ≤24 chars accepted for single pages, hostname as fallback. Identity (color, grouping) stays hostname-keyed for now.
* **Labels are importance-gated (agreed 2026-07-15, replacing Desktop4's rule).** Only runs containing a MEDIUM+ block earn a title; LOW never labels (hover tooltips carry the rest). Desktop4's "first occurrence of each app always titles" is deleted — it assumed ~6 apps, but a real browsing session has 20+ hostnames, and firsts bypassed collision checks entirely, shingling labels. When two earned labels would still collide, the **higher score wins** and the loser is dropped (never nudged — a nudged label misaligns with its block). Horizontal labels inside wide blocks were considered and deferred: they can't work for all bands and mixing orientations is worse than either alone; revisit after evaluating gating.
* "Application" for us = **hostname**; block color = stable hash of hostname (hue is identity — score never changes color, and any resting brightness difference reads as a different site, so glow is hover-only).
* Hour marks cannot be linear (widths are floored): each hour is time-interpolated within whichever block was active at that hour, clamping to edges in gaps.

**Importance: one score, three tiers, three heights**
* Bottom-flush heights — HIGH = 100% of band, MEDIUM = 80%, LOW = 60% — so the top edge is the single importance contour. Width is time; height is salience (spec §5).
* **The fence:** runs of ≥ 2 consecutive LOW blocks collapse into thin picket-fence sticks; click expands in place, click/Escape collapses. MEDIUM+ never fences — anything with real signal is structurally incapable of being hidden (this is §5's side-quest promotion). Expanded members render at LOW height: expansion reveals width, never confers stature. A singleton LOW (no run to join) stays a visible low block.

**Score v1 (FocusStream units)**
```
attendedSeconds = max(heartbeats × 10, audibleMs / 1000)
                  // measured attention: active windows OR audible playback
                  // (max, not sum — same-frame video counts in both)
score = attendedSeconds
      + 150 × copy + 150 × cut + 80 × paste
      + 200 × download                      // strongest intent signal we have
      + min(keyboard, 200)                  // 1/keystroke, capped: composition ≈ copy-tier
Tiers: HIGH ≥ 1000, MEDIUM ≥ 150
```
* Simpler than Desktop4's formula by design: their `duration × scroll-gate` and `focus_seconds` terms were proxies for attention; we measure it directly via heartbeats. Background tabs can't inflate dwell here — sessions only exist while visible + focused.
* mouse/scroll/click/media counts contribute via `attendedSeconds` (they make windows active) rather than separate weights.
* **⚠ Provisional:** all weights/thresholds inherited from Desktop4, which tuned them to its demo data. Expect revision once real captured data flows through them. Keep every weight a named constant. (2026-07-15: first real data suggests MEDIUM=150 may be too permissive — many blocks escape the fence — but thresholds are deliberately held for one iteration while label gating lands, so knobs turn one at a time.)
* **Open question (2026-07-15):** Chrome-internal pages (`chrome://newtab` etc.) currently capture and render as journey blocks ("newtab", "extensions" hostnames). Undecided whether to skip them at capture or exclude at display.

**Capture addition required: `heartbeats`**
One integer per SessionBlock — total count of active heartbeats received (NOT derivable from per-signal counts, which overcount multi-signal windows). `attendedSeconds = heartbeats × 10` replaces Desktop4's hand-authored `focus_seconds`; the `media` signal makes it honest for the zero-input video case. Max-scroll-depth capture was considered and **rejected** (2026-07-15): it gates against background-tab dwell, a pathology our capture model structurally prevents; scroll-as-activity is already captured as window counts.

### Final timeline (for later implementation)
* **Visual Hierarchy:** Compute a display score as a **weighted sum of the per-signal `activity` counts** (weights TBD at dashboard time) and map it to the CSS height, width, or font-size of the node.
* **High-Value Nodes:** A 15-minute active session (Score ~90) should be a massive, expanded block showing the title and URL clearly.
* **Low-Value Nodes (Noise):** A 2-second bounce (Score = 0) should be collapsed into a tiny horizontal sliver (favicon-only display is an option).
* **Timeline:** Chronological display. Ignore tabs entirely—just show the sequential flow of where the user's attention went based on time.
* **Click to open:** Every node links back to its URL.

## 7. Build Order
* **Phase 1 — Core loop:** `manifest.json` (permissions: `storage`, `webNavigation`, `tabs`, `scripting`; host permissions for injection) + content-script heartbeat + background session lifecycle (create on nav/tab-switch, finalize on nav/switch/close/hidden), writing to storage. No UI — verify by inspecting `chrome.storage.local` in DevTools while browsing.
* **Phase 2 — Edge cases:** SPA navigation + noise filter, video detection, non-scrollable pages, flush-on-hidden hardening.
* **Phase 3 — Dashboard:** the full-tab timeline UI.
* **Implemented 2026-07-15:** `download` signal capture (§5 roadmap); grouped debug view — consecutive same-hostname visit rows, expandable to member sessions (§5 grouping decisions).
* **Phase 3b implemented 2026-07-15:** `heartbeats` counter capture; horizontal timeline per §6 (`dashboard/timeline.js` — score → tiers → fence, vanilla DOM/CSS, Desktop4 visual identity) rendered above the debug list.
* **Deferred:** `parentId` / opener-tab tracking; any tree or branching view; zooming, multi-day paging/jumping; screenshots (+ heatmaps); max-scroll-depth capture (rejected for now, see §6).
