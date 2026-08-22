# Active Tab Manager Spec — §7

Third pillar (2026-08-21), split out like capture/display rather than folded
into either — this is a live, on-page UI surface with its own eventual
reconciliation into the historical container view, not a capture rule or a
historical-display rule. Grows by dated entry exactly like `capture.md`/
`display.md` — this file holds only what's built and true today; the full
phase roadmap (including phases not yet built) and the reasoning behind the
phasing live in `decisions/tabmanager.md`. Open doubts: `WATCHLIST.md`.

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

### Deferred (Phase 1)
Scoring/band on tiles, scored auto-eviction (Phase 3), and how a closed tab
folds into an existing historical container (Phase 4). Full roadmap and
reasoning: `decisions/tabmanager.md`.

## 7b. Animated Open-Tabs View (Phase 2, built 2026-08-22, rebuilt three times same week — see `decisions/tabmanager.md` for the prior architectures this superseded, most recently "Open-tabs/history unification")

**Core model, UNIFIED (2026-08-22):** there is exactly ONE ribbon pipeline
— `render()` → `assembleThreads()` → `clusterEvents()` → `layout()` →
`paint()`/`.blk`, `dashboard/timeline.js`'s pre-existing "Classic view"
(genuinely time/tier-reactive; NOT `paintCards()`/`.card`, confirmed
zoom-inert — `decisions/tabmanager.md` "Retargeted mid-build"). Every open
tab is a genuine, session-SHAPED entry spliced into the same array as the
day's real finalized sessions and run through this one pipeline — same
container/thread/tier treatment as any closed visit, keyed by
`assembleThreads()`'s own scheme once it runs. **There is no separate
open-tabs geometry, assembly, or draw function anymore** — the earlier
hyperlocal, `tabId`-keyed side-pipeline (`openTabSegsBase`/
`layoutStripGeom`/`layoutRibbonGeom`/`drawOpenTabSegs`) is retired; it's
why zoom never worked (see below). `decisions/tabmanager.md` "Open-tabs/
history unification."

**Right-anchored to "now":** the overlay sets `window.__fsTimelineAnchor =
"right"` (scaffolding that existed since 2026-08-21 but was unused until
this rework) — today's open tabs sit at the ribbon's right edge, with real
closed history to their left, revealed by zooming/panning out. The
standalone dashboard is unaffected (defaults to `"left"`, unchanged).

**Collapsed vs. expanded is a HEIGHT-ONLY toggle, not a geometry system:**
`heightMode` (`"uniform"` | `"tiered"`, `timeline.js`, set via
`window.__fsHeightMode` at module-init and `setHeightMode()` afterward) is
read only inside `paint()`'s own per-seg height calculation:
* `"uniform"` (collapsed): every top-level block forces `STRIP_TILE_H`
  (30px) regardless of band — tier shows via fill/border color only, like
  a real Chrome tab strip. Contained children are skipped entirely (no
  room, no need at rest). `#ribbon`'s own frame collapses to exactly
  `STRIP_TILE_H`, no title/axis reservation. No hover chrome of any kind
  (tooltip, quickLabel, `:hover` brightness) — `dataset.tip`/`_tipData`
  are deleted on every block while uniform, and `.blk:hover` is scoped to
  `#ribbon:not(.uniform-height)`. Mouse-wheel zoom is also disabled while
  uniform (see below).
* `"tiered"` (expanded): the historical three-height (`TIER_H`) behavior,
  contained children visible, full title/axis frame, hover chrome active.

**Horizontal geometry (`x`/`w`, `PX_PER_SEC`/zoom) is NOT part of
`heightMode` on purpose** (Scott, 2026-08-22: "expand does not change the
zoom level... only vertical reveal, not two-dimensional"). Expand/collapse
therefore only ever changes each `.blk`'s `top`/`height` — its existing
CSS transition (`timeline.css`) animates that for free, same free-
animation mechanism as every prior architecture here, just now backed by
the real pipeline instead of a parallel one. Zoom is the ribbon's own
pre-existing wheel handler, independent of expand/collapse, and now
actually works (previously dead — see "Why zoom was dead" below):
* Gated to only respond while `heightMode === "tiered"` (Scott: "zoom
  only works once expanded") — collapsed stays a clean, static, non-
  interactive-beyond-click strip. Naturally a no-op distinction on the
  standalone dashboard, which never sets `__fsHeightMode` and is always
  `"tiered"`.
* Collapsing resets `#ribbon-wrap`'s `scrollLeft` back to the right-
  anchored resting edge (`setHeightMode`) — if the user zoomed/panned into
  history while expanded, collapsing reliably shows today's open tabs
  again rather than leaving the (now very short) strip scrolled into old
  content. Zoom LEVEL itself is untouched by collapsing — resuming the
  same zoom on re-expand is the default.

**Open tabs as synthetic sessions (`syntheticSessionsForOpenTabs`,
`timeline.js`):** for each open tab, one session-shaped record — real
`id` (`"open:"+tabId`, stable across repaints), `startTime` (from the
tab's most recent finalized session when one exists, else `now`),
`endTime: Date.now()` **re-set on every repaint**, so `durMs` grows
naturally and the record continues clearing `parseSessions()`'s
`endTime`-in-viewed-day filter for as long as the tab stays open. Carries
`isOpenTab: true` and `incomplete` (true only when there's no prior
finalized session at all — a genuinely brand-new tab; a tab WITH prior
history is scored on its real merits like ordinary data, not forced LOW —
narrower than the retired pipeline's "every open tab is incomplete until
finalized" rule). Not written to `chrome.storage.local` — display-only,
spliced into the array `render()` assembles; `background.js`'s
finalize-only write contract for real `sessions` is untouched.

* **`isTransit` applies uniformly, no bypass** (Scott, 2026-08-22): a
  synthetic record for a JUST-opened tab can clear the 10s transit floor
  on a later repaint as long as the tab stays open — a tab closed within
  10s was never going to be visible for this conversation to matter, so
  the edge case doesn't need special-casing.
* **`isOpenTab`/`openTabId` propagate through merges and containers**
  (`assembly.js`'s `mergeVisits`/container-building, both OR-of-members —
  same convention as `scrollable`): a container that includes a currently-
  open tab, directly or via an already-merged fragment, still switches to
  the real tab on click rather than opening a duplicate. `openTabId`
  (not the container's own possibly-`undefined` `tabId`) is what the
  click handler reads, since a merge can span tabs.
* **Open tabs never fence-collapse** (`clusterEvents`, Scott's call,
  2026-08-22): a LOW-band run only fences when `!event.isOpenTab` — a tab
  the user can still switch to right now must never disappear into a tiny
  non-clickable stick just because it currently scores LOW. Same
  precedent as the card view's fence retirement (`plans/stack-ribbon.md`),
  scoped here to `isOpenTab` only, not global.
* **`OPEN_TAB_MIN_W` (96px), not `MIN_W` (8px):** `widthOf()` floors an
  `isOpenTab` seg at a much larger minimum than closed history's 8px sliver
  floor — a just-opened tab (near-zero `durMs`) still needs room for a
  favicon+label. Grows past the floor once real duration earns more, same
  as `MIN_W` always has.

**Why zoom was dead before this rework:** the retired open-tabs pipeline
never called `render()`/`assembleThreads()` at all, so `lastAssembly` (what
the zoom wheel handler's `relayout()` repaints from) was never populated in
the overlay's context — the wheel math fired correctly, `relayout()`
just had nothing real to redraw. Routing open tabs through the real
`render()` pipeline fixes this as a side effect, not a separate patch.

* **One host, one shadow root, one `<body>`:** unchanged from the prior
  architecture — `switcher.js` mounts a single `#fs-switcher-host` (fixed,
  top of viewport, same placement rule as Phase 1 below), whose height
  itself animates (CSS `transition: height`) between `STRIP_HEIGHT_PX`
  (34px) and the real content height of whatever's painted (`ResizeObserver`
  on `#ribbon`, ratcheted to at least 34px). A real `<body>`-tagged element
  is the shadow root's one child, with `height: 100%` (2026-08-22 fix —
  `timeline.css`'s `#ribbon-wrap` sets its own `height: 100%`, which
  resolved against nothing and collapsed the whole ribbon invisible
  without this) — required because `timeline.css`'s base rule is `body {
  font-family/background/color/color-scheme }`; a shadow root has no
  implicit `body`, and without a real one every element silently fell back
  to browser default (serif) styling — first-run bug, fixed 2026-08-21.
* **`#ribbon-wrap` padding overridden to `0`** in this shadow-root copy
  only (2026-08-22 fix): the shared stylesheet's `padding: 8px 16px`,
  fine on the full dashboard page, ate most of a 30-34px collapsed strip.
* **`#ribbon`/`#ribbon-wrap`/`#ribbon-empty`/`#week-strip`** are the only
  IDs `timeline.js`'s DOM lookups need — `week-strip` exists (permanently
  `hidden` via both the attribute AND an explicit inline `display: none`,
  2026-08-22 fix — the stylesheet's `#week-strip { display: flex }` ID
  selector otherwise beats the `hidden` attribute's own low-specificity
  UA rule) only because `renderWeekStrip()` unconditionally looks it up;
  day-paging/the week picker are otherwise entirely absent from this view
  and untouched in the standalone dashboard.
* **DOM-root parameterization:** `timeline.js`'s ~18 `document.getElementById`
  call sites (plus tooltip's `document.body.appendChild`) are indirected
  through `qs()`/`rootContainer()`, reading `window.__fsTimelineRoot` at
  MODULE-INIT time (set synchronously before `import()`, since several
  elements — the tooltip, quick-label — are created at top-level IIFE
  execution, before any render call). Lets the identical render code work
  against `document` (standalone dashboard, unchanged) or this shadow
  root.
* **Module loading:** `timeline.js`/`scoring.js`/`assembly.js` are ES
  modules; MV3 content scripts can't declare `"type": "module"`.
  `switcher.js` loads them via dynamic `import()` on mount. `shared/
  transit.js` is imported explicitly first, since `assembly.js`/
  `timeline.js` read its `window.FS_TRANSIT` global side-effect rather
  than a named export. All four files declared in `manifest.json`'s
  `web_accessible_resources`, alongside `dashboard/timeline.css`.
* **CSS delivery:** `dashboard/index.html`'s inline `<style>` block lives
  in `dashboard/timeline.css`, linked normally by the standalone dashboard
  and fetched/injected into this shadow root's own `<style>` (shadow DOM
  doesn't inherit light-DOM stylesheets). One source of truth for ongoing
  visual tuning, both consumers.
* **Block label:** always-on, clipped domain/site-name label on every
  `.blk` (favicon unchanged — `.blk` already draws one). Not hover-gated.
  Side-by-side with the favicon (not stacked/bottom-anchored) while
  `#ribbon.uniform-height` — the historical stacked favicon-top-left +
  label-bottom-left arrangement applies once tiered (plenty of room
  there).
* **Click:** an `isOpenTab` seg always posts `{type:'FS_SWITCH_TAB',
  tabId: openTabId}` — never `chrome.tabs.create` (the historical
  ribbon's own click behavior for ordinary closed-history segs, which
  would wrongly duplicate an already-open tab).
* **Background:** one shared dark ground (`body`'s `#14161a`,
  `timeline.css`) for both height modes — not part of what animates.
* **Toggle:** dedicated `expandBtn`/`collapseBtn` carets (top-right,
  mutually exclusive visibility) — not a click-anywhere-on-background
  listener (that fired on nearly every click, since blocks are narrow and
  the bar spans the full viewport). Escape also collapses.

### Deferred (Phase 2)
Multi-day/unbounded zoom-out beyond what real stored history covers;
scored auto-eviction (Phase 3); active→historical reconciliation beyond
what this unification already gives for free (Phase 4, may now be largely
subsumed — an open tab already IS a real thread/container member, not a
separate thing needing to "fold in" later). `decisions/tabmanager.md`.
