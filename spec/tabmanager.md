# Active Tab Manager Spec — §7

Third pillar (2026-08-21), split out like capture/display rather than folded
into either — this is a live, on-page UI surface with its own eventual
reconciliation into the historical container view, not a capture rule or a
historical-display rule. Grows by dated entry exactly like `capture.md`/
`display.md` — this file holds only what's built and true today; the full
phase roadmap (including phases not yet built) and the reasoning behind the
phasing live in `decisions/tabmanager.md`. Open doubts: `WATCHLIST.md`.

## Status: CLOSED (2026-08-25)

**This file is now historical.** It describes the injected tab strip — a
content-script surface that §8 Phase 1 removes. Nothing here is a rule to
extend; it is the record of a completed exploration and its result.

**The ribbon's navigation rules moved to `spec/ribbon.md`** (§7c-ribbon, §7d,
§7e, §7g, §7h — zoom, cross-day loading, the coordinate system, panning).
That behaviour is live, is Track B, and folds into §6 later. Only strip
content stayed here: §7 (injection, placement, close box), §7b (the
strip/ribbon height-mode unification), §7c-strip (Chrome-order tiles), §7f
(open-tab marking), §7i (strip visuals + broadcast narrowing).

**Retired outright, not pending:**
* **Phase 3 (score-ranked eviction)** — §8's read-later counterexample makes
  score an inverted signal for the population it would target first.
* **Phase 4 (active→historical reconciliation)** — dissolved rather than
  deferred: a parked tab was never attended, so it has nothing to reconcile
  into a container, and a user-closed tab already folds into history today.
* **The strip→ribbon animation rework** (never designed) and §7f's pending
  open-block visual treatment (its second job) — both disappear with the
  strip.
* **Three watch items**, all structural properties of content-script
  injection: `switcher-fixed-root-overlap`, `switcher-navigation-flash`,
  `switcher-phase1-rough-edges`. Deleted from `WATCHLIST.md` 2026-08-25.

Story and closing entry: `decisions/tabmanager.md` (also closed). The §8
supersession: `spec/parkinglot.md`, `decisions/parkinglot.md`.

**Terms (fixed 2026-08-22, §7b):** **strip** = the collapsed, Chrome-tab-
bar-like state (`heightMode: "uniform"`); **ribbon** = the expanded,
full-history state (`heightMode: "tiered"`, also the name of the
pre-existing historical Classic view these two states now share); **block**
= one item in the list, in either state (the `.blk` element). Earlier §7
text below (Phase 1, predates this naming pass) uses "tile" for the same
thing — left as originally written, not retroactively renamed.

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
  no-keepalive posture in §2). **Narrowed 2026-08-24, see §7i:** only
  add/remove and title/favicon changes broadcast now; focus changes do not.
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
  cross-window sync". **Rebuilt on `.blk` 2026-08-23** after being lost as
  collateral in the Phase 2 unification (`de076eb` replaced the `.fs-tab`
  DOM this `.fs-close` lived on); the `FS_CLOSE_TAB` handler was untouched
  throughout, so only the UI half went missing. Now `.blk-close`, painted in
  `paint()`'s own pass, strip-only and never on pinned tabs (real Chrome
  offers no close box there either, and a 30px icon-only tile has no room).

### Deferred (Phase 1)
Scoring/band on tiles, scored auto-eviction (Phase 3), and how a closed tab
folds into an existing historical container (Phase 4). Full roadmap and
reasoning: `decisions/tabmanager.md`.

## 7b. Animated Open-Tabs View (Phase 2, 2026-08-22)

Reasoning, and the three architectures this replaced: `decisions/tabmanager.md`,
"Open-tabs/history unification".

**One pipeline.** `render()` → `assembleThreads()` → `clusterEvents()` →
`layout()` → `paint()`/`.blk` serves both states. Every open tab is a
session-shaped entry spliced into the same array as the day's finalized
sessions and gets the same container/thread/tier treatment as any closed
visit. There is no separate open-tabs geometry, assembly, or draw function.

**Right-anchored to "now":** the overlay sets `window.__fsTimelineAnchor =
"right"` — today's open tabs at the right edge, closed history to their left.
The standalone dashboard defaults to `"left"`.

**Collapsed vs. expanded is HEIGHT ONLY.** `heightMode` (`"uniform"` |
`"tiered"`, set via `window.__fsHeightMode` / `setHeightMode()`) is read only
in `paint()`'s per-seg height calculation. Horizontal geometry (`x`/`w`,
`PX_PER_SEC`/zoom) is deliberately not part of it (Scott, 2026-08-22: "expand
does not change the zoom level... only vertical reveal"), so expand/collapse
changes only `top`/`height` and the existing CSS transition animates it free.
* `"uniform"`: every top-level block forces `STRIP_TILE_H` regardless of
  band; contained children skipped; no title/axis frame; no hover chrome at
  all (`dataset.tip`/`_tipData` deleted per block, `.blk:hover` scoped to
  `#ribbon:not(.uniform-height)`); wheel zoom disabled.
* `"tiered"`: three-height `TIER_H` behavior, contained children visible,
  full frame, hover chrome active.
* Collapsing resets `scrollLeft` to the right-anchored resting edge, so a
  strip scrolled into history returns to today's tabs. Zoom LEVEL survives.

**Open tabs are synthetic session-shaped records** (see §7c for the current
producer): `id` `"open:"+tabId`, `endTime` re-set every repaint so `durMs`
grows, `isOpenTab: true`. Display-only — never written to
`chrome.storage.local`; `background.js`'s finalize-only write contract is
untouched.
* **`isTransit` applies uniformly, no bypass** (Scott, 2026-08-22).
* **`isOpenTab`/`openTabId` propagate through merges and containers**
  (`assembly.js`, OR-of-members, same convention as `scrollable`) — so a
  container holding an open tab switches to it rather than duplicating it.
  The click handler reads `openTabId`, since a merge can span tabs.
* **Open tabs never fence-collapse** (Scott, 2026-08-22): a tab reachable
  right now must not vanish into a non-clickable stick for scoring LOW.

**Shadow-root hosting.** `switcher.js` mounts one `#fs-switcher-host` whose
height animates between `STRIP_HEIGHT_PX` and the painted content height
(`ResizeObserver` on `#ribbon`). Requirements that are easy to break:
* A real `<body>`-tagged element as the shadow root's one child, `height:
  100%` — `timeline.css` styles `body`, and a shadow root has no implicit one.
* `#ribbon-wrap` padding overridden to `0` in this copy only.
* `#ribbon`/`#ribbon-wrap`/`#ribbon-empty`/`#week-strip` are the only IDs
  `timeline.js` looks up; `week-strip` exists solely because
  `renderWeekStrip()` looks for it, hidden by attribute AND inline
  `display: none` (the stylesheet's ID selector beats the `hidden` UA rule).
* **DOM-root parameterization:** `timeline.js`'s `document.getElementById`
  call sites go through `qs()`/`rootContainer()`, reading
  `window.__fsTimelineRoot` at MODULE-INIT (several elements are created in
  the top-level IIFE, before any render call). One render path, two hosts.
* **Module loading:** `switcher.js` dynamic-`import()`s the ES modules (MV3
  content scripts can't be `"type": "module"`), `shared/transit.js` first
  since `assembly.js`/`timeline.js` read its `window.FS_TRANSIT` side-effect.
  All declared in `web_accessible_resources` with `dashboard/timeline.css`.
* **CSS delivery:** one `dashboard/timeline.css`, linked by the standalone
  dashboard and fetched/injected into this shadow root.

**Block label:** always-on `.blk-label` on every `.blk`, one unconditional
rule — top-anchored, side-by-side with the favicon, identical in both
`heightMode`s (expand changes height only, never label position).

**Persistent run-title (`.rtitle`) suppressed here** (2026-08-22): redundant
with `.blk-label` plus the hover tooltip. Gated on `anchorMode === "right"`;
the standalone dashboard keeps it. The floating quick label retired the same
way on 2026-08-25 (§7h).

**Click:** an `isOpenTab` seg posts `{type:'FS_SWITCH_TAB', tabId:
openTabId}` — never `chrome.tabs.create`, which would duplicate an open tab.

**Toggle:** dedicated `expandBtn`/`collapseBtn` carets, top-right; Escape
also collapses. Not a click-anywhere listener (blocks are narrow, the bar
spans the viewport, so it fired on nearly every click).

## 7c-strip. Strip ordering (2026-08-22)

**Ribbon half moved to `spec/ribbon.md` 2026-08-25** (§7c-ribbon: the
`DEFAULT_WINDOW_BLOCKS` default window, the pre-paint flush, fence
retirement). What stays here is the strip's own ordering.


Separates "currently open" (a Chrome fact) from "recently attended" (a
telemetry fact) — 7b's original `now`-anchoring conflated them. The bug
trail and every rejected alternative: `decisions/tabmanager.md`, "Strip
ordering rethink", "Strip data source", "Strip scroll-justify was
backwards", "applyDefaultZoomWindow's one-shot fired at the wrong moment".

**The strip is built directly from the live open-tab list, bypassing the
day-filtered ribbon pipeline** (`stripEventsFromOpenTabs`, reading
`lastOpenTabs`/`lastSessions`). Categorical Chrome order, not temporal, and
NOT scoped to today: an open tab last active yesterday, or never, still gets
a tile.
* `band`/`score` come from real prior evidence when it exists, LOW otherwise
  (nothing earned yet — not a guess).
* `tabIndex` is the tab's real position in `chrome.tabs.query` order (pinned
  first, by Chrome's construction); `stripLayout()` sorts by it at fixed
  pitch (`STRIP_TILE_W`/`STRIP_PINNED_TILE_W`, no time math).
* **Pinned tabs are icon-only, no label** — matches real Chrome.
* **Resting scroll is ALWAYS the left edge** (`scrollLeft: 0`, on render and
  on collapse): a real tab bar never hides its first pinned tabs.

**Animation is intersection-only:** a tab animates strip→ribbon only if it
has a position under the ribbon's current zoom/scroll. A tab outside that
window isn't part of the tiered paint — no fade-out, no edge-pinned
placeholder. Its reachability is unchanged: still in the strip (Chrome order,
any day) and in the ribbon once scrolled to its real time position.

## 7f. Open-tab marking (built 2026-08-23)

Eviction (Phase 3) is designed but NOT built, and its design lives only in
`decisions/tabmanager.md`, "Marking open tabs: shape, not colour; and
eviction by score". Blocked on `WATCHLIST.md` `eviction-fallback-tedium` and
the standing dry-run-vs-live rule.

**Open blocks are marked by SHAPE, not colour: rounded top corners, so they
read as tabs.** The requirement is persistence, not transition — a static
mark survives zoom, scroll, and day loading; an animation fires once and is
gone. Shape because the other channels are committed: fill and rim luminance
carry importance (§6), and a second colour was tried there once and reverted
(earned-HIGH's gold, 2026-08-08). Shape composes with any fill or rim, so
open + important + earned-HIGH can all show at once.

Shape needs an edge to be seen against: open blocks also take a
high-contrast rim (`rgba(255,255,255,0.85)`, `!important` to beat `paint()`'s
inline `borderColor` write) with a transparent bottom edge so the tab sits on
the baseline. Rounded corners alone were invisible. In the strip the bright
rim means *active* instead, not open (§7i) — the two rules are disjoint by
`heightMode`.

The same shape applies in both states: strip items look like tabs, and
ribbon blocks for currently-open tabs carry it too. That shared mark ties the
two views together.

**The height animation stays; per-item motion is retired.** Expand/collapse
animates vertically — the strip grows into the ribbon. No attempt to travel a
strip tile to its ribbon block: strip order is Chrome's (categorical), ribbon
order is time, so they do not correspond positionally, and an open tab
outside the ribbon's window has no destination at all. The container
animates, the items do not. Revisit only if the ordering mismatch changes.

**A closed tab is ordinary history.** No "recently closed" styling, no
resurrection state — it loses the tab shape on the next paint and is a normal
historical block. Closing is not a transition to be represented; it is a
return to the default.

## 7i. Strip visual pass + broadcast narrowing (2026-08-24)

Visual tuning of the collapsed strip, plus the messaging rule the border
flicker turned out to be about. Reasoning: `decisions/tabmanager.md`,
"Strip visual pass" and "Active is a local fact".

**Visual (all strip-scoped, `heightMode: "uniform"` only — `TIER_FILL`/
`TIER_RIM`/`PAGE_BG` are untouched and the tiered ribbon is unchanged):**
* `STRIP_GAP` (6px) separates tiles, replacing reuse of the ribbon's shared
  `GAP` (2px) — at 2px the 120px tiles butted together and read as one bar.
* `STRIP_TILE_H` is 34, matching `switcher.js`'s `STRIP_HEIGHT_PX`. At 30 the
  ribbon collapsed to 30px inside a 34px host and the leftover 4px painted as
  a black band under every tile, which stopped them reading as tabs.
* Strip ground is `#000` (via `#ribbon-wrap:has(#ribbon.uniform-height)`),
  tiles are `#333`; open-tab corner radius 8px → 6px.
* **The strip's rim is flat (`#3F3F46`), band-blind.** Band is a historical-
  attention fact with no meaning in a tab bar where every tile is an open tab,
  and the tier rims were nearly invisible against `#333` anyway.
* **The active tile carries the bright rim; open blocks carry it in the
  tiered ribbon.** The two rules are disjoint by `heightMode`, so the rim
  means exactly one thing per view — "active" in the strip, "open" in the
  ribbon (where §7f's shape mark needs an edge to be seen against).

**`active` is a LOCAL fact, never broadcast.** `toStripTab` no longer sends
it. Each strip is told its own `selfTabId` (in the `FS_GET_TABS` reply) and
stamps `active: true` on that one tile at paint time — a strip marks itself,
permanently, and cannot go stale: the tile it marks is the tab the user is
looking at whenever that strip is visible at all.

**Only add/remove and title/favicon broadcast to other tabs** (Scott's rule).
The `switcher: onActivated` broadcast is deleted and `status: "complete"` is
out of the `onUpdated` filter; both carried no strip-visible information and
fired on every switch. The session-lifecycle `onActivated` listener is
untouched — that is capture, not display. **A tab switch now causes zero
repaints in any strip.**
