# Active Tab Manager Spec — §7

Third pillar (2026-08-21), split out like capture/display rather than folded
into either — this is a live, on-page UI surface with its own eventual
reconciliation into the historical container view, not a capture rule or a
historical-display rule. Grows by dated entry exactly like `capture.md`/
`display.md` — this file holds only what's built and true today; the full
phase roadmap (including phases not yet built) and the reasoning behind the
phasing live in `decisions/tabmanager.md`. Open doubts: `WATCHLIST.md`.

## 7. Live Tab Strip (Phase 1, 2026-08-21)

**Scope invariant:** Phase 1 changes nothing about capture (§3–§4). Session
lifecycle, heartbeats, Score v1, snapshots — unchanged. This is a second,
parallel *view* of tab state the background script already observes for
session-lifecycle purposes; it does not create a shadow tab system, and it
does not evict tabs by score (that's Phase 3, still undesigned). A tile
close box (below) closes exactly the tab the user clicked — a direct,
user-initiated action, not scored eviction.

* **Surface:** a shadow-DOM strip injected top-frame only
  (`window === window.top` — a strip rendered inside an iframe would be a
  bug) via the existing `content_scripts` entry (`content.js`'s injection
  point, not a new one). One tile per open tab (favicon + short site-name
  label).
* **Tile label:** the same short site name the historical dashboard shows
  ("Gmail", "Google Voice") — `shared/utility.js`'s `computeHostNames`,
  reused live rather than forked, keyed by `labelKeyOf(host, url)`. Falls
  back to the bare hostname when no confident name exists yet (fresh host,
  no admitted history). Computed from `chrome.storage.local`'s `sessions`
  (up to 7 days retained, spec §3 `RETENTION_MS`) and cached in the
  background worker, invalidated on any write to that key — not
  recomputed per tab event. The tile's full `document.title`/URL remains
  available as the hover tooltip. `shared/utility.js`: `decisions/
  tabmanager.md`, "Live labels: promoting siteNameOf out of the
  dashboard".
* **Placement (revised 2026-08-21, same day):** always-visible, fixed to the
  top of the viewport (`position: fixed`, high z-index), with a companion
  `html { margin-top: 34px !important }` override on the page's own root —
  not plain push-down. Plain push-down (a normal in-flow first child) was
  the original design but fails silently on any site whose own app root is
  `position: fixed`/`absolute` over the full viewport (Google Voice
  confirmed as a specimen: strip mounted correctly, zero errors, entirely
  invisible, painted under Voice's own fixed shell). Fixed-overlay +
  margin-top compensation is visible unconditionally and reproduces the old
  push-down behavior pixel-for-pixel on every `position: static` site
  (confirmed: Gmail, Calendar). **Residual, deliberately accepted:** on a
  fixed-root site, `margin-top` cannot move that site's own `position:
  fixed` elements, so its own top ~34px still sits under the strip — known
  countermeasure (nudge same-shape elements at mount) deferred, not built
  — see `WATCHLIST.md` "switcher-fixed-root-overlap".
* **Data flow:** `background.js` already receives `tabs.onCreated` /
  `onRemoved` / `onUpdated` / `onActivated` for session-lifecycle purposes;
  Phase 1 broadcasts that same event stream to the injected strip via
  `chrome.tabs.sendMessage` — event-driven, no polling (matches the
  no-keepalive posture in §2).
* **Switching:** a tile click posts `{type:'FS_SWITCH_TAB', tabId}` to the
  background, which calls `chrome.tabs.update(tabId,{active:true})`
  (+ `windows.update` if the tab is in a different window). The strip never
  calls `chrome.tabs.*` itself — only the service worker holds that
  permission's actual capability from a content-script trigger.
* **Closing:** each tile shows a hover-revealed `×` (matches Chrome's own
  tab close box). Clicking it posts `{type:'FS_CLOSE_TAB', tabId}` to the
  background, which calls `chrome.tabs.remove(tabId)` — same
  never-calls-`chrome.tabs.*`-from-the-strip rule as switching. No new
  synchronization mechanism needed: `chrome.tabs.onRemoved` already fires
  for a close from *any* source (this close box, Cmd-W, Chrome's own `×`,
  another extension) and the existing per-window broadcast
  (`broadcastTabsForWindow`) already re-syncs every other strip in that
  window on every such event. `decisions/tabmanager.md`, "Close box +
  cross-window sync".

### Deferred
Scoring/band on tiles, scored auto-eviction (Phase 3), the full ribbon/card
view (Phase 2), and how a closed tab folds into an existing historical
container (Phase 4). None of this is built or assumed by Phase 1 — full
roadmap and reasoning: `decisions/tabmanager.md`.
