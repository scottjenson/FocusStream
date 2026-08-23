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

**Block label position, fixed 2026-08-22:** `.blk-label` is one
unconditional rule — top-anchored, side-by-side with the favicon — the
same in both `heightMode`s. (Previously only correct while
`uniform`, via a height-scoped override; expanding to `tiered` visibly
dropped the label to the block's bottom edge, since the override no
longer applied — expand must change height only, never label position.)

**Persistent run-title (`.rtitle`) suppressed in this view, 2026-08-22:**
every block here already carries its own always-on `.blk-label` plus the
existing hover tooltip/snapshot; the separate floating "HIGH-run title"
bar (spec §6, pre-existing, unrelated to Phase 2) is pure duplication on
top of both — true for real closed history same as for open tabs, not an
open-tab-specific issue. Suppressed whenever `anchorMode === "right"`
(this overlay); the standalone dashboard (`anchorMode === "left"`) is
unaffected, keeping `.rtitle` as its one on-face title mechanism.

### Deferred (Phase 2)
Multi-day/unbounded zoom-out beyond what real stored history covers;
scored auto-eviction (Phase 3); active→historical reconciliation beyond
what this unification already gives for free (Phase 4, may now be largely
subsumed — an open tab already IS a real thread/container member, not a
separate thing needing to "fold in" later). `decisions/tabmanager.md`.

## 7c. Strip ordering + ribbon default window (built 2026-08-22, corrected through 2026-08-23)

Corrects 7b's `now`-anchoring, which conflated "currently open" (a
Chrome-level fact) with "recently attended" (a telemetry fact) — a pinned
tab idle for hours rendered identically to one just switched into,
always glued to the ribbon's right edge, and (worse, found later)
fabricated multi-hour durations for tabs whose real attention was brief.
Full reasoning, every rejected alternative, and the full real-bug trail
are in `decisions/tabmanager.md` under "Strip ordering rethink" and its
several follow-on entries — this section states only the current, live
rules.

**Strip (`heightMode: "uniform"`) is built directly from the live open-tab
list, bypassing the day-filtered ribbon pipeline entirely**
(`stripEventsFromOpenTabs`, reading `lastOpenTabs`/`lastSessions` set by
`FS_renderOpenTabs`) — categorical Chrome order, not temporal, and NOT
scoped to today: an open tab whose last real activity was yesterday (or
never) still gets a tile. (Earlier version built the strip from
`assembleThreads(parseSessions(sessions, viewDayStart)).filter(isOpenTab)`
— the same day-filtered array the ribbon uses — which silently dropped
any open tab whose most recent real session wasn't from today; real
specimen: 3 of 4 pinned tabs and 1 of 6 regular tabs vanished.) Each
tile's `band`/`score` come from real prior evidence when it exists (LOW
otherwise — nothing earned yet, not a guess); `tabIndex` is the tab's
real position in `chrome.tabs.query`'s own order (pinned tabs first, by
Chrome's own construction) and is what `stripLayout()` (fixed pitch,
`STRIP_TILE_W`/`STRIP_PINNED_TILE_W`, no time math — modeled on the
dormant `cardLayout()`) sorts by. **Pinned tabs are icon-only, no label**
— matches real Chrome's own pinned-tab treatment. **The strip's resting
scroll position is ALWAYS the left edge** (`scrollLeft: 0`, both on
render and on collapse) — a real Chrome tab bar never hides its first
(pinned) tabs; an earlier version right-justified uniform mode too
(reasoning at the time, wrong: "Chrome-order rightmost slot is always
correct"), which scrolled pinned tabs off-screen by default.

**Ribbon (`heightMode: "tiered"`) shows only real, already-finalized
session data — no fabricated timing of any kind.** `markOpenTabs`
(replaces the retired `syntheticSessionsForOpenTabs`) tags a real,
already-finalized session in place (`isOpenTab`/`openTabId`/`tabIndex`/
`pinned`, shallow copy, never mutating the original) when one exists for
an open tab; only a tab with ZERO real history anywhere gets a genuinely
new placeholder, `durMs: 0`, anchored at `now`. (Earlier version computed
`durMs = now - priorStartTime` for EVERY open tab, real specimen: an
85-second real bsky visit at 2:49pm rendered as a 2.5-hour-wide block by
5pm — `durMs` measures "time since last visit began," not attention,
violating spec §1's "activity is the sole proxy for importance." It also
duplicated data: a separate synthetic object for a tab that already had a
real session in `sessions`, with no dedup.) **The currently-focused tab's
in-progress visit is flushed into real `sessions` before the ribbon
paints** (`FS_FLUSH_CURRENT` message, `background.js` — same
`finalizeCurrent`/`startSession` pair `chrome.tabs.onActivated` already
uses on a real tab switch, same `endReason: "tab_hidden"` too, deliberately
reused rather than inventing a new reason so the well-tested departure/
return container-qualification logic in `detectContainers` needs no
changes at all) — every OTHER open tab was already finalized the moment
the user switched away from it, so only the actively-focused tab could
ever have lagged, and only until this flush or the next real boundary.

Defaults on first real expand to a **last-`DEFAULT_WINDOW_BLOCKS` (12)
top-level-blocks lookback** (a container counts as one block; no
fence-detection or secondary adjustment — deliberately the simplest
version). Computed via two real `layout()` passes
(`windowScrollLeft`/`applyDefaultZoomWindow`, both O(n), no search) — NOT
a time-span estimate (an early cut used `spanMs × BASE_PX_PER_SEC`, which
`ZOOM_MAX` clamping and min-width-floor/gap error could silently blow
past). Gated to fire only on a `heightMode === "tiered"` render — the
overlay's very first `render()` call happens at page MOUNT while still
collapsed (`switcher.js` paints once on load), and the one-shot gate
(`defaultZoomApplied`) was being spent there uselessly before an earlier
fix added this gate. `switcher.js`'s `expand()` also calls
`setHeightMode("tiered", true)` (the new `skipPaint` param) instead of
letting it paint immediately — expand() flushes (above) THEN does its own
single fresh render, and letting `setHeightMode` paint first, before the
flush's data existed, meant the zoom calc locked onto a smaller dataset
than what actually painted moments later. Applied once per page lifetime;
every later render falls back to the ordinary right-justify (tiered mode
only) so a manual zoom/scroll is never fought.

**Fences are retired entirely in this view** (`clusterEvents`, gated on
`anchorMode !== "right"`) — not just for open tabs (7b's original,
narrower exemption) but for real closed history too, matching the
card-view's own prior fence retirement (`plans/stack-ribbon.md`). The
standalone dashboard's fencing (spec §6) is unchanged.

**Animation is intersection-only:** a tab animates strip→ribbon only if
it has a valid position under the ribbon's current zoom/scroll; a tab
outside that window simply isn't part of the tiered paint pass — no
fade-out, no edge-pinned placeholder (considered, rejected). Nothing about
a stale tab's real reachability changes: it's still fully present in the
strip (Chrome order, any day) and in the ribbon once zoomed/scrolled to
its real time position, same as any historical event.

**Deferred, not started:** real cross-day zoom-out for the ribbon
(reintroducing multi-day data into a view that currently loads only one
day's `sessions`) — a separate, bigger discussion.

## 7d. Ribbon zoom anchors right (built 2026-08-23)

**The expanded ribbon rests right-pinned: "now" sits at the viewport's
right edge and history runs back to the left.** Zooming in expands
leftward; zooming out contracts back toward the right edge. This replaces
the historical left-justified rest position (spec §6) for the overlay only
— the standalone dashboard is unchanged, and so is the collapsed strip
(see below). Motivation: `now` is the only landmark that stays meaningful
once the ribbon can reach past the current day, where there is no natural
left edge to anchor to.

**Two mechanisms, split by regime, because they answer different
questions.** When the content *overflows* the viewport, the right pin is
just `scrollLeft` clamped to its maximum. When the content *underflows*
there is nothing to scroll at all, so no `scrollLeft` can hold the right
edge; a `marginLeft` pad on `#ribbon` (`paint()`, `max(0, viewportW -
total)`) moves the leftover space to the left instead. The pad is exactly
0 whenever content overflows, so the scrollable regime keeps the
historical geometry untouched. This is NOT the permanent lead spacer tried
and reverted 2026-08-08 (see `timeline.css`): that one existed at every
zoom level and so made `scrollLeft: 0` show blank space in the scrollable
regime, reading as drift under panning. This pad only exists when
scrolling is impossible, so it cannot drift.

**Cursor-anchored zoom survives, bounded.** The existing anchor math (hold
the pointer's x-fraction of total width across the width change) is
unchanged; it is now clamped above by `maxScroll` as well as below by 0.
Zoomed in, the anchor wins — the instant under the pointer stays under it,
so a barely-visible block can be zoomed into directly. Zoomed out, the
anchor target runs past the right end and clamps, producing the pin. The
`min()` *is* the regime switch — there is no mode flag, and the two arms
agree exactly at the crossing point, so there is no jump through the fit
threshold.

**The collapsed strip stays left-justified** (`heightMode === "uniform"`,
same gate on both the pad and `render()`'s scroll reset). Its axis is
categorical (Chrome tab order), not time, so a right edge means nothing
there and pinning to it would hide the first/pinned tabs — the 2026-08-22
bug recorded in §7c. Left- and right-justification coexist as the two arms
of the `heightMode` branch, not as an inconsistency to reconcile.

**`applyDefaultZoomWindow` no longer computes a `scrollLeft`.** It still
solves the zoom that makes `DEFAULT_WINDOW_BLOCKS` (12) fill the viewport;
right-pinning at that zoom shows that same window. The removed left-edge
snap (`windowScrollLeft` as a resting position — the function itself
survives as the zoom probe) degraded worse under a `ZOOM_MIN`/`ZOOM_MAX`
clamp: it could leave "now" off-screen to the right, where the pin always
shows "now" and whatever fits behind it.

**`ZOOM_MAX` is 16** (was 8, provisional — weights and knobs stay named
constants, one turn at a time). At 8x a 30-second visit rendered ~9px
wide, barely clear of `MIN_W`'s 8px floor, which became the binding limit
once zooming in was the main way to inspect short visits. Only affects the
default view on a day sparse enough that 12 blocks wanted more than 8x,
where the higher cap is strictly better.

**Deferred, unchanged from §7c:** real cross-day zoom-out. Zoom-out
currently bottoms out at the day's own extent.

## 7e. Cross-day ribbon (design 2026-08-23)

Replaces the deferral noted at the end of §7c. The ribbon starts at today
and reaches backward through history as the user zooms out, up to a 7-day
cap. Supersedes the week strip's day-*picker* model for this view (Scott:
the per-day mini-summaries "weren't that helpful"); the standalone
dashboard's own day paging (§6) is unchanged.

**The layout engine already spans days; only the data window was
single-day.** `layout()` positions everything from absolute epoch
milliseconds (`(nextStart - prevEnd) / HOUR * GAP_HOUR_PX`) and never reads
clock time — yesterday 9am and today 9am are 86,400,000ms apart and lay out
correctly with no day concept at all. The only clock-relative call is
`msPastHour()`, used for whole-hour tick labels, which is correct as-is. So
cross-day is a **data-windowing** change, not a geometry one: the single
boundary is `parseSessions`' `[viewDayStart, nextDayStart)` filter.

**Scroll position is stored as distance from the RIGHT edge.** `fromRight =
scrollWidth - clientWidth - scrollLeft`, preserved across a day load and
converted back after. `scrollLeft` is measured from the document's left
edge, so prepending a day invalidates it by exactly the width inserted (the
classic prepend-jump); every pixel right of an insertion keeps its distance
from the right edge, so a right-relative offset survives untouched. This is
the same idea as §7d's right pin, and subsumes it: **`fromRight === 0` IS
the resting right pin**, so rest and preserved-anchor are one expression
rather than two mechanisms that must agree. Valid only while zoom is
constant across the load, which the loading rule below guarantees.

**Loading a day never changes zoom.** A load extends content leftward and
recomputes `scrollLeft` from the preserved `fromRight`; nothing else moves.
The user-visible invariant: *loading a day must not move anything already
on screen.*

**Night is a fixed-width divider, not an honest gap.** An overnight gap
rendered at honest gap scale (`GAP_HOUR_PX`) would be thousands of pixels
of empty ribbon between yesterday's last block and today's first — the user
would zoom out into a blank corridor rather than into yesterday. Overnight
gaps therefore collapse to a constant width carrying a vertical day label
("Sunday", "Monday"). Rotated text is accepted deliberately here: the
labels are short, fixed, and repetitive, and the break reads as a clean
day separator. Cost per additional day is O(1) px instead of
O(hours-asleep), which is what makes zoom-out reach real content.
This is the first deliberate exception to §6's absence-proportional gap
rule; it is confined to the day boundary.

**The break is at midnight, provisionally.** A user working 6pm-2am has a
genuinely different "night" and a hard midnight rule would slice through
active work. Known better answer, deliberately not built yet (see
`WATCHLIST.md` `night-break-midnight`): collapse any gap over a threshold,
and let the *label* attach to the first block after midnight — the label
means a calendar day, so its boundary must stay midnight, but the visual
break should land wherever the real quiet stretch is. Both versions are
just "how wide is this gap and what is drawn in it," so the upgrade needs
no other change.

**Days load on demand, one at a time, capped at 7.** The trigger is
CAPACITY, checked at the end of each `paint()`: if the laid-out total is
narrower than the viewport, there is room for more history, so load one
more day. This is the same condition as §7d's underflow pad — "the pad is
non-zero" and "there is room for more history" are one fact. Scroll
position is deliberately NOT the signal: the user reaches history by
zooming, not panning, and zooming out lands in the regime where content
underflows and `scrollLeft` is pinned at 0, where a position test cannot
fire at all (real specimen, `decisions/tabmanager.md`). **One day per
paint, never a loop** — zoom ticks are frequent, so the window catches up
across a gesture instead of jumping several days in one frame. Accepted
consequence: on a sparse day the ribbon RESTS underfilled (today only)
until the user zooms; underfill is a normal resting state here. At 7 days
loading stops, as it does when there is no older data.

**Bands thin out and then drop as zoom decreases, so a multi-day view shows
only what mattered.** LOW and MEDIUM each descend the same four-rung floor
ladder — 8 → 5 → 3 → dropped — offset in zoom so LOW is fully gone before
MEDIUM begins thinning; HIGH never descends. Open tabs are never dropped
whatever their band (they are reachable right now). At full zoom-out the
ribbon shows HIGH blocks and day dividers only, which is the honest answer
to "when did things that mattered happen" rather than a compromise to fit
more days.

The final rung **drops the band from `layout()` entirely** — a zero floor
alone does nothing, because `widthOf` takes `max(floor, realWidth)` and
real width simply wins (measured: with the floor at 0, *zero* of 131 LOW
blocks were still resting on it). Filtering happens before any geometry, so
a dropped block consumes no width and its neighbours' gaps close over it.
Duration is deliberately not preserved here: it is a weak signal this far
out, and a long LOW visit is an oddity rather than something worth width.

This replaced a `MIN_W`-driven wall: every block used to claim 8px
regardless of score, capping the view at `viewport / MIN_W` ≈ 215 blocks at
*any* zoom. Re-enabling fences was measured as the alternative and rejected
— +0.46 days in exchange for 111 blocks made hover-only
(`decisions/tabmanager.md`, "Fence retirement re-tested"). Blocks narrower
than `MIN_W` lose hover (`.inert`): a 1-4px target is worse than none.

**Measured reach: 6 days** (was 3 before the ladders, ~1.75 before
cross-day). All ladder thresholds, `ZOOM_MIN` (0.25, was 0.5) and
`ZOOM_MAX` (16, was 8) are provisional and expected to move with use.

**The strip is unchanged.** Open tabs are a *now* fact with no day
dimension (§7c's Chrome-order, day-filter-bypassing `stripEventsFromOpenTabs`
already ignores days entirely). Cross-day affects the ribbon only.
