# FocusStream (Lifestreams Telemetry Chrome Extension)

Personal Chrome Extension (Manifest V3) that tracks attention per URL and renders a
chronological, activity-weighted "Lifestreams" timeline.

**The full specification lives in `ChromeExtensionSetup.md` — read it before implementing
anything.** This file is orientation only; the spec is the source of truth for data
structures, edge cases, and semantics.

## Stack & workflow
- Vanilla JS, no build step, no framework, no dependencies. Load unpacked via
  `chrome://extensions` (Developer mode).
- Files: `manifest.json`, `background.js` (service worker), `content.js`,
  `dashboard/` (full-tab UI, phase 3).
- Debugging: inspect the service worker from `chrome://extensions`; verify captured
  data by reading `chrome.storage.local` in DevTools. Every SessionBlock carries
  `tabId` and `endReason` specifically to make phase-1 data debuggable.
- **Logging convention (keep it):** liberal `console.log` with prefixes — `[FS bg]`
  in the service worker, `[FS content]` in the content script — so consoles are
  filterable. Log every lifecycle transition (session start/end with reason, score,
  duration), every heartbeat (sent, received, dropped), and quiet windows.
- **Debug dump:** clicking the toolbar icon prints all finalized sessions as a
  `console.table` (plus the current unfinalized session) in the service worker console.
- **Score table button** (dashboard header): scores all sessions with the live
  §6 formula via `window.FS_SCORING` (exported by timeline.js — single source of
  truth), console.tables them sorted by score, and copies TSV to the clipboard.
  This is the tool for threshold/weight tuning sessions.

## Design philosophy (spec §5 — read it before touching dashboard/grouping code)
- **Importance = intent, not duration.** Block taxonomy: bounce (demote), side-quest
  (short but high-intent — highlight, never absorb), dwell. Interruptions are
  meaningful: grouping uses STRICT adjacency (consecutive same-hostname only);
  gap-tolerant merging is forbidden.
- SPA debounce is correct at the high level but watch for over-collapse of
  high-intent moments (e.g., composing a reply inside Bluesky); stay flexible.
- Eventual pivot: horizontal Lifestreams — width = time, salience = intent.

## Load-bearing decisions (rationale in the spec)
- **Only active (visible, focused) tabs accrue activity.** Tab switch *finalizes* the
  session; returning to a tab starts a new block with the same URL. Repeated-URL
  blocks are correct — the dashboard aggregates per-URL at display time.
- **The unfinalized session lives in `chrome.storage.session`, never in worker
  memory** — MV3 workers die after ~30s idle. Finalized blocks append to
  `chrome.storage.local`. No keepalive hacks or alarms.
- **Content script sends only *active* heartbeats** (10s windows); silent windows
  send nothing. Duration comes from `startTime`/`endTime`, not heartbeat counting.
- **Activity is per-signal totals, never a single summed score**, and units are
  hybrid (see spec "The 10-Second Heartbeat"): discrete signals (keyboard, click,
  cut, copy, paste — clipboard types are separate signals) record raw event
  counts; continuous signals (mouse, scroll, media) record active-10s-window
  counts, because their raw event rates measure hardware sampling, not attention.
- **`scrollable` flag** is measured per heartbeat (last wins) so the dashboard can
  weight scroll fairly on pages that can't scroll.
- **Auto-inject on install/reload:** background injects `content.js` into existing
  http(s) tabs (`scripting` + host permissions) — otherwise every extension reload
  silently stops tracking in open tabs until they're refreshed.
- `id` is opaque (not `Date.now()` — SPA navigations can collide on milliseconds);
  `startTime`/`endTime` are explicit fields.
- Video detection is content-script-side (`!video.paused` in the heartbeat check),
  not `tab.audible` polling.
- SPA navigation via `chrome.webNavigation` events **with a same-URL noise filter
  AND a 15s debounce** (spec Edge Case 3 — both required): URL changes in quick
  succession are view-state churn (Google Maps pans produced ~90 micro-blocks
  without it) and get absorbed into the current session, last URL wins.
- Titles are refreshed on heartbeat/finalize, never captured only at session start
  (SPAs set the title late).
- `parentId` / opener-tab tracking is **deferred** — don't build it yet.

## Status
- Phases: 1 = core capture loop, 2 = edge cases, 3 = dashboard (see spec §6).
- Current state: **Phases 1 and 2 implemented** (core loop verified end-to-end by
  Scott; Phase 2 — SPA nav + noise filter, media, scrollable flag, hybrid
  counting, auto-inject — awaiting manual verification). Old-schema data in
  `chrome.storage.local` should be cleared before testing.
- **Phase 3a: primitive debug dashboard implemented** (`dashboard/`) — one line
  per session, newest first, opened by the toolbar icon (which still also prints
  the console dump). The extension's own pages are excluded from tracking.
- Implemented 2026-07-15: `download` signal (`chrome.downloads.onCreated`,
  background-observed — does not ride the heartbeat) and grouped visit rows in
  the debug dashboard (strict adjacency per spec §5).
- Phase 3b implemented 2026-07-15: `heartbeats` counter (total active windows;
  ×10 = attended seconds) and the horizontal timeline (`dashboard/timeline.js`,
  IIFE exposing `window.renderTimeline`; score → three tiers/heights → picket
  fence, vanilla DOM/CSS) per spec §6. Design ported from the Desktop4 project
  (`~/Projects/Desktop4 (lifestreams)` — its plans/ dir has the rationale; its
  WebGL/React stack and screenshot/heatmap features did NOT port).
- Old sessions captured before the `heartbeats` field score attended-time 0 —
  clear stored data when validating the timeline.
- **The timeline is the PRIMARY view; the vertical list is debug-only and must
  not drive visual design** (Scott, 2026-07-15). Labels are importance-gated:
  MEDIUM+ runs only, collisions resolved by score (higher wins, loser dropped,
  never nudged). Desktop4's first-occurrence-always titling is deleted — wrong
  for the web's hostname cardinality.
- **Color = identity, rationed by importance:** curated ~10-hue palette for
  hosts holding a MEDIUM+ block; LOW-only hosts and collapsed sticks are gray.
  **Fence-open relaxation:** members of an expanded fence get colors and label
  eligibility (collision rules still apply). Expand bar has its own lane below
  the band, above the hour ticks.
- Audible tracking (2026-07-15): `audibleMs` per session via `tabs.onUpdated`
  events (no polling) — catches cross-origin embedded players (YouTube inside
  Bluesky). Attention = max(heartbeats×10, audibleSeconds), max not sum. Muted
  iframe playback still invisible; `all_frames` injection rejected (ad iframes
  would fake attention).
- Watch-list: passive reading undercounts attended time (bsky 284s → 140);
  MED=150 near-miss for long reads — same knob, two sides; decide with more data.
- **Blip filter (2026-07-15):** finalize discards sessions <2s with zero
  heartbeats/activity/audible — redirect hops and instant bounces are
  transition machinery, not journey.
- **Color registry (2026-07-15):** hash assignment replaced — the 20-hue
  wheel produced near-collisions (adjacent greens/pinks on real data; more
  hues ≠ more distinguishable hues). Now a persisted first-seen registry
  (`hostColorOrder` in storage.local): a host's first-ever MEDIUM+ block
  claims the next palette slot, permanent across days. Open-fence LOW-only
  hosts get a transient hash fallback; Clear data resets the registry.
- **Palette = Kelly's max-contrast sequence, cut to 16 (2026-07-15):** a
  hand-built 6-families × 2-lightness palette failed in a day (light/dark
  variants adjacent; hover-brightening faked identities). Kelly's ORDER is
  the point — first N entries always maximally contrast, matching slot
  claiming. Removed white/black/gray + 3 darkest (browns/olive → converge
  on noise-gray). Buff on watch. Hover = glow + mild brighten, never a
  strong brightness filter; run labels use the rim mix for legibility.
  Wrap collisions start at colored-host #17 (watch with data). Open-fence
  transient colors CONTINUE the Kelly sequence past the registry
  (first-appearance order, per-render, never persisted) — visible colors
  always form a Kelly prefix, mutually max-contrast by construction. Two
  hash-based fallbacks failed in one day first (probe = funnel; free-slot
  hash = sampled late entries, which sit close to early ones). Rule:
  non-prefix subsets of Kelly void the contrast warranty, and hashing
  structurally produces non-prefixes. MEDIUM+ gets hard guarantees; LOW
  gets best-effort.
- **Fence clicks (2026-07-15):** expanded members NAVIGATE like any block
  (click-to-recollapse made fence contents un-clickable). Collapse = expand
  bar (16px hit zone, 4px visual via ::after) or Escape. Click-away
  rejected (navigate + collapse firing together is busy). Collapsing is
  low-priority by design — day-paging will reset fences.
- Decided 2026-07-15: only http/https/file URLs are captured — browser-internal
  pages (chrome://newtab etc.) are skipped at capture (content scripts can't run
  there → guaranteed zero-attention noise; browser-UI time renders as a gap).
  This guard replaced the narrower own-dashboard self-exclusion. Display strips
  leading "www." from hostnames (before color hashing/grouping, so variants
  share identity).
- **Visit merging (2026-07-15):** consecutive same-host LOW blocks merge into
  one visit block scored on MERGED totals, before fencing — repairs SPA-debounce
  fragmentation (10 Maps minutes = one MEDIUM, not 11 fenced slivers). MEDIUM+
  never merges: the visit splits around it (a long email inside a Gmail hour
  stands alone). **Max-gap rule:** members must be <5 min apart (VISIT_GAP_MS) —
  a 2s re-peek 9 min later must NOT stretch the visit's span.
- **Hour axis:** whole-hour labels only; ribbon left-pads from the floor hour at
  the time scale so an 8:47 start sits proportionally after the 8am tick.
  Interior gaps still compress; tooltips carry the exact wall-clock span. Detection of big-events-inside-visits rests entirely on score
  calibration — the promotion machinery itself is threshold-agnostic.
- **Labels are title-derived site names** ("Google Maps", not google.com):
  most common trailing title segment across a run's pages, hostname fallback.
  Identity (color/grouping) stays hostname-keyed.
- Open: MEDIUM=150 may be too permissive on real data — thresholds deliberately
  held until label gating is evaluated (one knob at a time).
- Score weights are provisional (inherited from Desktop4's demo-tuned values) —
  expect revision against real data; keep them named constants.
- No zoom, single backward time window for now; paging between days later.
- Workflow reminder: spec changes are proposed and approved BEFORE code changes.
