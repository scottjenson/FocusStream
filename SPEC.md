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
    * `chrome.storage.local` is the database of **finalized Session Blocks**. **Retention (agreed 2026-07-15):** blocks older than 7 days are pruned at finalize time — the array is rewritten in full on every finalize, so unbounded growth would make every tab switch serialize the entire history and walk toward the 10MB quota. 7 days keeps headroom for day paging (live since 2026-07-16 — paging reach is exactly the retention window). **Snapshots (agreed 2026-07-16)** live under separate `snap:<sessionId>` keys — never inside SessionBlocks, which are read in full on every render — and die with their session (a failed capture leaves a `snapErr:<sessionId>` breadcrumb — `{when, message}` — instead, same lifecycle; added 2026-07-16 because worker-console logs rarely survive long enough to diagnose a missing screenshot): pruned in the same finalize pass, plus an **orphan sweep** on worker startup (`getKeys()`, names only — never `get(null)`, which would deserialize every stored image) so no snapshot can outlive its session even across long browser-closed stretches. The `unlimitedStorage` permission lifts the 10MB cap (~20MB steady state at 7 days).
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
* **Transit filter (agreed 2026-07-15):** the blip filter's rule one rung up, with a non-arbitrary rung height — the 10s heartbeat window, our attention quantum. A session is transit machinery if it lasted **< 10s**, has **no audible time**, and its activity has **no high-intent discrete signals** (keyboard, cut, copy, paste, download). Clicks/mouse/scroll do NOT save it: a click is the weakest signal we collect — it's how you *leave* a page (evidence: an OAuth account-chooser mid-meeting — 5s, one click, attended 0s — and a 5s calendar bounce; the signature covers SSO hoppers, consent interstitials, shortener hops generically, no host special-casing). A flushed partial-window heartbeat doesn't save it either (that's the click's flush artifact, not a completed attention window). Typing a password keeps the session (real interaction; "logged into Figma" is journey). Honest cost: a sub-10s purely-visual glance is dropped — we measured nothing; same knife-edge as the passive-reading watch-list item. **Display-time, not capture-time** (unlike the blip filter): sessions stay in storage and the Score table so the rule can be audited against real data; promote to capture once trusted.
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
* **Solution:** on `onInstalled`, the background injects `content.js` into all existing http(s) tabs via `chrome.scripting.executeScript` (requires the `scripting` permission and `host_permissions: ["<all_urls>"]`). chrome:// and Web Store pages cannot be injected — logged, non-fatal.
* **Hardening (agreed 2026-07-15, from code review):**
    * **Duplicate-injection guard:** a tab that finishes loading between an extension reload and the injection loop gets the manifest injection AND the executeScript injection — two live instances, every signal double-counted (silently corrupting score-tuning data). `content.js` sets `window.__fsLoaded` in its isolated world and bails if it's already set. The guard is per extension lifetime (a reload creates a fresh isolated world), so it never blocks legitimate re-injection.
    * **Orphan self-destruct:** orphaned instances (extension reloaded out from under the page) previously kept their 10s timer and all eight listeners running forever — one zombie per reload accumulating in every long-lived tab, the one real path by which capture could weigh on pages. Now every listener registers through one `AbortController`; the instance tears itself down (abort + clearInterval) on its first tick without an extension context (`chrome.runtime.id` gone) or on a failed send.

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

**Rules only.** Evidence, dated history, and rejected alternatives live in `plans/` — display decisions in `plans/timeline_design.md`, tooltips/snapshots in `plans/tooltip_snapshot_plan.md` + `plans/snapshot_implementation.md`. A date tag like (2026-07-16) marks when a rule was agreed; the story behind it is in plans.

### Phase 3a — Debug tools (list removed 2026-07-17)
The dashboard (`dashboard/index.html`, opened full-tab by the toolbar icon, which also console.tables all sessions in the worker console) carries the debug surfaces. The per-session list was removed 2026-07-17 — its jobs were already covered (raw inspection = console dump, tuning = Score table, per-block detail = tooltips).
* **Score table** button: scores every stored session with the live §6 formula via `window.FS_SCORING` (exported by timeline.js — single source of truth, so diagnostics can't drift), logs a `console.table` sorted by score with band counts, and copies TSV to the clipboard. Columns: host, title, secs, attended, hb, aud, kbd, copy, cut, paste, dl, click, mouse, scroll, scr(ollable), score, band, tabId, start (epoch ms), reason, url — enough to re-score weight candidates and replay chain-rule candidates offline.
* **Clear data** button (with confirm): wipes sessions, the color registry, and all snapshots (enumerate with `getKeys()`, never `get(null)`).
* Session-area writes (the live session's 10s heartbeats) refresh only the header count; local-area writes (finalize, color claims, Clear) repaint everything. The ribbon pipeline must never re-run on heartbeats.

**Self-exclusion:** the extension's own pages are never tracked — subsumed by the web-documents-only capture rule (§3 lifecycle semantics).

### Phase 3b — Horizontal Timeline (design adopted from Desktop4, 2026-07-15)
Rendering model ported from the Desktop4 demo (`~/Projects/Desktop4 (lifestreams)`) as pure functions on vanilla DOM/CSS; its WebGL/React stack did not come along.

#### Layout & day navigation
* A single horizontal ribbon: X = chronological time; block width = true duration × scale, floored at `MIN_W` (large blocks stay near-proportional; only slivers stretch the day). Desktop4 visual identity: dark background, flat color-filled blocks with a lighter border rim, hover glow, rotated run titles above the band, short white hour ticks + dim labels below. No zooming, no background grid (a uniform grid implies a uniform time scale, which the two-scale axis contradicts).
* **The timeline is the PRIMARY view (2026-07-15).** Size the ribbon generously — big band, legible type. Page layout (2026-07-17): week strip header, ribbon near the top, the space below kept open as clearance for snapshot tooltips. The whole page is dark.
* **One local calendar day (2026-07-16):** default today; ‹/› header paging bounded to [oldest stored day, today]. A session belongs to the day it **ends** in. The axis spans first→last activity of the viewed day — never a forced midnight-to-midnight canvas. Paging resets open fences. Viewing today live-updates; the "Today" label self-heals across midnight. Date-picker jumping deferred.
* **Week strip (2026-07-17):** one skyline cell per day, oldest→today, above the ribbon; weekday label per cell; selected day highlighted; click a cell to jump day paging there (‹/› stay). A cell draws the ribbon's TOP EDGE — the importance contour — on **linear time**: per 15-minute bin, a bottom-flush bar at the **max raw band** of any session overlapping the bin, tier heights 0.6/0.8/1.0 of the 30px strip, single neutral color — height is the only encoding. All cells share one hour-aligned window (earliest→latest activity across stored days), so hours align vertically across days. Bands come from `FS_SCORING` on raw sessions (ribbon admission rules apply: web sessions, transit filter); the display pipeline (merging/containers) is never invoked — container days skyline lower (watch list). A cell matches its ribbon vertically, never horizontally: the strip answers WHEN, the ribbon answers WHAT.

#### Time scales & hour axis
* **Two time scales (2026-07-15; both halved 2026-07-17):** presence renders at `PX_PER_SEC` = 0.0375 (135px/hr — sized to a NORMAL day so a light day reads light); absence at `GAP_HOUR_PX` = 22 per absent hour (~1/6 speed). Everything is linear in these two constants: hour ticks interpolate through blocks and gaps alike, and **hour boundaries have no width effect anywhere**, including the leading pad (an 8:47 first block sits proportionally after the 8am tick at gap scale). Whole hours inside a long absence render evenly spaced — countable. Gap regions ≥ ~6px carry an invisible hover plate with the exact away-span ("away 11:23 AM – 3:12 PM · 3h 49m"). `MIN_W` = 8 absorbs the small end (blocks under ~3m33s render at the floor). Fixed widths (`MIN_W`, `STICK_W`+`STICK_GAP`, `GAP`) do NOT scale with `PX_PER_SEC` — if dense stretches read too wide, tune the overhead constants, not the scale. Scale history (540 → 270 → 135px/hr) and rejected alternatives (fit-to-viewport, nonlinear width, break glyphs, uniform slots): plans.
* **Hour axis (2026-07-15):** whole-hour labels only — no minute labels; block tooltips carry the exact wall-clock span (`8:47 AM – 8:58 AM`) as ground truth. Hour marks are time-interpolated within whichever block or gap was active then — never assumed linear (widths are floored).
* **Crowded hour labels drop the meridiem (2026-07-17):** every mark first renders the full "9am/12pm" form, then drops to the bare number only when the full label's **measured** half-width + `LABEL_CLEARANCE` would spill past the midpoint to the next mark — room is measured geometry, not gap membership. Only the NEXT mark is tested, so a run's last label always keeps its meridiem — it is the run's anchor ("… 3 4 5pm"). Long absences read "9 10 11 12 1 …"; meridiem flips are implied by context. Backstop: left-to-right label collision thinning — a collider drops, never nudges. **Ticks are never thinned** — the countable-hours property is tick-borne. **Labels are centered under their ticks (2026-07-17)** in a row below the tick row — each label owns its inter-mark column instead of racing the next tick in the same lane.

#### Importance: one score, three tiers, three heights
* Bottom-flush heights — HIGH 100% / MEDIUM 80% / LOW 60% of the band — so the top edge is the single importance contour. Width is time; height is salience (§5).
* **Tier brightness (2026-07-17):** fill brightness joins height as a tier encoding. HIGH paints the full host color; every colored block below HIGH (MEDIUM, and expanded fence members at LOW) paints a solid `color-mix(in srgb, host 50%, page background)` — opaque paint, never alpha, so a block looks identical on any ground (a contained MEDIUM matches its standalone twin exactly). Gray (unclaimed-host) fills and LOW sticks are unchanged. The 50% is a named knob (watch list). **Rims stay full-strength on every tier (2026-07-17):** the border derives from the full host color, never the dimmed fill — the border carries identity, so HIGH and MEDIUM read as one family.
* **The fence:** EVERY run of consecutive LOW blocks — including singletons (2026-07-16, was ≥2; guideline: *opinionated demoting with user exploration* — over-demoting is acceptable while the event stays findable via hover + expand) — collapses into thin picket-fence sticks; click expands in place. MEDIUM+ never fences — anything with real signal is structurally incapable of being hidden (§5 side-quest rule). Expanded members render at LOW height: expansion reveals width, never confers stature. Fence runs split at member gaps ≥ `VISIT_GAP_MS` (isolated LOWs are visits, not bursts — and a fence must never span a gap hole and steal its hover plate). Singleton plates tooltip the host, not "1 rapid events".
* **Clicks (2026-07-15):** click means "open this page" on every block, everywhere — expanded members navigate, never re-collapse. Collapse = the expand bar (a ~16px hit zone around its 4px visual) or Escape. The expand bar lives in its own lane: bar snug under the band, clear gap, then hour ticks/labels — no vertical overlap.

#### Score v1 (FocusStream units)
```
attendedSeconds = max(heartbeats × 10, audibleMs / 1000)
                  // measured attention: active windows OR audible playback
                  // (max, not sum — same-frame video counts in both)
score = attendedSeconds
      + 150 × copy + 150 × cut + 80 × paste
      + 200 × download                      // strongest intent signal we have
      + min(keyboard, 200)                  // 1/keystroke, capped: composition ≈ copy-tier
      + 5 × scroll, ONLY when scrollable    // the "read" premium (added 2026-07-15)
Tiers: HIGH ≥ 1000, MEDIUM ≥ 150
```
* Simpler than Desktop4's formula by design: heartbeats measure attention directly, and background tabs can't inflate dwell (sessions only exist while visible + focused). mouse/click/media contribute via `attendedSeconds` (they make windows active), not separate weights.
* **The scroll term — "the read" (2026-07-15):** `W_SCROLL` = 5 per active scroll window, **gated on `scrollable = true`** — the gate is load-bearing: app-style SPAs scroll an inner container, so `documentElement.scrollHeight` never exceeds the viewport and feeds/Maps noise reads `scrollable = false` by architecture. Merged visits and containers inherit `scrollable` as the OR of their members. Validation method + numbers: plans.
* **⚠ Provisional:** all weights/thresholds are Desktop4-inherited. Keep every weight a named constant; thresholds held while label gating is evaluated (one knob at a time).
* **`heartbeats` capture:** one integer per SessionBlock — total active heartbeats received (NOT derivable from per-signal counts, which overcount multi-signal windows). Max-scroll-depth capture rejected (2026-07-15): it gates against background-tab dwell, a pathology our capture model structurally prevents.

#### Aggregation: visits & containers
* **Same-host visit merging (2026-07-15):** before fencing, consecutive same-host LOW blocks with member gaps < `VISIT_GAP_MS` (5 min — interruption-by-absence) merge into one visit block, scored and banded on the **merged totals**. MEDIUM+ never merges — the visit splits around it (§5 side-quest rule generalized: nothing important can be swallowed, *provided the score sees it*). A still-LOW merged visit stays fence-eligible. Click opens the top-scoring member; tooltip reports the page count. Display-time only; capture stays granular.
* **Containers — anchor + excursions (2026-07-15):** a tab the user keeps *returning* to frames its interruptions; returning is the strongest intent signal we have. **Detection:** same-`tabId` fragments chain when the gap to the next fragment is < `VISIT_GAP_MS`, OR < `AUDIO_BOOKEND_GAP_MS` (30 min, provisional) when both bookend fragments are audible-dominated (`audibleMs` ≥ 50% of duration). tabIds don't survive browser restarts (rare, accepted). A chain whose **summed fragment scores ≥ HIGH** becomes a container: fragments merge into the anchor (score = the sum; **width = wall-clock SPAN** — the one exception to width = duration, which makes containment geometrically possible); foreign events inside the span become **contained children**. **Guards** (the big-email case must never trigger this): (1) ≥1 interruption required — a foreign child in the span OR a **departure-boundary**: a non-final fragment that ended `tab_hidden` (revised 2026-07-16; `spa_navigation`/`navigated` boundaries never count — attention never left — so continuous same-tab reading can't self-containerize); (2) individually-HIGH events never chain (a block that's HIGH alone must not be diluted into a context); (3) a chain whose span holds a same-tab HIGH event is rejected (that event owns the story). Overlapping qualifying chains: higher sum wins. Merged visits carry their last member's `endReason`, so merged-LOW fragments can testify as departures. **Display (rewritten 2026-07-17 — wash retired):** a container paints exactly like a non-container HIGH block — same solid fill, standard rim, normal hover — so importance looks the same whether or not it framed excursions. Children are **cut out** of the interior: drawn on top at time-proportional positions in their own tier paint (capped at MEDIUM — containment frames, never confers, never destroys) with a 2px page-background border as the seam; no fences inside, no labels for children (hover only). If min-width children would overflow, the container stretches. Zero-children containers need no special case (the tooltip's "(interruptions outside the browser)" line still marks them). Click opens the top-scoring fragment; tooltip reports span, attended total, fragment + excursion counts. Pipeline: after visit-merging, before fencing. **§5 note:** containers keep every interruption visible, framed — the no-gap-tolerant-merging spirit is upheld, not violated.
* **Resumed-read containers — PROPOSED/DEFERRED (2026-07-16):** a second, tighter container trigger for the out-and-back read: same `tabId` AND same URL anchor (a *document*, not a site), gaps < `VISIT_GAP_MS`, ≥2 MEDIUM+ fragments, ≥1 foreign child, and **anchor dominance** (summed anchor scores > summed child scores — otherwise the anchor is a launcher and the children are the story). Tier = band of the sum, floor MEDIUM. Validated non-firing against one real day; deferred until a positive specimen appears. Dominance deliberately NOT retrofitted onto the meeting path (audio testifies for meetings, dominance for reads).
* **SPA-continuation merging — DEFERRED (2026-07-15):** proposal on file — merge consecutive same-tab MEDIUM+ events linked by `endReason: "spa_navigation"` (a machinery boundary, not a user boundary). Deferred: two SPA specimens are not a pattern; over-merging is silently destructive, fragmentation is visibly wrong. Collect more SPA data first.

#### Color & labels
* "Application" for us = **hostname**. Hue is identity — score never changes color, and glow is hover-only (a resting brightness difference reads as a different site).
* **Color is rationed by importance (2026-07-15):** only hosts that ever earned a MEDIUM+ block get an identity hue; LOW-only hosts render neutral gray (the day's noise is quiet texture). Assignment is a **persisted first-seen registry** (`hostColorOrder` in `chrome.storage.local`): a host's first-ever MEDIUM+ block claims the next palette slot, round-robin — permanent across days. "Clear data" resets the registry.
* **Palette: Kelly's max-contrast sequence, cut to 16 (2026-07-15).** Kelly's ORDER is the point — any prefix is mutually max-contrast, which matches first-seen claiming; **non-prefix subsets void the contrast warranty, and hashing structurally produces non-prefixes** (two recorded failures: plans). Kept, in Kelly's order: vivid yellow `#F3C300`, strong purple `#875692`, vivid orange `#F38400`, light blue `#A1CAF1`, vivid red `#BE0032`, buff `#C2B280`, vivid green `#008856`, purplish pink `#E68FAC`, strong blue `#0067A5`, yellowish pink `#F99379`, strong violet `#604E97`, orange yellow `#F6A600`, purplish red `#B3446C`, greenish yellow `#DCD300`, yellow green `#8DB600`, reddish orange `#E25822`. Removed: white/black/gray plus the three darkest entries (low-saturation darks converge on the noise-gray and would read "unimportant" — a lie). Wrap collisions begin at colored-host #17 and land on the oldest assignments.
* **Transient colors CONTINUE the Kelly sequence past the registry (2026-07-15):** open-fence members of LOW-only hosts take slots k+1, k+2… in first-appearance order — recomputed every render, never persisted — so everything visible is a Kelly prefix, mutually max-contrast by construction. MEDIUM+ identities get the hard guarantees (permanence, max contrast); LOW gets best-effort.
* Hover feedback = white glow + mild brighten, never a strong brightness filter (dark identities must not impersonate light ones). Run labels render in the rim mix (65% color + white). Self-legending: every visible hue is named by its label; redundant tier-coloring/score-gradients rejected (they restate height). Single-color is the fallback if this still reads busy.
* **Fence-open relaxation (2026-07-15):** expanding a fence grants its members identity colors and label eligibility (a tight domain — cardinality stays sane); collapsed sticks stay gray. Label collision rules still apply.
* **Labels are title-derived site names (2026-07-15):** a run's label is the most common trailing title segment (split on spaced `- – — | · /`) across its member pages — majority agreement required for multi-page runs, ≤24 chars accepted for single pages, hostname fallback. Identity (color, grouping) stays hostname-keyed.
* **Labels are importance-gated (2026-07-15):** only runs containing a MEDIUM+ block earn a title; LOW never labels (tooltips carry the rest). When two earned labels collide, the higher score wins and the loser is dropped — never nudged (a nudged label misaligns with its block). Horizontal in-block labels deferred.

#### Tooltips & snapshots
* **Custom tooltip layer (2026-07-15):** a self-drawn `#tip` panel with a uniform `TIP_DELAY_MS` (300ms) — native `title` tooltips have uncontrollable warm-up timing. Delegated pointerover/out/down on `#ribbon`; text set via `textContent` only (titles/URLs are page-controlled strings). The tooltip is measured at the origin before positioning (2026-07-17: a fixed-position box shrink-to-fits against the viewport edge, so measuring at the previous hover's leftover `left` squeezed it near the right edge).
* **Snapshot previews (2026-07-16):** block tooltips show a page screenshot above the text. **Capture:** `chrome.tabs.captureVisibleTab()` on the session's **first heartbeat only** — the heartbeat message carries its reason, and `flush-on-hidden` beats never capture (they fire exactly while the *next* tab becomes visible — the wrong-page trap). Only pages that earned attention earn a picture; capture is fire-and-forget and all failures are soft. **Downscale** in the worker: JPEG capture → `createImageBitmap` → `OffscreenCanvas` → JPEG at 640px width, quality 0.6 (~20–40KB); stored as a `data:` URL under `snap:<sessionId>` (storage/retention: §2). **Display:** lazy fetch on hover; merged visits and containers show their best-scoring member that HAS a picture (the click target stays the top scorer regardless); expanded fence members show their own; collapsed sticks and fence plates stay text-only. The image is revealed only after `img.decode()` resolves, so the tooltip is measured and viewport-clamped exactly once. **Privacy (recorded deliberately):** this puts images of everything browsed on disk — fine for a personal experiment, but a real property change of the tool; "Clear data" deletes all snapshots. As-built details: `plans/snapshot_implementation.md`.

### Watch list (living — consolidated 2026-07-15; CLAUDE.md links here)
Every "watch with data" item in one place. Each is a deliberate trade-off, not a bug.
* **MEDIUM=150 may be too permissive** — many blocks escape the fence; thresholds held until label gating is evaluated (one knob at a time).
* **Band is duration-biased:** 30s of intense typing scores LOW; density rescue (keystrokes/sec) is a future scoring knob.
* **Passive reading undercounts** attended time (bsky 284s → 140), and the transit filter drops sub-10s purely-visual glances — same knife-edge, two sides; decide with more data. Partially addressed 2026-07-15 by the scroll term ("the read"), but only for document-style pages.
* **bsky.app scrolls the document** (`scrollable = y`, unlike Phanpy/LinkedIn's inner containers), so a long Bluesky graze earns the scroll premium and could promote to MEDIUM — watch whether that reads as honest consumption or feed noise.
* **Transit filter is display-time:** audit via the Score table; promote to capture once trusted.
* **Palette:** buff is grayish by design (cut to 15 if it muddies); wrap collisions begin at colored-host #17 (consider LRU reassignment with data).
* **Containers:** two long videos in one tab <30 min apart chain into a "YouTube container" (audio-bookend false positive); Meet titles misfire the site-name heuristic ("Scott").
* **Fences:** singleton LOWs now collapse to lone sticks (2026-07-16, resolving the "reads as clutter" watch — it did). New watch: whether lone 3px sticks feel *too* quiet, i.e. whether the user misses seeing isolated 30–60s glances at full height. Revert = `MIN_RUN` back to 2.
* **Gap loudness:** presence:absence held at 6:1 through the 2026-07-17 halving (both knobs moved together), so the 2026-07-16 watch carries over unchanged — does absence read too prominent? Next knob if so: `GAP_HOUR_PX` 22 → 11 (~12:1).
* **Week strip is a usefulness bet:** the skyline design is cheap by construction, but whether a compact rhythm view earns its header space is only decidable on real use — evaluate once 5+ days of cells exist.
* **Week strip vs. container days:** strip tiers are raw per-session bands, so meeting-heavy days skyline lower than their ribbon (MEDIUM fragments, HIGH container). If it grates, extract merge/container banding (not layout) into a shared step.
* **MEDIUM 50% mix — palette compression (2026-07-17):** dimming toward the background pushes dark Kelly entries toward each other (the hover-saga impersonation risk). If MEDIUM identity suffers, raise `MEDIUM_MIX_PCT` (50 → 65) before anything structural.
* **Contained-child visibility (2026-07-17):** children paint MEDIUM-dim on a full-brightness container fill, separated only by the 2px cut-out seam. If genuinely-HIGH excursions get lost, the fallback is brightness-follows-true-band inside containers (height cap stays).
* **Fixed-overhead dilation after the 2026-07-17 halving:** `MIN_W`/`STICK_W`/`GAP` don't scale with `PX_PER_SEC`, so floored blocks (now anything under ~3m33s) and fence sticks claim a larger share of the ribbon — busy sections shrink sublinearly. If dense stretches still read too wide, tune the overhead constants, not the scale.
* **Container interior dilation:** a container renders its SPAN at presence scale, so interior time covered by neither fragments nor children is dilated ~6× vs gap scale. Negligible on the one real specimen (182s uncovered ≈ 14px), but it scales with the audio-bookend bridge (the 20-min whiteboard case would draw ~20 min of empty container interior). Candidate fix if a bloated specimen appears: render uncovered interior stretches at gap scale, at the cost of children no longer sitting at linearly-proportional positions.
* **SPA-continuation merging deferred:** collect endReason/band data on more SPAs (Gmail and Gemini are the only specimens so far).
* **Resumed-read containers deferred:** rule + guards validated for non-firing on one day; waiting for a positive specimen (a real M-detour-M read) before implementing.
* ~~All-transit-interruptions container gap~~ **Resolved 2026-07-16** by the departure-boundary rule (containers guard 1; story in plans).

## 7. Build Order
* **Phase 1 — Core loop:** `manifest.json` (permissions: `storage`, `webNavigation`, `tabs`, `scripting`; host permissions for injection) + content-script heartbeat + background session lifecycle (create on nav/tab-switch, finalize on nav/switch/close/hidden), writing to storage. No UI — verify by inspecting `chrome.storage.local` in DevTools while browsing.
* **Phase 2 — Edge cases:** SPA navigation + noise filter, video detection, non-scrollable pages, flush-on-hidden hardening.
* **Phase 3 — Dashboard:** the full-tab timeline UI.
* **Implemented 2026-07-15:** `download` signal capture (§5 roadmap); grouped debug view — consecutive same-hostname visit rows, expandable to member sessions (§5 grouping decisions).
* **Phase 3b implemented 2026-07-15:** `heartbeats` counter capture; horizontal timeline per §6 (`dashboard/timeline.js` — score → tiers → fence, vanilla DOM/CSS, Desktop4 visual identity) rendered above the debug list.
* **Deferred:** `parentId` / opener-tab tracking; any tree or branching view; zooming, jumping to an arbitrary day (date picker — ‹/› paging shipped 2026-07-16); screenshots (+ heatmaps); max-scroll-depth capture (rejected for now, see §6).
