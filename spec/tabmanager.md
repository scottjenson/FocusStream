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

## 7c. Strip ordering + ribbon default window (2026-08-22)

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

**The ribbon shows only real, already-finalized session data — no fabricated
timing of any kind.** `markOpenTabs` tags a real finalized session in place
(`isOpenTab`/`openTabId`/`tabIndex`/`pinned`, shallow copy, never mutating
the original). Only a tab with ZERO real history anywhere gets a placeholder,
`durMs: 0`, anchored at `now`. Deriving a duration from "time since last
visit began" measures the wrong thing and violates §1's "activity is the sole
proxy for importance".

**The focused tab's in-progress visit is flushed into real `sessions` before
the ribbon paints** (`FS_FLUSH_CURRENT`, `background.js`) — the same
`finalizeCurrent`/`startSession` pair and `endReason: "tab_hidden"` that
`chrome.tabs.onActivated` already uses, deliberately reused so
`detectContainers`' departure/return logic needs no changes. Every other open
tab was already finalized when the user switched away, so only the focused
tab can lag.

**First expand defaults to a `DEFAULT_WINDOW_BLOCKS` (12) top-level-block
lookback** (a container counts as one). Computed via two real `layout()`
passes (`windowScrollLeft`/`applyDefaultZoomWindow`, O(n)), never a time-span
estimate — `ZOOM_MAX` clamping and min-width/gap error can silently blow past
one. Fires only on a `tiered` render (the overlay's first `render()` happens
at mount while still collapsed) and once per page lifetime; later renders
right-justify normally so a manual zoom is never fought. `switcher.js`'s
`expand()` passes `skipPaint` so the flush lands before the zoom calc reads
the dataset.

**Fences are retired entirely in this view** (`clusterEvents`, gated on
`anchorMode !== "right"`) — for real closed history as well as open tabs,
matching the card view's own fence retirement (`plans/stack-ribbon.md`). The
standalone dashboard's fencing (§6) is unchanged.

**Animation is intersection-only:** a tab animates strip→ribbon only if it
has a position under the ribbon's current zoom/scroll. A tab outside that
window isn't part of the tiered paint — no fade-out, no edge-pinned
placeholder. Its reachability is unchanged: still in the strip (Chrome order,
any day) and in the ribbon once scrolled to its real time position.

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

## 7e. Cross-day ribbon (built 2026-08-23)

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
than `MIN_W` lose hover: a 1-4px target is worse than none. **Enforced
inline since 2026-08-25** — the `.inert` class carrying this in
`timeline.css` was silently defeated from the day it shipped by `paint()`'s
own inline `pointer-events: auto` write (inline beats any stylesheet rule),
so every sliver stayed hoverable at every zoom. The width condition now sits
in that inline write; the class stays as documentation of the intent.

**Measured reach: 6 days** (was 3 before the ladders, ~1.75 before
cross-day). All ladder thresholds, `ZOOM_MIN` (0.25, was 0.5) and
`ZOOM_MAX` (16, was 8) are provisional and expected to move with use.

**The strip is unchanged.** Open tabs are a *now* fact with no day
dimension (§7c's Chrome-order, day-filter-bypassing `stripEventsFromOpenTabs`
already ignores days entirely). Cross-day affects the ribbon only.

**Open tabs take `MIN_W`, not a special floor** (2026-08-23, retiring
`OPEN_TAB_MIN_W`'s 96px — §7b). That floor made every open tab render at
identical width regardless of real duration, and at multi-day zoom-out a
handful of them claimed hundreds of px exactly where width was scarcest,
working against the band ladders above. Open tabs keep their exemption from
the band-drop filter — a tab the user can switch to right now stays visible
whatever it scored — but hold `MIN_W` while exempt, not more. Marking a
block as open is a VISUAL job (the `.open-tab` class), not a geometric one;
the visual treatment that replaces the width cue is not yet designed and is
tied to the pending strip→ribbon animation rework.

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

## 7g. Ribbon coordinate system + zoom anchoring (built 2026-08-23)

**`layout()` returns `timeToX` / `xToTime` alongside its geometry.** Ribbon X
is not linear in time and never has been — widths are floored (`MIN_W`, §7e's
band ladders), gaps run on their own `GAP_HOUR_PX` scale (§6 two time
scales), day dividers compress a whole night into a fixed width, and §7e
drops whole bands out of the layout. So "where on screen is time T" is not
computable from the total width; it can only be answered by walking what
`layout()` actually produced. `axisOf` builds one ordered list of
`{t0,t1,x0,x1}` spans and derives both directions from it — binary search per
query, built once per layout.

Holes (stretches with no drawn geometry, e.g. a band-dropped range)
**interpolate** rather than clamping to the previous span's edge. Clamping
collapsed an entire time range onto one pixel, which made the anchor snap
whenever a band threshold was crossed mid-zoom. Interpolating keeps
`timeToX` monotonic and continuous in time — the property the anchor
depends on.

**Zoom anchors on the instant under the cursor.** Read `xToTime` before
relayout, `timeToX` after, and position so that instant lands back under the
same pixel. This replaced a width-fraction proxy, which assumed zoom scales
the ribbon uniformly — it deforms instead, so a fraction lands on a
proportionally-similar pixel showing a different time. A timestamp is also
unaffected by a day loading mid-gesture, where a fraction was not.

**During a gesture the anchor outranks the right pin** (§7d). Holding the
cursor's block steady proved the more important of the two rules: compacting
toward a pinned right edge kept changing what sat under the cursor. The
newest content may therefore sit left of the viewport's right edge, leaving a
deliberate gap. At rest the pin returns — the next real render reasserts it
via `fromRight`. Nothing eases back on its own after the gesture; moving the
view after the user stopped touching it would undo what they just did.

**Two pads, because `scrollLeft` alone cannot express the anchor at either
extreme.** A LEFT pad (`marginLeft`) shifts content right when it underflows
the viewport and there is nothing to scroll. A TRAILING pad (`marginRight`)
extends the scroll range: the platform clamps `scrollLeft` to
`scrollWidth - clientWidth`, and zoom-out shrinks that range, so the anchor's
target was being silently clamped — which *is* right-pinning. A larger left
pad cannot fix that (it grows the needed and available scroll equally); only
trailing space can.

**All scroll math uses our own geometry, never `scrollWidth`.** Reading it
back raced with Chrome's layout flush and returned the previous frame's
width. `paint()` records `total` and both pads at the moment it sets the
styles, and every calculation reads those.

## 7h. Ribbon panning — edge-proximity pump (built 2026-08-24)

**The gesture.** No targetable scroll affordances — no arrows, no visible
scrollbar, no drag. The ribbon pans by where the cursor RESTS inside the
viewport: a dead zone in the middle does nothing, and past its edge the
ribbon travels continuously toward the nearer side, faster the closer the
cursor sits to that side. A hover STATE driven by a rAF pump, not an
event-driven gesture — the cursor can be still while the view moves.

**Continuous ramp, not discrete zones.** Rate is a smooth function of
distance from centre: zero inside the dead zone, rising to a maximum at the
viewport edge, with a curve exponent as the tuning knob. Three fixed zones
with two step rates were rejected — a zone boundary is a step change in
speed, felt as a jerk, and the dead-zone edge is the only threshold that
reads as one (it is felt as motion STARTING). Dead-zone width, exponent and
max rate are provisional play-test knobs; turn one at a time.
**`PAN_DEAD_FRAC` widened 0.5 → 0.667 (2026-08-25):** two-thirds dead, a
1/6 ramp per side — at 0.5 panning fired while the user was still reading.
Curve and max rate untouched.

**Rate is zoom-invariant:** viewport-widths per second, converted to pixels
each frame. A px/frame rate would crawl through minutes at 16x and tear
through days at 0.25x, when the felt speed should be the same at every zoom
level. The remaining scroll range is not an input, so a day loading mid-pan
cannot change the pan's speed.

**Sub-pixel motion is banked, not handed to the platform.** `scrollLeft`
stores at integer device-pixel resolution, so a fractional write rounds and
the remainder is lost — at the gentle end of the ramp that is the whole
frame's motion (measured: 20px/sec travels 0px in two seconds unbanked, 40px
banked). The pump accumulates the fraction and writes only whole pixels: no
artificial speed floor, and the platform's rounding stays out of the loop.

**Position is a pixel between geometry changes, and a TIMESTAMP across
them.** The pan owns `scrollLeft` frame to frame — adding a delta to what is
on screen is exact. It consults its carried instant only when `paint()`'s
recorded total or pads changed under it (a load, a relayout), which is the
one moment a remembered pixel is meaningless and an instant is not. Then it
re-bases through `axis` and drops the banked fraction.

Re-deriving from the timestamp EVERY frame is what the first implementation
did, and it vibrates: the round trip is compressive inside a floored block
(8px can span 40 minutes), so it loses part of each frame's delta and can
land behind where it started. One conversion out on re-base, none back in.

**Hitting a wall ends the pan, and latches which wall.** No point running a
60fps loop against an edge. The latch is required, not decorative:
`pointermove` fires on the faintest jitter and would otherwise restart the
pump straight back into the same wall. Re-arming needs the cursor to call for
the other direction, to return to the dead zone, or the wall to move (a zoom
clears the latch). Only a frame that moves whole pixels registers a wall.

**`fromRight` stays the REST anchor,** re-captured when the pump stops, as
`applyZoom` already does at the end of a zoom. `applyFromRight` is skipped
during a pan, the same way it is skipped during a zoom (`pendingAnchor`).
Retiring `fromRight` in favour of a resting timestamp is the natural
follow-on and is deliberately NOT bundled here.

**Loading is triggered by capacity OR proximity — panning reaches history
too.** `maybeLoadOlderDay` gains a second arm: content underflows the
viewport (§7e's capacity signal) OR the viewport is within `LOAD_MARGIN_PX`
of the oldest loaded content. Both are asked from `paint()`, and neither
gesture knows about loading — zoom changes capacity, pan changes proximity.
The pump also asks each frame, since panning triggers no render of its own.

This reverses §7e's rejection of a scroll-position trigger, deliberately.
That rejection's reason — the signal is undefined on underflow — does not
carry, since panning only exists in the overflow regime. The real argument is
a UX correction: the 7-day window is an efficiency trick and should be
invisible; with infinite memory all seven days would simply be loaded.

The proximity arm is gated on a pan being IN PROGRESS: `scrollLeft` is 0 at
rest on every render, so ungated it reads as "near the left end" before the
user has touched anything and pulls all seven days at startup.
`LOAD_MARGIN_PX` is generous (order of one viewport) so the day lands before
the pan reaches the edge.

**A load moves the view by exactly zero.** The only thing that moves the
viewport is the pan's own rate. A prepended day becomes available to pan
into; the pan reaches it a moment later. This is not the zoom rule ("hold the
block under the cursor") — panning is horizontal motion and content DOES
slide out from under the cursor. The invariant is about jumps, not motion.

**A day load re-solves the default window, until the user takes over.**
`DEFAULT_WINDOW_BLOCKS` (§7c) is a claim about what rests on screen, solved
against the event set present at solve time; a prepend falsifies it. So
`maybeLoadOlderDay` re-arms the one-shot gate before re-rendering — unless
the user has already zoomed or panned, from which point their gesture is the
correction mechanism. The pan arm sets that flag only once it has actually
MOVED something. Re-armed at the load site rather than by loosening the gate,
so ordinary data ticks still never re-solve.

**The wall is honest.** With proximity loading, panning stops only at
`MAX_WINDOW_DAYS` (7) or the genuine end of recorded data — the edge of
history, not the edge of a cache.

**Gating.** Tiered only, same early-return as the wheel handler: the
collapsed strip's axis is categorical (Chrome tab order, §7c). Deliberately
NOT gated on `anchorMode` — the standalone dashboard gets panning too, and
the math holds there because both pads stay 0 outside the overlay. Only the
proximity LOAD arm stays overlay-only. The pump stops when the pointer leaves
the wrap, and arms only after a real `pointermove` inside it (so an overlay
opening under a parked cursor does not start travelling on its own).

**Panning suppresses hover UI — but only once it MOVES** (corrected
2026-08-25). Tooltips, `cardHoverText` and gap plates are inspection;
panning is navigation, and they are not simultaneous intents. Without this,
a block hovered in the outer band slides out from under the cursor
mid-tooltip. Precedent: `.zooming` already suspends transitions for a zoom
gesture.

The trigger is MOTION, not cursor position (corrected 2026-08-25): raised
from the pump's free-motion path only, gated on a frame having moved whole
pixels — the same evidence bar the wall latch uses. Resting in the ramp
against a wall no longer suppresses hover. The JS `panning` flag gating
`maybeLoadOlderDay`'s proximity arm still sets on intent in `startPan()`;
only the CSS class moved. `decisions/tabmanager.md`, "Hover suppression was
keyed to cursor POSITION".

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
