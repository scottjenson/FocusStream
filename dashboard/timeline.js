// FocusStream horizontal timeline (spec §6 Phase 3b).
//
// Vanilla-DOM port of the Desktop4 TimelineView pipeline:
//   score → tier (three bottom-flush heights) → picket fence → cursor layout
//   → interpolated hour marks → favicon identity.
// Width is time (floored at MIN_W); height is salience; luminance is
// importance (spec §6, 2026-08-07 monochrome pass — hue identity retired,
// favicons carry identity instead) — score never changes width. Only LOW
// blocks may fence; MEDIUM+ is structurally incapable of being hidden
// (§5 side-quest rule).
//
// Wrapped in an IIFE so nothing leaks into dashboard.js's global scope;
// dashboard.js hands us the session list via window.renderTimeline().
// Also dynamically imported by switcher.js's overlay (Active Tab
// Manager Phase 2, spec §7b) — same render pipeline, different DOM root
// (window.__fsTimelineRoot, read at module-init, see the qs()/rootContainer
// comment below). Each import() gets its own fresh module instance/closure
// (dynamic import isn't cached across distinct content-script/page realms),
// so the overlay and a standalone dashboard tab never share state.
//
// Scoring (session -> score/band) and assembly (sessions -> parsed/merged/
// containerized threads) split out to scoring.js/assembly.js (2026-08-15,
// file-size pass, 2026-08-15) — this file keeps layout, paint, and
// interaction (zoom/pan, fence expand, hover-card lock), which stayed together
// because that state is genuinely one coupled subsystem, not artificially
// glued.

import {
  hasEarnedHigh,
  scoreSession,
  attendedSeconds,
  bandFor,
  hostOf,
  fmtDuration,
  hourNum,
  fmtHour,
  fmtClock,
} from "./scoring.js";
import {
  VISIT_GAP_MS,
  parseSessions,
  assembleThreads,
  threadsByDay,
  labelKeyOf,
  computeHostNames,
  tipDataOf,
  dayStartOf,
  prevDayStart,
} from "./assembly.js";

(() => {
  const log = (...args) => console.log("[FS timeline]", ...args);

  // DOM-root indirection (Active Tab Manager Phase 2, spec §7b, 2026-08-21):
  // every DOM lookup in this file goes through qs()/rootContainer() instead
  // of calling document.getElementById/document.body directly, so the exact
  // same render() pipeline can paint into either the
  // standalone dashboard page (root = document, the default — nothing about
  // the historical view changes) or the tab-strip's overlay (root
  // = that overlay's shadow root). Read from window.__fsTimelineRoot at
  // MODULE-INIT time, not via a post-load setter call: several elements
  // below (tip, quickLabel) are created and
  // appended to their root at top-level IIFE execution, before render() is
  // ever called — a setter invoked after import() resolves would be too
  // late for those. switcher.js sets window.__fsTimelineRoot synchronously,
  // immediately before calling import() on this module, so it's already in
  // place the instant this line runs.
  let root = (typeof window !== "undefined" && window.__fsTimelineRoot) || document;
  function qs(id) {
    return root.getElementById(id);
  }
  // document.body has no shadow-root equivalent — callers that used to
  // append to document.body now append to root itself (the shadow root's
  // top-level append target) when root isn't `document`.
  function rootContainer() {
    // Mirrors document.body: the overlay's shadow root carries a real
    // <body>-tagged element as its one child (switcher.js) specifically so
    // timeline.css's `body { ... }` base rule (font-family, background,
    // color, color-scheme) applies inside the shadow tree exactly as it
    // does on the real dashboard page — appending straight to the shadow
    // root itself would put the tooltip outside that inheritance chain.
    return root === document ? document.body : root.querySelector("body");
  }
  // Zoom anchor edge (Active Tab Manager Phase 2, spec §7b): the standalone
  // dashboard always left-anchors (unchanged historical behavior — the
  // day's first event flush against the viewport's left edge). The
  // open-tabs overlay right-anchors instead, pinned to "now" — zooming out
  // reveals earlier time leftward. Same __fsTimelineRoot-style module-init
  // read; switcher.js sets window.__fsTimelineAnchor = "right" before
  // import()-ing this module for the overlay.
  // Defaults to "right" since §8 Phase 1 (2026-08-25) — this flag also gates
  // §7e cross-day loading. Rules: spec/display.md §6, spec/ribbon.md §7e.
  const anchorMode =
    (typeof window !== "undefined" && window.__fsTimelineAnchor) || "right";

  const HOUR = 3600 * 1000;

  // --- Layout (px). The timeline is the PRIMARY view (spec §6) — sized
  // for a NORMAL day (spec §6, halved again 2026-07-17 on real data):
  // 1 hour ≈ 135px, so a full day reads as a one-glance overview and a
  // light day reads light instead of inflating its small events.
  const BASE_PX_PER_SEC = 0.0375;
  // Horizontal zoom (spec §6, 2026-08-08): a scroll/trackpad gesture over
  // the ribbon scales BOTH time scales together by one factor, preserving
  // the presence:absence ratio at every zoom level — real relayout, not a
  // CSS transform, so text/borders/favicons stay crisp and MIN_W/hour-label
  // logic keep operating on true pixel values. PX_PER_SEC/GAP_HOUR_PX are
  // the LIVE (zoomed) values every layout call reads; setZoom() recomputes
  // them before a relayout.
  let zoom = 1;
  // 0.5 -> 0.25, 2026-08-23, provisional (spec §7e): at 0.5 the ribbon could
  // only reach about one day back, so cross-day stopped at yesterday.
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 16; // 8 -> 16, 2026-08-23, provisional (spec §7d)
  let PX_PER_SEC = BASE_PX_PER_SEC;
  const MIN_W = 8; // floor: smallest visible/hoverable block
  // OPEN_TAB_MIN_W (96px) RETIRED 2026-08-23 — see spec §7e. Open tabs used
  // to claim a 96px floor so a freshly-opened tab (durMs near 0) had room for
  // favicon+label. It made every open tab identical width regardless of real
  // duration, and at multi-day zoom-out those few blocks claimed hundreds of
  // px exactly where width was scarcest — fighting the band ladders that had
  // just been added to reclaim it. Open tabs now use the ordinary MIN_W floor
  // and show honest duration like everything else. "This tab is open" is a
  // VISUAL job, not a geometric one: the .open-tab class (set in paint) is
  // the hook for that treatment.
  // LOW-block shrink ladder (spec §7e, 2026-08-23). At low zoom nearly every
  // block sits ON the MIN_W floor (measured: 87% of 217 blocks across 3 days,
  // 87% of total ribbon width), so zoom-out stops shrinking the ribbon and
  // reach stalls at ~3 days — MIN_W, not ZOOM_MIN, is the real wall. Only LOW
  // blocks descend this ladder: MEDIUM/HIGH keep MIN_W, so zooming out
  // progressively SHARPENS the importance hierarchy instead of flattening it
  // into uniform slivers. Fences were measured as the alternative here and
  // rejected (they need consecutive runs; the real runs average 2.2) — see
  // decisions/tabmanager.md. The 4px/2px rungs are transition frames, not
  // useful states: they exist so the shrink reads as a shrink rather than a
  // pop. The ladder ENDS AT ZERO: at full zoom-out only HIGH survives, which
  // is what a multi-day view should answer ("when did things that mattered
  // happen"), not a compromise to reach 7 days.
  //
  // LOW and MEDIUM use the SAME 8-5-3-0 shape, OFFSET in zoom so LOW is fully
  // gone before MEDIUM starts thinning. The staging is what makes vanishing
  // legible rather than alarming: the user watches LOW fade out first and
  // learns the rule, so MEDIUM following later reads as "I'm zoomed out past
  // the small stuff," not "my data is missing." Two bands vanishing at the
  // same threshold would read as a cliff. HIGH never descends.
  //
  // Measured basis (3 days, zoom 0.25, 1721px viewport): after LOW's first
  // ladder shipped, MEDIUM was the LARGEST consumer at 722px from just 69
  // blocks, 60 of them pinned at the 8px floor — more width than 129 LOW
  // blocks took (606px). Holding MEDIUM flat was the remaining cap on reach.
  const BAND_FLOOR_STEPS = {
    // Most-zoomed-out FIRST: the first threshold at or below the current zoom
    // wins, so the ladder descends as zoom shrinks.
    low: [
      { zoom: 0.45, w: 0 },
      { zoom: 0.6, w: 3 },
      { zoom: 0.8, w: 5 },
    ],
    medium: [
      { zoom: 0.28, w: 0 },
      { zoom: 0.35, w: 3 },
      { zoom: 0.42, w: 5 },
    ],
  };
  // Overlay only: the standalone dashboard shows one day and never reaches
  // the zoom levels these ladders live at, so its geometry is untouched.
  const bandFloorFor = (e) => {
    if (anchorMode !== "right") return MIN_W;
    // Open tabs never descend and are never dropped (the layout() filter
    // exempts them too): a tab the user can switch to right now stays visible
    // whatever it scored. They hold MIN_W, not a larger floor — see the
    // OPEN_TAB_MIN_W retirement note above.
    if (e.isOpenTab) return MIN_W;
    const steps = BAND_FLOOR_STEPS[e.band];
    if (!steps) return MIN_W; // high (and anything unbanded) never descends
    for (const s of steps) if (zoom <= s.zoom) return s.w;
    return MIN_W;
  };
  // The final rung DROPS the band outright, duration and all (spec §7e,
  // 2026-08-23). A floor of 0 alone was not enough: widthOf takes
  // max(floor, realWidth), so once the floor reached 0 every block simply
  // rendered at its honest duration width and the ladder stopped doing
  // anything (measured: lowAtFloor 0 of 131 — not one LOW block was still
  // resting on the floor). Duration is a signal but a weak one down here
  // (Scott: "a longer low is an odd thing"), so past the zero threshold the
  // band goes entirely rather than proportionally. This is a real filter,
  // not a rendering tweak: at full zoom-out the view answers "when did
  // things that mattered happen," and LOW/MEDIUM are not answers to it.
  const bandDroppedAt = (e) => {
    const floor = bandFloorFor(e);
    return floor === 0;
  };
  const GAP = 2;
  const BAND_H = 144;
  // Bottom-flush; top edge = importance contour. MEDIUM/LOW dropped to 75%
  // of HIGH's height (2026-08-08) — the uniform-height pass (2026-08-07
  // second pass) made adjacent events run together with only fill/border to
  // separate them; a height step gives HIGH a second, stronger signal.
  // MEDIUM and LOW still share one height (fill/border is what splits them).
  // The one live tier-height source since the card deck was deleted
  // (2026-08-25) — layout() sizes every block from it.
  const TIER_H = { high: 144, medium: 108, low: 108 };

  // Contained children render at one uniform height regardless of band
  // (spec §6, 2026-08-07) — containment frames, never confers stature. Set
  // independently of TIER_H (50% of the full band, 2026-08-07 second pass)
  // now that TIER_H no longer has a natural "short" tier to borrow from.
  const CONTAIN_CHILD_H = BAND_H / 2;
  const STICK_W = 3; // fence stick: deliberately narrower than any real block
  const STICK_GAP = 1;
  const CUT_SEAM = 1; // .blk.cut border-width (index.html): the page-background seam around contained children
  const CONTAIN_INSET = 6; // px shaved off a contained child's top edge, so a same-tier child (e.g. MEDIUM-in-MEDIUM) still shows a strip of the container above it
  const CONTAIN_BOTTOM_INSET = 1; // px the child sits above the container floor, matching .blk's own border-width so the container's bottom border shows through
  // Two time scales (spec §6): presence renders at PX_PER_SEC; absence
  // renders at GAP_HOUR_PX per absent hour (~1/6 speed — halved together
  // with PX_PER_SEC 2026-07-17 to preserve the ratio; watch gap loudness).
  // Proportional everywhere — hour boundaries have no effect on width;
  // ticks just interpolate through gaps like they do through blocks.
  const BASE_GAP_HOUR_PX = 22;
  let GAP_HOUR_PX = BASE_GAP_HOUR_PX; // live (zoomed) value — see PX_PER_SEC above
  // The break/departure line (spec §6, 2026-07-28) — ONE constant, two
  // surfaces: fences bridge gaps under it and split at gaps over it, and
  // only gaps over it get an away hover plate. Wall-clock on purpose: this
  // encodes "how long before a break is a walk away from the machine", a
  // fact about the user, so it must NOT be derived from GAP_HOUR_PX the way
  // the old ~16min FENCE_SPLIT_GAP_MS (and the retired GAP_PLATE_MIN_PX
  // hover threshold) were — retuning the absence scale must not silently
  // redefine "lunch". Provisional: 30 min sits mid-dead-zone on the 07-28
  // histogram (grazing < 8min, step-aways 19–21min, nothing between) —
  // watch list.
  // Currently equals AUDIO_BOOKEND_GAP_MS above by coincidence, not by
  // reference (rules audit, 2026-08-06) — see that constant's comment.
  const FENCE_BRIDGE_GAP_MS = 30 * 60 * 1000; // away-plate hover threshold only (below) — untouched by lock evidence
  // Two independent mechanisms decide whether a LOW run bridges a gap (spec
  // §6, 2026-08-08) — not one threshold with a lock-aware exception:
  // (1) a recorded OS-lock interval (background.js, chrome.idle) inside the
  // gap is a CONFIRMED break — unconditional split, no duration floor; even
  // a lock lasting under a minute ends the run. Checked first, short-
  // circuits the duration question entirely.
  // (2) absent any lock evidence, the gap is an IMPLIED break — ambiguous
  // in cause (lunch vs. heads-down in another app; both invisible to this
  // extension) but foldable regardless of which, since neither is real
  // intent on THIS browser. FENCE_IMPLIED_BREAK_MS is deliberately looser
  // than the pre-lock FENCE_BRIDGE_GAP_MS (30min) precisely because it no
  // longer has to double as a proxy for "did they really leave" — that
  // question now has a real answer via (1) when one exists. Provisional (no
  // data yet to tune against — WATCHLIST.md).
  const FENCE_IMPLIED_BREAK_MS = 60 * 60 * 1000;
  const MIN_RUN = 1; // even a lone low fences (2026-07-16: opinionated demoting)
  // Space above the band for HIGH-run labels (spec §6, 2026-08-08 revival):
  // horizontal, single line — one line-height (16px). Down from the old
  // 170px rotated-title strip; rotation (and the space it needed) is
  // retired along with the MEDIUM+ gate.
  const TITLE_AREA = 24;
  // Gap between the label's own bottom edge and the block top (2026-08-09):
  // the label was originally coded bottom-flush against TITLE_AREA (zero
  // gap by design) — two earlier attempts to add clearance by growing
  // TITLE_AREA only pushed the whole label+block pair down together and
  // never separated them. This constant is subtracted from the label's
  // `top` instead, so it alone moves up while the block stays put.
  const LABEL_GAP = 6;
  // Axis strip below the band, in two lanes so nothing overlaps (spec §6):
  // expand bars snug under the band, then a clear gap, then ticks + labels.
  const TICK_TOP = 16; // band bottom → tick/label lane (expand-bar hit zone fills the gap)
  const TICK_H = 12;
  const AXIS_AREA = 46;
  // Hover card's parked slot (2026-08-25): clearance between the bottom of
  // the axis strip and the top of the card, so the card never sits on the
  // hour ticks/labels. The card left-aligns to its block and drops to this
  // fixed lane — already where an "expanded" card would go, which is why
  // locking needs no expand animation.
  const TIP_PARK_GAP = 12;
  // Below this width the lock icon is suppressed (2026-08-25): a 22px icon
  // cannot sit inside a narrower block without overflowing onto neighbors.
  // Such blocks still hover normally — they just can't be pinned. Held
  // separately from MIN_W (8, the hoverable floor) because it answers a
  // different question: MIN_W is "can this be hit at all", this is "can
  // this hold a control". Deliberately not folded into MIN_W.
  const LOCK_MIN_BLOCK_W = 28;
  const LABEL_CLEARANCE = 6; // min px between hour labels; colliders drop, never nudge (spec §6)
  // Left-anchored label sizing (spec §6, 2026-08-08 revival): a HIGH run's
  // label starts at its block's left edge and may overflow rightward across
  // LOW/MEDIUM neighbors (unlabeled space) but stops at the next HIGH run's
  // own anchor, or the ribbon's right edge. TITLE_MIN_W is the floor below
  // which even an ellipsis doesn't fit, so the label is dropped rather than
  // rendered as a meaningless sliver.
  const TITLE_MIN_W = 24;
  // Monochrome & favicons (spec §6, 2026-08-07): identity and importance
  // are fully decoupled. Importance is luminance + height; identity is the
  // favicon. Hue identity (Kelly palette, hostColorOrder registry/
  // tombstones, hue-derived rims) is retired — favicons can't clash with a
  // per-host color that no longer exists.
  const PAGE_BG = "#14161a"; // ribbon ground; also the cut-out seam color
  // Fill/rim ladder (spec §6, 2026-08-08): MEDIUM shares HIGH's fill
  // on purpose — fill reads as background-vs-foreground (LOW recedes,
  // MEDIUM/HIGH advance), while MEDIUM keeps its own rim and TIER_H
  // (108 vs HIGH's 144) to disambiguate from HIGH. Distinct from the
  // earlier MEDIUM=LOW collapse (rejected same day, indistinguishable
  // with no other signal to fall back on) — here height + rim carry it.
  const LOW_FILL = "#262626";
  const LOW_RIM = "#3A3A3A";
  const MEDIUM_FILL = "#474747";
  const MEDIUM_RIM = "#565656";
  const HIGH_FILL = "#474747";
  const HIGH_RIM = "#8A8A8A";
  const EARNED_RIM = HIGH_RIM; // was muted gold "#D4AF37" — kept as a named
  // constant in case earned-HIGH gets its own accent again, but matched to
  // HIGH_RIM for now: the gold read as an unexplained extra difference
  // rather than a helpful one (2026-08-08).
  const TIER_FILL = { low: LOW_FILL, medium: MEDIUM_FILL, high: HIGH_FILL };
  const TIER_RIM = { low: LOW_RIM, medium: MEDIUM_RIM, high: HIGH_RIM };
  // Collapsed fence sticks: solid, borderless, darker than LOW_FILL — a 3px
  // stick is nearly all rim if it keeps the 1px outline, and the fence
  // should whisper (visible but very subtle).
  const STICK_FILL = "#2f333b";
  // Favicons (spec §6, 2026-08-07; always-color/always-attempt experiment
  // same day): drawn in-block on every real block, always full color,
  // clipped by the block's own edge when too narrow/short to fit — sizing
  // lives in CSS (.blk .fav) since JS no longer gates on it.

  // Two-section tooltip display (spec §6, 2026-07-18): tipDataOf
  // (assembly.js) builds the data; TIP_DEBUG/TIP_TITLES_MAX here are
  // purely display concerns (whether/how much of it fillTip shows).
  const TIP_DEBUG = true; // demo period: scores + signals visible; flip off for normal use
  const TIP_TITLES_MAX = 8;

  // Admission filter, display rung (spec §3). The predicate and its knobs
  // moved to shared/transit.js (2026-07-24): the service worker applies the
  // SAME rule at finalize to delete snapshots of rejected sessions, so the
  // two sides can never drift.
  const { isTransit } = FS_TRANSIT;

  // The window's NEWEST day, pinned at today since §8 Phase 1 removed the
  // day picker (spec/display.md §6); windowStart alone walks backward.
  const viewDayStart = dayStartOf(Date.now());

  // Cross-day window (spec §7e, 2026-08-23), overlay only. windowStart is the
  // oldest day loaded; it walks backward one day at a time as the user zooms
  // out, capped at MAX_WINDOW_DAYS. Equal to viewDayStart = today-only, the
  // historical behavior and what the standalone dashboard always keeps.
  const MAX_WINDOW_DAYS = 7;
  let windowStart = viewDayStart;
  // Overnight absence collapses to a fixed-width labeled divider instead of
  // an honest GAP_HOUR_PX span (spec §7e: 8-10h of sleep would otherwise be
  // thousands of px of blank ribbon, and zooming out would reach a corridor
  // rather than yesterday). O(1) px per day is what makes zoom-out usable.
  const DAY_DIVIDER_W = 34;
  const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Scroll anchor as distance from the RIGHT edge (spec §7e, 2026-08-23).
  // scrollLeft is measured from the document's LEFT edge, so prepending a day
  // invalidates it by exactly the width inserted (the classic prepend jump);
  // every pixel right of an insertion keeps its distance from the right edge,
  // so this survives a load untouched. fromRight === 0 IS §7d's resting right
  // pin — rest and preserved-anchor are one expression, not two mechanisms.
  // Valid only while zoom is constant across a load, which §7e guarantees.
  let fromRight = 0;
  // The ribbon's scrollable width, as WE laid it out — never read back from
  // the DOM (spec §7g). Reading ribbonEl.scrollWidth raced with Chrome's
  // layout flush and returned the previous frame's width; we set the width,
  // so our own number is authoritative and cannot be stale.
  let lastTotalPx = 0;
  let lastPadPx = 0;
  // Trailing pad — extends the scroll range during a zoom gesture so the
  // anchor's target is not clamped away. See paint()'s padRightPx.
  let lastPadRightPx = 0;
  // The current layout's time<->x mapping (see axisOf). Replaced on every
  // tiered paint; null before the first one and in strip mode, where the axis
  // is categorical (Chrome tab order) and time has no meaning.
  let axis = null;
  // Zoom anchor request, set by applyZoom for the duration of one relayout:
  // {t, viewportX} = "keep instant t at this many px from the viewport's left
  // edge". paint() consults it when sizing the underflow pad, so the anchor
  // works in BOTH regimes (2026-08-23). Scroll position alone cannot hold an
  // anchor when content is narrower than the viewport — there is nothing to
  // scroll — so the pad becomes the actuator there, exactly as it is already
  // the actuator for holding the right edge. Null outside a zoom gesture,
  // where the pad reverts to its plain flush-right behaviour.
  let pendingAnchor = null;
  const scrollableWidth = () => lastTotalPx + lastPadPx + lastPadRightPx;
  const maxScrollOf = (wrap) => Math.max(0, scrollableWidth() - wrap.clientWidth);
  const captureFromRight = (wrap) => {
    fromRight = Math.max(0, maxScrollOf(wrap) - wrap.scrollLeft);
  };
  // True while WE are assigning scrollLeft. Assigning it fires a scroll event
  // asynchronously; without this the listener would re-derive fromRight from
  // a scroll we caused ourselves (spec §7g).
  let selfScrolling = 0;
  const setScrollLeft = (wrap, x) => {
    selfScrolling++;
    wrap.scrollLeft = x;
    // Cleared after the event loop turn that delivers the scroll event.
    setTimeout(() => {
      selfScrolling = Math.max(0, selfScrolling - 1);
    }, 0);
  };
  const applyFromRight = (wrap) => {
    setScrollLeft(wrap, Math.max(0, maxScrollOf(wrap) - fromRight));
  };

  // Demand-driven day loading (spec §7e, 2026-08-23, trigger corrected same
  // day). The signal is CAPACITY, not scroll position: if the loaded range no
  // longer fills the viewport, there is room for more history, so load a day.
  //
  // The first cut triggered on `scrollLeft <= 200px` — an infinite-scroll
  // pattern, which measures PANNING toward the end of loaded content. But the
  // user reaches history by ZOOMING, and zoom doesn't move the scroll position
  // at all; it changes how much fits. Worse, zooming out lands in exactly the
  // regime where the signal is undefined: content narrower than the viewport
  // means no scrolling is possible and scrollLeft is pinned at 0 forever, so
  // the trigger could never fire again (real specimen: 621px of content in a
  // 1470px viewport, stuck at "yesterday" no matter how far the user zoomed).
  //
  // `total < viewportWidth` is well-defined in both regimes and never mentions
  // scroll. Note it is the same condition as §7d's underflow pad — "the pad is
  // non-zero" and "there is room for more history" are one fact, which is a
  // good sign this is the model rather than another special case.
  //
  // ONE day per relayout, deliberately not a loop (Scott: "a type of calming
  // action... spread the load out across multiple scrolls so that we don't
  // have this weird edge case of having to load three days at once"). Zoom
  // ticks are frequent, so the window catches up over a gesture rather than
  // in one jump — and it removes the loop, its termination argument, and the
  // multi-day content jump in a single frame. Consequence, accepted: on a
  // sparse day the ribbon RESTS underfilled (today only) until the user zooms;
  // underfill is a normal resting state here, not a transient.
  //
  // PROXIMITY arm added 2026-08-24 (spec §7h): panning reaches history too,
  // deliberately reversing the rejection recorded above — the 7-day window is
  // an efficiency trick and should be invisible, and the old objection (the
  // signal is undefined on underflow) does not apply to panning, which only
  // exists in the overflow regime. Neither gesture knows about loading:
  // zoom changes capacity, pan changes proximity, paint() decides.
  //
  // Generous margin (order of one viewport) so the day lands BEFORE the pan
  // reaches the edge. If panning stalls at the left before MAX_WINDOW_DAYS,
  // this constant is the suspect, not the ramp.
  const LOAD_MARGIN_PX = 1200;
  // Set the first time the user zooms or pans (spec §7h). Until then a day
  // load may re-solve the default window, which a prepend otherwise falsifies;
  // after it, the user's gesture is the correction mechanism and re-solving
  // would fight it. Third default-window gate bug — see DEFAULT_WINDOW_BLOCKS.
  let userAdjusted = false;
  // Set by the pan pump for a pan's duration. The proximity arm is gated on it
  // because scrollLeft is 0 at rest on every render — ungated it would read as
  // "near the left end" before the user touched anything and pull all seven
  // days at startup. Proximity is a claim about a gesture, not a position.
  let panning = false;
  // Real motion, not mere cursor entry — `panning` alone is set by startPan
  // before anything moves (spec §7h; decisions/tabmanager.md 2026-08-25).
  let pannedMoved = false;
  let loadingDay = false;
  function maybeLoadOlderDay(totalPx) {
    if (loadingDay) return;
    if (anchorMode !== "right") return;
    const wrap = qs("ribbon-wrap");
    if (!wrap) return;
    // Capacity (§7e) OR proximity (§7h) — "is there room for more history to
    // be useful", asked two ways. lastPadPx is the left pad: content starts
    // there, so that is the real distance to the oldest loaded pixel.
    const underflows = totalPx < wrap.clientWidth;
    const nearLeftEnd = pannedMoved && wrap.scrollLeft - lastPadPx <= LOAD_MARGIN_PX;
    if (!underflows && !nearLeftEnd) return; // plenty of loaded history ahead
    if (Math.round((viewDayStart - windowStart) / 864e5) + 1 >= MAX_WINDOW_DAYS) return;
    const older = prevDayStart(windowStart);
    if (oldestDayStart() > older) return; // no data older than this — stop
    windowStart = older;
    log(`§7e: loading older day, window now ${new Date(windowStart).toDateString()}`);
    // A prepend falsifies a default window solved before it — the extra day
    // renders at a zoom solved for the smaller set (spec §7h). Re-armed here
    // rather than by loosening the gate, so ordinary data ticks still never
    // re-solve.
    if (!userAdjusted) defaultZoomApplied = false;
    loadingDay = true;
    try {
      render(lastSessions, lastLockIntervals);
    } finally {
      loadingDay = false;
    }
  }

  // True if [from, to) fully contains at least one recorded OS-lock interval
  // (spec §3/§6, 2026-08-08) — confirmed departure, not a wall-clock guess.
  function gapIsLockBounded(from, to, lockIntervals) {
    return lockIntervals.some((iv) => iv.start >= from && iv.end <= to);
  }

  // Runs of MIN_RUN+ consecutive LOW events fence; everything else lays out
  // as a plain block. MIN_RUN=1: even a singleton LOW collapses to a stick
  // (spec §6, 2026-07-16 — opinionated demoting; hover + expand keep it
  // findable). The run machinery is kept as-is so the revert is one constant.
  function clusterEvents(events, lockIntervals = []) {
    const items = [];
    let run = [];
    const flush = () => {
      if (run.length >= MIN_RUN) items.push({ kind: "cluster", key: "c" + run[0].id, members: run });
      else run.forEach((event) => items.push({ kind: "event", event }));
      run = [];
    };
    for (const event of events) {
      // Fencing retired ENTIRELY in the overlay (spec §7c, 2026-08-22):
      // originally scoped to isOpenTab only (a tab the user can still
      // switch to shouldn't disappear into a tiny non-clickable stick just
      // because it currently scores LOW) — widened per Scott's direct
      // call to match the same "no fences" precedent the card-view rework
      // already established (that view dropped fences outright — the big
      // learning from it; see decisions/timeline_design.md). A LOW run of real
      // CLOSED history in the overlay now renders as ordinary individual
      // blocks too, same as open tabs already did — anchorMode === "right"
      // is the existing flag distinguishing this overlay from the
      // standalone dashboard (see the .rtitle suppression above for the
      // same convention), which keeps its own fencing (spec §6) unchanged.
      if (event.band === "low" && !event.isOpenTab && anchorMode !== "right") {
        // Departures split fences, breaks don't (spec §6, 2026-07-28): a
        // scattered grazing stretch is one expand target. Bridged gaps that
        // are still wide enough to hover keep their away plate on top of the
        // fence plate, so nothing is stolen — only leaving ends the run.
        // Two independent split checks (2026-08-08), lock checked first: a
        // recorded lock interval is an unconditional, duration-free split —
        // even a short lock ends the run. Only absent lock evidence does the
        // gap fall back to the ordinary IMPLIED_BREAK duration bar.
        const prev = run[run.length - 1];
        if (prev) {
          const locked = gapIsLockBounded(prev.endTime, event.startTime, lockIntervals);
          if (locked || event.startTime - prev.endTime >= FENCE_IMPLIED_BREAK_MS) flush();
        }
        run.push(event);
      } else {
        flush();
        items.push({ kind: "event", event });
      }
    }
    flush();
    return items;
  }

  // Ms past the local whole hour (timezone-correct, unlike epoch % hour).
  function msPastHour(t) {
    const d = new Date(t);
    return d.getMinutes() * 60000 + d.getSeconds() * 1000 + d.getMilliseconds();
  }

  // The ribbon's coordinate system (spec §7g, 2026-08-23). Ribbon X is NOT
  // linear in time — widths are floored, gaps run on their own scale, day
  // dividers compress a whole night, and §7e drops whole bands — so time<->x
  // can only be answered by walking what layout() actually produced. Returns
  // that mapping so callers stop improvising their own.
  function axisOf(segs, gaps, dividers, total) {
    const spans = [];
    for (const s of segs) {
      if (s.collapsed || s.w <= 0) continue; // sticks/dropped carry no usable span
      const t0 = s.e.startTime;
      const t1 = s.e.endTime > t0 ? s.e.endTime : t0 + 1;
      spans.push({ t0, t1, x0: s.x, x1: s.x + s.w });
    }
    for (const g of gaps) if (g.w > 0) spans.push({ t0: g.from, t1: g.to, x0: g.x, x1: g.x + g.w });
    // A divider swallows the whole overnight span into a fixed width. Its
    // real time range is not recoverable from x (that IS the compression),
    // so it maps as a single block — good enough for anchoring, and honest.
    for (const d of dividers) spans.push({ t0: d.at, t1: d.at, x0: d.x, x1: d.x + d.w });
    spans.sort((a, b) => a.x0 - b.x0);
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    // Binary search for the last span whose start is <= the probe.
    // Last span whose start is <= the probe. Index form, because callers need
    // the NEXT span too, to interpolate across a hole between spans.
    const findIdx = (val, key) => {
      if (!spans.length) return -1;
      if (val <= spans[0][key]) return 0;
      let lo = 0;
      let hi = spans.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (spans[mid][key] <= val) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    return {
      // Interpolates inside the containing span, and ACROSS holes (stretches
      // with no drawn geometry, e.g. a band-dropped range) to the next span.
      // Interpolating holes rather than clamping is what keeps this monotonic
      // and continuous in t — the property the zoom anchor needs (spec §7g).
      timeToX(t) {
        if (!spans.length) return 0;
        const i = findIdx(t, "t0");
        const s = spans[i];
        if (t <= s.t0) return s.x0;
        if (t < s.t1) return s.x0 + ((t - s.t0) / (s.t1 - s.t0)) * (s.x1 - s.x0);
        const next = spans[i + 1];
        if (!next) return s.x1;
        const dt = next.t0 - s.t1;
        if (dt <= 0) return s.x1;
        return s.x1 + ((t - s.t1) / dt) * (next.x0 - s.x1);
      },
      // x -> time. The inverse, with the same interpolation. Inside a FLOORED
      // block time is not linear in x, so this is approximate there by
      // construction — bounded by that one block's width, which is the
      // smallest unit the layout represents at all.
      xToTime(x) {
        if (!spans.length) return null;
        const px = clamp(x, 0, total);
        const i = findIdx(px, "x0");
        const s = spans[i];
        if (px <= s.x0) return s.t0;
        if (px < s.x1) {
          const w = s.x1 - s.x0;
          return s.t0 + (w > 0 ? ((px - s.x0) / w) * (s.t1 - s.t0) : 0);
        }
        // Across a hole to the next span — the inverse of timeToX's own
        // hole interpolation, keeping the two exact inverses of each other.
        const next = spans[i + 1];
        if (!next) return s.t1;
        const dx = next.x0 - s.x1;
        if (dx <= 0) return s.t1;
        return s.t1 + ((px - s.x1) / dx) * (next.t0 - s.t1);
      },
    };
  }

  function layout(items, expandedKey) {
    // Band drop (spec §7e, 2026-08-23): filter BEFORE any geometry so a
    // dropped block consumes no width and its neighbours' gaps close over it
    // — the point is to reclaim the space, not to hide a block that still
    // occupies it. Open tabs are never dropped (they are reachable right now,
    // whatever they scored). Cluster members are filtered individually; a
    // cluster emptied by the filter disappears with them.
    items = items
      .map((item) => {
        if (item.kind !== "cluster") return item;
        const members = item.members.filter((e) => e.isOpenTab || !bandDroppedAt(e));
        return members.length ? { ...item, members } : null;
      })
      .filter((item) => item && (item.kind === "cluster" || item.event.isOpenTab || !bandDroppedAt(item.event)));
    // Leading pad from the floor hour at GAP scale — absence is absence,
    // including the absence before the first block (spec §6: hour labels
    // stay clean whole hours; the pad does the honesty).
    const first = items[0] && (items[0].kind === "cluster" ? items[0].members[0] : items[0].event);
    let cursor = first ? (msPastHour(first.startTime) / HOUR) * GAP_HOUR_PX : 0;
    const segs = [];
    const plates = [];
    const bars = [];
    const gaps = [];
    const dividers = []; // day boundaries (spec §7e) — see allocGap below
    let prevEnd = null; // wall-clock end of the previously laid element
    // Absence at gap scale (spec §6 two time scales): every gap between
    // drawn elements — fence sticks included — gets width proportional to
    // its true duration, ticks interpolated linearly inside. No hour-
    // boundary special case; a 30s tab-hop allocates a fraction of a px.
    const allocGap = (nextStart) => {
      if (prevEnd === null) return;
      // Day boundary (spec §7e, 2026-08-23): a gap straddling midnight
      // collapses to DAY_DIVIDER_W and carries the following day's label —
      // the one deliberate exception to the absence-proportional rule above,
      // confined to this boundary. No hour ticks inside: they would be
      // meaningless at a compressed scale. Midnight is provisional; see
      // WATCHLIST night-break-midnight for the night-owl case.
      if (dayStartOf(nextStart) > dayStartOf(prevEnd)) {
        dividers.push({
          x: cursor,
          w: DAY_DIVIDER_W,
          label: DAY_LABELS[new Date(nextStart).getDay()],
          at: dayStartOf(nextStart),
        });
        cursor += DAY_DIVIDER_W;
        return;
      }
      const w = ((nextStart - prevEnd) / HOUR) * GAP_HOUR_PX;
      const marks = [];
      for (let t = prevEnd - msPastHour(prevEnd) + HOUR; t < nextStart; t += HOUR) {
        marks.push({ t, x: cursor + ((t - prevEnd) / HOUR) * GAP_HOUR_PX });
      }
      if (w > 0 || marks.length) {
        gaps.push({ x: cursor, w, from: prevEnd, to: nextStart, marks });
        cursor += w;
      }
    };
    const widthOf = (e) => Math.max(bandFloorFor(e), (e.durMs / 1000) * PX_PER_SEC);
    for (const item of items) {
      if (item.kind === "cluster" && item.key !== expandedKey) {
        let left = null;
        for (const e of item.members) {
          allocGap(e.startTime);
          if (left === null) left = cursor;
          segs.push({
            e,
            key: e.id,
            clusterKey: item.key,
            collapsed: true,
            band: "low",
            w: STICK_W,
            x: cursor,
          });
          cursor += STICK_W + STICK_GAP;
          prevEnd = e.endTime;
        }
        cursor -= STICK_GAP;
        plates.push({ key: item.key, members: item.members, x: left, w: cursor - left });
        cursor += GAP;
      } else {
        const members = item.kind === "cluster" ? item.members : [item.event];
        let start = null;
        for (const e of members) {
          allocGap(e.startTime);
          if (start === null) start = cursor;
          let w = widthOf(e);
          // Contained children sit at their time-proportional offsets
          // inside the span-scaled container, pushed right — and the
          // container stretched — when min-width floors would collide
          // (spec §6 containers, rule 6).
          const kids = [];
          if (e.children) {
            const span = e.endTime - e.startTime;
            let prevRight = -Infinity;
            for (const k of e.children) {
              // Contained LOW sticks are retired (spec §6, 2026-08-07 second
              // pass, same pass as the top-level fence retirement): every
              // child — LOW included — gets proportional block width now,
              // no more STICK_W floor.
              const kw = Math.max(MIN_W, (k.durMs / 1000) * PX_PER_SEC);
              let kx = span > 0 ? ((k.startTime - e.startTime) / span) * w : 0;
              if (kx < prevRight + GAP) kx = prevRight + GAP;
              prevRight = kx + kw;
              kids.push({ k, kx, kw });
            }
            w = Math.max(w, prevRight + GAP);
          }
          segs.push({
            e,
            key: e.id,
            clusterKey: item.kind === "cluster" ? item.key : null,
            collapsed: false,
            // Expanded members keep low stature: expansion reveals width,
            // never confers importance.
            band: item.kind === "cluster" ? "low" : e.band,
            w,
            x: cursor,
          });
          for (const kid of kids) {
            segs.push({
              e: kid.k,
              key: kid.k.id,
              clusterKey: null,
              collapsed: false,
              contained: true,
              // The container event, so the tooltip can narrate the framing
              // ("interruption inside Phanpy · visit 2 of 2").
              parent: e,
              // Capped at MEDIUM: containment frames — never confers,
              // never destroys. Structurally unreachable since the
              // tree-blind covered-HIGH guard (2026-07-24) — kept as a
              // defensive invariant.
              band: kid.k.band === "high" ? "medium" : kid.k.band,
              // Contained LOW sticks are retired (spec §6, 2026-08-07 second
              // pass): every child paints as a normal block now, LOW
              // included — stick paint is gone from containers entirely.
              stick: false,
              w: kid.kw,
              x: cursor + kid.kx,
            });
          }
          cursor += w + GAP;
          prevEnd = e.endTime;
        }
        if (item.kind === "cluster") {
          bars.push({ key: item.key, x: start, w: cursor - GAP - start });
        }
      }
    }
    const total = Math.max(cursor - GAP, 0);
    return { segs, plates, bars, gaps, dividers, total, ...axisOf(segs, gaps, dividers, total) };
  }

  // Ribbon X is NOT linear time (widths are floored), so each whole hour is
  // placed at the time-interpolated X within whichever block was active
  // then. Hours that fell between blocks already own uniform gap slots from
  // layout — the old clamp-to-edge case (which shingled labels when a
  // multi-hour absence stacked its hours on one x) no longer exists.
  // Now placed via layout()'s own coordinate system (axisOf) rather than a
  // duplicate interpolation of its own. Deliberately still SKIPS any hour
  // with no drawn geometry: an hour inside a band-dropped stretch or between
  // spans has no honest x, and inventing one would put a tick where nothing
  // is rendered. Hence the containment test rather than a bare timeToX call
  // (timeToX clamps to the nearest edge, which is right for anchoring and
  // wrong for tick placement).
  function hourMarks(segs, gaps, laid) {
    if (!segs.length) return [];
    const first = segs[0];
    const spans = [];
    for (const s of segs) {
      if (s.collapsed || s.w <= 0) continue;
      spans.push({ t0: s.e.startTime, t1: s.e.endTime });
    }
    for (const g of gaps) if (g.w > 0) spans.push({ t0: g.from, t1: g.to });
    const covered = (t) => spans.some((s) => t >= s.t0 && t <= s.t1);
    // First tick: the floor hour, sitting at the left edge of the pad (the
    // pad is absence, so it's gap-scaled) — a clean whole-hour label with
    // the first block proportionally inset.
    const floorT = first.e.startTime - msPastHour(first.e.startTime);
    const marks = [{ t: floorT, x: first.x - (msPastHour(first.e.startTime) / HOUR) * GAP_HOUR_PX }];
    const lastEnd = segs[segs.length - 1].e.endTime;
    for (let t = floorT + HOUR; t <= lastEnd; t += HOUR) {
      if (covered(t)) marks.push({ t, x: laid.timeToX(t) });
    }
    return marks;
  }

  // Consecutive same-host segments, for titling only. bestScore tracks the
  // strongest label-worthy member: HIGH blocks only (spec §6, 2026-08-08
  // revival) — fewer, wider runs than the old MEDIUM+ gate, which is what
  // makes horizontal (non-rotated) labels fit at all. Collapsed fence
  // sticks stay ineligible regardless of the member's own band.
  // Absence splits runs (2026-07-18, same constant as fences): morning and
  // evening Gmail clusters with nothing rendered between them are ADJACENT
  // in seg order, and an unsplit run centered its label over the 8-hour
  // away gap between them.
  function groupRuns(segs) {
    const runs = [];
    for (const seg of segs) {
      const labelWorthy = seg.band === "high" && !seg.collapsed;
      const memberScore = labelWorthy ? Math.max(seg.e.score, 1) : 0;
      // Runs join on the LABEL key, not the host (spec §6, 2026-07-25):
      // on a label-split host a Search run and a Maps run must answer to
      // their own names. Everywhere else labelKey === host.
      const labelKey = labelKeyOf(seg.e.host, seg.e.url);
      const last = runs[runs.length - 1];
      if (last && last.labelKey === labelKey && seg.e.startTime - last.lastEnd < VISIT_GAP_MS) {
        last.end = seg.x + seg.w;
        last.lastEnd = seg.e.endTime;
        last.bestScore = Math.max(last.bestScore, memberScore);
        last.members.push(seg.key);
      } else {
        runs.push({
          // Stable identity across expand/collapse (the first member's seg
          // key survives the toggle) so the title element can persist and
          // animate rather than being rebuilt.
          key: seg.e.host + ":" + seg.key,
          host: seg.e.host,
          labelKey,
          start: seg.x,
          end: seg.x + seg.w,
          lastEnd: seg.e.endTime,
          bestScore: memberScore,
          // Member seg keys (quick-label hover, 2026-08-08): lets the
          // instant per-block hover label skip blocks a persistent HIGH-run
          // title already covers, without re-deriving run membership on
          // every hover.
          members: [seg.key],
        });
      }
    }
    return runs.map((r) => ({ ...r, center: (r.start + r.end) / 2 }));
  }

  // Labels are importance-gated (spec §6, 2026-08-08 revival): only runs
  // holding a HIGH block earn a title — MEDIUM/LOW never label; tooltips
  // carry the rest. HIGH runs are naturally fewer and wider than the old
  // MEDIUM+ gate, which is what makes a horizontal (unrotated) label fit.
  //
  // Left-anchored width, not symmetric clearance: a run's label starts at
  // its own left edge and is allowed to run rightward OVER unlabeled
  // LOW/MEDIUM space, stopping only at the next HIGH run's left edge (its
  // anchor point — reserving that space regardless of whether the neighbor
  // ultimately keeps its own label) or the ribbon's right edge. This is
  // computed in x-order (spatial neighbor), independent of the score-order
  // pass below that decides which labels survive at all.
  //
  // Runs below TITLE_MIN_W are dropped outright — a sliver too narrow for
  // even an ellipsis is worse than no label. Remaining collisions (two
  // adjacent HIGH runs each too narrow even after claiming their full
  // available width) resolve by score: higher wins, loser is dropped —
  // never nudged, since a nudged label misaligns with its block.
  function titleRuns(runs, totalWidth) {
    const byX = runs.filter((r) => r.bestScore > 0).sort((a, b) => a.start - b.start);
    const withWidth = byX.map((r, i) => {
      const nextStart = i + 1 < byX.length ? byX[i + 1].start : totalWidth;
      return { ...r, maxW: Math.max(0, nextStart - r.start) };
    });
    const candidates = withWidth
      .filter((r) => r.maxW >= TITLE_MIN_W)
      .sort((a, b) => b.bestScore - a.bestScore);
    const placed = [];
    for (const run of candidates) {
      // A later-placed (lower-score) run may have its available width eaten
      // by an already-placed neighbor's anchor — re-clamped here rather
      // than trusting the original x-order maxW once collisions are in play.
      const nextAnchor = placed
        .map((p) => p.start)
        .filter((x) => x > run.start)
        .reduce((min, x) => Math.min(min, x), run.start + run.maxW);
      const maxW = nextAnchor - run.start;
      if (maxW < TITLE_MIN_W) continue;
      placed.push({ ...run, maxW });
    }
    return placed;
  }

  // --- Rendering. Block elements persist across expand/collapse keyed by
  // session id, so CSS transitions animate the fence stretching open in
  // place. Run titles persist too (2026-07-17), keyed by host + first
  // member, so they glide with their blocks instead of jumping; everything
  // else (plates, bars, ticks) is rebuilt.
  const blockEls = new Map();
  const titleEls = new Map();
  // Hover fences (spec §6, 2026-08-08): at most one fence expanded at a
  // time — hovering a new plate always replaces whichever run was open,
  // never adds to it. A single nullable key (not a Set) makes that the only
  // possible state instead of a rule callers have to remember to enforce.
  let expandedKey = null;
  // The expanded fence's own hit box in ribbon-local coordinates (spec §6
  // gap-scale/px-scale split doesn't matter here — layout() already resolved
  // it), refreshed each paint from bars[0]. mousemove tests the cursor
  // against this instead of relying on any DOM ancestor/descendant
  // relationship, since fence member blocks stay flat siblings under
  // #ribbon (no reparenting — see decisions/timeline_design.md hover-fence
  // entry for why: reparenting would fight the zoom path, which repaints on
  // every wheel tick via paint() directly, and the .transient sweep that
  // rebuilds plates/bars each paint would delete persisted block nodes
  // living inside a wrapper it also owns).
  let expandedBox = null; // {left, top, right, bottom} in #ribbon's own box, i.e. offsetLeft/offsetTop space
  let closeTimer = null;
  let openTimer = null;
  const FENCE_CLOSE_DELAY_MS = 400;
  const FENCE_OPEN_DELAY_MS = 400; // debounces a fly-by pass over a plate from expanding it
  let lastSessions = [];
  // Lock intervals (spec §3, 2026-08-08): fetched once by dashboard.js
  // alongside sessions and handed to render() as a second argument; cached
  // here the same way lastSessions is so the internal re-render call sites
  // (expand/collapse, Escape) don't need to re-fetch or
  // re-thread it.
  let lastLockIntervals = [];

  // Fences open on hover-in, close on hover-out. Open and close are
  // separate triggers now, not one toggle: hovering the collapsed plate
  // expands (after a short grace delay, so a fly-by mouse pass doesn't
  // spring it open — see scheduleOpen), immediately replacing any other
  // open fence; the cursor straying outside the expanded box (after its own
  // short grace delay, tracked by mousemove below) collapses.
  function expandFence(key) {
    if (expandedKey === key) return;
    if (closeTimer !== null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    expandedKey = key;
    render(lastSessions, lastLockIntervals);
  }

  function collapseFence() {
    closeTimer = null;
    if (expandedKey === null) return;
    expandedKey = null;
    expandedBox = null;
    render(lastSessions, lastLockIntervals);
  }

  // Debounced open: called on a plate's mouseenter. Mirrors scheduleCollapse
  // — only actually expands after the pointer has sat on the plate for the
  // full delay; mouseleave before then (cancelOpen) drops it silently.
  function scheduleOpen(key) {
    if (openTimer !== null) clearTimeout(openTimer);
    openTimer = setTimeout(() => {
      openTimer = null;
      expandFence(key);
    }, FENCE_OPEN_DELAY_MS);
  }

  function cancelOpen() {
    if (openTimer !== null) {
      clearTimeout(openTimer);
      openTimer = null;
    }
  }

  // Full reset (Escape, day paging): drop the open fence and any pending
  // open/close timer, so a stale timeout can't fire against a day that's no
  // longer on screen.
  function collapseAllFences() {
    cancelOpen();
    if (closeTimer !== null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    expandedKey = null;
    expandedBox = null;
  }

  // Single mousemove listener drives the hover-close: while a fence is
  // expanded, moving outside its box (re)starts a debounce timer; moving
  // back inside before it fires cancels it. No per-block listeners, no
  // ownership bookkeeping — expandedBox IS the fence's footprint, computed
  // once per paint from the same geometry the (now-removed) underline bar
  // used to draw.
  qs("ribbon").addEventListener("mousemove", (e) => {
    if (expandedKey === null || !expandedBox) return;
    const ribbon = qs("ribbon");
    const r = ribbon.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const inside =
      x >= expandedBox.left && x <= expandedBox.right && y >= expandedBox.top && y <= expandedBox.bottom;
    if (inside) {
      if (closeTimer !== null) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
    } else if (closeTimer === null) {
      closeTimer = setTimeout(collapseFence, FENCE_CLOSE_DELAY_MS);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // Escape releases the lock too (2026-08-25) — the card view already
    // taught Escape as a dismissal, and a pinned card is the same kind of
    // "committed-to" state a fence is.
    unlockTip();
    if (expandedKey !== null) {
      collapseAllFences();
      render(lastSessions);
    }
  });

  // --- Oldest loaded day: the floor for §7e's backward window walk. All
  // day-picking UI went in §8 Phase 1 (spec/display.md §6).
  const oldestDayStart = () =>
    lastSessions.length
      ? dayStartOf(Math.min(...lastSessions.map((s) => s.startTime)))
      : dayStartOf(Date.now());

  // --- Custom tooltip (spec §6, decisions/snapshot_implementation.md Part 1).
  // Native title tooltips have uncontrollable warm-up timing (~1s cold,
  // near-instant warm, any click resets it) — so ribbon elements carry
  // data-tip instead, shown by one delegated timer at a uniform delay.
  // Text lands via textContent only: titles/URLs are page-controlled.
  const TIP_DELAY_MS = 300;
  const tip = document.createElement("div");
  tip.id = "tip";
  tip.hidden = true;
  // Snapshot slot above the text lines (spec §6 snapshot previews). Fixed
  // children — only their content changes, so page-controlled strings still
  // land via textContent only.
  const tipImg = document.createElement("img");
  tipImg.id = "tip-img";
  tipImg.alt = "";
  tipImg.hidden = true;
  const tipText = document.createElement("div");
  tipText.id = "tip-text";
  tip.appendChild(tipImg);
  tip.appendChild(tipText);
  // Close (×) for the locked card, hidden while merely hovering — an
  // unlocked card is pointer-transparent, so a close button on it could
  // never be clicked anyway.
  const tipClose = document.createElement("div");
  tipClose.id = "tip-close";
  tipClose.textContent = "×";
  tipClose.hidden = true;
  tipClose.onclick = (ev) => {
    ev.stopPropagation();
    unlockTip();
  };
  tip.appendChild(tipClose);
  rootContainer().appendChild(tip);
  let tipTimer = null;
  // Bumped on every hide: async continuations below (storage fetch, image
  // decode) compare against it, so a stale hover can never resurrect a
  // dismissed tooltip or paint into a newer one.
  let tipSeq = 0;

  // --- Lock (2026-08-25). Clicking a block's lock icon pins the hover card
  // so it can be interacted with (it is pointer-transparent otherwise).
  //
  // Once locked, the card is deliberately INDEPENDENT OF CURSOR POSITION.
  // Tying its survival to the pointer would defeat the feature: the blocks
  // that most need locking are the narrow ones, and making the user hold a
  // few-pixel corridor on the way down to the card is exactly the care the
  // lock exists to remove. So leaving the block, the card, or the ribbon
  // does NOT close it.
  //
  // What does close it: an explicit dismissal (the icon again, or the
  // card's ×), or any pan/zoom. Pan/zoom isn't an arbitrary policy — the
  // card is anchored to a BLOCK's left edge, and those are precisely the
  // gestures that move blocks, so the anchor stops meaning anything.
  let lockedKey = null; // blockEls key of the locked block; null = not locked
  const isLocked = () => lockedKey !== null;
  // Whichever block's lock icon is currently revealed, so hideTip can put it
  // away without scanning every block. One at a time by construction — the
  // icon only ever shows for the block whose card is up.
  let shownLockBtn = null;

  // Guarded hide: while locked, ordinary hover dismissals (pointerout,
  // pointerdown, a new pointerover) must not tear the card down. Callers
  // that genuinely mean "close regardless" use hideTip({force:true}).
  function hideTip(opts) {
    if (isLocked() && !(opts && opts.force)) return;
    clearTimeout(tipTimer);
    tipTimer = null;
    tipSeq++;
    tip.hidden = true;
    tipClose.hidden = true;
    if (shownLockBtn) {
      shownLockBtn.hidden = true;
      shownLockBtn = null;
    }
  }

  // Lock icon click. Re-clicking the locked block's own icon releases it;
  // clicking a different block's icon is not reachable (plain hover is
  // suppressed while locked, so no other block's icon is ever showing).
  function toggleLock(key, el) {
    if (lockedKey === key) {
      unlockTip();
      return;
    }
    lockedKey = key;
    el.classList.add("locked");
    if (el._lockBtn) el._lockBtn.classList.add("on");
    tip.classList.add("locked");
    tipClose.hidden = false;
  }

  // Releases the lock and clears the card. Returns to plain hover: the next
  // pointerover repaints normally. Safe to call unlocked (no-op).
  function unlockTip() {
    if (!isLocked()) return;
    const el = blockEls.get(lockedKey);
    if (el) {
      el.classList.remove("locked");
      if (el._lockBtn) el._lockBtn.classList.remove("on");
    }
    lockedKey = null;
    tip.classList.remove("locked");
    hideTip({ force: true });
  }

  // Build the tooltip text area. Structured blocks carry _tipData (two
  // sections, spec §6); gaps/plates/bars carry a plain data-tip string.
  // One div per line, all content via textContent (injection rule).
  function fillTip(el) {
    tipText.textContent = "";
    const d = el._tipData;
    if (!d) {
      tipText.textContent = el.dataset.tip;
      return;
    }
    const line = (cls, text) => {
      const div = document.createElement("div");
      div.className = cls;
      div.textContent = text;
      tipText.appendChild(div);
    };
    line("tip-title", d.siteName);
    line("tip-meta", d.meta);
    for (const p of d.pages.slice(0, TIP_TITLES_MAX)) {
      // Title span ellipsizes; the debug score is its own span so a long
      // title can never truncate it away.
      const div = document.createElement("div");
      div.className = p.band === "low" ? "tip-page dim" : "tip-page";
      const t = document.createElement("span");
      t.className = "t";
      t.textContent = p.title;
      div.appendChild(t);
      if (TIP_DEBUG) {
        const sc = document.createElement("span");
        sc.textContent = Math.round(p.score);
        div.appendChild(sc);
      }
      tipText.appendChild(div);
    }
    if (d.pages.length > TIP_TITLES_MAX)
      line("tip-page dim", `+ ${d.pages.length - TIP_TITLES_MAX} more`);
    if (d.ctx) line("tip-meta", d.ctx);
    if (TIP_DEBUG) line("tip-debug", d.debug.join("\n"));
  }

  // Quick label (spec §6, 2026-08-08): hovering a LOW/MEDIUM block shows its
  // site name INSTANTLY, styled like a HIGH-run title (reuses the shared
  // .rtitle look) — lets a run of small blocks be swept by eye without
  // waiting out TIP_DELAY_MS per block. HIGH blocks are skipped; they
  // already carry a persistent .rtitle (data-run-labeled marks coverage,
  // set in the run-title render pass), and showing both would duplicate.
  // Deliberately omits .rtitle-clip: unlike the persistent run title, only
  // one quick label is ever on screen, so it has no sibling to collide with
  // and is allowed to overflow the ribbon/viewport edge rather than clip.
  const quickLabel = document.createElement("div");
  quickLabel.id = "quicklabel";
  quickLabel.className = "rtitle";
  quickLabel.hidden = true;
  quickLabel.style.top = TITLE_AREA - 16 - LABEL_GAP + "px";
  quickLabel.style.color = HIGH_RIM;
  qs("ribbon").appendChild(quickLabel);

  function hideQuickLabel() {
    quickLabel.hidden = true;
  }

  {
    const ribbonEl = qs("ribbon");
    ribbonEl.addEventListener("pointerover", (ev) => {
      // While locked, plain hover is suppressed entirely (2026-08-25): two
      // cards competing for the one parked slot would thrash, and a card
      // that swapped to whatever block the cursor grazed would not be
      // locked in any sense the user would recognize. Ordinary hover
      // resumes the moment the lock clears.
      if (isLocked()) return;
      // Twin of the pointerout guard below: re-entering from a child of the
      // same hover target (the lock icon) is not a new hover, and must not
      // tear down and re-arm the tip — that re-arm was half the flicker.
      {
        const to = ev.target.closest && ev.target.closest("[data-tip]");
        const from = ev.relatedTarget && ev.relatedTarget.closest
          ? ev.relatedTarget.closest("[data-tip]")
          : null;
        if (to && to === from) return;
      }
      hideTip();
      hideQuickLabel();
      // Panning suppresses hover UI entirely (spec §7h, 2026-08-24):
      // navigation and inspection are not simultaneous intents. The blocks
      // sliding past under a travelling cursor fire pointerover constantly;
      // without this they would each arm a tooltip for a block that is
      // already gone by the time it shows.
      if (ribbonEl.classList.contains("panning")) return;
      const el = ev.target.closest("[data-tip]");
      if (!el) return;
      const isOpenTab = el.classList.contains("open-tab");
      // No separate "collapsed tiles get no hover chrome" check needed
      // here (Active Tab Manager Phase 2, 2026-08-22 unification): paint()
      // already deletes dataset.tip on every block while heightMode is
      // "uniform" (Scott's call — flat click-to-switch symbols, no hover
      // at all) — those elements simply don't match this handler's own
      // `[data-tip]` selector above, so they never reach this line at all
      // while collapsed. Expanded (tiered) tiles fall through normally
      // below (real #tip snapshot), just with the floating quickLabel
      // duplicate suppressed (next check) since the site name is already
      // painted inline (.blk-label).
      // Open-tab tiles (2026-08-22) don't need the floating quick label —
      // it would duplicate their inline label.
      // Retired in the overlay (2026-08-25): redundant with §7b's always-on
      // .blk-label. Same gate/reason as runTitlesLive below; the standalone
      // dashboard keeps it (spec §6, 2026-08-08).
      const quickLabelLive = anchorMode !== "right";
      if (quickLabelLive && el._tipData && el.dataset.runLabeled !== "1" && !isOpenTab) {
        quickLabel.textContent = el._tipData.siteName;
        const left = parseFloat(el.style.left) || 0;
        quickLabel.style.left = left + "px";
        quickLabel.hidden = false;
      }
      // Anchored to the BLOCK, not the cursor (2026-08-25): captured here
      // at hover time, read after the awaits below. Using the element's own
      // viewport rect sidesteps the scroll-content-vs-viewport conversion
      // entirely (blocks live in #ribbon-wrap's scrolled space; #tip is
      // position: fixed) — the same trap cardExpandGeom handles by hand.
      const anchorEl = el;
      const seq = tipSeq;
      tipTimer = setTimeout(async () => {
        fillTip(el);
        tipImg.hidden = true;
        tipImg.removeAttribute("src"); // never flash the previous page's snapshot
        // Lazy snapshot fetch, decoded BEFORE showing (spec §6): the tooltip
        // is measured and viewport-clamped exactly once, at its final size —
        // an image popping in later would grow it past the clamp. One get()
        // for every candidate; the best-scoring member that HAS a picture
        // wins (top members can be unphotographed pre-navigation stubs).
        const ids = (el.dataset.snapIds || "").split(",").filter(Boolean);
        if (ids.length) {
          const keys = ids.map((id) => "snap:" + id);
          const r = await chrome.storage.local.get(keys).catch(() => ({}));
          const stored = keys.map((k) => r[k]).find(Boolean);
          if (stored && seq === tipSeq) {
            tipImg.src = stored;
            try {
              await tipImg.decode();
              tipImg.hidden = false;
            } catch {} // undecodable stored data: text-only
          }
        }
        if (seq !== tipSeq) return; // hover ended during the awaits
        // Measure at the origin: a fixed-position box shrink-to-fits against
        // the viewport edge, so measuring at the previous hover's leftover
        // `left` squeezes the tooltip (and its snapshot) near the right edge.
        tip.style.left = "0px";
        tip.style.top = "0px";
        tip.hidden = false;
        // Measure after content is set, then park it (2026-08-25): left edge
        // flush with the block's, top a fixed lane below the axis strip so it
        // can never cover the hour ticks/labels. Only the right edge is
        // clamped — a block near the viewport's right would otherwise push
        // the card off-screen. No bottom flip: the slot is below everything
        // already, and flipping it up would land it back on the ribbon.
        const r = tip.getBoundingClientRect();
        const wrapRect = qs("ribbon-wrap").getBoundingClientRect();
        let left = anchorEl.getBoundingClientRect().left;
        if (left + r.width > innerWidth - 4) left = Math.max(4, innerWidth - r.width - 4);
        tip.style.left = left + "px";
        tip.style.top = wrapRect.top + TITLE_AREA + BAND_H + AXIS_AREA + TIP_PARK_GAP + "px";
        // The lock icon rides the card: it appears with it and goes with
        // it, so the two read as one affordance rather than as a control
        // that's always sitting on the block.
        if (anchorEl._lockBtn) {
          anchorEl._lockBtn.hidden = false;
          shownLockBtn = anchorEl._lockBtn;
        }
      }, TIP_DELAY_MS);
    });
    ribbonEl.addEventListener("pointerout", (ev) => {
      // Crossing onto a child of the SAME hover target is not an exit
      // (2026-08-25). pointerout/pointerover are delegated on #ribbon and
      // bubble, so moving from a block onto its own lock icon fires a
      // matched out/over pair even though the cursor never visually left
      // the block. Unguarded, that tore the card (and the icon with it)
      // down the instant the cursor reached the icon — making the lock
      // literally unclickable — and the re-entering pointerover restarted
      // the tip timer, which together with the icon's own cursor:pointer
      // read as an arrow/hand flicker. relatedTarget is where the cursor
      // WENT; if that's still inside the same [data-tip], ignore it.
      const from = ev.target.closest && ev.target.closest("[data-tip]");
      const to = ev.relatedTarget && ev.relatedTarget.closest
        ? ev.relatedTarget.closest("[data-tip]")
        : null;
      if (from && from === to) return;
      hideTip();
      hideQuickLabel();
    });
    ribbonEl.addEventListener("pointerdown", () => {
      hideTip();
      hideQuickLabel();
    });
  }

  // Horizontal zoom (spec §6, 2026-08-08): vertical wheel/trackpad motion
  // over the ribbon zooms (deltaY), horizontal motion pans (deltaX) via the
  // wrap's native scrollLeft — a diagonal trackpad gesture decomposes into
  // both at once. The ribbon claims ALL wheel input while the cursor is
  // over it (preventDefault unconditionally) rather than passing vertical
  // scroll through to the page: the dashboard is a single-view page with
  // nothing below the ribbon to scroll to (spec §6 Layout).
  {
    const wrap = qs("ribbon-wrap");
    const ribbonEl = qs("ribbon");
    const ZOOM_SENSITIVITY = 0.0018; // wheel-delta-to-zoom-factor curve; retune to taste
    const ZOOM_IDLE_MS = 150; // quiet period after the last tick before .zooming lifts (re-arms .blk's transition)
    let pendingDy = 0;
    // Which wall the pan last stopped against: -1 (oldest), +1 ("now"), 0 none.
    // Latched, because pointermove fires on the faintest jitter and would
    // otherwise restart the pump straight back into the same wall.
    let panWall = 0;
    // Sub-pixel bank (see panTick): fractional movement the platform would
    // have rounded away, carried to the next frame instead.
    let panFrac = 0;
    // Geometry as of the last pan frame. When these stop matching paint()'s
    // live values, something relaid out under us and the carried timestamp —
    // not the remembered pixel — is what still means something.
    let panGeomTotal = -1;
    let panGeomPad = -1;
    let panGeomPadRight = -1;
    let rafId = null;
    let lastPointerX = 0;
    let idleTimer = null;
    const applyZoom = () => {
      rafId = null;
      // Zoom invalidates the lock's anchor (2026-08-25): the card is pinned
      // to a block's left edge, and zooming moves and rescales every block.
      unlockTip();
      const rect = wrap.getBoundingClientRect();
      // Anchor the pointer's x-FRACTION of the ribbon's total width across
      // the width change, so the timestamp under the cursor stays under it
      // (both time scales zoom by the same factor — a proportional-position
      // anchor tracks the same instant a true timestamp anchor would).
      // Left-justified at rest, by construction (spec §6, 2026-08-08 zoom
      // retry — a permanent left spacer was tried and reverted, see
      // index.html): the target scrollLeft computed below can go negative
      // when zooming very close to the left edge; assigning it is simply
      // clamped to 0 by the platform, so the left edge always wins with no
      // special-casing — the anchor point drifts slightly under the cursor
      // only in that edge case, self-correcting on the next tick.
      const viewportX = lastPointerX - rect.left; // cursor, relative to viewport
      // Ribbon coords = viewport + scroll - pad (the pad shifts content right,
      // so it must come off to get back to the axis's own coordinate space).
      const cursorX = viewportX + wrap.scrollLeft - lastPadPx;
      // Anchor on the INSTANT under the cursor (spec §7g). The earlier
      // width-fraction proxy assumed zoom scales the ribbon uniformly; it
      // deforms instead, so a fraction lands on a different time.
      const anchorT = axis ? axis.xToTime(cursorX) : null;
      zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * Math.exp(-pendingDy * ZOOM_SENSITIVITY)));
      pendingDy = 0;
      userAdjusted = true; // the user owns the view now — see applyDefaultZoomWindow
      // A zoom moves the walls: content that was flush against the right edge
      // may now overflow it. Clear the pan's wall latch so a cursor still
      // parked in an outer band can resume panning without first having to
      // cross to the other side of the viewport.
      panWall = 0;
      PX_PER_SEC = BASE_PX_PER_SEC * zoom;
      GAP_HOUR_PX = BASE_GAP_HOUR_PX * zoom;
      // paint() reads this while sizing the underflow pad — see pendingAnchor.
      pendingAnchor = anchorT != null ? { t: anchorT, viewportX } : null;
      relayout();
      pendingAnchor = null;
      // paint() just wrote lastTotalPx/lastPadPx — our own numbers, not a DOM
      // read-back that Chrome may not have flushed yet (see lastTotalPx).
      const newTotal = scrollableWidth() || 1;
      // Applied unconditionally, including when a day loaded during the
      // relayout above: a timestamp anchor survives prepending, unlike the
      // width fraction this replaced (spec §7g). timeToX is in ribbon coords,
      // so the left pad is added to reach viewport coords. No clamp to
      // maxScroll — the anchor outranks the right pin during a gesture, and
      // paint()'s trailing pad extends the range to make room.
      const target =
        anchorT != null && axis
          ? Math.max(0, axis.timeToX(anchorT) + lastPadPx - viewportX)
          : Math.max(0, newTotal - wrap.clientWidth);
      setScrollLeft(wrap, target);
      // The zoom just settled the viewport; that position is the anchor to
      // preserve if a day loads (spec §7e). Loading itself is triggered from
      // paint(), which is where the real laid-out total is known.
      captureFromRight(wrap);
    };
    // ---- Panning: edge-proximity pump (spec §7h, 2026-08-24) ----
    //
    // No targetable affordances. The ribbon pans by where the cursor RESTS: a
    // dead zone in the middle, then travel toward the nearer edge, faster the
    // closer the cursor sits to it. A hover STATE, not an event-driven
    // gesture — the cursor can be still while the view moves, hence the pump.
    //
    // PROVISIONAL knobs, to be play-tested — turn ONE at a time.
    // Middle 66.7%: no panning (0.5 → 0.667, 2026-08-25 — spec §7h,
    // decisions/tabmanager.md "First turn of the dead-zone knob").
    const PAN_DEAD_FRAC = 0.667;
    // Curve exponent. 1 = linear; higher keeps the ramp gentle across most of
    // the band and concentrates speed at the very edge. Replaces a three-zone
    // dead/slow/fast design, whose zone boundaries were felt as speed jerks
    // (spec §7h). The knob most likely to want turning.
    const PAN_CURVE = 2;
    // VIEWPORT-WIDTHS PER SECOND, not px/frame: a pixel rate would crawl
    // through minutes at 16x zoom and tear across days at 0.25x, when the felt
    // speed should be the same at every zoom level. Converted to px each frame
    // against the live viewport width, so it is zoom- AND load-invariant (the
    // viewport does not change when a day arrives).
    const PAN_MAX_RATE = 1.2;
    const PAN_MAX_FRAME_MS = 50; // dt clamp: a stalled tab must not teleport the view

    // The tunable core, kept pure and DOM-free so it can be read and reasoned
    // about on its own. Returns signed viewport-widths/sec: negative = pan
    // left (toward history), positive = right (toward now), 0 inside the dead
    // zone. Symmetric about the centre.
    function panRateFor(cursorX, viewportWidth) {
      if (!(viewportWidth > 0)) return 0;
      const f = cursorX / viewportWidth; // 0 = left edge, 1 = right edge
      const d = Math.abs(f - 0.5) * 2; // 0 at centre, 1 at either edge
      if (d <= PAN_DEAD_FRAC) return 0;
      // Normalize the live band to 0..1 so the curve spans it regardless of
      // how wide the dead zone is set.
      const t = (d - PAN_DEAD_FRAC) / (1 - PAN_DEAD_FRAC);
      const rate = Math.pow(Math.min(1, t), PAN_CURVE) * PAN_MAX_RATE;
      return f < 0.5 ? -rate : rate;
    }

    let panRaf = null;
    let panLastTs = 0;
    // The instant the pan is holding, used to re-base after a prepend or
    // relayout — scrollLeft is measured from the content's left edge, so a
    // prepended day invalidates it while a timestamp survives (spec §7h,
    // extending §7g's stance from zoom to pan). Live only during the pump;
    // fromRight stays the REST anchor, re-captured on stop as applyZoom does.
    let panT = null;
    // Arm-on-first-move (spec §7h): without this, an overlay opening with the
    // pointer already parked at an edge would start travelling before the user
    // touched anything, reading as the ribbon moving on its own.
    let panArmed = false;

    // Hover suppression is owned by MOTION, not cursor position (spec §7h,
    // corrected 2026-08-25 — resting in the ramp is not panning). Called
    // from panTick's first whole-pixel frame; cleared by stopPan.
    const markPanningMoved = () => {
      pannedMoved = true; // §7h load arm: real motion, not mere cursor entry
      if (ribbonEl.classList.contains("panning")) return;
      ribbonEl.classList.add("panning");
      unlockTip(); // pan invalidates the anchor (2026-08-25); plain hideTip is a no-op while locked
      hideTip();
      hideQuickLabel();
    };

    const stopPan = () => {
      if (panRaf != null) cancelAnimationFrame(panRaf);
      panRaf = null;
      panT = null;
      panLastTs = 0;
      panFrac = 0;
      panning = false;
      pannedMoved = false;
      if (ribbonEl.classList.contains("panning")) {
        ribbonEl.classList.remove("panning");
      }
    };

    const panTick = (ts) => {
      panRaf = null;
      if (!panArmed) return stopPan();
      const vw = wrap.clientWidth;
      const rate = panRateFor(lastPointerX - wrap.getBoundingClientRect().left, vw);
      if (rate === 0) return stopPan();
      // First tick establishes the clock without moving anything.
      const dt = panLastTs ? Math.min(PAN_MAX_FRAME_MS, ts - panLastTs) : 0;
      panLastTs = ts;
      const deltaPx = rate * vw * (dt / 1000);
      // Set once the pan actually moves something (dt > 0 — the first tick
      // only starts the clock): the user owns the view from here, so the
      // default window must never be re-solved underneath them. Merely
      // resting the cursor in a band, with the view clamped at a wall and
      // nothing moving, is not taking over.
      if (deltaPx !== 0) userAdjusted = true;

      // The pan owns the pixel position between geometry changes; the
      // timestamp is consulted ONLY when something relaid out under us, which
      // is the one moment a remembered pixel is meaningless. Re-deriving from
      // panT every frame instead is lossy enough to vibrate — the round trip
      // is compressive inside a floored block (spec §7h).
      const geomChanged =
        lastTotalPx !== panGeomTotal || lastPadPx !== panGeomPad || lastPadRightPx !== panGeomPadRight;
      let baseX;
      if (geomChanged && axis && panT != null) {
        baseX = axis.timeToX(panT) + lastPadPx; // re-base: the instant is what survived
        panFrac = 0; // banked sub-pixels refer to the old geometry — drop them
      } else {
        baseX = wrap.scrollLeft;
      }
      panGeomTotal = lastTotalPx;
      panGeomPad = lastPadPx;
      panGeomPadRight = lastPadRightPx;

      // scrollLeft stores at integer device-pixel resolution, so a fractional
      // write rounds and the remainder is lost — at the gentle end of the ramp
      // that is the whole frame's motion. Bank it instead: every rate reaches
      // the screen, with no artificial speed floor (spec §7h).
      panFrac += deltaPx;
      const wholePx = Math.trunc(panFrac);
      panFrac -= wholePx;
      const wanted = baseX + wholePx;
      // The clamp is the wall. At the far right ("now") and at the true end of
      // history there is nothing beyond. Before MAX_WINDOW_DAYS the proximity
      // load should have extended the range already, so the cache edge is
      // never felt — only the real edge of recorded time.
      const maxScroll = maxScrollOf(wrap);
      const target = Math.max(0, Math.min(maxScroll, wanted));
      // Hitting a wall ends the pan and latches which wall (spec §7h) — no
      // point running a 60fps loop against an edge. Only a frame that moved
      // whole pixels counts: wholePx === 0 is the clock-starting first tick or
      // a banked sub-pixel frame, neither of which is evidence of an edge.
      const clamped = wholePx !== 0 && target !== wanted;
      if (clamped) {
        panWall = rate < 0 ? -1 : 1;
        // Land exactly on the wall first: the last frame before stopping
        // should reach the edge, not stop a few px short of it.
        if (target !== wrap.scrollLeft) setScrollLeft(wrap, target);
        captureFromRight(wrap);
        return stopPan();
      }
      panWall = 0; // moved freely — no wall in play
      if (wholePx !== 0) markPanningMoved(); // real motion only (spec §7h)
      setScrollLeft(wrap, target);
      // Keep the carried instant fresh for the NEXT re-base. This is not read
      // again until geometry actually changes, so it never feeds back into the
      // position the way the old per-frame round trip did — one conversion
      // out, none back in. Skipped on sub-pixel frames (nothing moved to
      // re-record) to keep the common slow-creep path free of axis work.
      if (axis && wholePx !== 0) panT = axis.xToTime(target - lastPadPx);
      captureFromRight(wrap);
      // paint() asks this too, but only runs on a render and panning triggers
      // none — so the pump asks for itself. A question, not a command:
      // maybeLoadOlderDay owns every guard and usually does nothing.
      maybeLoadOlderDay(lastTotalPx);
      panRaf = requestAnimationFrame(panTick);
    };

    const startPan = () => {
      if (panRaf != null) return;
      panLastTs = 0;
      panFrac = 0;
      // Start from the live geometry, so the first frame takes the ordinary
      // scrollLeft path rather than spuriously re-basing off a timestamp that
      // was only just derived from that same position.
      panGeomTotal = lastTotalPx;
      panGeomPad = lastPadPx;
      panGeomPadRight = lastPadRightPx;
      panT = axis ? axis.xToTime(wrap.scrollLeft - lastPadPx) : null;
      // .panning is deliberately NOT set here — see markPanningMoved().
      panning = true; // gates maybeLoadOlderDay's proximity arm (spec §7h)
      panRaf = requestAnimationFrame(panTick);
    };

    wrap.addEventListener("pointermove", (ev) => {
      lastPointerX = ev.clientX;
      panArmed = true;
      // Tiered only — the collapsed strip's axis is categorical (Chrome tab
      // order, §7c), so time-based panning is meaningless there. Deliberately
      // NOT gated on anchorMode: the standalone dashboard gets panning too,
      // and the math holds there because both pads stay 0 outside the overlay
      // (spec §7h). Only the proximity LOAD arm is overlay-only.

      const rate = panRateFor(ev.clientX - wrap.getBoundingClientRect().left, wrap.clientWidth);
      if (rate === 0) {
        panWall = 0; // back in the dead zone: whatever wall we held is moot
        if (panRaf != null) stopPan();
        return;
      }
      // Held against a wall (see panWall): only a cursor calling for the
      // OTHER direction re-arms the pump. Jitter in the same direction is
      // ignored, which is what keeps the wall from shaking.
      if (panWall !== 0 && Math.sign(rate) === panWall) return;
      panWall = 0;
      startPan();
    });
    // Pointer gone: the view must not drift on while the user is doing
    // something else entirely.
    wrap.addEventListener("pointerleave", () => {
      panArmed = false;
      stopPan();
    });

    // Panning moves the anchor, and as of §7h (2026-08-24) it ALSO reaches
    // history: paint()'s load check now has a proximity arm alongside §7e's
    // capacity arm. The gesture itself still knows nothing about loading —
    // paint() decides, exactly as it does for zoom.
    wrap.addEventListener("scroll", () => {
      // Panning invalidates the lock's anchor (2026-08-25), same reasoning
      // as the zoom hook. Hooked HERE rather than in the pan pump because
      // every pan path lands in scrollLeft — edge-pan (panTick), trackpad
      // deltaX, and keyboard/programmatic alike — so one listener catches
      // them all with no gaps. Ahead of the anchorMode guard (a lock is
      // just as invalid when left-anchored) but behind selfScrolling: our
      // own scroll assignments echoing back are not user navigation.
      if (selfScrolling) return; // our own assignment echoing back
      unlockTip();
      if (anchorMode !== "right") return;
      captureFromRight(wrap);
    });
    wrap.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        wrap.scrollLeft += ev.deltaX;
        if (ev.deltaY) {
          lastPointerX = ev.clientX;
          pendingDy += ev.deltaY;
          // .zooming suspends .blk's day-paging transition for a crisp
          // real-time zoom (index.html); lifts ZOOM_IDLE_MS after the last
          // tick so ordinary re-renders (day paging etc.) keep animating.
          ribbonEl.classList.add("zooming");
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => ribbonEl.classList.remove("zooming"), ZOOM_IDLE_MS);
          if (rafId == null) rafId = requestAnimationFrame(applyZoom);
        }
      },
      { passive: false }
    );
  }

  // Zoom-only relayouts (below) must skip thread (re)assembly — it's real
  // work (merge/container/atomicity passes), not just geometry — so the
  // last assembly is cached here, invalidated whenever render() runs for
  // an actual reason (new data, day paging, fence expand/collapse).
  let lastAssembly = null; // { sessions, dayThreads, hostNames, events }

  // Ribbon default resting window (spec §7c, 2026-08-22; corrected same
  // day — the first cut computed zoom from a pure TIME-span estimate,
  // which ZOOM_MAX clamping and min-width-floor/gap error could silently
  // blow past, showing far more than DEFAULT_WINDOW_BLOCKS (caught via a
  // real specimen: 22 blocks shown instead of 12). This version uses
  // layout()'s REAL pixel output directly — two layout() passes (initial
  // probe, then one at the solved zoom), both O(n), no search/iteration —
  // so "the 12th-from-last block's left edge sits at the viewport's left
  // edge" is exact, not approximated, and the scroll position is set
  // explicitly to that edge rather than relying on a coincidental
  // right-justify (render()'s own scrollLeft reset showed whatever fit at
  // whatever zoom resulted, not necessarily this window). Still a
  // deliberately simple heuristic otherwise — no fence-detection pass, no
  // secondary adjustment (decisions/tabmanager.md "Strip ordering
  // rethink").
  const DEFAULT_WINDOW_BLOCKS = 12;
  // Applied once per page lifetime, not on every render — recomputing it
  // on every new event/tick would fight a user's own manual zoom/scroll,
  // which is supposed to be the correction mechanism from here on.
  let defaultZoomApplied = false;
  // Returns the scrollLeft that puts the window's left edge at the
  // viewport's left edge, given the CURRENT zoom/PX_PER_SEC — null if there
  // aren't enough events to have a meaningful window. Used only as
  // applyDefaultZoomWindow's probe now (§7d dropped it as a resting
  // position); never mutates zoom itself.
  function windowScrollLeft(events, lockIntervals) {
    if (events.length <= DEFAULT_WINDOW_BLOCKS) return null;
    const sorted = [...events].sort((a, b) => a.startTime - b.startTime);
    const windowStartTime = sorted[sorted.length - DEFAULT_WINDOW_BLOCKS].startTime;
    // Uses layout()'s own coordinate system (axisOf) rather than re-deriving
    // the position by scanning segs — same answer, one shared mechanism.
    return layout(clusterEvents(sorted, lockIntervals), null).timeToX(windowStartTime);
  }
  // Sets zoom (once per page lifetime) so DEFAULT_WINDOW_BLOCKS fill the
  // viewport. Since 2026-08-23 (spec §7d) render() right-pins unconditionally,
  // so this no longer needs a scrollLeft of its own — the pin at this zoom IS
  // the default window. Return value is now advisory; no caller reads it.
  function applyDefaultZoomWindow(events, wrap) {
    if (defaultZoomApplied || !events.length || !wrap) return false;
    defaultZoomApplied = true;
    if (events.length <= DEFAULT_WINDOW_BLOCKS) return false; // everything already fits at zoom=1
    // Probe pass at the current (usually zoom=1) scale to find the
    // window's real pixel width, then solve for the zoom that makes that
    // width exactly fill the viewport.
    const probeLeft = windowScrollLeft(events, lastLockIntervals);
    if (probeLeft == null) return false;
    const probeTotal = layout(clusterEvents(events, lastLockIntervals), null).total;
    const naturalPx = probeTotal - probeLeft;
    if (naturalPx <= 0) return false;
    const viewportPx = Math.max(wrap.clientWidth, 1);
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, viewportPx / naturalPx));
    PX_PER_SEC = BASE_PX_PER_SEC * zoom;
    GAP_HOUR_PX = BASE_GAP_HOUR_PX * zoom;
    // A ZOOM_MIN/MAX clamp here just means more or fewer than 12 blocks at
    // rest; under the right-pin that degrades on its own (spec §7d).
    return true;
  }

  function render(sessions, lockIntervals) {
    lastSessions = sessions;
    // lockIntervals is optional per call (internal re-renders omit it and
    // rely on the cache); only overwrite the cache when the caller actually
    // passed something, so expandFence()/collapseFence()/day-paging/Escape
    // don't need to know about it at all.
    if (lockIntervals !== undefined) lastLockIntervals = lockIntervals;
    // One quiet assembly of every stored day feeds the strip; the viewed
    // day re-assembles loud below (identical functions, identical inputs —
    // kept separate so the worker-console transit/container logs stay tied
    // to the day on screen).
    const dayThreads = threadsByDay(sessions);
    // On-block labels are retired in favor of favicons (spec §6,
    // 2026-08-07) — computeHostNames now serves the tooltip's site name
    // only; the label-rendering pass itself is gone.
    const hostNames = computeHostNames(sessions, isTransit);
    // windowStart spans multiple days in the overlay (spec §7e); it equals
    // viewDayStart everywhere else, so this is the historical single-day call.
    const events = assembleThreads(parseSessions(sessions, viewDayStart, windowStart));
    lastAssembly = { sessions, dayThreads, hostNames, events };
    const wrap = qs("ribbon-wrap");
    // Ribbon default window (spec §7c; bug fix 2026-08-22, SAME root cause
    // as the earlier "22 blocks not 12" bug — a one-shot gate consumed too
    // early): only meaningful for the overlay (anchorMode "right") AND
    // only once the ribbon is actually what's showing (heightMode ===
    // "tiered") — the overlay's FIRST-EVER render() call happens at page
    // MOUNT, while still collapsed (switcher.js calls paintRibbon()
    // immediately, heightMode starts "uniform"). Without this gate,
    // defaultZoomApplied's one-shot fired then — against whatever
    // sessions/viewport happened to exist at mount — and was permanently
    // spent by the time the user actually expanded, so the real first
    // expand got NO default-window treatment at all (real specimen: 26+
    // blocks shown on expand). Applied BEFORE paint() so the very first
    // TIERED paint (the real first expand) already reflects it, not a
    // post-paint correction.
    if (anchorMode === "right") applyDefaultZoomWindow(events, wrap);
    paint(events, hostNames);
    // A real render (new data, day paging, fence toggle — never a zoom
    // relayout, which calls paint() directly) always resets to the resting
    // edge (spec §6, 2026-08-08; anchorMode split spec §7b, 2026-08-21):
    // left-justified for the standalone dashboard (the day's first event
    // flush against the viewport's left edge, regardless of wherever
    // zoom/pan left the scroll position on the previous day — visual
    // stability across day paging, not a preserved viewport); the overlay
    // RIGHT-pins to "now" (spec §7d, 2026-08-23) on every render, first
    // included — applyDefaultZoomWindow sets the zoom, the pin shows it, so
    // it no longer needs a scrollLeft of its own. Zoom LEVEL is never reset
    // here, so re-renders don't fight a manual zoom.
    //
    // Uniform mode is ALWAYS left-justified (scrollLeft: 0) — bug fix,
    // spec §7c, 2026-08-22 (real specimen: all 4 pinned tabs + the first
    // regular tab were invisible, scrolled off past the left edge). The
    // previous version right-justified uniform mode too (reasoning at the
    // time: "Chrome-order rightmost slot is always correct") — wrong: a
    // real Chrome tab bar never hides its FIRST (pinned) tabs by default,
    // it rests showing them from the left. Right-justifying a Chrome-
    // order strip was importing the RIBBON's own "show 'now'" logic into
    // an axis (categorical tab order) where "now" has no meaning at all.
    if (wrap) {
      // Skipped while a zoom gesture owns positioning (pendingAnchor set): a
      // day loaded mid-zoom would otherwise be positioned here by fromRight
      // (edge-relative) only for applyZoom to immediately reposition it by
      // the time anchor — wasted work, and a frame positioned by the wrong
      // rule. At rest pendingAnchor is null and this is the resting pin.
      // `panning` extends the same rule to the pan pump (spec §7h): the pump's
      // next frame re-bases off its carried instant, so positioning here by
      // fromRight would only be undone.
      if (anchorMode === "right") {
        if (!pendingAnchor && !panning) applyFromRight(wrap);
      } else wrap.scrollLeft = 0;
    }
  }

  // The paint-only path (spec §6, 2026-08-08 zoom): layout + DOM diff on an
  // already-assembled event list — no thread/container/label work. Shared
  // by render() (fresh assembly) and relayout() (zoom, same assembly).
  function paint(events, hostNames) {
    // Every paint rebuilds plates from scratch (.transient sweep below), so
    // a pending open-delay timer's plate element may be gone by the time it
    // would fire (periodic refresh, zoom, day paging) without ever getting
    // its mouseleave — cancel rather than let it fire against a dead plate.
    cancelOpen();
    let segs, plates, bars, gaps, dividers, total;
    {
      // Fences reinstated (spec §6, 2026-08-08): LOW runs collapse to sticks
      // again, with two independent split rules (clusterEvents: a recorded
      // lock interval unconditionally splits; otherwise FENCE_IMPLIED_BREAK_MS
      // gates bridging) — see decisions/timeline_design.md for why. lastLockIntervals
      // is read directly (closure) rather than threaded as a paint() param,
      // since relayout() (zoom) calls paint() without re-fetching data.
      const items = clusterEvents(events, lastLockIntervals);
      const laid = layout(items, expandedKey);
      ({ segs, plates, bars, gaps, dividers, total } = laid);
      // Publish this layout's coordinate system for callers outside layout()
      // (applyZoom's time anchor, windowScrollLeft). Always the CURRENT one:
      // it is replaced on every paint, so a stale axis can't outlive the
      // geometry it describes — the same discipline as lastTotalPx.
      axis = laid;
    }

    const ribbon = qs("ribbon");
    const bandBottom = TITLE_AREA + BAND_H;
    ribbon.style.width = total + "px";
    // Right-pin underflow pad (spec §7d, 2026-08-23): holds the right edge
    // when content is too narrow to scroll. 0 whenever it overflows, so the
    // scrollable regime is untouched. Overlay + tiered only — same gate as
    // render()'s scroll reset.
    const padWrap = qs("ribbon-wrap");
    let padPx = 0;
    let padRightPx = 0;
    if (anchorMode === "right") {
      const vw = padWrap ? padWrap.clientWidth : 0;
      const slack = Math.max(0, vw - total);
      if (pendingAnchor && axis) {
        // During a zoom gesture the anchor outranks the right pin (spec §7g).
        // Two pads, because scrollLeft alone cannot express the anchor at
        // either extreme: the LEFT pad shifts content right when there is
        // nothing to scroll; the TRAILING pad extends the scroll range so the
        // platform's own clamp to scrollWidth-clientWidth stops silently
        // re-pinning the right edge as zoom-out shrinks that range.
        const anchorX = axis.timeToX(pendingAnchor.t);
        padPx = Math.max(0, pendingAnchor.viewportX - anchorX);
        const wantScroll = Math.max(0, anchorX + padPx - pendingAnchor.viewportX);
        padRightPx = Math.max(0, wantScroll + vw - (total + padPx));
      } else {
        // At REST the pad reverts to flush-right: the pin is deferred, not
        // abandoned. Nothing eases back on its own after a gesture.
        padPx = slack;
      }
    }
    ribbon.style.marginLeft = padPx + "px";
    ribbon.style.marginRight = padRightPx + "px";
    // Authoritative geometry for every scroll calculation — see lastTotalPx.
    // Written here, at the same moment the style is set, so the two can never
    // disagree the way a scrollWidth read-back could.
    lastTotalPx = total;
    lastPadPx = padPx;
    lastPadRightPx = padRightPx;
    ribbon.style.height = bandBottom + AXIS_AREA + "px";
    qs("ribbon-empty").hidden = segs.length > 0;

    ribbon.querySelectorAll(".transient").forEach((el) => el.remove());

    const seen = new Set();
    for (const s of segs) {
      // Contained children sit at one uniform height regardless of band
      // (spec §6, 2026-08-07) — containment frames, never confers stature;
      // standalone blocks, collapsed sticks, and expanded fence members
      // keep the three-way tier heights.
      seen.add(s.key);
      let el = blockEls.get(s.key);
      if (!el) {
        el = document.createElement("div");
        el.className = "blk";
        ribbon.appendChild(el);
        blockEls.set(s.key, el);
      }
      const h =
        s.contained ? CONTAIN_CHILD_H : TIER_H[s.band];
      // Importance, not identity, drives fill/border now (spec §6,
      // 2026-08-07; three-step ladder restored 2026-08-08): each tier gets
      // its own luminance step (TIER_FILL/TIER_RIM) — MEDIUM and LOW no
      // longer share one "dim" pair, they were running together visually.
      // Hue is retired; favicons carry identity instead. Sticks (fence or
      // contained-LOW; both currently dormant) paint their own fill
      // regardless of band.
      const fill = s.collapsed || s.stick ? STICK_FILL : TIER_FILL[s.band];
      // Children draw on top of their container; persistent els can be in
      // any DOM order, so z-index does it (cleared when not contained).
      el.style.zIndex = s.contained ? 2 : "";
      // Snap to the pixel grid at paint time (layout stays fractional):
      // sub-pixel edges anti-alias, which reads as fuzz on narrow blocks.
      // Rounding the right edge (not the width) keeps snapped neighbors
      // adjacent.
      const topInset = s.contained ? CONTAIN_INSET : 0;
      const bottomInset = s.contained ? CONTAIN_BOTTOM_INSET : 0;
      el.style.left = Math.round(s.x) + "px";
      el.style.width = Math.round(s.x + s.w) - Math.round(s.x) + "px";
      // Below MIN_W a block is a presence indicator, not a target (spec §7e):
      // a 1-4px hover target is worse than none — the user tries, misses, and
      // reads the UI as broken. Zooming back in restores both size and hover.
      el.classList.toggle("inert", s.w < MIN_W);
      el.style.top = bandBottom - h + topInset + "px";
      el.style.height = h - topInset - bottomInset + "px";
      // Containers paint like any other solid block (spec §6, 2026-07-17 —
      // wash retired); contained children are cut out of the interior by a
      // page-background seam (.cut CSS carries the width) and inset off the
      // container's top/bottom edges (spec §6, 2026-08-02).
      el.classList.toggle("cut", !!s.contained);
      // .open-tab: always false since §8 Phase 1 removed open-tab tagging;
      // kept for the parking lot to feed (spec/ribbon.md §7c-ribbon).
      el.classList.toggle("open-tab", !!s.e.isOpenTab);
      el.style.background = fill;
      // Sticks paint the border in their own fill — at 3px wide a 1px
      // outline IS the stick, so "borderless" means border = fill. Dormant
      // path since fences and contained LOW sticks both retired (spec §6,
      // 2026-08-07 second pass) — s.stick is never true from the current
      // layout, kept for a fence/stick revert.
      el.style.backgroundClip = s.stick ? "padding-box" : "";
      // Earned-HIGH border (spec §6, 2026-08-07): the container/block
      // itself, never its contained children — this marks how the THREAD
      // reached HIGH, a fact about the frame, not about any one interior
      // moment (which already has its own display treatment). Gold
      // replaces the tier's own rim rather than layering on it.
      const earned =
        s.band === "high" && !s.contained && !s.collapsed && !s.stick && hasEarnedHigh(s.e);
      el.classList.toggle("earned-high", earned);
      el.style.borderColor = s.stick
        ? "transparent"
        : s.contained
          ? PAGE_BG
          : s.collapsed
            ? STICK_FILL
            : earned
              ? EARNED_RIM
              : TIER_RIM[s.band];
      // heightMode "uniform" (2026-08-22): the whole strip reads as flat,
      // static Chrome-tab symbols — click to switch, no hover chrome at
      // all (Scott's call, Active Tab Manager Phase 2). Same no-tooltip
      // treatment as a fence-collapsed stick (s.collapsed, below), just
      // gated by strip mode instead of fence state.
      if (s.collapsed) {
        // Collapsed sticks carry neither text nor snapshot (spec §6: the
        // expand toggle doubles as the snapshot gate).
        delete el.dataset.tip;
        delete el.dataset.snapIds;
        delete el._tipData;
      } else {
        // Blocks get the structured two-section tooltip as a JS property;
        // data-tip stays (empty) as the hover marker. Gaps/plates/bars keep
        // plain data-tip strings — fillTip falls back for those.
        el.dataset.tip = "";
        // Contained children narrate their framing: whose session they
        // interrupted, and — when the same site interrupted more than once —
        // which round trip this one was (the ribbon can't show a sub-pixel
        // anchor-return between floored children; the hover explains it).
        let ctx = null;
        if (s.contained && s.parent) {
          const sibs = s.parent.children.filter((c) => c.host === s.e.host);
          const pname = hostNames.get(labelKeyOf(s.parent.host, s.parent.url)) || s.parent.host;
          ctx =
            `↩ interruption inside ${pname}` +
            (sibs.length > 1 ? ` · visit ${sibs.indexOf(s.e) + 1} of ${sibs.length}` : "");
        }
        el._tipData = tipDataOf(s.e, hostNames.get(labelKeyOf(s.e.host, s.e.url)) || s.e.host, ctx);
        // Snapshot candidates, best first: merges/containers carry snapIds
        // (members in score order); raw blocks, contained children, and
        // expanded fence members are their own only candidate. Ids are
        // UUIDs — comma-join is unambiguous.
        el.dataset.snapIds = (s.e.snapIds || [s.e.id]).join(",");
      }
      // Collapsed sticks are inert; their cluster's plate is the one target.
      // Every visible block navigates — expanded fence members included
      // (spec §6: click means "open this page" everywhere; collapse is the
      // expand bar or Escape). A block tagged isOpenTab (2026-08-22
      // unification; tagging corrected same day — see markOpenTabs)
      // represents a tab the user ALREADY HAS open: switching to it, never
      // chrome.tabs.create, which would open a duplicate. Same
      // never-calls-chrome.tabs.*-directly-except-switch rule the retired
      // open-tabs-only pipeline followed (spec §7).
      // Sub-MIN_W blocks are presence indicators, not targets (spec §7e).
      // Enforced HERE, not by .inert: inline beats the stylesheet rule.
      el.style.pointerEvents = s.collapsed || s.w < MIN_W ? "none" : "auto";
      el.onclick = s.collapsed
        ? null
        : s.e.isOpenTab
          ? () => chrome.runtime.sendMessage({ type: "FS_SWITCH_TAB", tabId: s.e.openTabId ?? s.e.tabId })
          : () => chrome.tabs.create({ url: s.e.url });

      // Lock affordance (2026-08-25). Created lazily per block and kept on
      // the element; shown only while this block's card is up (see the
      // pointerover/pointerout wiring). Suppressed below LOCK_MIN_BLOCK_W —
      // the icon would overflow onto neighbors — and on collapsed sticks,
      // which are inert.
      const lockable = !s.collapsed && s.w >= LOCK_MIN_BLOCK_W;
      if (lockable) {
        if (!el._lockBtn) {
          const btn = document.createElement("div");
          btn.className = "blk-lock";
          btn.textContent = "🔒";
          btn.hidden = true;
          // stopPropagation, or this rides the block's own navigate click
          // and opens the page instead of locking. Same guard the card
          // view's close button and snapshot already use.
          btn.onclick = (ev) => {
            ev.stopPropagation();
            toggleLock(s.key, el);
          };
          // The block's pointerdown handler hides the tip; without this the
          // card would be torn down before the lock click ever landed.
          btn.onpointerdown = (ev) => ev.stopPropagation();
          el.appendChild(btn);
          el._lockBtn = btn;
        }
        el._lockBtn.classList.toggle("on", lockedKey === s.key);
      } else if (el._lockBtn) {
        // Block shrank below the threshold (or collapsed) — drop the icon.
        // Clear shownLockBtn if it was this one, so hideTip can't later
        // reach through a detached node. Zoom already unlocks before any
        // repaint gets here, so this is belt-and-braces rather than a live
        // path — but a dangling reference would outlive the element.
        if (shownLockBtn === el._lockBtn) shownLockBtn = null;
        el._lockBtn.remove();
        el._lockBtn = null;
      }
      el.classList.toggle("locked", lockedKey === s.key);
    }
    for (const [key, el] of blockEls) {
      if (!seen.has(key)) {
        // A locked block leaving the layout takes its lock with it — the
        // card is anchored to an element that no longer exists.
        if (lockedKey === key) unlockTip();
        if (el._lockBtn && shownLockBtn === el._lockBtn) shownLockBtn = null;
        el.remove();
        blockEls.delete(key);
      }
    }

    // Invisible hover plate over each gap region: the exact away-span, same
    // tooltip-as-ground-truth convention as blocks. Not clickable, and
    // appended BEFORE fence plates so a hole inside a collapsed fence still
    // expands on click (the fence plate wins the overlap).
    //
    // ONLY departures get a plate (spec §6, 2026-07-28): FENCE_BRIDGE_GAP_MS
    // gates the tooltip — under it a break the timeline doesn't annotate,
    // over it a departure that earns "away 12:04 – 1:38". Sub-threshold gaps
    // were tedious hover targets whose duration the width already implies;
    // a week of data had 14 of them inside fences alone. **No longer a pure
    // subset relationship (2026-08-08):** a recorded lock interval always
    // splits a fence (clusterEvents), so a lock-bounded gap can never end up
    // inside a bridged fence — but FENCE_IMPLIED_BREAK_MS (60min, unlocked
    // gaps only) is now looser than FENCE_BRIDGE_GAP_MS (30min), so an
    // ordinary unlocked gap CAN be both bridged into a fence AND long enough
    // to clear this loop's threshold — a 45-minute unlocked gap fences (it's
    // under the 60min implied-break bar) yet still earns an away-plate (it's
    // over the 30min plate bar). The two thresholds no longer move together.
    for (const g of gaps) {
      if (g.to - g.from < FENCE_BRIDGE_GAP_MS) continue;
      const el = document.createElement("div");
      el.className = "gap transient";
      el.style.left = g.x + "px";
      el.style.width = g.w + "px";
      el.style.top = TITLE_AREA + "px";
      el.style.height = BAND_H + "px";
      el.dataset.tip = `away ${fmtClock(g.from)} – ${fmtClock(g.to)} · ${fmtDuration(g.to - g.from)}`;
      ribbon.appendChild(el);
    }

    // Day dividers (spec §7e, 2026-08-23): fixed-width break carrying a
    // rotated day name. Full ribbon height — it separates days, it isn't an
    // event in a band.
    for (const d of dividers) {
      const el = document.createElement("div");
      el.className = "dayline transient";
      el.style.left = d.x + "px";
      el.style.width = d.w + "px";
      el.style.height = bandBottom + "px";
      el.dataset.tip = new Date(d.at).toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
      const label = document.createElement("span");
      label.textContent = d.label;
      el.appendChild(label);
      ribbon.appendChild(el);
    }

    // Invisible hit plate spanning each collapsed fence: hover-open target
    // (spec §6 hover fences, 2026-08-08 — click retired). Hovering always
    // replaces whichever fence was previously expanded; see expandFence.
    for (const p of plates) {
      const el = document.createElement("div");
      el.className = "plate transient";
      el.style.left = p.x + "px";
      el.style.width = Math.max(p.w, MIN_W) + "px";
      el.style.top = TITLE_AREA + "px";
      el.style.height = BAND_H + "px";
      const active = p.members.reduce((t, m) => t + m.durMs, 0);
      // Span is narrated only when it materially exceeds the attended time —
      // a bridged fence can cover hours, and "7 brief visits · 4m" alone
      // would imply four continuous minutes.
      const span = p.members[p.members.length - 1].endTime - p.members[0].startTime;
      const spanNote = span >= active * 2 + 60000 ? ` over ${fmtDuration(span)}` : "";
      // A singleton stick isn't a run of "brief visits" — name the page.
      el.dataset.tip =
        p.members.length === 1
          ? `${p.members[0].host} · ${fmtDuration(active)}`
          : `${p.members.length} brief visits · ${fmtDuration(active)}${spanNote}`;
      el.addEventListener("mouseenter", () => scheduleOpen(p.key));
      el.addEventListener("mouseleave", cancelOpen);
      ribbon.appendChild(el);
    }

    // Expanded run's hit box (spec §6 hover fences, 2026-08-08): at most one
    // fence is ever expanded, so at most one bars entry exists. No visual
    // element draws it (the underline bar is retired — the sprung-open
    // blocks read as "this group opened" on their own); it exists purely so
    // the document-level mousemove listener knows the footprint the cursor
    // has to leave before the close-debounce starts.
    expandedBox = bars.length
      ? { left: bars[0].x, right: bars[0].x + bars[0].w, top: TITLE_AREA, bottom: bandBottom }
      : null;

    // axis is null in strip mode (categorical, no time axis) — no hour ticks
    // there, which is already the case: uniform mode reserves no axis area.
    const marks = axis ? hourMarks(segs, gaps, axis) : [];
    let lastLabelRight = -Infinity;
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      const tick = document.createElement("div");
      tick.className = "tick transient";
      // Snap: a 1px line on a fractional x anti-aliases into a 2px smear.
      tick.style.left = Math.round(m.x) + "px";
      tick.style.top = bandBottom + TICK_TOP + "px";
      tick.style.height = TICK_H + "px";
      ribbon.appendChild(tick);
      const label = document.createElement("div");
      label.className = "hlabel transient";
      // Centered under the tick (2026-07-17): tick row on top, label row
      // below — each label owns its full inter-mark column instead of
      // racing the next tick in the same lane.
      label.style.top = bandBottom + TICK_TOP + TICK_H + 2 + "px";
      // Room-keyed format (spec §6): try the full "9am" form; drop to the
      // bare number only when its MEASURED half-width + clearance spills
      // past the midpoint to the NEXT mark (which runs the same symmetric
      // test). Room is geometry, not gap membership — an hour in a 10-min
      // gap with no neighbor for a presence-hour keeps its meridiem. Only
      // next is tested: a run's LAST label is where its meridiem lives
      // ("… 3 4 5pm"), and demoting it against prev would strip the whole
      // run of its anchor.
      label.textContent = fmtHour(m.t);
      ribbon.appendChild(label);
      const next = marks[i + 1];
      let w = label.getBoundingClientRect().width;
      if (next && w / 2 + LABEL_CLEARANCE > (next.x - m.x) / 2) {
        label.textContent = String(hourNum(m.t));
        w = label.getBoundingClientRect().width;
      }
      label.style.left = Math.max(0, m.x - w / 2) + "px";
      // Thinning backstop (spec §6): a label overlapping the last survivor
      // drops, never nudges. Ticks are never thinned — the countable-hours
      // property is tick-borne. The backstop guards against literal
      // overlap only (2px), NOT the format test's LABEL_CLEARANCE: a
      // run-ending "5pm" legitimately reaches back toward its bare
      // neighbor, and full clearance here deleted it.
      if (m.x - w / 2 < lastLabelRight + 2) label.remove();
      else lastLabelRight = m.x + w / 2;
    }

    // HIGH-run labels, revived horizontal (spec §6, 2026-08-08): retired
    // 2026-08-07 in favor of favicon-only identity, brought back gated to
    // HIGH runs only (rare/wide enough that a horizontal line fits, unlike
    // the old MEDIUM+ rotated strip). Persistent titles (2026-07-17): an
    // existing title GLIDES to its new left in sync with the blocks; a
    // brand-new one fades in; a departed one fades out.
    const liveTitles = new Set();
    // Blocks a persistent run title already covers (quick-label hover,
    // 2026-08-08): the instant per-block label skips these, so a HIGH
    // block never shows two overlapping labels.
    const runLabeledKeys = new Set();
    // Suppressed entirely in the open-tabs overlay (Active Tab Manager
    // Phase 2 cleanup, 2026-08-22): every block there already carries its
    // own always-on .blk-label (spec §7b) PLUS the existing hover tooltip/
    // snapshot — a third, floating title on top of both is pure
    // duplication, for real closed-history HIGH runs same as for open
    // tabs (confirmed against a real specimen: a closed-history "Gemini"
    // block still showed the floating title even though isOpenTab was
    // false, since the redundancy was never open-tab-specific). Narrower
    // isOpenTab-only exclusion tried first, superseded same day — the
    // standalone dashboard (anchorMode "left") is untouched, keeping
    // .rtitle as its one on-face title mechanism same as always.
    const runTitlesLive = anchorMode !== "right";
    for (const run of runTitlesLive
      ? titleRuns(groupRuns(segs.filter((s) => !s.contained)), total)
      : []) {
      liveTitles.add(run.key);
      for (const memberKey of run.members) runLabeledKeys.add(memberKey);
      let el = titleEls.get(run.key);
      const fresh = !el;
      if (fresh) {
        el = document.createElement("div");
        el.className = "rtitle rtitle-clip";
        el.style.opacity = "0";
        // One line-height (16px, fixed in CSS) tall, offset up from the
        // band ceiling by LABEL_GAP so its bottom edge doesn't touch the
        // tallest (HIGH) block.
        el.style.top = TITLE_AREA - 16 - LABEL_GAP + "px";
        ribbon.appendChild(el);
        titleEls.set(run.key, el);
      }
      el.style.left = Math.round(run.start) + "px";
      el.style.maxWidth = Math.round(run.maxW) + "px";
      el.style.color = HIGH_RIM;
      const name = hostNames.get(run.labelKey) || run.host;
      el.textContent = name;
      if (fresh) {
        // Zoom churns runs in/out of eligibility every rAF tick — forcing a
        // sync layout per fresh title (to commit opacity:0 before flipping
        // it) on top of that is exactly the kind of per-frame cost that
        // reads as laggy. During zoom, skip the fade choreography and snap
        // straight to visible, matching .blk's own zoom behavior (no
        // transition at all, per #ribbon.zooming above).
        if (ribbon.classList.contains("zooming")) {
          el.style.opacity = "1";
        } else {
          // Commit the opacity-0 state before flipping it, so the fade
          // transition actually runs instead of the style batching to 1.
          el.getBoundingClientRect();
          el.style.opacity = "1";
        }
      }
    }
    for (const [key, el] of titleEls) {
      if (liveTitles.has(key)) continue;
      titleEls.delete(key);
      if (ribbon.classList.contains("zooming")) {
        el.remove();
      } else {
        el.style.opacity = "0";
        el.addEventListener("transitionend", () => el.remove(), { once: true });
        setTimeout(() => el.remove(), 500);
      }
    }
    for (const [key, el] of blockEls) {
      el.dataset.runLabeled = runLabeledKeys.has(key) ? "1" : "";
    }

    // Favicons (spec §6, 2026-08-07; always-color/always-attempt experiment
    // 2026-08-07): every real block attempts a favicon, always full color —
    // grayscale dimming made them unreadable and didn't help identify the
    // visit. On a block too narrow/short to fit the full 16px icon, the
    // icon still renders at its native top-left anchor and is CLIPPED by
    // the block's own edge (.blk's overflow:hidden) rather than withheld —
    // a partial icon beats none. Sticks (collapsed or fenced) stay
    // favicon-free: a 3px sliver of a 16px icon is noise, not identity.
    for (const s of segs) {
      const el = blockEls.get(s.key);
      if (!el) continue;
      const src = !s.collapsed && !s.stick ? s.e.favIconUrl : null;
      if (!src) {
        if (el._favEl) {
          el._favEl.remove();
          el._favEl = null;
        }
        continue;
      }
      if (!el._favEl) {
        const img = document.createElement("img");
        img.className = "fav";
        img.alt = "";
        el.appendChild(img);
        el._favEl = img;
      }
      if (el._favEl.src !== src) el._favEl.src = src;
    }

    // Block label (Active Tab Manager Phase 2, spec §7b, 2026-08-21):
    // always-on, clipped domain/site-name label on every real block — the
    // same short name the strip/tooltip already show (hostNames +
    // labelKeyOf, computeHostNames' established idiom throughout this
    // file), not the raw host. Sticks (collapsed or fenced) stay
    // label-free, matching the favicon rule just above — a 3px sliver has
    // no room for either. Pinned tabs in the strip are ALSO label-free
    // (spec §7c, 2026-08-22: "you just simply drop the label" — matches
    // real Chrome's own icon-only pinned-tab treatment); irrelevant in
    // tiered mode, where s.e.pinned is never set on a real historical
    // event.
    for (const s of segs) {
      const el = blockEls.get(s.key);
      if (!el) continue;
      const text =
        !s.collapsed && !s.stick && !s.e.pinned
          ? hostNames.get(labelKeyOf(s.e.host, s.e.url)) || s.e.host
          : null;
      if (!text) {
        if (el._labelEl) {
          el._labelEl.remove();
          el._labelEl = null;
        }
        continue;
      }
      if (!el._labelEl) {
        const label = document.createElement("span");
        label.className = "blk-label";
        el.appendChild(label);
        el._labelEl = label;
      }
      if (el._labelEl.textContent !== text) el._labelEl.textContent = text;
    }

    // On-block snapshots (2026-08-25): MEDIUM/HIGH only, width-fitted, lazy
    // and viewport-culled — a pan must not fetch every picture it crosses.
    // Rules: spec/display.md "On-block snapshots",
    // decisions/snapshot_implementation.md.
    // Cull window in CONTENT coordinates (seg.x/.w are content-space; the
    // ribbon is offset by lastPadPx inside the scroller). One margin-widened
    // viewport either side, so a pan reveals blocks whose picture is already
    // in flight rather than starting the fetch at the moment they appear.
    const snapWrap = qs("ribbon-wrap");
    const snapViewW = snapWrap ? snapWrap.clientWidth : 0;
    const snapViewL = (snapWrap ? snapWrap.scrollLeft : 0) - lastPadPx - snapViewW;
    const snapViewR = snapViewL + snapViewW * 3;
    const snapWanted = [];
    for (const s of segs) {
      const el = blockEls.get(s.key);
      if (!el) continue;
      const wants =
        !s.collapsed && !s.stick && (s.e.band === "high" || s.e.band === "medium");
      if (!wants) {
        if (el._snapEl) {
          el._snapEl.remove();
          el._snapEl = null;
        }
        delete el.dataset.snapKey;
        continue;
      }
      const ids = (s.e.snapIds || [s.e.id]).filter(Boolean);
      if (!ids.length) continue;
      const snapKey = ids.join(",");
      // Already showing this exact set: leave the decoded <img> alone. Without
      // this, every pan/zoom repaint would re-fetch and re-decode every
      // visible block's picture.
      if (el.dataset.snapKey === snapKey) continue;
      // Cull: only blocks in (or just outside) the viewport. Skipped entirely
      // when the scroller isn't measurable yet (clientWidth 0 pre-layout), so
      // a first paint fetches rather than silently drawing nothing.
      if (snapViewW && (s.x + s.w < snapViewL || s.x > snapViewR)) {
        // Drop the decoded image too, not just the key: an offscreen ribbon
        // otherwise holds every 640px bitmap it has ever scrolled past.
        // Elements are keyed by seg key and never reused across events, so
        // this is purely a memory concern, not a wrong-picture one.
        if (el._snapEl) {
          el._snapEl.remove();
          el._snapEl = null;
        }
        delete el.dataset.snapKey; // re-fetch when it pans back in
        continue;
      }
      el.dataset.snapKey = snapKey;
      snapWanted.push({ el, ids, snapKey });
    }
    if (snapWanted.length) {
      const allKeys = [...new Set(snapWanted.flatMap((f) => f.ids.map((id) => "snap:" + id)))];
      chrome.storage.local
        .get(allKeys)
        .then((r) => {
          for (const { el, ids, snapKey } of snapWanted) {
            // Stale by the time this resolved (repaint re-targeted the block,
            // or the band gate dropped it).
            if (el.dataset.snapKey !== snapKey) continue;
            // Best-scoring member that HAS a picture wins; top members can be
            // unphotographed pre-navigation stubs (same rule as the tooltip).
            const stored = ids.map((id) => r["snap:" + id]).find(Boolean);
            if (!stored) continue;
            if (!el._snapEl) {
              const img = document.createElement("img");
              img.className = "blk-img";
              img.alt = "";
              // Behind the favicon/label scrim, which is appended after it in
              // DOM order and so paints on top.
              el.insertBefore(img, el.firstChild);
              el._snapEl = img;
            }
            el._snapEl.src = stored;
          }
        })
        .catch(() => {}); // storage read failed: blocks just stay flat fill
    }

    log(`rendered ${segs.length} blocks in ${plates.length} fences + ${bars.length} expanded, ${total}px wide`);

    // Capacity check LAST, once the real laid-out total is known and the DOM
    // is settled (spec §7e): if the loaded range no longer fills the viewport,
    // pull in one more day. At most one per paint — see maybeLoadOlderDay.
    maybeLoadOlderDay(total);
  }

  // Zoom relayout (spec §6, 2026-08-08): re-paints from the CACHED
  // assembly — no thread/container work — so a scroll-wheel zoom stays
  // cheap enough to run every frame. No-op before the first real render.
  function relayout() {
    if (!lastAssembly) return;
    paint(lastAssembly.events, lastAssembly.hostNames);
  }

  window.renderTimeline = render;
  // Single source of truth for scoring — the Score-table button in
  // dashboard.js uses these so diagnostics can never drift from the render.
  window.FS_SCORING = { scoreSession, attendedSeconds, bandFor, hostOf };
})();
