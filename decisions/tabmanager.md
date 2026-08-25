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
   **The load-bearing premise is stated under "What licenses aggressive
   eviction" below** — the ribbon is not a nice-to-have visualization of
   this phase, it is the precondition for it.
4. **Active→historical reconciliation:** how a tab closed by eviction (or
   just closed normally) folds into the existing container/thread
   assembly in the historical ribbon (§6) — e.g. does closing an actively-
   tracked tab make it join an existing container the way a departure or
   absence would today? Undesigned; explicitly the open question the user
   raised when confirming this roadmap ("closing a tab could have it join
   an existing container").

### Phase status (reviewed 2026-08-24)

**Phases 1 and 2 are done; 3 and 4 are not started.** Phase 1 (§7) shipped
2026-08-21, Phase 2 (§7b) 2026-08-22. Phase 2's undecided expansion
mechanism got answered in the building: an in-page overlay sharing ONE
geometry pipeline with the historical ribbon, not a separate panel or a
differently-fed dashboard tab.

**Everything from §7c to §7h is post-Phase-2 work the roadmap did not
anticipate** — strip ordering, right-anchored zoom, cross-day loading with
band ladders, open-tab marking, the ribbon coordinate system, panning. It
reads as Phase 2 polish and is not: it is Phase 3 groundwork, by this file's
own premise (see "What licenses aggressive eviction") that the ribbon is the
PRECONDITION for eviction rather than a nice-to-have alongside it. Making
history genuinely navigable is what earns the right to close tabs. Anyone
picking this up cold should read those four days as one project, not eight
unrelated fixes.

**Phase 1 was briefly un-done without anyone noticing:** the close box was
lost as collateral in the Phase 2 unification (`de076eb` replaced the DOM it
lived on) and only rebuilt 2026-08-23. Worth remembering as a pattern — a
phase declared complete can be silently undone by the next one, since the
handler survived and only the UI half went missing.

**Phase 1's one open item is a watch item, not unfinished work:**
`switcher-fixed-root-overlap`.

**Phase 3 is the next real decision, and it is gated, not merely unstarted.**
Two standing conditions, both recorded before any `chrome.tabs.remove()`
ships: the dry-run-vs-live question needs a real answer, and `WATCHLIST.md`'s
`eviction-fallback-tedium` is an explicit blocking condition. The gate is a
judgment call about whether the history fallback is now fast enough — which
is what the §7c–§7h work exists to make true, and what play-testing it is
meant to answer.

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
  visual tweak — and git history shows card visuals (tier
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

## Lightweight opinion + fallback: what licenses aggressive eviction (stated 2026-08-23)

Context captured mid-Phase-2, while working on ribbon zoom, because it is
the reason the zoom/exploration work matters at all and it was not written
down anywhere. Scott's framing, and it is the fundamental building block
of the whole project, not just Phase 3.

**The structure: a lightweight opinion with a fallback.** The system takes
strongly opinionated positions — it closes tabs, promotes some things as
important, demotes others — because "there is a good probability that most
of the time it will be right." It is explicitly permitted to be wrong. What
makes that acceptable is not accuracy; it is that **the fallback is always
to let the user browse the blocks themselves.** Opinionated by default,
recoverable by design.

**This is why the correlation is NOT the load-bearing part.** An earlier
draft of this section had it backwards: it treated "score/height predicts
what you'll want back" as the thesis, with a poor correlation falsifying
the design. That is the wrong bet, and a worse one — it would require a
proxy to be accurate. The real bet is weaker and sturdier: attention time
only has to be right often *enough* for the opinion to be useful, because
browsing absorbs the rest. A closed tab that is genuinely wanted but
renders as a narrow, low block is an *expected* outcome, priced in from
the start, not a failure.

**So the failure condition is tedium, not inaccuracy.** Scott: "if it is
too difficult for the user to browse and too tedious to find a tab, well
then we will have failed." That is a usability question, answerable only
by browsing real history — which makes the exploration work (zoom,
scrolling, cross-day) the actual risk-reduction for Phase 3, not polish
alongside it. Ribbon quality gates eviction.

**The sharp edge this framing exposes: the opinion and the fallback share
one surface.** The ribbon both expresses the opinion (tall = important) and
serves as the recovery path when the opinion is wrong. So when the user is
hunting a tab the system demoted, they are searching a view whose visual
hierarchy is working against them — the thing they want is small precisely
*because* the system was wrong about it. This does not break the design,
but it raises the bar for what "browsing works" has to mean. Not "the
ribbon exists," but something closer to: **a low-scored sliver is findable
without already knowing when it happened.** Treat that as a design
constraint on strip overflow and cross-day navigation, not a later
refinement. Scott's own specimen for it: Google Keep, closed for disuse,
now a thin sliver four hours back.

**Pinned tabs are exempt, and the exemption is principled.** Users pin
precisely because they want a tab present regardless of how long since
they used it. That is the user explicitly declaring importance through a
channel telemetry cannot infer — elapsed attention says nothing about it.
So pinned tabs are never evicted and never scored. Already reflected in
the built strip (icon-only, Chrome-order-first, unscored, §7c); recorded
here because the *reason* it is a permanent carve-out, rather than a
display convention, was not written down.

**Open question, cheap to note now and expensive later: system-closed vs.
user-closed is not currently a distinguishable fact.** A tab the user
deliberately dismissed and a tab the system evicted arguably deserve
different retrieval guarantees — the system took the action, so it owes a
stronger one back. The data model has no such flag today. Not to be solved
now, but Phase 3's design should decide it deliberately rather than
inherit "indistinguishable" by default.

---

## The product goal, stated plainly (2026-08-23)

Recorded because it was driving every decision this week while appearing
nowhere in the docs as a goal — only as "Phase 3" in the roadmap, which
badly undersells it. Someone reading this project cold would conclude it is
a timeline visualization that has an eviction feature planned. It is the
reverse.

**The product is: you stop managing tabs.** The system closes them for you,
aggressively. Everything else exists to make that safe. Scott's framing:
"the goal with this project is to allow the user to have auto closing tabs
— if you can trust that your history contains everything, then you should
be able to get back to what you wanted to, no problem."

So the dependency runs: **auto-close is the product → it is only acceptable
if retrieval is trustworthy → the ribbon is the retrieval mechanism → ribbon
quality gates the product.** Zoom, cross-day reach, band ladders, legibility
at range are not visualization polish that happens alongside eviction; they
are the work that earns the right to ship it. That is why a week was spent
on zoom before any `chrome.tabs.remove()` exists.

The safety argument itself is in "Lightweight opinion + fallback" above —
the system is *allowed* to be wrong about importance because browsing is
always the recovery path, so the failure mode to watch is tedium rather than
inaccuracy (`eviction-fallback-tedium`). This entry is only about stating
what the thing is for, since the premise entry assumed it.

**Pinned tabs are the standing exception** and always will be: pinning is
the user explicitly declaring "keep this regardless of use," a channel
telemetry cannot infer. See the premise entry.

## Week strip / day-picker model retired for the overlay (2026-08-23)

§7e replaces day *picking* with zoom-back, and the reason is an evaluative
judgment on a shipped feature rather than a technical constraint. Scott, on
the standalone dashboard's week strip: "we had the day browser with these
small little mini summaries above each day and while it was clever it wasn't
that helpful and it didn't give me a good idea of what happened on each
day." Hence: "now that we've switched towards a very tab-heavy approach, I
think it's more helpful to start from today and just go back into history."

Two models of time navigation, and the overlay picks the second:
* **Discrete day picking** (week strip): jump to a day, see that day. Needs
  a per-day summary good enough to choose from — which is exactly what
  didn't work.
* **Continuous zoom-back** (§7e): always anchored at now, reach further by
  zooming. No summary needed, because you never choose a day — you widen the
  window until what you want is in it.

The standalone dashboard keeps its week strip and day paging unchanged; this
is an overlay decision, not a deletion. But the overlay is where the product
is heading, so treat the week strip as legacy rather than as a model to
extend. Open question, not urgent: whether `viewDayStart` and the week strip
should eventually retire from the overlay's code path entirely, or stay as
the standalone dashboard's own affordance.

## Pending: strip -> ribbon animation rework (flagged 2026-08-23, not designed)

Raised by Scott twice in one session and worth tracking before the reasons
are lost. **The animation that morphs strip tiles into ribbon blocks is
largely dead:** "we had an animation that tried to animate the strip blocks
to the ribbon blocks and given the decisions that we've made recently, the
majority of that animation is completely lost." The decisions that eroded it
were each individually right — Chrome-order strip vs. time-ordered ribbon
(§7c) means tiles and blocks no longer correspond positionally, and
intersection-only animation (§7b) means a tab outside the ribbon's current
window has nothing to animate to.

**It has since acquired a second job.** Retiring `OPEN_TAB_MIN_W` (above)
removed the width cue that marked a block as open, deliberately, on the
grounds that open-ness is a visual property and not a geometric one. The
replacement treatment — Scott: "likely highlighting the block in a way that
implies that it is open" — was left to this rework rather than designed
separately, since both are about the same thing: how strip and ribbon stay
legible as one object.

Not designed, deliberately. Noting only that the two questions are one
question, and that `.open-tab` (set in `paint()`) is the existing hook.

---

## Marking open tabs: shape, not colour; and eviction by score (2026-08-23, designed not built)

Follows `OPEN_TAB_MIN_W`'s retirement, which removed the only cue marking a
block as open and left the gap deliberately. Design session, no code. Spec
§7f carries the resulting rules; this is the reasoning and the alternatives
that lost.

**The problem is a bridge between two genuinely different orderings.** The
strip is ~10 items in Chrome order — for pinned tabs, an order the user
chose for their own retrieval, with no relation to history. The ribbon is 12+
items (many more zoomed out) in time order. Scott's example: a pinned Gmail
at strip position 1 might not appear in the ribbon's first two days at all.
Pinned tabs are acting as bookmarks, and "they may not be historically
valid." No positional mapping exists between the two views, which is why
per-item animation is not merely hard but ill-defined.

**Colour was proposed first, as a replacement for the animation** ("it could
be as dumb as just making them appear dark blue"), then reconsidered in
favour of shape. The decisive evidence was already in the tree: earned-HIGH
shipped a muted gold rim on 2026-08-08 for exactly this kind of second,
orthogonal fact, and it was reverted — `EARNED_RIM` is now literally
`HIGH_RIM`, with the note "the gold read as an unexplained extra difference
rather than a helpful one." Scott remembered this and was right to be wary;
I initially mis-read the code as still shipping gold and had to correct
myself against line 506. A second colour here would have been the same
experiment with the same likely result.

**Shape is the free channel.** Fill and rim luminance encode importance (§6)
and rim additionally carries earned-HIGH's thicker treatment. Rounded top
corners are unused, read instantly as "tab," and compose with everything —
a block can be important, earned-HIGH, and open simultaneously with no
interference. Scott's framing of why the orthogonality is acceptable rather
than a smell: "it is a bridge between these two worlds, and almost by
definition, it is going to feel orthogonal. So I can live with that."

**The requirement is persistence, not transition,** and this is what
finally settles the animation question. Scott: "zoom all the way out for
seven days and zoom back in again, you still have a representation of 'oh
yeah, these are the tabs that are currently open'." An animation fires once
at expand and is gone; a static mark survives zoom, scroll, and day loading.
So the marking is not a consolation prize for a failed animation — it is
strictly better for the actual need.

**Height animation stays; per-item motion is retired.** Clarified by Scott
directly: "the height animation should still be there... but there will be
no animation to line up the strip view tabs to the ribbon view blocks."
Splitting these was clarifying — previously one mechanism was implicitly
responsible for both "something is happening" and "these are your tabs."
Now the container animates and the items do not: height carries the
transition, shape carries the identification. Explicitly revisitable, but
only if the ordering mismatch changes.

**Eviction: Scott corrected his own proposal mid-discussion.** The first
idea was capacity-as-policy — whatever does not fit in the strip gets
closed — which is appealingly simple and self-limiting, with no threshold to
tune. The flaw he then identified himself: Chrome puts newly-opened tabs at
the right end, so "the downside with getting rid of the strip on the end is
that that is always the most recently used tab, so it is likely the tab that
you really do not want to [close]." Score-based eviction fixes it and adds
no machinery, since score already drives band/height. The accepted cost is
predictability: "it is not from the user's point of view visually
deterministic... however, if we do our job correctly, it will feel like the
right one" — which is the product thesis (opinionated, usually right,
recoverable) applied to a single decision.

**The grace slot: "the right kind of lie."** The strip keeps listing the
most recently auto-closed tab even though it is closed. Scott: "it sounds
wrong on paper, but I feel like it might end up winning by keeping it much
simpler. We're not inventing a new colour marking system. And if the user
really doesn't care about it, they'll ignore it, and then the next time they
open the ribbon, it'll just naturally go away." Its strongest property is
self-clearing — no decay logic, no timer, no third visual state — and it
puts the thing the system just took in the place it is most easily
recovered, which is exactly where the eviction safety net is under most
load.

**What made the whole design collapse to something simple:** a closed tab is
just history. Not a resurrection, not a "recently closed" state — it stops
being open, loses the shape on the next paint, and is an ordinary
historical block. An earlier draft of this discussion was heading toward a
third visual state for recently-evicted tabs; Scott's clarification ("it
really is exactly the same in every way, it just doesn't show up in the
strip") removed the need entirely. Closing is not a transition to represent;
it is a return to the default.

---

## Building §7f's marking: shape needed an edge, and a lost close box (2026-08-23)

Implementation notes on §7f's marking half. The eviction half was
deliberately NOT built — it is Phase 3, and two standing constraints block
it (the dry-run-vs-live question in the roadmap entry, and
`eviction-fallback-tedium`'s "no `chrome.tabs.remove()` until retrieval has
been exercised by hand"). Building the grace slot would also have required
inventing eviction to feed it, so §7f split cleanly along that line.

**The design was wrong in one specific way, and building it found it
immediately: shape alone is invisible.** The first cut shipped
`border-radius: 7px 7px 0 0` on `.blk.open-tab` and showed nothing at all —
in either view. Not a class bug, not a stylesheet-loading bug (both checked
first): `paint()` inline-writes `borderColor` from `TIER_RIM[band]` on every
repaint, and the LOW/MEDIUM rims sit very close to their own fills. There
was a correctly-rounded border with nothing visible to round.

The fix keeps the argument for shape intact while admitting the gap: open
blocks take a high-contrast rim (`rgba(255,255,255,0.85)`, `!important` to
beat the inline write) with a transparent bottom so the tab sits on the
baseline. **Shape still does the identifying — the rim only gives the shape
an edge to be seen against.** Worth recording as a general trap on this
ribbon: any purely-geometric marking has to survive `paint()`'s inline
colour writes, and "the border is already there" is not the same as "the
border is visible."

**The close box had been silently missing since 2026-08-22.** Scott noticed
it while checking the tab shape: hovering a strip tile no longer offered an
`×`. `git log -S` located it precisely — added in `0e06334`, removed in
`de076eb` (the Phase 2 unification). Not a deliberate removal: it lived as
`.fs-close` on the `.fs-tab` tile DOM, and Phase 2 replaced that whole DOM
with shared `.blk` blocks. The `FS_CLOSE_TAB` handler in `background.js` was
never touched and had been working the entire time — only the UI half went
missing.

Rebuilt as `.blk-close` in `paint()`'s own pass, following the same
create-once/update idiom as the favicon and label passes. Strip-only, and
never on pinned tabs (real Chrome offers no close box there either, and a
30px icon-only tile has no room). No new synchronisation: `onRemoved`
already fires for a close from any source and the existing per-window
broadcast re-syncs every strip, exactly as §7 documented.

**The spec drift is the more interesting failure.** §7 documented the close
box as a current, working feature for a full day after it stopped existing,
because the unification rewrote the DOM it depended on without anything
flagging the dependency. Nothing in the process catches this class of
regression — a feature described in one section, implemented in machinery a
later section replaces. No process change proposed; noting it because
"the spec says it works" was not evidence here, and a second instance would
justify one.

**Also fixed, cosmetic:** strip tiles centred their contents vertically
(`top: 4px` -> `top: 7px` in uniform mode only; `(30 - 16) / 2`). The base
rules anchor favicon/label to the top, which is right for a variable-height
tiered block and visibly top-heavy on a fixed 30px tile. The label reserves
the close box's lane (`right: 22px`) so long names ellipsise instead of
running underneath it.

---

## Strip visual pass (2026-08-24)

Prompted by an outside agent's redesign proposal for the strip. Most of it
was written against a DOM that does not exist here — `.tab-bar`/`.tab`/
`.is-active`, flexbox layout, a JS click handler toggling an active class —
and several items would have undone working decisions: flexbox breaks the
one-pipeline invariant (§7b) and the height animation that depends on
absolute positioning; removing all borders removes §6's importance channel
*and* §7f's shape-marking rim; a `#3b82f6` accent for "active" is exactly the
second colour channel earned-HIGH's gold was reverted for; `flex: 1 1 180px`
re-litigates `STRIP_TILE_W`'s fixed pitch. Adopted from it: the observation
that the strip had **no active-tab cue at all**, which was a real gap.

Kept the fixes strip-scoped rather than editing `TIER_FILL`/`TIER_RIM`/
`PAGE_BG`: those serve the tiered ribbon and (for `PAGE_BG`) the container
cut-out seam, and this was a tab-bar visual question, not an importance-
encoding one.

**The rim was reassigned rather than duplicated.** In the strip every tile is
an open tab, so §7f's white "this is open" rim distinguished nothing there —
it just made the row read as white-outlined boxes. Scoping that rim to the
tiered ribbon freed it for the active tile, which is why "one rim, one
meaning per view" fell out rather than needing a new channel. A CSS
specificity trap on the way: both rim rules are `!important`, so source order
does not decide between them — the two rules are now disjoint by `heightMode`
(`:not(.uniform-height)` vs `.uniform-height`) so neither can shadow the
other. The first version had a bare `.blk.active-tab` (0,2,0) losing to an
ID-carrying ribbon rule (1,2,1), invisible only because both rims are
currently the same colour.

## Active is a local fact (2026-08-24)

**Symptom:** clicking a tab flickered its border several times.

**Two wrong fixes preceded the right one, both worth recording because each
was a plausible-looking read of the same evidence.**

*First:* a click fires 2-3 broadcasts (`onActivated`, then `onUpdated`/
`status: "complete"`) with a session finalize landing between them; the
finalize changes the outgoing tab's most-recent session, hence its score,
band, and inline-written `borderColor`. `border-color` is not in `.blk`'s
transition list, so each repaint snapped. Real, and the fix (pinning the
strip's rim band-blind) was kept on its own merits — band is a historical-
attention fact with no meaning in a tab bar. But it was treating a symptom:
it made the churn invisible instead of stopping the repaint.

*Second:* gating repaints on `document.hidden`, so an arriving strip paints
while still hidden and is never redrawn on screen. This worked, but it was
compensating for a broadcast that should not have existed. Deleted when the
real fix landed.

**The actual insight (Scott):** every tab has its own strip, and a strip's own
tile is the active one *by definition* whenever the user can see that strip at
all. So `active` is not something a strip needs to be told — it is a local
fact, derivable from identity alone. `toStripTab` stops sending it; each strip
learns its own `selfTabId` from the `FS_GET_TABS` reply and stamps that one
tile at paint time. It cannot go stale, so there is nothing to resync.

That collapses the messaging rule too: **only add/remove and title/favicon
broadcast to other tabs.** Focus changes carried no information any *other*
strip could use, and the `status: "complete"` broadcast carried none at all
while firing right after every switch. A tab switch now causes zero repaints
anywhere, which is why the visibility gate stopped earning its complexity.

The general shape, worth remembering: **a fact that is derivable locally
should not be broadcast.** Broadcasting it turns one user action into N
repaints and creates a resync problem that then needs its own machinery
(debouncing, visibility gating) to manage.

## Closing entry: what the exploration returned (2026-08-25)

This log stops accumulating here. The Active Tab Manager was an exploration
of one question — *what does it mean for tabs to transition into a ribbon
view* — and it has an answer. Successor log: `decisions/parkinglot.md`.

**The result is negative, and that is a real result.** Tabs do not transition
into history, because half of them were never history. The tab bar holds a
working set (genuinely the ribbon's leading edge), standing tabs (a user
declaration telemetry cannot infer), and open loops (near-zero attention by
construction). Only the first is what the ribbon shows. Full reasoning:
`decisions/parkinglot.md`, "Origin".

**This log had already recorded the evidence three times without naming it.**
§7c's strip had to bypass the day-filtered ribbon pipeline entirely; the
pinned-tab carve-out was written as an exemption from eviction when it is
really an exemption from the attention model; and "Pending: strip -> ribbon
animation rework" recorded the animation dying because the two orderings do
not correspond. Each was read as a local problem. They were one fact.

**What died, and how.** Not by being fixed:
* The injected strip surface, and with it three watch items that were
  structural properties of content-script injection —
  `switcher-fixed-root-overlap`, `switcher-navigation-flash`,
  `switcher-phase1-rough-edges`. Deleted from `WATCHLIST.md`, not carried
  forward.
* The strip→ribbon animation rework (flagged twice, never designed) and
  §7f's pending open-block visual treatment, which was that rework's second
  job.
* **Phase 3 (score-ranked eviction) — retired, not deferred.** A read-later
  tab has zero attention and maximal intent, so "close the lowest score"
  targets the most deliberately-opened tabs first. An inverted signal, not a
  tuning gap.
* **Phase 4 (active→historical reconciliation) — dissolved.** It asked
  whether closing a tab should make it join an existing container. Under §8
  the question does not arise: a parked tab was never attended, so there is
  nothing to reconcile, and a user-closed tab already folds into history
  correctly.

**What survives, and where it goes.** Everything from §7c to §7h that is
about the *ribbon* rather than the strip — right-anchored zoom, cross-day
loading with day dividers and band ladders, the `timeToX`/`xToTime`
coordinate system, edge-proximity panning, the default-window solve. This is
the project's current ribbon behaviour and it moves to the dashboard in §8
Phase 1. Its watch items moved to `WATCHLIST.md`'s Display section under
"Ribbon navigation".

**The premise that framed this whole file is superseded.** "Ribbon quality
gates eviction" (see "The product goal, stated plainly" and "Lightweight
opinion + fallback") assumed the ribbon was the recovery path for every
closed tab. §8 splits the population: open loops recover through the parking
lot, and only genuinely-visited pages recover through history. The safety
argument is unchanged in shape — opinionated by default, recoverable by
design — but it now rests on two surfaces instead of one, which is what makes
aggressive closing shippable at all. `eviction-fallback-tedium` was narrowed
accordingly; `parkinglot-recovery-trust` carries the blocking half.

**Worth keeping from the four days.** The work between §7c and §7h was
correct work on a wrong host. It was done under the belief that it was Phase
3 groundwork — making history navigable enough to license eviction — and
that belief is what produced a genuinely good ribbon. The ribbon is now the
history product on its own terms, which is a better outcome than the
subordinate role this file had planned for it.
