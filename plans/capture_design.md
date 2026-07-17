# Capture Design — Decision Log (content script + service worker)

The spec (`SPEC.md` §2–§4) holds the **current rules**; this
file holds the dated decisions and the reasoning — moved out of CLAUDE.md
2026-07-15 to keep it lean.

## Session model
- Only active (visible, focused) tabs accrue activity. Tab switch *finalizes*
  the session; returning starts a new block with the same URL. Repeated-URL
  blocks are correct — the dashboard aggregates at display time.
- The unfinalized session lives in `chrome.storage.session`, never in worker
  memory — MV3 workers die after ~30s idle. Finalized blocks append to
  `chrome.storage.local`. No keepalive hacks or alarms.
- `id` is opaque (not `Date.now()` — SPA navigations can collide on
  milliseconds); `startTime`/`endTime` are explicit fields.
- Every SessionBlock carries `tabId` and `endReason` specifically to make
  captured data debuggable.
- **Retention (2026-07-15, from code review):** blocks older than 7 days are
  pruned at finalize — the array is rewritten in full per finalize, so
  unbounded growth made every tab switch serialize the whole history.

## Heartbeat model
- Content script sends only *active* heartbeats (10s windows); silent windows
  send nothing. Duration comes from `startTime`/`endTime`, not heartbeat
  counting; the `heartbeats` counter (×10 = attended seconds) is the dwell term
  of the score.
- Activity is per-signal totals, never a single summed score, and units are
  hybrid: discrete signals (keyboard, click, cut, copy, paste — clipboard types
  are separate signals) record raw event counts; continuous signals (mouse,
  scroll, media) record active-window counts, because their raw event rates
  measure hardware sampling, not attention.
- `scrollable` flag measured per heartbeat (last wins) so the dashboard can
  weight scroll fairly on pages that can't scroll.
- Titles are refreshed on heartbeat/finalize, never captured only at session
  start (SPAs set the title late).

## What is and isn't captured
- **Only http/https/file URLs** (2026-07-15): browser-internal pages
  (chrome://newtab etc.) are skipped at capture — content scripts can't run
  there → guaranteed zero-attention noise; browser-UI time renders as a gap.
  This guard replaced the narrower own-dashboard self-exclusion.
- **Blip filter (2026-07-15):** finalize discards sessions <2s with zero
  heartbeats/activity/audible — redirect hops and instant bounces are
  transition machinery, not journey. (The display-time transit filter is the
  same idea one rung up — see `plans/timeline_design.md`.)
- **`download` signal** (2026-07-15): `chrome.downloads.onCreated`,
  background-observed — "Save image as…" fires no DOM event, so it does not
  ride the heartbeat. Likely the strongest single intent signal.
- **Audible tracking** (2026-07-15): `audibleMs` per session via
  `tabs.onUpdated` events (no polling) — catches cross-origin embedded players
  (YouTube inside Bluesky). Attention = max(heartbeats×10, audibleSeconds), max
  not sum. Muted iframe playback still invisible; `all_frames` injection
  rejected (ad iframes would fake attention).
- Video detection is content-script-side (`!video.paused` in the heartbeat
  check), not `tab.audible` polling.

## SPA navigation
- Via `chrome.webNavigation` events **with a same-URL noise filter AND a 15s
  debounce** (spec Edge Case 3 — both required): URL changes in quick
  succession are view-state churn (Google Maps pans produced ~90 micro-blocks
  without it) and get absorbed into the current session, last URL wins.
- The debounce is correct at the high level but watch for over-collapse of
  high-intent moments (e.g., composing a reply inside Bluesky); stay flexible.

## Injection & lifecycle hardening
- **Auto-inject on install/reload:** background injects `content.js` into
  existing http(s) tabs (`scripting` + host permissions) — otherwise every
  extension reload silently stops tracking in open tabs until refreshed.
- **Duplicate-injection guard (2026-07-15, from code review):** manifest
  injection + install-time executeScript could both land in a tab loading
  during the injection loop — two live instances double-counted every signal.
  `window.__fsLoaded` in the isolated world bails the second copy; per
  extension lifetime, so reloads still re-inject.
- **Orphan self-destruct (2026-07-15, from code review):** instances orphaned
  by a reload previously kept their timer + listeners forever (one zombie per
  reload per long-lived tab — the one real "capture weighs on pages" path).
  All listeners register through one AbortController; teardown fires on the
  first tick without `chrome.runtime.id` or on a failed send.

## Performance posture (2026-07-15 review verdict)
A single healthy content.js instance is negligible: 8 passive one-statement
listeners (no scroll-jank path exists), one 10s tick with one tag-name query
and one layout read. The honest cost ranking is (1) the logging convention,
(2) everything else — and the logging is load-bearing for debugging, kept
deliberately. Full analysis: `plans/code_review_2026-07-15.md`.
