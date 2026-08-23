# Active Tab Manager — Decision Log

Reasoning/story behind `spec/tabmanager.md` (§7). One accumulating file
across all phases, like `decisions/timeline_design.md` holds the ribbon's
entire multi-month history in one place — new phases append dated entries
here rather than spawning per-phase files.

## Origin (2026-08-21)

A Google Doc ("FocusStream Active Switcher Specification") proposed a full
architectural pivot: moving FocusStream from passive, retrospective
telemetry (SPEC.md §1 — "we do not care about tab management") to an
**agentic, self-evicting tab-management system** — the background script
would actively call `chrome.tabs.remove()` on low-scoring tabs in real
time, promoting the display-time Rung 2 admission filter (`capture.md` §3)
to a capture-time eviction invariant.

**Why this wasn't adopted whole:** the doc's scoring formula is the same
Score v1 that SPEC.md §6 itself flags as `⚠ Provisional: all
weights/thresholds are Desktop4-inherited`. Auto-closing a real browser tab
is destructive and irreversible from the extension's point of view — an
untuned formula making that call in real time risks closing tabs the user
actually wanted, with no way to validate the formula against real usage
before it starts acting. Building the full agentic system in one pass was
considered and rejected for exactly this reason.

**What was separately confirmed as originally-lost context motivating this
whole redesign (not from the doc — from the user directly):** an earlier
detour into an apps/SQLite-backed model with a different display had lost
three things the ribbon view had: visible event *duration*, visible
*contained* items, and — because that display had to stay always-visible
on screen at once — enough space to browse comfortably. The tab-manager
redesign is partly a way to reclaim browsability (a live view doesn't need
to show a whole day at once; a history view can zoom into hours instead)
while keeping duration/containment intact from the existing ribbon.

## Phase breakdown (adopted 2026-08-21)

Scoped down from the doc's single-pass proposal into four phases, each a
separate go/no-go decision rather than one committed build:

1. **Live tab strip (spec §7, this phase — building now):** an on-page,
   shadow-DOM UI showing currently open tabs, click-to-switch. Pure
   display layer over the *existing* unchanged capture pipeline — no
   scoring, no eviction, no new persistence. Validates the on-page
   injection mechanism and the live-tab data flow before anything
   destructive is built on top of it.
2. **Full card/ribbon view, integrated:** expand the same surface into
   something closer to today's dashboard ribbon (duration, containment,
   the full taxonomy) — but reachable from the live view rather than only
   the standalone dashboard tab. Exact expansion mechanism (in-page
   overlay? triggered panel? still the separate dashboard tab, just
   fed differently?) is undecided — to be designed when Phase 1 is
   stable.
3. **Auto-close eviction:** the doc's original core proposal —
   `chrome.tabs.remove()` on low-scoring tabs, Keep-Alive scoring,
   Self-Eviction Invariant (close only after the session's `snap:id`/
   `snapErr` is confirmed in `storage.local`, so a closed tab never loses
   its capture). Undesigned in detail; when it's picked up, the question
   raised in Phase 1 planning — dry-run/log-only first vs. live from day
   one — needs a real answer before any `chrome.tabs.remove()` call ships.
4. **Active→historical reconciliation:** how a tab closed by eviction (or
   just closed normally) folds into the existing container/thread
   assembly in the historical ribbon (§6) — e.g. does closing an actively-
   tracked tab make it join an existing container the way a departure or
   absence would today? Undesigned; explicitly the open question the user
   raised when confirming this roadmap ("closing a tab could have it join
   an existing container").

## Rejected alternatives

* **Build the full doc as one pass** (scoring + live eviction + new
  display, all at once) — rejected: no way to validate the scoring
  formula against real usage before it starts closing tabs (see Origin).
* **Phase 1 as overlay (fixed-position, floats on top of page content)**
  — rejected in favor of push-down layout: an overlay would cover a
  site's own fixed header/nav; push-down reserves real space instead,
  closer to a genuine second tab bar. Trade-off noted in
  `WATCHLIST.md` (sticky-header collision risk on the *document* reflow
  even though layout is otherwise correct).
* **Phase-1-only spec file (`spec/switcher.md`, scoped to just the strip)**
  — rejected in favor of one growing `spec/tabmanager.md` spanning all
  phases, matching how `capture.md`/`display.md` are themselves
  append-only rule sets rather than phase-numbered files.

## Voice fixed-root specimen (2026-08-21, same day) — placement reversed

Phase 1 built and initially verified working (Gmail, Calendar) with the
push-down layout above. User-reported bug, reproduced by cycling real open
tabs: the strip was completely invisible on Google Voice
(`voice.google.com`) — no console error, `switcher.js`'s own "mounted" log
fired normally, the host element was confirmed present in the DOM at the
correct size and position (`getBoundingClientRect()`: `top:0, height:34`,
first child of `body`).

**Root cause, confirmed by direct DOM inspection on both sites:** Gmail's
own top-level app container is `position: static` (normal document flow)
— it correctly lands below our host, `top: 34px`. Voice's own top-level
container is `position: fixed; top: 0` spanning the full viewport height
— it ignores document flow entirely and paints over our host regardless
of the host's reserved space. This is not a Voice-specific bug to route
around; it's a common pattern for app-shell/SPA sites that want exact
`100vh` control (messaging apps, call apps — Meet is presumed same-shaped,
untested). Plain push-down therefore doesn't have a *partial* failure
mode on such sites — it fails completely and silently, which is worse
than the header-overlap risk push-down was originally chosen to avoid.

**Options considered (discussed across a provider comparison — Sonnet,
then Fable, then back to Sonnet for the decision):**
1. Fixed overlay everywhere — visible unconditionally, but permanently
   overlaps real header controls on nearly every site with its own
   header, not just fixed-root ones (quantified against real open tabs:
   Gmail's hamburger/search, Voice's search/dropdown/icon row all sit in
   the top ~34-40px band a bare overlay would cover). Rejected as the
   pure form — too costly on the sites push-down already handled
   correctly.
2. `chrome.sidePanel` — considered and rejected: width is user-draggable,
   not programmatically controllable, so it can't support the two-size
   (small strip / full card view) requirement from the original design
   discussion. Also loses the "looks like Chrome's own tab bar" visual
   goal entirely (vertical panel, not a horizontal strip).
3. **Adopted: fixed overlay + `html { margin-top: 34px !important }`
   compensation.** Strip is `position: fixed`, always visible. The
   margin-top override reproduces push-down's exact behavior on every
   `position: static` site (confirmed pixel-identical on Gmail/Calendar).
   On a fixed-root site, `margin-top` can't move that site's own `position:
   fixed` elements, so the residual cost is narrower than either pure
   alternative: only fixed-root sites are affected, and only their own
   top ~34px, not their whole header.
4. **Known countermeasure, deliberately deferred:** on mount, detect
   same-shape `position: fixed`/`sticky` elements anchored at `top: 0`
   among the page's own top-level children and nudge their `top` down by
   the strip's height — the technique classic toolbar-injecting
   extensions used. Not built for Phase 1: it's the first move in a CSS
   arms race (SPAs can recreate such elements post-mount, sites can fight
   back with their own `!important`), and there's no evidence yet of how
   many real sites the residual case actually bites. Watched, not
   patched — `WATCHLIST.md` "switcher-fixed-root-overlap".

This also reverses this file's own "Rejected alternatives" entry above
(overlay rejected in favor of push-down) — recorded there as the original
decision with its original reasoning, not rewritten, per this file's own
append-only convention; this entry is the supersession.

## Navigation-flash structural limit (2026-08-21, discussed before the build)

Before writing any code, discussed whether Phase 1 could plausibly "feel
native" — the explicit goal going in. Conclusion: **not fully, and that's
worth stating plainly rather than discovering later.**

A real browser tab bar lives in browser chrome, outside the page,
persistent no matter what the page does. `switcher.js` is a content-script
injection into the page's own DOM. Chrome does a full document
reload/replace on any real navigation — the old document, including our
shadow-DOM strip, is destroyed; the new document gets a fresh injection
and mount from scratch. This isn't limited to using the strip to switch
tabs (which doesn't reload anything — `chrome.tabs.update` just changes
which already-rendered tab is frontmost, confirmed working). It applies to
**ordinary browsing** — clicking any normal link on the current page
rebuilds the strip too, something a real tab bar never does.

**What's achievable vs. not, broken down at the time:**
* Tile-click tab switching (already-open tab, already has a mounted
  strip): genuinely instant, no redraw — this part fully works.
* Two real exceptions even there: a Chrome-discarded/backgrounded tab
  forces a real reload on activation (Chrome's own memory-management
  behavior, not something we can prevent); a tab with no content script
  (`chrome://`, Web Store, PDFs in some configs, tabs older than the
  extension's load) shows no strip at all.
* Ordinary navigation (link clicks): structural flash/rebuild, not fixable
  from a content script. Mitigation identified but not built for Phase 1:
  inject at `document_start` with a synchronous placeholder shell
  (reserve the space before first paint) rather than `document_idle`,
  then hydrate with real data once the background responds — makes the
  rebuild look closer to invisible without eliminating it. Tracked,
  deferred: `WATCHLIST.md` "switcher-navigation-flash".

Considered and rejected as an alternative that would avoid this
altogether: `chrome.sidePanel` (browser-chrome-level, no page injection,
so no rebuild-on-navigation at all). Rejected the same day, separately,
for the fixed-root placement bug (see above) — its width is
user-draggable, not programmatically controllable, which independently
rules it out for the two-size (strip / full card view) requirement from
the original design discussion, regardless of this flash question.

## Close box + cross-window sync (2026-08-21)

User asked for a real close box on each tile (matching Chrome's own tab
`×`) and specifically wanted to confirm closing wouldn't desync the strips
in other tabs. Discussed before coding, per the standing discuss-first
rule (spec-first was explicitly waived for this one — see "spec-before-code
scope" below).

**Finding: no new synchronization problem exists.** `background.js`
already listens to `chrome.tabs.onRemoved` for *every* close regardless of
origin (Cmd-W, Chrome's own `×`, another extension, `chrome.tabs.remove`
from anywhere) and re-broadcasts the window's tab list to every strip
(`broadcastTabsForWindow`, pre-existing from Phase 1). Adding a close box
is therefore symmetric to the already-built `FS_SWITCH_TAB` path: the tile
posts `{type:'FS_CLOSE_TAB', tabId}`, the background calls
`chrome.tabs.remove()`, and the existing `onRemoved` → broadcast path does
the rest. Verified this reasoning applies to the native Cmd-W shortcut too
— it's handled entirely by Chrome before any extension code runs, and
converges on the same `onRemoved` event as every other close path.

**Rejected:** optimistic local tile removal (having the clicked tile
disappear immediately, before the broadcast round-trips). Would add
per-tile local state and a reconciliation edge case (what if the broadcast
disagrees) for no real latency win — a native Chrome tab close isn't
instant either, and the round trip here is fast. Kept the strip a pure
re-render off the one broadcast, no exceptions.

**Built:** `FS_CLOSE_TAB` message handler in `background.js` (mirrors
`FS_SWITCH_TAB`: validates the tab still exists before calling
`chrome.tabs.remove`, since a double-click or already-gone tab must not
throw). Hover-revealed `×` per tile in `switcher.js`, `stopPropagation`
so the close click doesn't also fire the tile's switch-tab handler.

## Live labels: promoting siteNameOf out of the dashboard (2026-08-21)

User wanted tiles to show the same short site name (`Gmail`, `Google
Voice`) the historical dashboard already derives via `dashboard/
assembly.js`'s `siteNameOf`/`computeHostNames`, instead of the raw
(long, truncated) `document.title`.

**The real obstacle wasn't fetching the name — it was the wall between
capture and display.** `computeHostNames` is a majority-vote algorithm
over a *week* of stored titles per host; the live strip has one title,
right now, no history — not a call-through, a genuine cross-boundary
reuse question. And the function lived in `dashboard/assembly.js`, an ES
module, while `background.js` was a classic `importScripts`-based service
worker — the two module systems don't compose, so nothing in `dashboard/`
was reachable from the worker at all before this.

**Discussed as a standing pattern, not a one-off fix** (user's framing):
now that the tab strip is a genuine third pillar living in the worker
(spec §7) but wanting the same "given raw session data, derive a display
fact" logic the dashboard already has, this class of function is expected
to recur — score bands, transit filtering, site naming are all the same
shape. Decided to promote such functions into `shared/` (already home to
`transit.js`, the transit predicate) as real ES exports, rather than
fork/duplicate per occurrence.

**File shape, explicitly decided:** one `shared/utility.js` for all such
functions (not one file per function, not a `naming.js`-style split by
topic) — the traffic across this boundary is new and its eventual shape
isn't known yet, so a single grab-bag file was chosen deliberately over
guessing a taxonomy upfront. **Agreed split trigger:** not a line count —
revisit (split into focused files) once the file holds **3+ genuinely
unrelated concerns**. Today it holds exactly one (site naming), moved
from `dashboard/assembly.js`: `hostOf`, `labelKeyOf`, `siteNameOf`,
`computeHostNames`. `dashboard/assembly.js` and `dashboard/scoring.js`
now re-export from `shared/utility.js` so every existing dashboard import
site is unchanged.

**Enabling change: `background.js` became a module worker**
(`"type": "module"`, `manifest.json`), replacing `importScripts` with a
real `import` — required for any `shared/` ES-module reuse, not just this
one function. Checked first (per discuss-before-coding) for anything
relying on classic-worker semantics: only one `importScripts` call
existed (`shared/transit.js`) and no `self.`/global-scope tricks
elsewhere in the file — clear to convert. `shared/transit.js` gained real
`export`s alongside its existing `globalThis.FS_TRANSIT` assignment (kept
for the dashboard's plain-`<script>` loading path, untouched).
**Flagged, not yet independently verified:** module service workers can
behave differently on wake-from-idle timing in some Chrome versions vs.
classic workers — a real risk for an extension whose whole job is
reliable event capture; noted as something to watch under real use rather
than something this change proves safe.

**Signature change:** `computeHostNames(sessions, isTransit)` now takes
`isTransit` as an explicit parameter instead of closing over the
`FS_TRANSIT` global — `shared/` code shouldn't assume either side's
loading convention. `dashboard/timeline.js`'s one call site updated to
pass its own `isTransit` through.

**Perf:** the name map is real work over 1700+ stored sessions, so
`background.js` caches it (`hostNamesCache`) rather than recomputing per
broadcast, invalidated via `chrome.storage.onChanged` on the `sessions`
key and rebuilt lazily on next use. A tab/host with no confident name
(fresh host, no admitted history yet) falls back to the bare hostname in
`switcher.js`'s tile.

## Phase 2 design: ribbon overlay (2026-08-21, discussed, not yet built)

Designed in discussion before any code — spec `spec/tabmanager.md` §7b.
Four forks were worked through in order; each is recorded here because the
rejected side of each fork is a real alternative that could resurface.

### Retargeted mid-build: `paintCards()`/`.card` → `paint()`/`.blk` (2026-08-21, same day)

The whole design below was originally scoped against `paintCards()` (the
`.card` elements — a riffled/swiveled screenshot deck), based on the
user's description ("card view... numbered hours... duration for each
card... existing zoom code that already knows how to distribute width").
That assumption broke during the build, once `paintCards()`/`cardLayout()`
were actually read: card width is a **fixed constant per tier**
(`CARD_TIER_W[band]`), overlap pitch is a **constant** (`CARD_STEP = 10`),
and `relayout()`'s own comment says plainly "Stage 1's card layout doesn't
scale with zoom... visually nothing changes with zoom level." There is no
width-distribution mechanism on that path to reuse — the DOM-root
parameterization and module-loading work already done (below) is still
valid (it's DOM-plumbing, not tied to which paint function runs), but the
zoom/width/filter design built on top of it would have been inert.

Surfaced to the user rather than built further on the wrong premise. Root
cause of the mismatch: `dashboard.js`'s toggle button is labeled with the
mode it would switch **to**, not the current mode — so "click the button
that says Card view" actually lands on `ribbonMode === "blocks"`
(`paint()`/`.blk`: colored/favicon rectangles, genuinely time-proportional
width, real `PX_PER_SEC` zoom reactivity, no overlap pitch), which the
same button confusingly calls **"Classic view"** when *that* mode is the
one showing. Confirmed with the user: `paint()`/`.blk` — not
`paintCards()`/`.card` — is the real Phase 2 target. All "card"
terminology below refers to what was designed before this correction;
spec §7b was rewritten to say "ribbon"/"block" throughout, matching the
corrected target.

### Toggle shape: A vs. B vs. C

How the strip transitions into the card view was the first real fork.

* **B — navigate to the standalone dashboard tab** (open/focus
  `dashboard/index.html`, now defaulting into the filtered/right-anchored
  state). Technically the easiest: zero porting, the card renderer runs in
  its native, unmodified host. **Rejected** — a cross-tab transition can't
  carry a morph animation (different tab, possibly different window); at
  best a cut or cross-fade on load. Since the confirmed end goal of this
  whole exercise is animating tile→card continuously, an option with "no
  future" for that goal was rejected even though it's the cheapest to
  build today.
* **A — in-page overlay, same shadow-DOM injection as the strip.** Chosen.
  Requires porting the card renderer to run inside a content-script shadow
  root on an arbitrary host page (DOM-root parameterization + CSS
  delivery, both in spec §7b) — real work, but scoping it (below) showed
  the actual renderer/layout/zoom code needs no changes, only where its
  DOM lookups and CSS resolve. Keeps strip and card view as literal
  sibling DOM under one host, which is what a future morph animation needs
  (continuous DOM, not a page navigation).
* **C — overlay containing an iframe to the dashboard page.** A middle
  ground (stays on-page like A, reuses the unmodified page like B).
  **Rejected**: adds iframe/postMessage plumbing neither A nor B needs,
  without fully solving A's animation goal either (iframe content still
  isn't the same DOM tree as the strip).

### Scoping read before committing to A (2026-08-21)

Before agreeing to build the port, `dashboard/timeline.js`,
`dashboard/index.html`, and `dashboard/dashboard.js` were read to check
whether "in-page overlay" was a moderate or heavy port. Findings:

* `timeline.js` is one IIFE exposing exactly two globals
  (`window.renderTimeline`, `window.setRibbonMode`); all DOM access is
  `document.getElementById` against a fixed ~4-ID set, plus one
  `document.body.appendChild` for the tooltip — no viewport-relative
  units, no `window.top` assumptions, no iframe dependencies found.
* The actual visual styling (`.card`, `.card-face`, `.blk`, `.rtitle`,
  `#tip`, etc.) lives entirely in `index.html`'s light-DOM `<style>`
  block — `timeline.js` itself writes only geometry inline (left/top/
  width/height/transform/border-color).
* Conclusion: the port is two mechanical changes (parameterize the DOM
  root instead of hardcoding `document`; get the existing CSS into the
  shadow root), not a rewrite of layout/zoom/paint logic. This is what
  made option A tractable enough to commit to instead of falling back to
  B for expedience.

### CSS delivery: shared file vs. duplicated inline

Shadow DOM doesn't inherit light-DOM `<style>` tags, so the card CSS needs
a delivery path into the overlay's shadow root.

* **Duplicate the CSS inline in `switcher.js`**, matching how the strip
  already inlines its own CSS. No manifest change, no fetch. **Rejected**:
  ~600 lines of card CSS would need hand-sync between two copies on every
  visual tweak — and this project's `HISTORY.md` shows card visuals (tier
  colors, borders, hover, perspective) are tuned often, making that an
  ongoing tax, not a one-time cost.
* **Extract to a shared CSS file, fetched by both** `index.html` (linked
  normally) and the overlay (fetched, injected into its shadow root).
  Chosen — one source of truth for ongoing tuning. Cost: a new
  `web_accessible_resources` manifest entry (none exists today) so a
  content-script-injected shadow root can fetch a packaged extension
  asset.

### Card-width tension: duration-proportional width vs. legibility

Right-anchoring on "now" means most open tabs are young, so
duration-proportional card width (today's model) would render most cards
narrow — directly fighting the original motivation for this whole
exercise ("expand their width," not recreate the whole-day compression
problem for a different time range). Three resolutions were floated
before the discussion:

1. Minimum card-width floor regardless of duration.
2. Fixed width per card, real time reflected only in x-position (gaps),
   not width — breaks "card width = duration" as a semantic.
3. Index-based layout (ordered like the tab strip), hour ribbon shown only
   as a loose reference, not truly time-positioned.

**Resolved differently than any of the three:** don't engineer around it
yet. Reuse the existing width-distribution code unmodified, rely on the
zoom level (an hour or two window, not a full day) to naturally give each
card room, and observe real behavior before adding floor/fixed-width/
index-based logic. If narrow young-tab cards prove to be a real problem in
use, revisit then — not preemptively.

### Anchor point: left (existing) vs. right (new)

Existing zoom (`display.md` §6, 2026-08-08) is left-anchored: pins the
left edge, grows rightward as you zoom out — correct for "browse a whole
day from its start," wrong for "zoom in from now." Phase 2 adds a
right-anchor mode (pinned to "now," reveals earlier time leftward on
zoom-out) as a second mode alongside the existing one, not a replacement
— the existing left-anchor zoom still exists in the code for whenever a
whole-day/historical view returns.

### Day-paging: overlay-only omission, not standalone-dashboard retirement (scope narrowed 2026-08-21, during build)

Originally scoped as "retire day-paging from the UI" broadly — hide the
week-strip picker everywhere, including the standalone dashboard tab,
dormant not deleted (same posture as `NATIVE_BRIDGE_ENABLED = false`,
`decisions/capture_design.md`). **Narrowed during the build**: the
standalone dashboard's week strip and day-paging are left completely
untouched — zero risk to an existing, working view for a change that isn't
actually needed there. The overlay was never going to have a week strip in
the first place (it's a filtered, single-moment view, not a day browser),
so "day-paging omitted from the overlay" is really just "the overlay's DOM
doesn't include it" — not a retirement of anything that used to work.
Reduces this phase's blast radius: the only user-visible change to the
existing dashboard page is the CSS extraction (`<style>` → `<link>`,
visually identical) and the block label; day-paging itself is entirely
outside this phase's diff.

### Open-tabs filter data source: finalize-only `sessions`, live gap accepted (2026-08-21, during build)

Building the filter surfaced a real gap: `chrome.storage.local`'s
`sessions` array is written to in exactly one place
(`background.js` `finalizeCurrent`), gated on a visit actually ENDING —
there is no earlier/heartbeat write. The user's working hypothesis going
in ("maybe a tab gets an early DB entry after ~10s of heartbeats") was
checked directly against the code and doesn't hold — it's all-or-nothing
per visit. Practical effect: the overlay's open-tabs filter can only ever
show an open tab's *previous, already-completed* visit; a freshly-opened
tab, or the actively-focused tab's current in-progress visit (which lives
separately in `chrome.storage.session.currentSession`, singular — one tab
at a time, not a per-tab live table), shows nothing.

Two responses were discussed:

* **Add an early/partial write to `sessions`** (e.g. after the first
  qualifying heartbeat) so open tabs have something current to show.
  **Rejected for this phase** — a real capture-side change (spec §3–§4),
  bigger and separately risky, not something to fold into a display-layer
  phase without its own scoping pass.
* **Join in `currentSession` for the one actively-focused tab.**
  Considered, not built — narrower fix (covers only one tab of many) and
  adds complexity for a single case.

**Resolved: ship against `sessions` as-is, gap accepted and documented**
(`WATCHLIST.md` "overlay-shows-only-finalized-visits"), not silently. The
overlay may routinely look sparse/stale for whichever tab is actually
being looked at — a known, real limitation of this phase, not an
oversight.

## Animation architecture rework (2026-08-22): from "second surface" to "one shared element set"

The first working build (previous entries above) satisfied "it opens and
shows the ribbon" but failed a harder requirement the user had stated from
the start and re-raised once the build was actually visible: it must
eventually **animate** the strip into the ribbon, not just open and close.
User's review of the working build, verbatim scope: "1) The original tab
view remains there, it should animate into the classic view (i.e. the two
views should never be drawn together) 2) The starting tabs look nothing
like the ending classic cards so they can't animate, they should have a
similar dom structure so there is a chance for the animation to actually
work 3) The backgrounds are completely different colors." And the
instruction that followed: stop, don't hack, rethink from an animation
point of view, using the classic ribbon as the desired end state and
changing the (simpler) strip to match it, not the reverse.

**Diagnosis, confirmed against the actual code:** the previous build had
two independent shadow-DOM hosts (`host` for the Phase 1 strip, a second
`overlayHost` for the Phase 2 ribbon), each with its own bespoke markup
(`.fs-tab` flex rows vs. `.blk` absolutely-positioned divs) and its own
color system (`#dee1e6` light Chrome-mimicking strip vs. `#14161a` dark
ribbon). Two unrelated DOM trees can't animate into each other — there is
nothing to interpolate between element A and unrelated element B; at best
a crossfade, never a real shared-element transition. Root cause wasn't a
missing animation call, it was two architectures that were never designed
to become one.

### Reframe: ribbon-as-target, strip-as-simplification

User's framing, adopted directly: the classic ribbon (`paint()`/`.blk`) is
"pretty much what we want" — the right move is to change the SIMPLER
surface (the strip) to be built from the SAME element vocabulary as the
ribbon, not to keep them separate and try to fake a transition between
unlike things. Concretely: every open tab becomes exactly one `.blk`
element from the moment it's drawn, in EITHER state — "strip" and "ribbon"
become two LAYOUT functions over one shared, persistent element set, not
two renderers. `.blk` already carries a CSS `transition: left/top/width/
height` (`timeline.css`, pre-existing, unrelated to this feature) — once
the same element receives new geometry instead of being destroyed and
recreated, that transition animates it for free. No animation framework,
no FLIP library, no manual tween code was needed — the entire "animation"
requirement resolves to correctly reusing DOM nodes across two paint
calls.

### The three review points, resolved

1. **"Two views should never be drawn together"** → one host
   (`#fs-switcher-host`), one shadow root, one `<body>`, one `#ribbon`.
   There is no second host to accidentally leave visible. The host's own
   height (34px collapsed, real content height expanded) is itself CSS-
   transitioned, so "the bar opens" is one property change, not a
   show/hide of a second element.
2. **"Similar DOM structure so animation has a chance"** → literally the
   same elements, not just similar-looking ones. `drawOpenTabSegs`
   (`timeline.js`) is the one function that creates/updates/removes
   `.blk`s for BOTH `layoutStripGeom` and `layoutRibbonGeom` — a tab's
   tile IS its eventual ribbon block from creation.
3. **"Backgrounds shouldn't animate"** → one shared dark ground
   (`body`'s `#14161a`, inherited by both states since they're the same
   DOM tree now) — nothing to crossfade, confirmed by construction rather
   than by picking matching colors in two separate stylesheets.

### Open-tabs identity: why `tabId`-keying is safe here specifically

Reusing elements requires a STABLE key across both paint calls. The
historical ribbon's own key scheme — `assembleThreads()`'s `"v"+id`
(merged visit) / `"k"+id` (container), both derived from a session's own
UUID — is not available or stable for this purpose: an open tab's session
might merge into a different thread/container once assembled against a
FULL day of history, and that identity isn't knowable in advance from the
strip side. Discovered mid-build as a real blocker (see the "found a real
blocker" exchange in-session) before being resolved, not before being hit.

**Resolution, per direct user correction:** this view is deliberately
hyperlocal — "approximately the same number of objects," never a full-day
assembly — so there is no wider merge context for a tab's identity to
collide with. Both `openTabSegsBase` (identity/band) and both geometry
functions key every seg `"tab:"+tabId`, and NEITHER geometry function
calls `layout()`/`clusterEvents()`/`assembleThreads()` at all — those stay
exclusively the historical (`render()`) pipeline's own. This isn't a
narrower version of the general identity problem solved for a special
case; it's a structurally different, smaller problem (a handful of live
tabs, no merge candidates outside that set) that a full identity rework
(threading `tabId` as a first-class field through `assembleThreads()`
itself — discussed and explicitly deferred, see the in-session exchange)
was never required to solve.

### Incomplete container: real placeholder, not a design afterthought

A tab with no finalized session (brand new, or all history pruned past
7-day retention) still needs a `.blk` — clickable, closable-feeling,
positioned correctly — despite having none of the data `tipDataOf`/
`hasEarnedHigh`/etc. assume. Resolved by giving it a real, complete
placeholder `e` object (safe defaults for every field those functions
read) rather than special-casing each downstream consumer — lower risk of
missing one. Visual treatment: forced LOW tier, no distinct styling
(`.incomplete` kept as an unstyled class hook, matching this file's
existing `.tier-low` convention) — a direct, explicit choice over a
dashed-border/distinct-fill alternative, to avoid inventing new visual
vocabulary before real use surfaces whether it's needed.

### Click semantics: switch, never duplicate

The historical ribbon's own click handler opens a FRESH tab
(`chrome.tabs.create({url})`) — correct there (a click means "revisit this
past page"), wrong here (every seg in this view IS an already-open tab;
`chrome.tabs.create` would open a duplicate). `drawOpenTabSegs` overrides
click uniformly to `FS_SWITCH_TAB` for every seg, incomplete or not — a
real bug caught and fixed before shipping (initial draft only special-
cased incomplete segs, leaving normal segs on the wrong, ribbon-inherited
behavior).

## Open-tabs/history unification (2026-08-22): from "hyperlocal sidestep" to "one real ribbon"

The animation-architecture rework (above) shipped a working, animating
strip↔ribbon toggle — but two things surfaced once the user actually used
it: mouse-wheel zoom (pre-existing, wired to the historical pipeline) did
nothing at all in this view, and the user's original framing for the whole
feature — "zoom out to the view we have today," a genuine gateway from
open tabs into the day's real history — was still unrealized. The
hyperlocal `tabId`-keyed side-pipeline that made the animation rework
tractable was, by construction, never going to reveal history: it
deliberately never called `assembleThreads()`/`render()` at all.

**Diagnosis, confirmed against the code:** the zoom wheel handler
(`display.md` §6/`timeline.js`) calls `relayout()`, which repaints from
`lastAssembly` — set only inside `render()`. The open-tabs pipeline never
called `render()`, so `lastAssembly` stayed `null` in the overlay's
context; `relayout()` silently no-op'd every tick. Not a bug in the zoom
math itself — the math never had real data to work with.

**User's reframe, stated directly:** "This may feel like a scope change,
but what this really was was how do we get started with the existing tabs
and how do we build a bridge to the history... What I had hoped is that
all of the existing Chrome tabs could somehow be marked as short term or
local or temporary tabs that would just show up on the right side of the
history... so we just have one classic ribbon list here that just happens
to show the currently open tabs on the far right hand side." This resolves
the identity/keying problem the previous rework worked around, rather than
sidestepping it again: an open tab stops being a synthetic `"tab:"+tabId`
object outside the real pipeline and becomes a genuine, session-shaped
entry INSIDE it — real `assembleThreads()` identity, not a parallel one.

### What was decided, in the order it was decided

1. **Live-data feed: synthesize per-tab session records, not a capture-side
   change.** `assembleThreads()`/`layout()` only ever consumed finalized
   `sessions` (the exact gap `WATCHLIST.md`
   "overlay-shows-only-finalized-visits" already named). Two options: (a)
   build one lightweight session-shaped record per open tab and splice it
   into the array assembly runs over, or (b) extend `background.js` to
   write the in-progress `currentSession` into the same finalize-only
   store, kept live-synced. **Chosen: (a).** Keeps `background.js`'s
   finalize-only contract for real `sessions` completely untouched — this
   stays a display-side synthesis, not a capture-side behavior change,
   matching the project's standing separation between capture (§3–§4) and
   display (§5–§6) rules.
2. **Full pipeline replacement, not a fast-path fork.** Considered keeping
   the existing hyperlocal pipeline as a fast-path for collapsed state,
   only routing through the real pipeline once expanded. **Rejected in
   favor of full replacement** — one pipeline always, collapsed state is
   just the real ribbon at a different height. Simpler mental model, no
   two systems to keep in sync; accepted the trade that collapsed-state
   correctness now depends on `assembleThreads()`/`clusterEvents()`
   behaving well on this narrower kind of data (fencing, merging — both
   then needed real fixes, see below), rather than being structurally
   exempt from those concerns.
3. **One resting zoom level; expand/collapse never touches it.** Original
   assumption going in (mine, corrected by the user) was that "collapsed"
   needed its own tight zoom level distinct from "expanded." **User's
   correction:** the tight-zoom feel IS the resting state, full stop —
   "the original insight that appears to have gotten lost was that the
   collapsed ribbon view looks like Chrome tabs today because it is zoomed
   in so closely, and then when you expand it, it just simply shows more
   vertical information... expand does not change the zoom level... if we
   were to expand in two dimensions, both horizontally and vertically,
   that would be visually quite confusing." Resolved: `heightMode` governs
   ONLY vertical geometry (see spec §7b); horizontal (`PX_PER_SEC`/zoom) is
   a wheel-driven axis, completely orthogonal to expand/collapse.
4. **Collapsed height: uniform, unconditionally — not bottom-flush-clipped
   real tiers.** A second corrected assumption: I initially proposed
   letting real tier heights render but clipping the collapsed VIEWPORT to
   a short bottom-flush window (so a tall HIGH block just has more of
   itself hidden above the fold). **User's correction:** "The collapsed
   ribbon should show every tab being exactly the same height, independent
   of their importance. The [three] different height tiers only are
   exposed when the collapsed tab view is expanded." Resolved: `paint()`
   gained a `heightMode` branch (`"uniform"` forces `STRIP_TILE_H`
   regardless of band) rather than a viewport-clipping trick — height
   itself changes per block, not just what's visible of it.
5. **Contained children: hidden while collapsed, not squeezed in.**
   Follow-on question once uniform height was settled — user confirmed
   children render only once expanded, matching "just a Chrome tab strip"
   at rest.
6. **Zoom gated to expanded-only.** User confirmed wheel-zoom should do
   nothing while collapsed — "these should just be symbol tabs, click to
   navigate" — rather than being live in both states.

### Real bugs found rebuilding around the real pipeline (not present in the retired hyperlocal one, because it never touched real data)

* **Contained-width floor collision (`OPEN_TAB_MIN_W`):** `widthOf()`'s
  existing `MIN_W` (8px) floor is fine for closed-history slivers but
  reproduces the exact "tabs too narrow to read" problem this whole
  rework exists to avoid for a JUST-opened tab (near-zero `durMs`).
  Resolved with a per-seg floor override for `isOpenTab` segs (96px) —
  same pattern as `MIN_W` itself, not a new zoom level (considered and
  rejected: would make real multi-hour history extremely wide at rest).
* **Fence-collapse of open tabs:** `clusterEvents()`'s existing LOW-run
  fencing would silently swallow a currently-open, low-scoring tab into a
  tiny non-clickable stick. User confirmed exemption (`!event.isOpenTab`),
  citing the card view's own prior fence retirement as precedent.
* **`isTransit` on freshly-opened tabs:** raised as a concern (a synthetic
  record for a just-opened tab starts at `durMs≈0`, under the 10s transit
  floor) and then resolved by the user's own reasoning, not a code
  special-case: since the synthetic record's `endTime` re-sets to
  `Date.now()` on every repaint, a tab that's still open necessarily
  crosses the 10s bar on some later repaint — only a tab opened AND closed
  within 10s would ever be invisible throughout, not a case worth
  designing for ("I don't understand how you can open and close a tab for
  less than 10 seconds and yet still have a tab open for us to have this
  conversation").
* **`isOpenTab`/`openTabId` dropped on merge:** `assembleThreads()`'s
  `mergeVisits`/container-building both construct fresh output objects
  field-by-field (no `...spread`), so a flag on a raw session doesn't
  automatically survive being merged into a `"v"+id`/`"k"+id` thread.
  Fixed by adding explicit OR-of-members `isOpenTab`/`openTabId` fields to
  both constructors, same convention `scrollable` already uses there.
* **Collapse should snap back to "now":** if the user zoomed/panned into
  history while expanded, then collapsed, the (now very short) strip could
  be left scrolled into old content instead of showing today's open tabs.
  `setHeightMode("uniform")` now resets `scrollLeft` to the right-anchored
  edge; zoom level itself is left alone (resuming the same zoom on
  re-expand was judged more useful than resetting it too).
* **Stale shadow-root CSS assumptions, found via live DevTools inspection
  (not static reading):** `#ribbon-wrap`'s `height: 100%` resolved against
  nothing (the shadow root's `<body>` had no explicit height) and
  collapsed the whole ribbon invisible; the shared stylesheet's `padding:
  8px 16px` (fine on the full dashboard page) ate most of a 30-34px
  collapsed strip; `#week-strip`'s `hidden` attribute was silently beaten
  by the stylesheet's own `#week-strip { display: flex }` ID-selector rule
  (attribute-based `[hidden]` has very low specificity), so it kept
  rendering at ~22px and pushing `#ribbon-wrap` out of the visible box.
  All three diagnosed by walking the user through DevTools' computed-box
  panel live rather than guessing further from static code reading — see
  the in-session exchange (Scott: "body appears to be 34 pixels high,
  week strip appears to be 22 pixels high... clearly pushing everything
  down").

### Superseded from prior entries

This retires the "Open-tabs identity" (`tabId`-keying to sidestep
`assembleThreads()`) and "Incomplete container" (forced-LOW synthetic
placeholder with no real evidence path) sections above as the CURRENT
architecture — kept in place, not deleted, per this file's append-only
convention, since the reasoning in each remains valid for understanding
why the intermediate architecture existed and what it traded off. The
"incomplete" concept itself survives, narrowed: `incomplete: true` on a
`syntheticSessionsForOpenTabs` record now means specifically "no prior
finalized session at all" (a genuinely new tab), not "every open tab until
its current visit finalizes" — a tab WITH prior history is scored on real
merits like ordinary data.

Also resolves `WATCHLIST.md` "overlay-shows-only-finalized-visits" — its
own suggested fix ("joining in `chrome.storage.session.currentSession`")
is effectively what `syntheticSessionsForOpenTabs` does, generalized from
"the one actively-focused tab" to every open tab, entry marked resolved.

## Spec-before-code scope, clarified (2026-08-21)

User revised the standing "spec before code" workflow rule mid-session:
it's for early-stage/foundational design, not for small, scoped fixes —
those go straight to code, since spec-first on a small change often
surfaces problems that force re-specing anyway. Both changes in this
entry (close box, live labels) were built directly, discussed inline
rather than pre-specced, with this file and `spec/tabmanager.md` updated
afterward once the shape was actually known.

## Visual cleanup pass on the unified ribbon (2026-08-22, built)

Two small display bugs surfaced once the unified strip/ribbon (above) was
actually used, both fixed same day:

1. **Block label dropped to the bottom on expand.** `.blk-label`'s base
   CSS rule (bottom-left) predated Phase 2 and was only overridden to sit
   favicon-adjacent (top-left) while `#ribbon.uniform-height` — so
   expanding to tiered height visibly dropped the label to the block's
   bottom edge, since the override no longer applied. Fixed by making
   favicon-adjacent/top-anchored the ONE unconditional rule for
   `.blk-label`, removing the height-scoped override entirely — position
   is now identical in both states, matching the "expand is height-only,
   nothing else moves" principle spec §7b already states.
   `dashboard/timeline.css`.
2. **Redundant floating run-title (`.rtitle`).** Every block in this view
   already carries its own always-on `.blk-label`, plus the pre-existing
   hover tooltip/snapshot — a third, floating "persistent HIGH-run title"
   bar (spec §6, historical, unrelated to Phase 2) was duplicative once
   both of those exist. First attempt scoped the fix to `isOpenTab` segs
   only; a real specimen (a closed-history "Gemini" block, not an open
   tab) showed the floating title was never open-tab-specific — the whole
   mechanism is redundant in this view, for real history same as for open
   tabs. Resolved by suppressing `.rtitle` entirely whenever
   `anchorMode === "right"` (the existing flag that already distinguishes
   this overlay from the standalone dashboard) — the standalone dashboard
   is completely untouched, keeping `.rtitle` as its one on-face title
   mechanism same as always. `dashboard/timeline.js`.

## Strip ordering rethink: Chrome-tab-order, not `now`-anchored (2026-08-22, discussed at length; BUILT same day — see the follow-on entries below for the real bugs found implementing it)

**Status: built.** Everything proposed below was implemented the same
day, plus three real bugs found and fixed only once real data exercised
the code (not caught by reading alone) — see "Strip-ordering bugs found
during implementation" after "What's left to build" for the specifics.
The reasoning below is kept exactly as discussed/proposed, per this
file's append-only convention.

### The problem, as it was actually found

The strip's live-testing surfaced a real conflict between two things this
project has been treating as one: **"currently open"** (a Chrome-level
fact — this tab exists, you can switch to it) and **"recently attended"**
(a telemetry fact — this is where your actual activity went). Today's
`syntheticSessionsForOpenTabs` conflates them: every open tab's synthetic
record gets `endTime = Date.now()`, re-stamped every repaint, right-
anchoring EVERY open tab to "now" regardless of how stale its last real
activity was.

**Specimen that broke the naive model:** a pinned tab (Gmail, Chrome) can
be open all day, checked once every few hours, yet always renders glued
to the ribbon's right edge as if it were just as "hot" as a tab switched
into ten seconds ago. The original mental model going into this feature
("strip shows new tabs, ribbon lets you scroll back to older ones") is
wrong — an open tab's *position* under this scheme was never derived from
attention recency at all, just from the fact of being open, which is
exactly the pinned-tab case's whole reason to exist (open for
accessibility, not because it's being actively used).

### Resolution reached (in the order it was agreed)

1. **Case B (a just-opened tab with zero heartbeats yet) is explicitly NOT
   worth designing around.** Confirmed repeatedly by the user: the
   10-second heartbeat means a tab surviving long enough to matter to this
   conversation already has telemetry by construction; the only failure
   window is open-and-closed-within-10s, which the user is fine simply not
   showing (same posture as the existing "narrower than special-casing"
   call in `syntheticSessionsForOpenTabs`, above).
2. **The strip becomes a literal, unmodified copy of Chrome's own tab
   strip** — same left-to-right order as `chrome.tabs.query` already
   returns for the window (pinned tabs first, by construction — no sort
   logic of our own to write), uniform height, one `.blk` per open tab.
   This REPLACES the `now`-anchored right-alignment entirely. No zoom, no
   scroll-by-time in this mode — it is categorical (tab identity/order),
   not temporal, full stop. Chosen explicitly over trying to preserve any
   "recency" signal in strip position: the user's stated goal is "replace
   the Chrome tab manager," and a strip whose tabs move around based on
   recency would be WORSE than Chrome's own (which never reorders), not an
   improvement.
3. **The ribbon (expand/tiered) is untouched** — the same real historical
   ribbon (`assembleThreads`/`clusterEvents`/`layout`/`paint`, time-based
   axis, real zoom/scroll) that already exists, with its own independent
   default resting zoom/scroll position (see next section). Expand/
   collapse remains a HEIGHT-ONLY toggle per existing spec §7b — nothing
   about this proposal changes that principle; it changes what feeds the
   strip's OWN resting geometry when heightMode is "uniform".
4. **Animation is intersection-only.** Since the strip's x-axis (Chrome
   order) and the ribbon's x-axis (real time) are now two genuinely
   different coordinate systems, not two zoom levels of the same one, a
   given open tab's `.blk` needs a valid position in BOTH to animate
   between them. If a tab's last real activity falls outside whatever
   window the ribbon is currently zoomed/scrolled to, that tab's block
   simply has no tiered-mode geometry and is not part of the animated set
   at all — no fade-out, no clipped/boundary placeholder (explicitly
   rejected — see below), just absence, same as any other real event this
   view doesn't currently have in view. Every other open tab (the ones
   whose last activity DOES fall inside the current ribbon window)
   animates normally: Chrome-order position → time-position, uniform
   height → tiered height, exactly like today's existing animation
   mechanism (same shared `.blk` elements, same CSS transition, no new
   animation code needed for this part).
5. **Rejected: pinning an out-of-window tab to the ribbon's edge as an
   overflow indicator.** Considered as a way to keep a stale pinned tab
   visible/reachable even when it falls outside the ribbon's current
   view. Rejected by the user directly: it could land slightly outside or
   way outside the window, and "completely screws up the rest of the
   ribbon view's animation code" — a new visual affordance (clipped/
   boundary block) that isn't a real time-position, adding a special case
   for no real gain given point 6 below already keeps the tab reachable.
6. **Nothing about the stale tab's real accessibility is lost.** The
   user's core objection to designing around this case was addressed
   directly: the full ribbon (real telemetry, real zoom, real scroll) is
   never hidden or reduced by this feature — a stale pinned tab is exactly
   as reachable as it always was, by zooming/scrolling the ribbon to its
   real time position, same as any other historical event. What changes
   is only whether IT'S PART OF THE ANIMATED SET on a given expand, not
   whether it's ever visible or clickable at all.

### Ribbon default resting position: last-N-blocks heuristic

Separately from strip ordering, discussed what the ribbon's own default
zoom/scroll position should be (relevant on initial page load/mount, and
whenever the ribbon has no prior user-chosen position to preserve) — NOT
part of the expand transition itself (see point 3 above: expand doesn't
recompute anything, it reveals whatever the ribbon is already resting at).

**Known failure mode this is trying to avoid** (learned the hard way in
this project's earlier prototype, per the Origin section above): zooming
out to show a whole day compresses everything into unreadable slivers.
The goal is a default that's readable most of the time, not a provably
correct one — the same "simple heuristic, user corrects the rest via
zoom" posture as the rest of this project's scoring/threshold work.

**Ideas considered, in the order discussed:**
- *Fixed lookback (e.g. 1-2 hours), full stop.* Simplest. Fails when the
  most recent stretch happens to be a dense low-value "fence" (a string of
  short, uncontainerizable hops — see SPEC.md §6 fence taxonomy);
  containers (serial same-site runs, round-trip excursions) don't have
  this problem since they already collapse to one labeled block regardless
  of zoom.
- *Snap outward to fence boundaries* (proposed by the assistant, REJECTED
  by the user) — never bisect a fence, widen the window to swallow it
  whole. Rejected: the user's read is the opposite — a fence's
  informational content ("you bounced around here") survives truncation
  fine, so there's no reason to preserve it whole; better to zoom IN and
  show fewer fence members at a legible width than zoom OUT to fit all of
  them illegibly.
- *Block-count target ("last N blocks"), CHOSEN.* Count backward from
  "now" through top-level blocks (a container counts as ONE block,
  regardless of how many real visits it merged) until N are reached; that
  span is the default window. **N = 12**, picked as a first guess to build
  against and tune from real use, not derived from any measurement.
  Explicitly acknowledged as foolable (the user's own example: one very
  long block plus nine tiny ones can add up to a huge span while still
  only counting as ten blocks) — accepted anyway, since the standing
  project posture is "simple rule, user-correctable via zoom, iterate with
  real data" rather than solving the general case up front.
- No fence-detection pass, no per-block width math, no secondary
  adjustment pass of any kind — deliberately the simplest version, to be
  revisited only once real usage shows it's actually a problem (matching
  how Score v1's own weights are explicitly provisional and tuned one knob
  at a time, CLAUDE.md).

### What was built (originally "what's left to build" — all items below shipped 2026-08-22)

1. **Strip data source swap:** replace `syntheticSessionsForOpenTabs`'s
   `now`-anchoring with real `chrome.tabs.query` order (pinned-first is
   already how Chrome returns it) for `heightMode: "uniform"` layout.
   Needs to keep everything downstream that already reads `isOpenTab`/
   `openTabId` working — this changes ORDER/POSITION only, not whether a
   tab is a real synthetic session record.
2. **Ribbon default window:** implement the N=12 last-top-level-blocks
   lookback as the ribbon's initial/default resting zoom+scroll, replacing
   whatever the ribbon currently defaults to on mount in this overlay.
3. **Intersection-only animation:** the expand/collapse geometry code
   needs to treat "does this open tab have a valid tiered-mode position
   under the CURRENT ribbon zoom/scroll" as a real per-tab condition — an
   open tab failing that check must be excluded from the tiered paint pass
   cleanly (not crash, not render at some fallback position). This is
   probably the trickiest real implementation work here, since today's
   code assumes every open tab always has SOME tiered position (it does,
   because of the `now`-anchor being removed by change #1).
4. **Verification specimen to look for once built:** a real pinned tab
   idle for hours, confirm (a) it renders correctly, in Chrome's own
   order, in the strip; (b) it is simply absent from the tiered/expanded
   view at the default N=12 window; (c) zooming/scrolling the ribbon out
   to its real time position makes it reappear normally, animated exactly
   like any other real historical block would be if the ribbon happened to
   already be scrolled there.
5. Not discussed in detail yet, flagged as likely follow-on questions once
   \#1-3 are real: does `broadcastTabsForWindow`'s existing per-window tab
   list already preserve Chrome's pinned/order metadata, or does `switcher.js`
   need to request it explicitly; whether a tab UN-pinned/re-pinned mid-
   session needs a live re-order (probably yes, likely free from re-reading
   `chrome.tabs.query` on the next broadcast, not yet confirmed against the
   actual API shape in use — still not confirmed as of this build, real
   usage will tell).

## Strip-ordering bugs found during implementation (2026-08-22, same day as the build above)

Three real bugs, each caught by looking at the actual running extension
against real data — none of them were visible from reading the code, and
each is the same underlying lesson repeated: **`assembleThreads()`'s
final pass always re-sorts its output by `startTime`**, which silently
discards any other ordering/field a caller assumed would survive
assembly untouched.

**Bug 1 — strip rendered in time order, not Chrome order.** The first
cut fed `events.filter(e => e.isOpenTab)` straight into `stripLayout()`,
trusting the filtered array's own order. Wrong: `detectContainers`'
final line (`out.sort((a, b) => a.startTime - b.startTime)`) always
re-sorts, so the filtered array was in TIME order regardless of what
order `syntheticSessionsForOpenTabs` originally built it in. Caught via
a direct screenshot comparison against the real Chrome tab bar (user:
"I assumed the strip would match exactly the order of the tabs that are
in Chrome" — it didn't). Fixed by adding a real `tabIndex` field (the
tab's position in the original `chrome.tabs.query`-ordered array) to the
synthetic record, propagated through `mergeVisits`/`detectContainers`'s
field-by-field object construction (same OR-of-members convention as
`isOpenTab`/`openTabId` — a field not explicitly added to those
constructors does NOT survive merging/containerizing), then sorting by
`tabIndex` immediately before `stripLayout()` in `paint()`'s uniform
branch.

**Bug 2 — pinned tabs still showed full labels.** `pinned` was added to
`syntheticSessionsForOpenTabs` and read correctly by `stripLayout()`/the
label-suppression check — but, unlike `tabIndex`, was never added to
`mergeVisits`/`detectContainers`'s constructors when `isOpenTab`/
`openTabId`/`tabIndex` were. A lone, unmerged tab passes through both
functions' "untouched passthrough" paths fine (confirmed: `mergeVisits`
pushes a length-1 run's sole member as-is; `detectContainers`' final
`events.filter(e => !absorbed.has(e))` returns an un-chained event's
exact same object reference) — but any of the four real pinned tabs that
had genuine prior history chaining with another visit got rebuilt as a
merged/container composite with `pinned === undefined`. Caught via a
real screenshot (four genuinely Chrome-pinned tabs — Mail/Calendar/
Voice/Messages — still showing "Mail"/"Calendar"/etc. instead of
icon-only). Fixed identically to Bug 1's fix: `pinned` added to both
constructors, same first-open-tab-member convention as `openTabId`/
`tabIndex`.

**Bug 3 — stale open tab rendered with a day-spanning duration, which
also corrupted the N=12 window math.** `syntheticSessionsForOpenTabs`
used a prior finalized session's real `startTime` unclamped; `endTime`
is always `Date.now()` (today). `parseSessions`' day filter only checks
`endTime` (always inside today for a synthetic record) — never
`startTime` — so an idle tab's real `startTime` from a previous day (or
much earlier the same day) passed the filter anyway, producing a `durMs`
that silently spanned a day boundary. Real specimen: an idle Gmail tab
rendered as an ~8-hour block; the same corrupted width also fed
`applyDefaultZoomWindow`'s real-layout-based measurement, which the user
separately caught as "23 blocks instead of 12" — one root cause behind
two visible symptoms, confirmed by fixing Bug 3 alone and re-checking the
block count with no further change needed. Fixed (Pass 1 of 2, Scott's
call) as `startTime = prior ? Math.max(prior.startTime, viewDayStart) :
now` — clamps to midnight rather than the real prior startTime whenever
that would cross into a previous day. Explicitly scoped: this view only
loads one day's `sessions`, so "since midnight" is the only honest floor
available without a bigger change. **Pass 2, deferred, not designed:**
real cross-day zoom-out for the overlay (the user's own framing —
"as you do zooming, we want to cross boundaries and start to show the
previous day's entry") is a separate, likely substantial feature (this
view currently loads only one day's data at all — day-paging was
explicitly retired from it, see "Day-paging: overlay-only omission"
above) and was deliberately not started here.

### applyDefaultZoomWindow's own bug, found and fixed the same day

Separately from the three above, the *first* implementation of the N=12
default window itself had a real bug, independent of the `assembleThreads`
sorting lesson: it computed the target zoom from a pure TIME-span
estimate (`spanMs × BASE_PX_PER_SEC`), not from real `layout()` output.
`ZOOM_MAX` clamping, or plain estimation error (the estimate ignores
min-width floors, inter-block gaps, and contained-child stretching, all
of which can make the REAL pixel width of a span wider than the naive
formula), could silently produce a much looser zoom than intended, with
no correction — and separately, `render()`'s scroll-reset was an
unconditional right-justify (`scrollWidth - clientWidth`), entirely
decoupled from whatever window the zoom computation intended, so even a
correctly-computed zoom had no guarantee the visible viewport actually
showed that window.

**Fixed by making it measurement-based, not estimate-based** — still
O(n), not a search: `windowScrollLeft()` runs one real `layout()` pass to
find the 12th-from-last block's true pixel position; `applyDefault
ZoomWindow` runs a second `layout()` pass to measure the window's real
width at the current zoom, then solves directly for the zoom that makes
that width fill the viewport (one division, no iteration). `render()` now
explicitly scrolls to `windowScrollLeft()`'s computed edge on the same
one first-mount call that set zoom (`usedDefaultWindow`, returned from
`applyDefaultZoomWindow`) — every subsequent render falls back to the
ordinary right-justify, so a user's later manual zoom/scroll is never
silently overridden by a re-snap to the 12-block window.

## Open-tab duration was fabricated, not real attention (2026-08-22, found via direct chrome.storage.local inspection)

A real specimen (five blocks starting within ~3 minutes of each other,
each ~2 hours wide — "mathematically impossible... you physically cannot
open five tabs and spend two hours in each") led to a real investigation,
not a quick patch. Two false leads were pursued and ruled out FIRST,
against real data, before the true cause was found — recorded because
both were reasonable hypotheses that turned out wrong, not just the
answer:

1. **Chrome tabId reuse** (a closed tab's numeric id recycled onto a new
   tab, so a fresh tab silently inherits an unrelated old tab's session)
   — hypothesized, then explicitly challenged by the user ("this code has
   been heavily tested... over two thousand data points... never had this
   reuse problem before"). Ruled out by a real console query
   (`chrome.tabs.query` + `chrome.storage.local.get("sessions")` run in
   the background worker's own devtools) — every tabId/prior session pair
   was genuinely distinct, no collision.
2. **The `viewDayStart` clamp colliding across multiple stale tabs**
   (several tabs all clamping to the same midnight value) — proposed,
   then directly contradicted by the user pointing out the real start
   times were mid-afternoon, not midnight. Also ruled out once real data
   was inspected.
3. **A genuine coincidence, not a bug** — the first full round of real
   data (via a `FS_debugAssembly` temporary hook exposing the actual
   post-`assembleThreads()` events, read from the CONTENT-SCRIPT isolated
   world, not the page's own main-world console — a real gotcha worth
   remembering: `window.FS_*` hooks set inside a dynamically-imported
   module running via a content script are invisible to the page's own
   DevTools console context unless the console's context dropdown is
   switched to the extension's world) showed `startTime + durMs ≈ now`
   held exactly for every row — six tabs genuinely opened/last-touched
   within a ~9-minute window that afternoon, each idle since. Not a bug:
   real telemetry, correctly computed.

**The real, deeper issue, surfaced by the user directly:** even though
the MATH checked out, the CONCEPT was wrong. `durMs = now -
priorSession.startTime` measures "time elapsed since your last recorded
visit began," not attention — directly violating SPEC.md §1 ("activity is
the sole proxy for importance... only active tabs accrue activity"). A
real 85-second bsky visit at 2:49pm was rendering as a 2.5-hour-wide block
by 5pm, which reads exactly like 2.5 hours of engagement even though real
recorded attention was 85 seconds. User's framing, direct: "we're only
supposed to be measuring user intent within a tab... this strongly
suggests a change in how telemetry has been captured" — later corrected
by both of us together to: no capture-side corruption exists (confirmed:
zero `chrome.storage.local.set` calls anywhere outside `background.js`,
so nothing display-side can corrupt real stored sessions), the
DISPLAY-side concept of "how do I represent an open tab" was wrong from
the start, predating this session's own work (traces to the 2026-08-21/22
Phase 2 unification).

**A second, independent problem found in the same investigation:**
whenever an open tab HAD real prior history, the old code still created a
SEPARATE synthetic object for the same time window, spliced in alongside
the real session already in `sessions` (`render([...sessions,
...synthetic])`, confirmed via grep: no dedup logic existed anywhere in
that call chain). Two objects, one real visit.

**User's explicit push, once both problems were named:** "why are there
even synthetic sessions for open tabs being created... there's no need
for these things to be synthetic" — and separately, a standing complaint
about drift: "we need to unify this code. This should all be in one
spot... commented so we don't get this kind of drift in the future."

### Resolution: `markOpenTabs` replaces `syntheticSessionsForOpenTabs`

One function, real data first, synthesis only as an explicit last resort:

* **A tab WITH real prior history:** the real session object already in
  `sessions` is tagged in place (shallow copy — never mutates the
  original) with `isOpenTab`/`openTabId`/`tabIndex`/`pinned`. No new
  `startTime`/`endTime`/`durMs` invented at all — the tab's real,
  already-finalized attention is exactly what it is.
* **A tab with ZERO real history anywhere:** a genuinely new record, but
  honest about it — `durMs: 0` (a real zero, not a fabricated span),
  anchored at `now` (a first draft anchored it at `viewDayStart`/midnight
  by mistake — caught and fixed same-session: a just-opened tab belongs
  near "now" on the right edge, not at the start of the day).
* No duplication: the function returns ONE array (real sessions, tagged
  in place, only truly-new tabs appended) — the call site's old
  `[...sessions, ...synthetic]` concat is gone.

### The remaining gap: the actively-focused tab, and the flush that closes it

Even after the above, one real gap remained: the tab currently in focus
has its in-progress visit sitting only in `chrome.storage.session`'s
`currentSession`, never in the real, finalized `sessions` array — so it
alone could still lag behind real-time. Two directions were discussed:

1. **Accept the lag** (originally the assistant's recommendation) — the
   user pushed back with a real, checkable claim: `chrome.tabs.onActivated`
   already calls `finalizeCurrent("tab_hidden")` on every real tab switch
   (confirmed by reading `background.js` directly), so every OTHER open
   tab is already fully finalized the instant the user switches away from
   it. Only the ONE currently-focused tab can ever lag, narrowing the
   real scope of the gap considerably.
2. **Force a real flush** when the strip/ribbon needs fresh data, the
   same way tab-close already does (`chrome.tabs.onRemoved` → `finalizeCurrent
   ("tab_closed")`, confirmed pre-existing). User: "if each tab change is
   flushing, we should be okay" — chosen.

**What `endReason` to use for a forced flush was a real, separate
discussion.** `finalizeCurrent`'s `endReason` isn't just a label —
`detectContainers`' Guard 1 (`assembly.js`) reads `endReason ===
"tab_hidden"` as direct evidence of "the user left and returned," which
feeds real container-qualification decisions. Inventing a new reason
(e.g. `"strip_peek"`) was the assistant's first instinct, to avoid
teaching that well-tested logic a meaning it wasn't designed for. **User's
counter, adopted:** reusing `"tab_hidden"` is actually the SAFER choice,
not a compromise — "the reason for going away is the same as effectively
tabbing away," and reusing it means the return-and-rejoin path (a real
tab switch and this new flush) both exercise the identical, already
well-debugged code path, rather than adding a second case
`detectContainers`/`mergeVisits` would need to be separately taught and
trusted. Chosen: `FS_FLUSH_CURRENT` (new message, `background.js`) checks
the current session belongs to the requesting tab, then calls the exact
same `finalizeCurrent("tab_hidden")` → `startSession(tab)` pair
`onActivated`'s own handler already uses — capture never actually stops,
just gets a real boundary stamped at expand-time. Routed through the
existing `enqueue` chain (extended to return its promise, additive, no
behavior change for existing fire-and-forget callers) so it can't race a
real concurrent navigation/close, and the caller (`switcher.js`'s
`expand()`) awaits it before painting, so the subsequent `sessions` read
is guaranteed fresh.

## Strip data source: bypassing the day filter entirely (2026-08-22/23, real bug found post-flush)

Fixing the duration bug (above) surfaced a second, independent,
PRE-EXISTING bug — invisible before only because the old fabricated-
duration code always faked `endTime: now`, which happened to guarantee
every open tab passed `parseSessions`' day filter regardless of when it
was really last used. Once that accidental guarantee was removed, real
specimens broke visibly: 3 of 4 pinned tabs and 1 of 6 regular tabs
vanished from the strip.

**Root cause:** the strip's tile list was built from
`assembleThreads(parseSessions(sessions, viewDayStart)).filter(isOpenTab)`
— the SAME calendar-day-filtered array the ribbon uses. `parseSessions`
filters strictly by `endTime` falling inside the viewed day. An open tab
whose most recent REAL session ended on a previous day is real data, but
not TODAY's data — so it was silently absent from `events` before
`paint()`'s uniform branch ever saw it. The strip has no reason to care
about calendar days at all; it's every currently open tab, full stop,
categorical by Chrome order.

**Fix:** `stripEventsFromOpenTabs(openTabs, sessions)` — a new function
building strip-ready objects directly from the live `openTabs` array (any
real prior session, any day, or none) plus a `lastOpenTabs`/`lastSessions`
module-level cache (`FS_renderOpenTabs` sets `lastOpenTabs`) so `paint()`'s
uniform branch can read them without threading new params through
`render()`'s signature (which the standalone dashboard also calls, with
no open-tabs concept at all). The ribbon (`events`, day-filtered) is
completely untouched — genuinely two different data sources for two
genuinely different views now, not one array serving both imperfectly.

## Strip scroll-justify was backwards (2026-08-23, same investigation thread)

A second real bug surfaced immediately after the data-source fix above —
same screenshot-driven specimen (pinned tabs "missing"), but the ACTUAL
cause was scroll position, not data: `render()`'s post-paint scroll reset
and `setHeightMode`'s collapse handler both right-justified `anchorMode
=== "right"` regardless of `heightMode` — inherited unchanged from the
RIBBON's own "show now" logic when the Chrome-order strip was first
built, never reconsidered for an axis where "now" has no meaning at all.
A real Chrome tab bar rests showing its FIRST tabs (pinned), never
scrolled to hide them by default. Fixed: uniform mode now always rests at
`scrollLeft: 0` (left edge), on every render and on every collapse; only
tiered mode's scroll position is ever computed against the ribbon's real
time-based content.

## applyDefaultZoomWindow's one-shot fired at the wrong moment, twice (2026-08-22/23)

Two SEPARATE bugs, both root-caused to the same one-shot gate
(`defaultZoomApplied`) firing on the wrong `render()` call — found in two
rounds, the second only after the first was fixed and a NEW specimen
appeared (26+ blocks visible on expand, after the earlier "22 not 12"
bug had already been fixed once).

**Round 1:** the overlay's very FIRST `render()` call happens at page
MOUNT, while still collapsed (`switcher.js` calls `paintRibbon()`
immediately on load, `heightMode` starts `"uniform"`) — `applyDefault
ZoomWindow` was firing unconditionally whenever `anchorMode === "right"`,
consuming its one-shot against a collapsed-mode render that was never
going to matter, so the REAL first expand got no default-window treatment
at all. Fixed: gated to also require `heightMode === "tiered"`.

**Round 2, found via temporary `console.log` instrumentation (source
reading alone had failed twice by this point — the assistant asked to
add logging rather than guess a third time, user agreed):** even after
Round 1's fix, expand() still does effectively TWO renders —
`setHeightMode("tiered")`'s own internal `paint()` call (existing
behavior: any height-mode change repaints immediately) using PRE-flush
data, then `paintRibbon()`'s fresh render using POST-flush data (the
`FS_FLUSH_CURRENT` mechanism, above, can add a brand-new real session).
`applyDefaultZoomWindow`'s one-shot fired on the FIRST of these two
(smaller dataset), then never re-ran for the second (larger dataset) —
confirmed via the log output directly: `naturalPx` computed against a
354px-wide 12-block window, zoom solved to 4.15x to fill a 1470px
viewport (correct math) — but the ACTUAL painted ribbon was 4992px wide
at that same zoom, meaning far more than 12 blocks' worth of real content
was present by the time paintRibbon() ran, mismatched against a zoom
computed for less data.

**Fixed by removing the double-render, not by re-arming the one-shot:**
`setHeightMode(mode, skipPaint)` gained a second parameter — when true,
it flips `heightMode` without its own internal `paint()` call, leaving
the caller responsible for rendering. `switcher.js`'s `expand()` passes
`skipPaint: true`, so the ONLY render that happens is `paintRibbon()`'s,
after the flush completes — `applyDefaultZoomWindow` now only ever sees
one, final, complete dataset. Considered and rejected: making the
one-shot re-arm itself whenever the flush changed `events.length` — more
moving parts for the same result, and doesn't fix the deeper issue (two
renders for one logical "expand" action was itself the wrong shape).

---

## Zoom anchors right, not left (2026-08-23)

**The trigger was the multi-day plan, not a bug.** The existing zoom was
left-pinned: content laid out from x=0 and grew rightward, so zooming out
compacted it toward the left and zooming in expanded it to the right.
Scott: "that was the original model and worked well when we tried very
hard to keep the day always within the width of the viewport. But now that
we're going to get rid of the day navigation and be able to zoom out back
into history, I think we need to switch this around." The reasoning holds
independently of the multi-day work landing: `now` is the one landmark
that is always meaningful, and once the ribbon reaches past today there is
no natural left edge to anchor to at all.

**First framing was wrong, and Scott corrected it.** The initial read was
that right-pinning and cursor-anchored zoom were in conflict — you can pin
the right edge or hold the instant under the cursor, not both — and that
choosing the pin meant giving up zoom-into-a-specific-block. Scott
rejected the premise: "even with the cursor focus that we have today, it
still is pinned on the left and it expands to the right. So I don't think
that the how you zoom around the cursor completely reframes it... I'm just
asking that we keep the same basic model, but we just pin it to the
right."

That is correct, and it is the whole insight behind the implementation
being as small as it is. **The pin is not a competing anchor — it is what
the clamp does when the anchor runs out of room.** Today's left pin is not
written anywhere; it is the platform clamping a negative `scrollLeft` to
0. Adding a `min(..., maxScroll)` on the other end produces the right pin
by exactly the same mechanism. Scott's own rule for which regime applies:
cursor-anchoring matters specifically when content overflows, because
"you often want to put the cursor over something that you cannot see very
well and you want to blow it up." Below the fit threshold there is nothing
to scroll and nothing to anchor, so the edge simply wins. One expression,
two regimes, no mode flag, and the arms agree at the crossing so there is
no visible jump.

**The underflow pad, and why it is not the 2026-08-08 spacer.** The one
case `scrollLeft` cannot express is content narrower than the viewport:
scrolling is impossible, the blocks are laid out from x=0, so the leftover
space lands on the right and the newest block drifts away from the right
edge as you zoom out. Fixing that needs the leftover space on the *left*,
i.e. a pad. A permanent lead spacer was tried and reverted on 2026-08-08
(`timeline.css`'s `#ribbon-wrap` comment) — worth checking before
repeating it. The reverted one existed at *every* zoom level, which made
`scrollLeft: 0` show blank space in the *scrollable* regime and read as
the ribbon centering itself and drifting under panning. This pad is
`max(0, viewportW - total)`: it is exactly 0 whenever content overflows,
so it never exists in the regime where the old one failed, and being
absent there it cannot drift. The two differ precisely in the dimension
that killed the first attempt.

**Strip stays left-justified — caught live, not by review.** The pad's
first cut sat above `paint()`'s uniform/tiered fork and so applied to the
collapsed strip too. Scott found it testing: the strip "is supposed to
look like a chrome tab view, in that case that one should be left
justified," and asked whether having one view left-justified and the other
right-justified would be a problem. It is not, and the reason is worth
recording: the two views have different *axes*. The ribbon's is time, so
its right edge means "now"; the strip's is categorical (Chrome tab order),
where a right edge means nothing and pinning to it hides the first/pinned
tabs. That is the same reasoning that produced the 2026-08-22 fix
(§7c) — right-pinning the strip was importing the ribbon's "show now"
logic into an axis with no now. Gated on `heightMode === "tiered"`, matching
`render()`'s scroll reset.

**`windowScrollLeft` as a resting position was deleted, and the view got
better.** `applyDefaultZoomWindow` used to solve the 12-block zoom *and*
snap `scrollLeft` to that window's left edge. Under the right pin the snap
is redundant — pinning right at that same zoom shows the same window — and
strictly worse in the clamped case: when `ZOOM_MIN`/`ZOOM_MAX` prevents
the exact solve, the left-edge snap could leave "now" off-screen to the
right, whereas the pin always shows "now" and whatever fits behind it. The
function survives as `applyDefaultZoomWindow`'s own probe; only its use as
a resting position is gone.

**`ZOOM_MAX` 8 -> 16, provisional.** Raised in the same session, on
Scott's call ("let's just double it to 16 for now... this is part of my
experiment to make sure that we get zoom working properly") after 24 was
proposed. The reason a ceiling was being felt at all: at 8x
(`BASE_PX_PER_SEC` 0.0375 -> 1080 px/hour) a 30-second visit renders ~9px,
barely clear of `MIN_W`'s 8px floor — and right-pinned zoom made zooming
in the primary way to inspect exactly those short visits. Note the floor
also means low zoom is *not* linear in time; zooming in makes the layout
more honestly proportional, not just bigger, so there is little reason to
cap it early. Left at 16 to watch rather than 24, per the project's
one-knob-at-a-time rule.
