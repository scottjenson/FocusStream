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

## Spec-before-code scope, clarified (2026-08-21)

User revised the standing "spec before code" workflow rule mid-session:
it's for early-stage/foundational design, not for small, scoped fixes —
those go straight to code, since spec-first on a small change often
surfaces problems that force re-specing anyway. Both changes in this
entry (close box, live labels) were built directly, discussed inline
rather than pre-specced, with this file and `spec/tabmanager.md` updated
afterward once the shape was actually known.
