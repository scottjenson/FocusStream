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
// Also dynamically imported by switcher.js's card-view overlay (Active Tab
// Manager Phase 2, spec §7b) — same render pipeline, different DOM root
// (window.__fsTimelineRoot, read at module-init, see the qs()/rootContainer
// comment below). Each import() gets its own fresh module instance/closure
// (dynamic import isn't cached across distinct content-script/page realms),
// so the overlay and a standalone dashboard tab never share state.
//
// Scoring (session -> score/band) and assembly (sessions -> parsed/merged/
// containerized threads) split out to scoring.js/assembly.js (2026-08-15,
// file-size pass: see HISTORY.md) — this file keeps layout, paint, and
// interaction (zoom/pan, card expand, gap-drag), which stayed together
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
  nextDayStart,
  prevDayStart,
} from "./assembly.js";

(() => {
  const log = (...args) => console.log("[FS timeline]", ...args);

  // DOM-root indirection (Active Tab Manager Phase 2, spec §7b, 2026-08-21):
  // every DOM lookup in this file goes through qs()/rootContainer() instead
  // of calling document.getElementById/document.body directly, so the exact
  // same render()/setRibbonMode() pipeline can paint into either the
  // standalone dashboard page (root = document, the default — nothing about
  // the historical view changes) or the tab-strip's card-view overlay (root
  // = that overlay's shadow root). Read from window.__fsTimelineRoot at
  // MODULE-INIT time, not via a post-load setter call: several elements
  // below (tip, quickLabel, cardHoverText, cardChildRow) are created and
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
  const anchorMode =
    (typeof window !== "undefined" && window.__fsTimelineAnchor) || "left";

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
  // Dormant since the Stage 1 stack-ribbon rewrite (plans/stack-ribbon.md)
  // — kept, not deleted, as the fallback block-ribbon layout's own sizing;
  // CARD_TIER_H below is what the live card layout actually reads.
  const TIER_H = { high: 144, medium: 108, low: 108 };

  // --- Stack-ribbon card layout (plans/stack-ribbon.md Stage 1,
  // 2026-08-11): replaces width-as-duration with height-as-tier. Cards are
  // laid out left-to-right in chronological order with no gap-as-absence
  // scaling (explicitly dropped for Stage 1 — see the plan doc's
  // "X-axis/gaps" discussion) and no hour axis. Three REAL heights — the
  // point of this stage is legible screenshots, so HIGH is picked large
  // enough to read a page at a glance; MEDIUM/LOW step down by thirds
  // rather than repeating the old two-tier collapse.
  const CARD_TIER_H = { high: 260, medium: Math.round((260 * 2) / 3), low: Math.round(260 / 3) };
  // Width scales WITH height, one fixed aspect ratio (2026-08-11 fix,
  // Scott's catch): a fixed CARD_W with per-tier height made LOW/MEDIUM/
  // HIGH three DIFFERENTLY-SHAPED rectangles (2.53 / 1.27 / 0.85 w:h) —
  // rotating different-shaped boxes by the identical rotateY() angle
  // legitimately produces different-looking trapezoids (confirmed with an
  // isolated test: the matrix and convergence RATIO were provably
  // identical, but the shapes going in weren't, so the shapes coming out
  // weren't either). CARD_ASPECT matches the real snapshot capture's own
  // shape (640×342, measured off real stored data — shared/… captures at
  // 640px width) so a card is never stretched/cropped away from what the
  // page actually looked like, and — the actual fix — every tier is now
  // the SAME rectangle at 3 different sizes, so identical rotation reads
  // as identical rotation.
  const CARD_ASPECT = 640 / 342;
  const CARD_TIER_W = Object.fromEntries(
    Object.entries(CARD_TIER_H).map(([band, h]) => [band, Math.round(h * CARD_ASPECT)])
  );
  // Swivel (Stage Manager-ish, 2026-08-11 deepened per Scott's "dominoes"
  // framing): EACH card rotates independently around its OWN left edge —
  // there is no shared deck anchor. rotateY(CARD_SWIVEL_DEG) (positive —
  // right edge recedes in Z, left edge stays frontmost) both (a)
  // foreshortens the card's own projected width well under 50% of CARD_W
  // and (b) is what makes tight left-edge spacing read as a physical
  // overlapping stack rather than cards floating apart — CARD_STEP
  // (how far each card's own left edge sits from the previous one) is
  // deliberately narrower than the foreshortened width, so a card visually
  // overlaps/obscures the start of its neighbor (the hover-gap effect,
  // Stage 5, is what un-hides it).
  //
  // Pivot is a SHARED point, not each card's own edge (2026-08-15): fixed
  // at CARD_PIVOT_Y_FRAC × the deck's max height, the same absolute Y for
  // every tier — a per-card pivot (each card's own top/center/bottom)
  // always traded one edge's alignment for the other's, since shorter and
  // taller cards' edges sit at different absolute heights once rotated
  // around their own box. swivelPivotPx(cardTopAbs) converts the shared
  // fraction into each card's own local pivot Y in px (transform-origin/
  // perspective-origin are relative to each element's own box, so the
  // shared value can't be written as a plain CSS %). See
  // plans/stack-ribbon.md Stage 5 for the exploration behind 0.8.
  const CARD_PIVOT_Y_FRAC = 0.8;
  const CARD_SWIVEL_DEG = 64;
  // LOW rotates 10° less than every other tier (2026-08-15) — a small
  // deliberate exception on top of the shared pivot above, not a per-tier
  // angle map (that fights the shared pivot — see git history for why one
  // was tried and reverted). swivelDegFor(band) is the one place this
  // applies.
  const CARD_SWIVEL_DEG_LOW_DELTA = -10;
  function swivelDegFor(band) {
    return band === "low" ? CARD_SWIVEL_DEG + CARD_SWIVEL_DEG_LOW_DELTA : CARD_SWIVEL_DEG;
  }
  // Perspective depth, RATIO not a fixed px value (2026-08-11 — see
  // index.html's .card comment for why a fixed px value is wrong): must
  // scale WITH each card's own height so the Z÷perspective ratio — not
  // perspective alone — stays constant across tiers, or a taller card
  // converges harder than a shorter one at the identical rotation angle.
  // CARD_PERSPECTIVE_RATIO is that constant (perspective_px = height ×
  // ratio, computed per-card in paintCards).
  const CARD_PERSPECTIVE_RATIO = 6.0;
  // px between consecutive cards' own left edges — deliberately less than
  // even the smallest tier's own width (LOW ≈163px post-CARD_ASPECT) so
  // any tier adjacency still overlaps into a stack. Uniform across all
  // tiers (Stage 5) — the hover-gap effect (CARD_GAP_* below) earns back
  // browsability at this tight a pitch. Retune by feel.
  const CARD_STEP = 10;
  // Converts the shared CARD_PIVOT_Y_FRAC into one card's own local pivot
  // Y in px — can't be a CSS `%` since that's relative to the element's
  // own box, not the shared deck height. cardTopAbs is this card's own top
  // edge in the deck's coordinate space (`maxH - cardHeight`).
  function swivelPivotPx(cardTopAbs) {
    return CARD_TIER_H.high * CARD_PIVOT_Y_FRAC - cardTopAbs;
  }
  // Hover-gap effect (Stage 5, 2026-08-15 — see plans/stack-ribbon.md
  // Stage 5 and decisions/timeline_design.md for the full design
  // discussion this implements). Exactly ONE card is ever offset from its
  // rest position at a time — the "traveling" card — determined purely by
  // which gap (between two consecutive rest-position left edges) the
  // cursor currently falls in. Its offset is a PURE function of cursor X
  // within that gap (lerp, not a chase/velocity/spring model), and moves
  // AGAINST the cursor's direction, not with it (corrected 2026-08-15
  // after the first cut shipped the two moving the same way — Scott's
  // catch): cursor at the gap's near (just-arrived-from) edge → card is at
  // its FURTHEST offset, still reaching back toward where the cursor came
  // from; cursor at the gap's far edge (about to hand off) → offset has
  // eased back to 0, since the card has fully returned to meet the
  // NEXT gap's handoff at its own rest slot. This directly implements the
  // design's two load-bearing decisions: (1) cursor and card move toward
  // each other, which is what keeps the physical mouse-travel to hand
  // focus to the next card small (the card closes part of the distance
  // too — the Mac-Dock-genie reference), and (2) handoff at a gap
  // boundary is a hard snap — the traveling card's position is always
  // exactly what the formula says for the CURRENT cursor X, so there's no
  // independently-animated region for the cursor to cross through (that
  // crossing mismatch was the flicker mechanism the naive "push the
  // neighbor open" version hit).
  // CARD_GAP_MAX_PX is how far the traveling card can shift, i.e. how much
  // extra breathing room hovering opens up — deliberately NOT the same as
  // CARD_STEP (the rest pitch): it can exceed it, since the card is
  // moving INTO the space beyond its immediate neighbor's rest edge, not
  // just closing the gap to it. Started at 48 (2026-08-15); raised to 4x
  // (192) same day on the (mistaken, since-fixed — see updateCardGap's
  // comment) belief the gap itself was too small; once the piles-are-
  // fixed rebuild made the true gap visible, 192 read as too much and was
  // halved back down to 96, same day. Still a feel knob, not derived.
  //
  // It's ALSO the fixed distance the "right pile" (every card right of
  // the traveling one) sits shifted by, the whole time a gap is active —
  // NOT a live/animated value for the pile (2026-08-15 rebuild, Scott's
  // catch: the first two cuts re-shifted the right pile every frame in
  // lockstep with the traveling card, so the gap between them never
  // actually opened — no separation, since both moved together). The
  // pile only ever steps (not eases) when the traveling card itself
  // changes at a handoff; see applyCardTransform/updateCardGap below for
  // the full "piles are fixed, only the traveling card moves" model.
  const CARD_GAP_MAX_PX = 96;
  // Half of CARD_GAP_MAX_PX (2026-08-15, centering fix): the gap is now
  // split evenly around the cursor instead of anchored to the left pile's
  // rest position — see updateCardGap/applyCardTransform below for the
  // "both piles shift, traveling card lerps between them" model this
  // drives. Kept as its own named constant (not computed inline at each
  // call site) so the "this is a half-distance, not the full gap" intent
  // stays legible everywhere it's used.
  const CARD_GAP_HALF_PX = CARD_GAP_MAX_PX / 2;
  // Reserved band below the card deck for cardHoverText (2026-08-11 follow-
  // up: on-face .card-label retired, site name/meta/top-page now show as
  // plain text under the hovered card instead). #ribbon-wrap sets
  // `overflow-x: auto`, which per the CSS overflow spec forces the other
  // axis to `auto` too — so anything positioned below #ribbon's own height
  // gets silently clipped. This height must be added into ribbon.style.
  // height (paintCards) so the hover text band sits INSIDE the box
  // #ribbon-wrap sizes to, not below it. Three lines at 12px/16px line-
  // height plus a little breathing room.
  const CARD_HOVER_TEXT_H = 56;
  // Click-to-expand (plans/stack-ribbon.md Stage 2, 2026-08-11): a clicked
  // card animates down below the deck, flattens (rotateY -> 0), and grows
  // to the snapshot's native size (capped to fit the viewport). Duration
  // and easing tuned by feel (Scott: "a little bit of weight… bounces
  // slightly at the bottom"), not derived from anything. Vertical position
  // is the ONLY property that overshoots (Scott: rotation/size just ease
  // in smoothly alongside) — CARD_EXPAND_BOUNCE_PX is how far past the
  // resting `top` the card dips before settling back, expressed as a
  // keyframe offset since WAAPI has no native spring/overshoot easing.
  const CARD_EXPAND_MS = 840; // doubled from 420 (2026-08-11) — felt too quick, tuning by feel
  const CARD_EXPAND_BOUNCE_PX = 14;
  // Scaling (left/width/height/perspective) finishes at this fraction of
  // CARD_EXPAND_MS, before the vertical drop/bounce (which runs the full
  // duration) settles (2026-08-11, Scott: without this, size kept growing
  // for the ENTIRE duration while position visually stopped by ~75%, i.e.
  // backwards from what reads as "weight" — "the movement has pretty much
  // stopped and the scaling continues to grow"). 0.75 landed in his
  // requested 70-80% range.
  const CARD_EXPAND_SIZE_DONE_AT = 0.75;
  // Plain ease-out for width/height/rotation — fast start, smooth stop, no
  // overshoot (see CARD_EXPAND_BOUNCE_PX comment: only `top` bounces).
  const CARD_EXPAND_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
  // Gap between the deck's bottom edge (maxH + CARD_HOVER_TEXT_H) and the
  // top of the expanded card, and between the expanded card's own bottom
  // and #ribbon's bottom edge — pure breathing room, not load-bearing for
  // the no-overlap guarantee (that's the deck-bottom placement itself).
  const CARD_EXPAND_GAP = 24;
  // Fixed display ratio (2026-08-12): expanding used to grow the image as
  // large as it could fit the viewport/height caps, which (a) made cards
  // captured at the newer 1280px SNAP_WIDTH take up too much screen, and
  // (b) landed on an arbitrary fractional scale (e.g. 1155/1280 ≈ 0.9024)
  // depending on window size, which softens a raster image more than a
  // clean round downscale does. Capping at a fixed 50% instead makes size
  // predictable and the resample ratio consistent regardless of native
  // capture resolution or window size (viewport/height are still applied
  // as a floor beneath 50% for small windows — see cardExpandGeom).
  const CARD_EXPAND_SCALE = 0.5;
  // Cap the expanded card's width to the visible viewport (ribbon-wrap's
  // own clientWidth, read at click time) minus a little margin, so a card
  // captured at the newer 1280px SNAP_WIDTH never forces horizontal
  // scrolling just to see the thing you clicked to read.
  const CARD_EXPAND_VIEWPORT_MARGIN = 48;
  // Stage 3 (container child row, 2026-08-11): height cap mirrors the width
  // cap above, but on the vertical axis — the page is a normal scrolling
  // document (no viewport-locked shell), so "don't force scrolling" means
  // fitting the WHOLE expanded assembly (image + child row) inside
  // whatever window height remains below the deck at click time, read once
  // (same click-time-only timing as CARD_EXPAND_VIEWPORT_MARGIN — a resize
  // while a card is open is an accepted edge case, not live-tracked).
  // Margin below the child row before the window's own bottom edge.
  const CARD_EXPAND_VIEWPORT_BOTTOM_MARGIN = 24;
  // Fixed small thumbnail row for a container's children (Stage 3), shown
  // below the expanded image — one uniform height regardless of tier,
  // same "containment frames, never confers stature" reasoning as
  // CONTAIN_CHILD_H, just sized for a thumbnail rather than a cut-in block.
  const CARD_CHILD_THUMB_H = 72;
  const CARD_CHILD_THUMB_ASPECT = CARD_ASPECT; // same 640/342 snapshot shape
  const CARD_CHILD_ROW_GAP = 12; // gap between the expanded image/info and the child row
  const CARD_CHILD_THUMB_GAP = 6; // gap between thumbnails within the row
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
  const LABEL_CLEARANCE = 6; // min px between hour labels; colliders drop, never nudge (spec §6)
  // Left-anchored label sizing (spec §6, 2026-08-08 revival): a HIGH run's
  // label starts at its block's left edge and may overflow rightward across
  // LOW/MEDIUM neighbors (unlabeled space) but stops at the next HIGH run's
  // own anchor, or the ribbon's right edge. TITLE_MIN_W is the floor below
  // which even an ellipsis doesn't fit, so the label is dropped rather than
  // rendered as a meaningless sliver.
  const TITLE_MIN_W = 24;
  // Week strip (spec §6, 2026-07-17): a cell is the ribbon's TOP EDGE — the
  // importance contour — on LINEAR time. LOW/MEDIUM both match HIGH (spec
  // §6, 2026-08-07 second pass, same rationale as the main ribbon's
  // TIER_H) — fill is the only signal splitting HIGH from the rest; height
  // carries no tier signal in the strip either.
  const STRIP_TIER_H = { high: 30, medium: 30, low: 30 };
  const STRIP_H = STRIP_TIER_H.high;
  const STRIP_INSET = 2; // .wday-sky's padding (index.html), reserved so bars never sit under the selected-day outline
  const STRIP_BIN_MS = 15 * 60 * 1000;
  const STRIP_BIN_PX = 2;
  const STRIP_RANK = { low: 1, medium: 2, high: 3 };
  const STRIP_BAND = [null, "low", "medium", "high"];

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
  // Gap-card highlight (2026-08-15, handoff-disambiguation): card content
  // (page screenshots) can be near-white or near-black, so a plain border
  // color alone can vanish against either extreme. Dark navy border reads
  // against light pages; the bright blue box-shadow glow (CSS, see
  // .card.gap-active in index.html) is what carries it against dark pages.
  // Started as pure red for a visibility smoke-test (2026-08-15); this is
  // the follow-up "make it professional" pass.
  const GAP_ACTIVE_BORDER = "#0B2E6B";
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

  // viewDayStart (spec §6, 2026-07-16): the ribbon shows ONE local calendar
  // day; day-navigation UI (week strip, prev/next) lives here and owns this
  // value, passing it into assembly.js's parseSessions explicitly.
  let viewDayStart = dayStartOf(Date.now());

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
  let loadingDay = false;
  function maybeLoadOlderDay(totalPx) {
    if (loadingDay) return;
    if (anchorMode !== "right" || heightMode !== "tiered") return;
    const wrap = qs("ribbon-wrap");
    if (!wrap) return;
    // Capacity (§7e) OR proximity (§7h) — "is there room for more history to
    // be useful", asked two ways. lastPadPx is the left pad: content starts
    // there, so that is the real distance to the oldest loaded pixel.
    const underflows = totalPx < wrap.clientWidth;
    const nearLeftEnd = panning && wrap.scrollLeft - lastPadPx <= LOAD_MARGIN_PX;
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
      // already established (plans/stack-ribbon.md dropped fences
      // outright, the big learning from that rework). A LOW run of real
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

  // --- Card layout (plans/stack-ribbon.md Stage 1, 2026-08-11; rotation/
  // overlap deepened, then width tied to CARD_ASPECT, same day): flat
  // left-to-right deck, one card per assembled event (thread/container),
  // chronological order — the fence/stick and gap-as-absence machinery
  // above are NOT invoked here (fence code is kept for a possible revert,
  // per plan doc discussion; this stage explicitly drops absence-as-width).
  // Height is the tier signal (CARD_TIER_H); width follows it 1:1 via
  // CARD_ASPECT so every tier is the same shape, just scaled (Scott's
  // aspect-ratio catch — see CARD_ASPECT above for why). Spacing is
  // CARD_STEP: each card's own left edge is CARD_STEP from the previous
  // one, deliberately less than even the SMALLEST tier's width, so the CSS
  // swivel's foreshortening makes consecutive cards overlap into a stack
  // regardless of which tiers happen to be adjacent (each card's
  // independent rotateY around its OWN left edge is what makes this read
  // as physical overlap rather than misaligned spacing — CARD_SWIVEL_DEG).
  function cardLayout(events) {
    // Uniform CARD_STEP pitch since Stage 5 (2026-08-15) — see that
    // constant's own comment for why the old per-band branch was retired.
    let x = 0;
    const segs = events.map((e, i) => {
      const h = CARD_TIER_H[e.band];
      const seg = { e, key: e.id, band: e.band, w: CARD_TIER_W[e.band], h, x };
      x += CARD_STEP;
      return seg;
    });
    const last = segs[segs.length - 1];
    const total = last ? last.x + last.w : 0;
    return { segs, total };
  }

  // Strip tile source (spec §7c, bug fix 2026-08-22): the strip's tile
  // list used to come from assembleThreads(parseSessions(sessions,
  // viewDayStart)).filter(isOpenTab) — the SAME calendar-day-filtered
  // pipeline the ribbon uses. Real bug, found via a real specimen (3 of 4
  // pinned tabs, 1 of 6 regular tabs vanished): any open tab whose most
  // recent real session's endTime falls outside TODAY is silently
  // excluded by parseSessions before paint() ever sees it — invisible
  // before because the OLD synthetic-record code always faked
  // endTime=now (guaranteeing every open tab passed the day filter,
  // dishonestly); markOpenTabs' fix (no more fabricated timing) removed
  // that accidental guarantee and exposed this real, independent
  // pre-existing gap. The strip has no reason to care about calendar
  // days at all — it's every CURRENTLY OPEN tab, full stop, categorical
  // by Chrome order, not filtered by when it was last used. This
  // function builds strip-ready objects straight from openTabs +
  // whatever real (any-day) prior session exists, bypassing
  // parseSessions/assembleThreads entirely. Band/score still come from
  // real evidence when it exists (uniform mode colors by tier — spec
  // §7b, "tier is shown via fill/border color only"); a tab with zero
  // real history anywhere gets LOW (nothing earned yet, not a guess).
  function stripEventsFromOpenTabs(openTabs, sessions) {
    const latestByTab = new Map();
    for (const s of sessions) {
      if (s.tabId == null) continue;
      const prev = latestByTab.get(s.tabId);
      if (!prev || s.endTime > prev.endTime) latestByTab.set(s.tabId, s);
    }
    return openTabs.map((t, tabIndex) => {
      const prior = latestByTab.get(t.id);
      const score = prior ? scoreSession(prior) : 0;
      return {
        id: "strip:" + t.id,
        tabId: t.id,
        openTabId: t.id,
        host: hostOf({ url: t.url || "" }),
        url: t.url || "",
        favIconUrl: t.favIconUrl || "",
        score, // real score, not just the derived band — hasEarnedHigh(s.e)
        // (paint()'s gold "earned-HIGH" border check) reads .score
        // directly; without this a HIGH-banded strip tile could never
        // earn the gold rim (undefined >= HIGH_SCORE is always false, a
        // silent visual gap, not a crash — fixed while it was cheap to).
        band: bandFor(score),
        isOpenTab: true,
        pinned: !!t.pinned,
        // The currently-focused tab, straight from background.js's own
        // broadcast (toStripTab already ships `active`) — the strip had no
        // "which tab am I on" cue at all before this. Chrome owns this fact
        // and re-broadcasts on every switch, so paint() re-derives it every
        // repaint rather than any local class toggle going stale.
        active: !!t.active,
        tabIndex,
      };
    });
  }

  // Strip layout (Active Tab Manager, spec §7c, 2026-08-22): the
  // collapsed strip's own x/w, replacing reuse of layout()'s real
  // time-based geometry. Deliberately as simple as cardLayout() above —
  // fixed pitch, array order only, no time math, no gaps-as-absence.
  // openTabSessions is expected to already be in Chrome's own tab-strip
  // order (chrome.tabs.query order, pinned tabs first — background.js's
  // toStripTab/broadcastTabsForWindow do no re-sorting of their own, and
  // neither does this function: it trusts the array order it's given).
  // Pinned tabs get a narrower, icon-only tile (STRIP_PINNED_TILE_W,
  // matching real Chrome's own pinned-tab treatment) — everything else is
  // one fixed STRIP_TILE_W regardless of duration/band, on purpose: a real
  // Chrome tab bar doesn't widen a tab because you spent longer on it.
  function stripLayout(openTabSessions) {
    let x = 0;
    const segs = openTabSessions.map((e) => {
      const w = e.pinned ? STRIP_PINNED_TILE_W : STRIP_TILE_W;
      const seg = { e, key: e.id, band: e.band, collapsed: false, w, x };
      x += w + STRIP_GAP;
      return seg;
    });
    return { segs, total: Math.max(x - STRIP_GAP, 0) };
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
  // (expand/collapse, day paging, Escape) don't need to re-fetch or
  // re-thread it.
  let lastLockIntervals = [];
  // Open tabs (spec §7c, bug fix 2026-08-22): the raw openTabs array
  // FS_renderOpenTabs receives from switcher.js — cached the same way
  // lastSessions/lastLockIntervals are so paint()'s uniform branch can
  // build the strip's tile list from it directly (stripEventsFromOpenTabs)
  // without going through the day-filtered assembleThreads/parseSessions
  // pipeline. Always [] on the standalone dashboard, which never calls
  // FS_renderOpenTabs.
  let lastOpenTabs = [];

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
    if (e.key === "Escape" && expandedKey !== null) {
      collapseAllFences();
      render(lastSessions);
    }
    // Day paging by arrow key, mirroring the week strip's own click handler
    // (same bounds, same fence-reset). Ignored while typing in the search
    // box so arrows still move the text cursor there.
    if (
      (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
      e.target.tagName !== "INPUT" &&
      e.target.tagName !== "TEXTAREA"
    ) {
      const today = dayStartOf(Date.now());
      const day =
        e.key === "ArrowLeft"
          ? Math.max(oldestDayStart(), prevDayStart(viewDayStart))
          : Math.min(today, nextDayStart(viewDayStart));
      if (day !== viewDayStart) {
        viewDayStart = day;
        collapseAllFences();
        log(`arrow key → ${new Date(day).toDateString()}`);
        render(lastSessions);
      }
    }
  });

  // --- Day paging (spec §6; ‹/› header nav removed 2026-07-17): the week
  // strip is the only day picker — with 7-day retention every reachable day
  // always has a cell. Paging resets fences (expansion is a per-look act,
  // not per-day state).
  const oldestDayStart = () =>
    lastSessions.length
      ? dayStartOf(Math.min(...lastSessions.map((s) => s.startTime)))
      : dayStartOf(Date.now());

  // --- Week strip (spec §6, 2026-07-17; thread bands 2026-07-18): one
  // skyline cell per day, oldest → today, above the ribbon; click a cell
  // to jump the viewed day there. Per 15-min bin, a bottom-flush bar at
  // the MAX band of any THREAD overlapping the bin — max, not
  // time-dominant: that is what the ribbon's top edge is at any x. Bands
  // come from the same assembled threads the ribbon draws (shared
  // threadsByDay step), so container/meeting days skyline like their
  // ribbon instead of lower (the old raw-band divergence, resolved).
  // All cells share one hour-aligned window, so hours align VERTICALLY
  // across days — the cross-day comparison the two-scale ribbon can't give.
  function renderWeekStrip(dayThreads) {
    const strip = qs("week-strip");
    strip.replaceChildren();
    const all = [...dayThreads.values()].flat();
    strip.hidden = !all.length;
    if (!all.length) return;

    let minOff = Infinity;
    let maxOff = 0;
    for (const [day, threads] of dayThreads) {
      for (const t of threads) {
        // Offsets are time-of-day within the thread's own day; midnight
        // straddlers clamp to 0 rather than leaking into the previous day.
        minOff = Math.min(minOff, Math.max(0, t.startTime - day));
        maxOff = Math.max(maxOff, t.endTime - day);
      }
    }
    minOff = Math.floor(minOff / HOUR) * HOUR;
    maxOff = Math.min(24 * HOUR, Math.ceil(maxOff / HOUR) * HOUR);
    const bins = Math.ceil((maxOff - minOff) / STRIP_BIN_MS);

    const today = dayStartOf(Date.now());
    for (let day = oldestDayStart(); day <= today; day = nextDayStart(day)) {
      const cell = document.createElement("div");
      cell.className = "wday" + (day === viewDayStart ? " selected" : "");
      const label = document.createElement("div");
      label.className = "wday-label";
      // Day-first "Wed 15 Jul": unambiguous across US/European readers
      // (7/15 is not), month/weekday names still follow the user's locale.
      const d = new Date(day);
      label.textContent =
        d.toLocaleDateString([], { weekday: "short" }) +
        " " +
        d.getDate() +
        " " +
        d.toLocaleDateString([], { month: "short" });
      const sky = document.createElement("div");
      sky.className = "wday-sky";
      sky.style.width = bins * STRIP_BIN_PX + STRIP_INSET * 2 + "px";
      sky.style.height = STRIP_H + STRIP_INSET * 2 + "px";

      const tiers = new Array(bins).fill(0);
      const earnedAt = new Array(bins).fill(false);
      for (const t of dayThreads.get(day) || []) {
        const rank = STRIP_RANK[t.band];
        const from = Math.max(
          0,
          Math.floor((Math.max(t.startTime - day, 0) - minOff) / STRIP_BIN_MS)
        );
        const to = Math.min(
          bins - 1,
          Math.floor((t.endTime - day - minOff - 1) / STRIP_BIN_MS)
        );
        for (let i = from; i <= to; i++) {
          // Strict >, matching the prior Math.max tie-break: the first
          // thread to claim a bin's rank keeps it.
          if (rank > tiers[i]) {
            tiers[i] = rank;
            earnedAt[i] = t.band === "high" && hasEarnedHigh(t);
          }
        }
      }
      // Run-length bars, edges snapped like blocks (round the right edge,
      // not the width, so snapped neighbors stay adjacent). Bars paint by
      // importance, not identity (spec §6, 2026-08-07; three-step ladder
      // restored 2026-08-08): the strip carries no hue — each tier gets its
      // own luminance step (TIER_FILL/TIER_RIM), with the earned-HIGH gold
      // border layered on top; runs break on tier or earned-HIGH change.
      for (let i = 0; i < bins; ) {
        let j = i + 1;
        while (j < bins && tiers[j] === tiers[i] && earnedAt[j] === earnedAt[i]) j++;
        if (tiers[i]) {
          const bar = document.createElement("div");
          bar.className = "wbar";
          const x = Math.round(i * STRIP_BIN_PX);
          bar.style.left = x + "px";
          bar.style.width = Math.round(j * STRIP_BIN_PX) - x + "px";
          const band = STRIP_BAND[tiers[i]];
          bar.style.height = STRIP_TIER_H[band] + "px";
          bar.style.background = TIER_FILL[band];
          bar.style.borderColor = earnedAt[i] ? EARNED_RIM : TIER_RIM[band];
          sky.appendChild(bar);
        }
        i = j;
      }

      cell.addEventListener("click", () => {
        if (day === viewDayStart) return;
        viewDayStart = day;
        collapseAllFences(); // paging resets fences, same as ‹/›
        log(`week strip → ${new Date(day).toDateString()}`);
        render(lastSessions);
      });
      cell.append(label, sky);
      strip.appendChild(cell);
    }
  }

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
  rootContainer().appendChild(tip);
  let tipTimer = null;
  // Bumped on every hide: async continuations below (storage fetch, image
  // decode) compare against it, so a stale hover can never resurrect a
  // dismissed tooltip or paint into a newer one.
  let tipSeq = 0;

  function hideTip() {
    clearTimeout(tipTimer);
    tipTimer = null;
    tipSeq++;
    tip.hidden = true;
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

  // Expanded-card info overlay (Stage 2 follow-up, 2026-08-11 — see
  // .card-info in index.html): fuller than #card-hover-text's one-line
  // trim, but still deliberately short of #tip's TIP_DEBUG block — site
  // name, meta, and the deduped page list. First pass showed the FULL list
  // uncapped ("show what it looks like" request, Scott 2026-08-11); a real
  // 14-page session overflowed the panel's legible area, so this now caps
  // at TIP_TITLES_MAX + "N more", same as #tip's own fillTip. LOW-band
  // pages dropped entirely (2026-08-11 follow-up, Scott: the dim/bright
  // two-font look was read as visual noise, not signal worth keeping here)
  // — filtered BEFORE the cap, so both the 8-item limit and "+N more" count
  // apply to the remaining non-LOW pages only; #tip itself is untouched,
  // still shows LOW pages dimmed. Rebuilds el._info's content from the
  // card's own _tipData; caller (toggleCardExpand / paintCards) owns
  // show/hide.
  function fillCardInfo(el) {
    const d = el._tipData;
    const info = el._info;
    info.textContent = "";
    if (!d) return;
    const line = (cls, text) => {
      const div = document.createElement("div");
      div.className = cls;
      div.textContent = text;
      info.appendChild(div);
    };
    line("ci-title", d.siteName);
    line("ci-meta", d.meta);
    const pages = d.pages.filter((p) => p.band !== "low");
    for (const p of pages.slice(0, TIP_TITLES_MAX)) line("ci-page", p.title);
    if (pages.length > TIP_TITLES_MAX)
      line("ci-page dim", `+ ${pages.length - TIP_TITLES_MAX} more`);
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

  // Card hover text (plans/stack-ribbon.md Stage 1 follow-up, 2026-08-11):
  // replaces the on-face .card-label AND the floating #tip tooltip for
  // cards. Same one-shared-floating-element pattern as quickLabel above
  // (repositioned per hover, not per-card DOM) — sits below the card deck,
  // shows instantly (no TIP_DELAY_MS), three lines: site name, time ·
  // duration, then the top-scoring page title (tipDataOf's first entries).
  const cardHoverText = document.createElement("div");
  cardHoverText.id = "card-hover-text";
  cardHoverText.hidden = true;
  qs("ribbon").appendChild(cardHoverText);

  // Which card's key the currently-visible cardHoverText belongs to, if
  // any (2026-08-15, Stage 5 label-tracking follow-up) — set whenever the
  // pointerover branch below positions it for a deck card. Read by
  // applyCardTransform so the label's OWN left offset can be kept in sync
  // with that same card's live gap-effect translateX every frame the card
  // moves, not just recomputed once at pointerover time (which only reads
  // the card's REST left — see that branch's own comment for why a static
  // read broke once cards started actually traveling).
  let cardHoverTextKey = null;

  // Label-center, no transition (2026-08-15, Scott: riding pixel-for-pixel
  // with the fast-traveling card — the ORIGINAL Stage 5 label design — made
  // the label "nearly impossible to read." First replacement eased the
  // label's handoff move too — ALSO reverted same day, Scott's next
  // feel-test: at real sweep speed the ease itself was "fighting what's
  // happening... trying to do too much in too little time," flickery
  // rather than smooth. Current, simplest version: the label sits at the
  // GAP's stable center (a card's own rest-left — see updateLabelGapCenter)
  // instead of the card's live gapOffsetPx, and moves ONLY when gapKey
  // itself changes at a handoff — a hard snap then, same as the card's own
  // handoff, no separate animated value at all.
  let labelGapCenterPx = 0;
  let labelGapCenterTargetKey = null; // which gap's center labelGapCenterPx currently reflects; null = inactive (label positioned some other way, e.g. plain pointerover)

  // Re-targets the label's stable center for the CURRENT gap — a plain
  // snap, no easing (see this block's comment above for why easing was
  // tried and reverted). seg is lastCardSegs' entry for gapKey (its rest x
  // IS the center — see gapOffsetPx's lerp range, symmetric around 0 added
  // to restLeft). Called every updateCardGap, but only actually writes
  // anything when gapKey changed since the last call — repeated calls with
  // the same gapKey are no-ops.
  function updateLabelGapCenter(seg) {
    if (!seg) return;
    if (labelGapCenterTargetKey === seg.key) return; // already at this gap's center
    labelGapCenterTargetKey = seg.key;
    labelGapCenterPx = seg.x;
  }

  function hideCardHoverText() {
    cardHoverText.hidden = true;
    cardHoverTextKey = null;
    // Label center also goes inactive (2026-08-15 follow-up) — the next
    // gap opened after this must set its center fresh, not read as already
    // matching a stale target key left over from before the hide.
    labelGapCenterTargetKey = null;
  }

  // Shared fill (2026-08-15 — pulled out of the pointerover handler below
  // so updateCardGap can use it too; both need identical three-line
  // content). d is a card's _tipData (siteName / meta / pages).
  function fillCardHoverText(d) {
    cardHoverText.textContent = "";
    const line = (cls, text) => {
      const div = document.createElement("div");
      div.className = cls;
      div.textContent = text;
      cardHoverText.appendChild(div);
    };
    line("cht-title", d.siteName);
    line("cht-meta", d.meta);
    if (d.pages.length) line("cht-page", d.pages[0].title);
  }

  // Shows cardHoverText for a specific deck card, positioned at its
  // CURRENT authoritative X — the single entry point updateCardGap uses to
  // make gapKey authoritative for the label (2026-08-15, Scott's catch: the
  // old pointerover-only path showed whatever DOM element the raw cursor
  // happened to be over, which is the STATIC neighbor once a card is
  // mid-travel, not the traveling card itself — see
  // decisions/timeline_design.md and this file's Stage 5 section for the
  // full bug). leftPx defaults to the card's own rest-left for non-gap
  // (pointerover) callers; the gap caller passes the eased
  // labelGapCenterPx instead (2026-08-15 follow-up — see that variable's
  // comment for why this is no longer offsetPx/gapOffsetPx-based).
  function showCardHoverTextFor(el, key, leftPx) {
    if (!el || !el._tipData) return;
    fillCardHoverText(el._tipData);
    cardHoverTextKey = key;
    const restLeft = parseFloat(el.dataset.deckLeft) || 0;
    const top = parseFloat(el.style.top) || 0;
    const height = parseFloat(el.style.height) || 0;
    cardHoverText.style.left = (leftPx != null ? leftPx : restLeft) + "px";
    cardHoverText.style.top = top + height + LABEL_GAP + "px";
    cardHoverText.hidden = false;
  }

  {
    const ribbonEl = qs("ribbon");
    ribbonEl.addEventListener("pointerover", (ev) => {
      hideTip();
      hideQuickLabel();
      // Skipped while a gap is active (2026-08-15, label-flicker fix):
      // raw pointerover fires on whatever DOM element the cursor is
      // LITERALLY over, which is a stale/static card's real hit-box once
      // the traveling card has painted itself elsewhere via transform —
      // same DOM-hit-testing mismatch already called out below and in the
      // click-redirect handler. Hiding cardHoverText here blanked and
      // re-snapped the gap's label once or twice per sweep as the cursor
      // crossed each real card boundary underneath, which was the flicker.
      // updateCardGap (pointermove) is the sole authority for this label
      // whenever a gap is active, so this handler must leave it alone.
      if (gapKey == null) hideCardHoverText();
      // Panning suppresses hover UI entirely (spec §7h, 2026-08-24):
      // navigation and inspection are not simultaneous intents. The blocks
      // sliding past under a travelling cursor fire pointerover constantly;
      // without this they would each arm a tooltip for a block that is
      // already gone by the time it shows.
      if (ribbonEl.classList.contains("panning")) return;
      const el = ev.target.closest("[data-tip]");
      if (!el) return;
      const isCard = el.classList.contains("card");
      const isChildThumb = el.classList.contains("card-child-thumb");
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
      // Stage 1 cards show their own below-card text instead of the
      // floating quick label (which would duplicate it). Open-tab tiles
      // (2026-08-22) never need it either — same reason, inline label.
      // Retired in the overlay (2026-08-25): redundant with §7b's always-on
      // .blk-label. Same gate/reason as runTitlesLive below; the standalone
      // dashboard keeps it (spec §6, 2026-08-08).
      const quickLabelLive = anchorMode !== "right";
      if (quickLabelLive && el._tipData && el.dataset.runLabeled !== "1" && !isCard && !isOpenTab) {
        quickLabel.textContent = el._tipData.siteName;
        const left = parseFloat(el.style.left) || 0;
        quickLabel.style.left = left + "px";
        quickLabel.hidden = false;
      }
      // Stage 1 cards show their own below-card text instead of the
      // floating quick label (which would duplicate it). Suppressed ONLY
      // for the currently-expanded card (Stage 2, 2026-08-11): el.style.
      // left/top/height only get baked in once animateCardTo's animation
      // finishes, so mid-flight (or even at rest, expanded) this math would
      // read stale deck-position values and misplace the text box below the
      // wrong spot — that misplaced box, not the normal below-deck-card
      // text, was the "hover card on the ribbon" bug (2026-08-11). Deck
      // cards keep this text as before; only isCard still needs its own
      // early return (skipping straight past it here) so a hovered card
      // never falls through into the delayed #tip tooltip path below.
      //
      // Suppressed entirely while a gap is active (2026-08-15, Scott's
      // catch): raw pointerover fires on whatever DOM element the cursor
      // is literally over, which is the STATIC neighbor once its own
      // sibling has traveled on top of/away from it — updateCardGap is now
      // the sole authority for the label whenever gapKey is set (it reruns
      // every pointermove and calls showCardHoverTextFor for gapKey's own
      // card), so this branch would only ever fight it, never help it.
      if (isCard && gapKey == null && el._tipData && el !== cardEls.get(cardExpandedKey)) {
        showCardHoverTextFor(el, el._e ? el._e.id : null, null);
      }
      // Child carousel thumbnails (2026-08-12): same below-item label as
      // deck cards, but positioned off the thumbnail's own offset WITHIN
      // cardChildRow (a flex child, not individually left/top-positioned
      // like a deck card) plus the row's own inline left/top — cardChildRow
      // and #ribbon share the same coordinate space cardHoverText is
      // positioned in, same as the isCard branch above.
      if (isChildThumb && el._tipData) {
        fillCardHoverText(el._tipData);
        const rowLeft = parseFloat(cardChildRow.style.left) || 0;
        const rowTop = parseFloat(cardChildRow.style.top) || 0;
        cardHoverText.style.left = rowLeft + el.offsetLeft + "px";
        cardHoverText.style.top = rowTop + el.offsetTop + el.offsetHeight + LABEL_GAP + "px";
        cardHoverText.hidden = false;
      }
      if (isCard || isChildThumb) {
        return; // cards and child thumbnails never fall through to the delayed #tip below
      }
      const px = ev.clientX;
      const py = ev.clientY;
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
        // Measure after content is set; clamp to the viewport (flip above
        // the cursor rather than run off the bottom).
        const r = tip.getBoundingClientRect();
        let left = px + 12;
        let top = py + 12;
        if (left + r.width > innerWidth - 4) left = Math.max(4, innerWidth - r.width - 4);
        if (top + r.height > innerHeight - 4) top = Math.max(4, py - r.height - 12);
        tip.style.left = left + "px";
        tip.style.top = top + "px";
      }, TIP_DELAY_MS);
    });
    ribbonEl.addEventListener("pointerout", () => {
      hideTip();
      hideQuickLabel();
      // Same guard as pointerover above, same reason: pointerout fires
      // whenever the cursor's real screen position exits a child's actual
      // (unpainted) hit-box — which happens repeatedly mid-sweep, since a
      // traveling card's box never moves, only its paint does. This was
      // the other half of the flicker: pointerover's hide was guarded but
      // this twin wasn't, so the label still blanked on the matching exit.
      if (gapKey == null) hideCardHoverText();
    });
    ribbonEl.addEventListener("pointerdown", () => {
      hideTip();
      hideQuickLabel();
      hideCardHoverText();
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
      if (ribbonEl.classList.contains("panning")) return;
      ribbonEl.classList.add("panning");
      hideTip();
      hideQuickLabel();
      hideCardHoverText();
    };

    const stopPan = () => {
      if (panRaf != null) cancelAnimationFrame(panRaf);
      panRaf = null;
      panT = null;
      panLastTs = 0;
      panFrac = 0;
      panning = false;
      if (ribbonEl.classList.contains("panning")) {
        ribbonEl.classList.remove("panning");
      }
    };

    const panTick = (ts) => {
      panRaf = null;
      if (!panArmed || heightMode !== "tiered") return stopPan();
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
      if (panRaf != null || heightMode !== "tiered") return;
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
      if (heightMode !== "tiered") return;
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
      if (anchorMode !== "right" || heightMode !== "tiered") return;
      if (selfScrolling) return; // our own assignment echoing back
      captureFromRight(wrap);
    });
    wrap.addEventListener(
      "wheel",
      (ev) => {
        // Zoom only while expanded/tiered (Active Tab Manager Phase 2,
        // 2026-08-22, Scott's call: "zoom only works once expanded" — the
        // collapsed strip stays a clean, static Chrome-tab bar). This
        // naturally does nothing on the standalone dashboard page, which
        // never sets __fsHeightMode and so is always "tiered" — the
        // historical always-zoomable behavior there is unchanged.
        if (heightMode === "uniform") return;
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

  // Ribbon view mode (plans/ribbon-toggle.md, 2026-08-12): a standing
  // toggle between the live card deck and the dormant-but-intact block
  // ribbon, not a migration — both stay permanently available. A viewing
  // preference like `zoom`, not part of a day's data, so it lives in
  // localStorage rather than chrome.storage.local. Defaults to "cards" —
  // the currently-shipped experience — on any missing or invalid stored
  // value (fresh install, cleared storage, or a corrupted value all fall
  // back the same way).
  //
  // Overlay override (spec §7b, 2026-08-21): the overlay always wants
  // "blocks" (Classic view/.blk — the genuinely zoom-reactive, time-
  // proportional path; paintCards()/.card is fixed-tier-width and
  // confirmed zoom-inert, wrong for this view) regardless of any stored
  // preference. localStorage is scoped to the HOST PAGE's own origin
  // inside the overlay's shadow root, not the dashboard extension page's
  // origin — so it can never see a "blocks" value saved via the dashboard's
  // own toggle button anyway; reading it here would silently fall back to
  // "cards" every time. window.__fsTimelineMode is read at module-init,
  // same pattern as __fsTimelineRoot/__fsTimelineAnchor above.
  // localStorage ACCESS itself throws (not just returns null) when the
  // origin has site data blocked — and this module is also dynamically
  // imported into content-script contexts on arbitrary host pages
  // (switcher.js overlay, header above), where that is entirely possible.
  // An unguarded read here aborted the whole IIFE at module-init, so
  // every window.* export below it — notably FS_SCORING, the Score
  // table's only entry point — silently never got assigned while the
  // ribbon itself still rendered. Fails soft to the "cards" default.
  const storedMode = (() => {
    try {
      return localStorage.getItem("fs_ribbon_mode");
    } catch {
      return null;
    }
  })();
  let ribbonMode =
    (typeof window !== "undefined" && window.__fsTimelineMode) ||
    (storedMode === "blocks" ? "blocks" : "cards");

  // Collapsed/expanded height mode (Active Tab Manager Phase 2, spec §7b,
  // 2026-08-22 unification): the open-tabs overlay used to be a second,
  // parallel geometry pipeline (layoutStripGeom/layoutRibbonGeom,
  // retired) whose whole reason to exist was showing every tile at one
  // uniform height, tier-blind, like a real Chrome tab strip. That's now
  // just a height-calculation MODE inside paint() itself (see TIER_H read
  // below) — "uniform" forces every top-level block to STRIP_TILE_H
  // regardless of band and skips contained children entirely (no room,
  // no need, at rest); "tiered" is the historical three-height behavior,
  // unchanged.
  //
  // Horizontal geometry DIVERGES between the two modes too, as of the
  // strip-ordering rework (spec §7c, 2026-08-22 — NOT the same day as the
  // paragraph above's original height-only design, a real correction to
  // it): "uniform" now lays out open tabs by chrome.tabs.query's own
  // order (stripLayout(), fixed pitch, no time math at all) instead of
  // reusing layout()'s real time-based x/w — a stale pinned tab was
  // otherwise always glued to the right edge (`now`-anchoring), which
  // falsely read as "recently attended." "tiered" is untouched: real
  // time-based x/w from layout(), independent zoom, as always. Since the
  // two modes can now show genuinely different SETS of blocks (see
  // stripLayout()), a tab present in the strip may simply have no tiered
  // position at all — paint()'s existing per-call `seen`/removal sweep
  // handles that with no new code, same as any other departed element.
  let heightMode = (typeof window !== "undefined" && window.__fsHeightMode) || "tiered";
  // Matches switcher.js's STRIP_HEIGHT_PX (34) so a tile fills the host's
  // full height and sits flush on the strip's bottom edge (2026-08-24). At
  // 30 the ribbon collapsed to 30px inside the 34px host and the leftover
  // 4px painted as a black band under every tile — which stopped them
  // reading as tabs, since a tab meets the edge it sits on.
  const STRIP_TILE_H = 34;
  // Fixed pitch for the Chrome-order strip (spec §7c) — same idea as the
  // dormant cardLayout()'s CARD_STEP, just for .blk instead of .card. Not
  // duration-derived at all: a real Chrome tab bar doesn't widen a tab
  // because you spent longer on it, and stripLayout() shouldn't either.
  const STRIP_TILE_W = 120;
  // Pinned tabs are icon-only, no label (Scott, 2026-08-22: "you just
  // simply drop the label" — matches real Chrome's own pinned-tab
  // treatment) — narrower pitch since there's no label to reserve room
  // for, same favicon size as any other tile.
  const STRIP_PINNED_TILE_W = 30;
  // The strip's own inter-tile gap, separate from the ribbon's shared GAP
  // (2px) on purpose: GAP is time-geometry spacing that layout() also uses,
  // while this is pure visual separation between categorical tiles. At the
  // ribbon's 2px the 120px tiles butted together and read as one continuous
  // bar rather than a row of tabs.
  const STRIP_GAP = 6;
  // skipPaint (bug fix, spec §7c, 2026-08-22): switcher.js's expand()
  // flushes the active tab's in-progress visit (FS_FLUSH_CURRENT) AFTER
  // flipping to tiered, then calls its own fresh paintRibbon() once the
  // flush completes — real specimen this fixes: applyDefaultZoomWindow's
  // one-shot was firing on THIS function's own internal paint() call
  // (still pre-flush data), then never re-firing for paintRibbon()'s
  // later, larger (post-flush) dataset — zoom stayed sized for the
  // smaller pre-flush window while the wider post-flush data painted at
  // that stale zoom (26+ blocks visible instead of 12). skipPaint lets
  // the caller flip heightMode without an intermediate paint, so
  // applyDefaultZoomWindow only ever sees ONE, final, complete dataset —
  // whoever passes skipPaint:true is responsible for calling
  // render()/paintRibbon() themselves right after. Defaults to false
  // (paint immediately) for every other caller — the standalone
  // dashboard and collapse() both have no follow-up render of their own.
  function setHeightMode(mode, skipPaint) {
    if (mode !== "uniform" && mode !== "tiered") return;
    if (mode === heightMode) return;
    heightMode = mode;
    if (!lastAssembly || skipPaint) return;
    paint(lastAssembly.events, lastAssembly.hostNames);
    // Collapsing snaps back to the strip's own LEFT edge (bug fix,
    // 2026-08-22, re-scoped same day as the strip-ordering rework above):
    // if the user zoomed/panned into history while expanded, collapsing
    // should reliably show the strip's own FIRST tabs (pinned tabs, by
    // Chrome order) again, not whatever scroll position history-browsing
    // left behind — collapsed is meant to read as a clean, predictable
    // Chrome-tab bar, and a real Chrome tab bar rests showing its first
    // tabs, never scrolled to hide them. (Previously right-justified —
    // real specimen: all 4 pinned tabs + the first regular tab invisible
    // after collapsing. Same root mistake as render()'s own scroll-reset
    // above: importing the ribbon's "show now" logic into an axis where
    // "now" has no meaning.) Zoom LEVEL itself is untouched — collapsed
    // doesn't visibly depend on it (wheel-zoom is gated off while
    // collapsed), and resuming the same zoom on re-expand is unaffected.
    if (mode === "uniform") {
      const wrap = qs("ribbon-wrap");
      if (wrap) wrap.scrollLeft = 0;
    }
  }

  // Mode switch (not just a re-render): closes whichever expand state the
  // outgoing mode has open, tears down its persistent DOM elements (blockEls
  // and cardEls are separate Maps — neither paint()/paintCards() clears the
  // other's nodes, see paintCards's own .transient-sweep comment below), then
  // does a full render() so the incoming mode lays out fresh rather than
  // inheriting geometry computed for the other mode's #ribbon height rules.
  function setRibbonMode(mode) {
    if (mode === ribbonMode || (mode !== "cards" && mode !== "blocks")) return;
    // Close open expand state directly rather than through the animated
    // close paths (collapseFence/closeExpandedCard) — those exist to leave
    // a kept element in a clean collapsed state, but the element is about
    // to be removed entirely below, so animating it first is wasted work
    // and risks touching a mid-animation node.
    collapseAllFences();
    if (cardExpandedKey !== null) {
      cardExpandedKey = null;
      hideCardChildRow();
    }
    const outgoing = ribbonMode === "cards" ? cardEls : blockEls;
    for (const el of outgoing.values()) el.remove();
    outgoing.clear();
    ribbonMode = mode;
    // Same guard as the module-init read above: persisting the preference
    // is best-effort — a blocked-storage origin still gets the toggle for
    // this session, it just won't be remembered.
    try {
      localStorage.setItem("fs_ribbon_mode", mode);
    } catch {
      /* preference not persisted — non-fatal */
    }
    if (lastAssembly) render(lastAssembly.sessions, lastLockIntervals);
  }

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
    renderWeekStrip(dayThreads);
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
    if (anchorMode === "right" && heightMode === "tiered") applyDefaultZoomWindow(events, wrap);
    if (ribbonMode === "cards") paintCards(events, hostNames);
    else paint(events, hostNames);
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
      if (anchorMode === "right" && heightMode === "tiered") {
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
    // Strip vs. ribbon geometry now genuinely diverge (spec §7c,
    // 2026-08-22 strip-ordering rework): "uniform" lays out ONLY the open
    // tabs, in Chrome's own tab-strip order, fixed pitch, no time math —
    // stripLayout() — instead of reusing layout()'s real time-based x/w
    // over the full assembled event set. Closed history never appears in
    // the strip at all (there's no meaningful "Chrome order" for a past
    // visit). "tiered" is completely unchanged: real assembly, fences,
    // gaps-as-absence, the works. plates/bars/gaps are empty in uniform
    // mode (fences/expand-bars/hour-ticks are already reserved-space-free
    // there — see bandBottom below) — every later use of them in this
    // function degrades to a no-op on an empty array, not a special case.
    let segs, plates, bars, gaps, dividers, total;
    if (heightMode === "uniform") {
      // Built straight from lastOpenTabs/lastSessions (stripEventsFrom
      // OpenTabs), NOT from `events` (bug fix, spec §7c, 2026-08-22): the
      // `events` param here is assembleThreads(parseSessions(sessions,
      // viewDayStart))'s output, day-filtered — an open tab whose most
      // recent real session isn't from TODAY silently isn't in `events`
      // at all, so filtering it for the strip dropped that tab entirely
      // (real specimen: 3 of 4 pinned tabs, 1 of 6 regular tabs vanished).
      // The strip has no reason to care about calendar days — every
      // currently open tab belongs there, always. Sorted by tabIndex
      // defensively (stripEventsFromOpenTabs already builds from
      // openTabs' own Chrome-order array, so this should already be a
      // no-op — kept as an explicit guarantee, not a fix for anything
      // observed here).
      const stripEvents = stripEventsFromOpenTabs(lastOpenTabs, lastSessions).sort(
        (a, b) => a.tabIndex - b.tabIndex
      );
      ({ segs, total } = stripLayout(stripEvents));
      plates = [];
      bars = [];
      gaps = [];
      dividers = [];
      axis = null; // categorical axis — time has no meaning here
    } else {
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
    // #ribbon.uniform-height (2026-08-22): lets timeline.css key hover/
    // other visual effects off strip vs. tiered state without a per-tile
    // class — see .blk:hover's :not(#ribbon.uniform-height) guard.
    ribbon.classList.toggle("uniform-height", heightMode === "uniform");
    // heightMode "uniform" (2026-08-22): the ribbon's own frame collapses
    // to exactly STRIP_TILE_H, no title/axis reservation — the collapsed
    // strip needs none of that, and it's what makes the strip genuinely
    // short (not just its tiles). "tiered" keeps the historical frame.
    const bandBottom = heightMode === "uniform" ? STRIP_TILE_H : TITLE_AREA + BAND_H;
    ribbon.style.width = total + "px";
    // Right-pin underflow pad (spec §7d, 2026-08-23): holds the right edge
    // when content is too narrow to scroll. 0 whenever it overflows, so the
    // scrollable regime is untouched. Overlay + tiered only — same gate as
    // render()'s scroll reset.
    const padWrap = qs("ribbon-wrap");
    let padPx = 0;
    let padRightPx = 0;
    if (anchorMode === "right" && heightMode === "tiered") {
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
    ribbon.style.height = (heightMode === "uniform" ? bandBottom : bandBottom + AXIS_AREA) + "px";
    qs("ribbon-empty").hidden = segs.length > 0;

    ribbon.querySelectorAll(".transient").forEach((el) => el.remove());

    const seen = new Set();
    for (const s of segs) {
      // heightMode "uniform" (2026-08-22, Active Tab Manager collapsed
      // strip): every top-level block forces STRIP_TILE_H regardless of
      // band — tier is shown by fill/border color only, matching a real
      // Chrome tab strip. Contained children have no room and no need at
      // rest, so they're left OUT of `seen` entirely while uniform — the
      // ordinary end-of-loop sweep (unseen keys get their element removed)
      // cleans up any child el a previous "tiered" paint created, exactly
      // like a real exit. "tiered" (the historical default, unchanged)
      // keeps contained children at one uniform height regardless of band
      // (spec §6, 2026-08-07) — containment frames, never confers stature;
      // standalone blocks, collapsed sticks, and expanded fence members
      // keep the three-way tier heights.
      if (heightMode === "uniform" && s.contained) continue;
      seen.add(s.key);
      let el = blockEls.get(s.key);
      if (!el) {
        el = document.createElement("div");
        el.className = "blk";
        ribbon.appendChild(el);
        blockEls.set(s.key, el);
      }
      const h =
        heightMode === "uniform" ? STRIP_TILE_H : s.contained ? CONTAIN_CHILD_H : TIER_H[s.band];
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
      // .open-tab (2026-08-22 unification): a real, always-current class —
      // NOT the retired open-tabs-only pipeline's own element set, just a
      // CSS/hover hook so the pointerover handler (below) and timeline.css
      // can identify "this block represents a tab the user has open right
      // now" the same way .earned-high/.incomplete/.cut already work.
      el.classList.toggle("open-tab", !!s.e.isOpenTab);
      // .active-tab (2026-08-24): the one currently-focused tab. Only ever
      // set from the strip's own event list (stripEventsFromOpenTabs) —
      // the tiered ribbon's blocks come from real finalized sessions, where
      // "active" is not a property of a historical visit. Carries the
      // high-contrast rim that .open-tab used to wear in the strip, where
      // every tile is open and the mark distinguished nothing (timeline.css).
      el.classList.toggle("active-tab", !!s.e.active);
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
      if (s.collapsed || heightMode === "uniform") {
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
    }
    for (const [key, el] of blockEls) {
      if (!seen.has(key)) {
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

    // Close box (restored 2026-08-23, spec §7c): a hover-revealed × per strip
    // tile, matching Chrome's own. Existed as .fs-close on the pre-
    // unification .fs-tab tiles and was lost as collateral when Phase 2
    // replaced that DOM with shared .blk blocks — background.js's
    // FS_CLOSE_TAB handler never went away, so this only restores the UI.
    // Strip only (closing a historical block is meaningless), and never on
    // pinned tabs: real Chrome doesn't offer a close box on those either.
    // No onRemoved plumbing needed — the background broadcast already
    // re-syncs every strip in the window on any close, from any source.
    for (const s of segs) {
      const el = blockEls.get(s.key);
      if (!el) continue;
      const wants = heightMode === "uniform" && s.e.isOpenTab && !s.e.pinned && s.e.openTabId != null;
      if (!wants) {
        if (el._closeEl) {
          el._closeEl.remove();
          el._closeEl = null;
        }
        continue;
      }
      if (!el._closeEl) {
        const x = document.createElement("span");
        x.className = "blk-close";
        x.textContent = "×";
        x.title = "Close tab";
        // Stops the click reaching .blk's own switch-to-tab handler.
        x.addEventListener("click", (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          chrome.runtime
            .sendMessage({ type: "FS_CLOSE_TAB", tabId: x._tabId })
            .catch((err) => log("close request failed:", err?.message));
        });
        el.appendChild(x);
        el._closeEl = x;
      }
      el._closeEl._tabId = s.e.openTabId;
    }

    log(`rendered ${segs.length} blocks in ${plates.length} fences + ${bars.length} expanded, ${total}px wide`);

    // Capacity check LAST, once the real laid-out total is known and the DOM
    // is settled (spec §7e): if the loaded range no longer fills the viewport,
    // pull in one more day. At most one per paint — see maybeLoadOlderDay.
    maybeLoadOlderDay(total);
  }

  // --- Open tabs as real sessions (Active Tab Manager Phase 2, spec §7b,
  // UNIFIED 2026-08-22: "one classic ribbon list... that just happens to
  // show the currently open tabs on the far right hand side"). Replaces
  // the earlier separate open-tabs pipeline (openTabSegsBase/
  // layoutStripGeom/layoutRibbonGeom/drawOpenTabSegs, retired) — that
  // pipeline deliberately never touched assembleThreads()/layout(),
  // which is exactly why zoom (wired only to the historical pipeline)
  // never revealed real history through it. Every open tab is now a
  // genuine, session-SHAPED entry spliced into the same array render()
  // assembles — same container/thread/tier treatment as any closed
  // visit, keyed by assembleThreads()'s own scheme once it runs, not a
  // synthetic "tab:"+tabId placeholder. The only thing special about an
  // open tab is that it's still accumulating: no real endTime yet, so
  // `incomplete` records that as a flag on otherwise-ordinary data,
  // rather than a parallel code path.
  //
  // background.js's capture-side finalize-only contract for `sessions`
  // (chrome.storage.local) is untouched — nothing here ever writes to
  // storage; this is display-only tagging of an in-memory array.
  //
  // REWRITTEN 2026-08-22 (real bug found and corrected same day the
  // original version shipped — see decisions/tabmanager.md "Open-tab
  // duration was fabricated, not real attention"): the original version
  // (below, for the record) called itself "session-shaped" but actually
  // invented brand-new timing for EVERY open tab, including ones with
  // real, already-finalized history — `durMs = now - prior.startTime`
  // measures "time elapsed since your last recorded visit began," which
  // is NOT attention (spec §1: activity is the sole proxy for
  // importance). A real 85-second visit at 2:49pm rendered as a
  // 2.5-hour-wide block by 5pm — confirmed via direct chrome.storage.local
  // inspection, not assumed. It also DUPLICATED data: a tab with real
  // prior history got a second, separate synthetic object for the same
  // time window, spliced in alongside the real session already in
  // `sessions` (render() did `[...sessions, ...synthetic]`, no dedup).
  //
  // This version tags REAL session objects in place instead of inventing
  // parallel ones. One function, one place, one comment block — the
  // explicit goal (Scott, 2026-08-22) is no more of this drifting apart
  // into two slightly-different ideas of "what is an open tab's data."
  //
  // Returns a NEW array (shallow-copies tagged sessions; never mutates
  // the original `sessions` array or its objects) ready to feed straight
  // into render() — no separate splice step at the call site.
  function markOpenTabs(openTabs, sessions) {
    // Most recent finalized session per open tabId — chrome.storage.local's
    // `sessions` is finalize-only (no write happens before a visit ends),
    // so an open tab's CURRENT in-progress visit is never in here; this
    // is "best real evidence for this tab," not "what's happening right
    // now." The gap that leaves (the actively-focused tab's newest
    // moments may lag until it finalizes — on tab switch/hide/close, all
    // of which already call finalizeCurrent in background.js) is
    // accepted, not designed around (Scott, 2026-08-22: every OTHER open
    // tab was already finalized the moment you switched away from it —
    // only the one tab you're looking at right now can possibly lag, and
    // only until the next real boundary).
    const latestByTab = new Map();
    for (const s of sessions) {
      if (s.tabId == null) continue;
      const prev = latestByTab.get(s.tabId);
      if (!prev || s.endTime > prev.endTime) latestByTab.set(s.tabId, s);
    }
    const out = sessions.slice();
    for (const [t, tabIndex] of openTabs.map((t, i) => [t, i])) {
      const prior = latestByTab.get(t.id);
      if (prior) {
        // Tag the REAL session in place (shallow copy — sessions/its
        // objects are never mutated) — no new startTime/endTime/durMs of
        // any kind. This tab's real, already-finalized attention is
        // exactly what it is; "still open" is a flag, not a reason to
        // invent more duration on top of real data.
        const idx = out.indexOf(prior);
        out[idx] = { ...prior, isOpenTab: true, openTabId: t.id, tabIndex, pinned: !!t.pinned };
      } else {
        // No real evidence at all for this tab today — a genuinely new
        // tab. Case A (open-and-closed within one heartbeat) was
        // explicitly ruled out of scope earlier (Scott: "seems very
        // unlikely... I don't want to worry about it too much"), so this
        // branch exists only for "opened moments ago, first heartbeat
        // hasn't landed in `sessions` yet" — durMs: 0 (a real, honest
        // zero, not a fabricated span) anchored at `now` (NOT viewDayStart
        // — this tab was just opened, it belongs at the right edge near
        // "now," not at the start of the day) so it renders as the
        // smallest legitimate block rather than inventing a story.
        out.push({
          id: "open:" + t.id,
          tabId: t.id,
          url: t.url || "",
          startTime: Date.now(),
          endTime: Date.now(),
          durMs: 0,
          heartbeats: 0,
          audibleMs: 0,
          activity: {},
          endReason: null,
          favIconUrl: t.favIconUrl || "",
          title: t.title || "",
          isOpenTab: true,
          openTabId: t.id,
          incomplete: true,
          pinned: !!t.pinned,
          tabIndex,
        });
      }
    }
    return out;
  }

  // --- Card paint (plans/stack-ribbon.md Stage 1, 2026-08-11): the live
  // paint path. paint() above (block-ribbon: width=duration, fence/stick,
  // hour axis) is kept dormant, not deleted, per the plan's explicit
  // "keep the code to the side" direction — this is a different display
  // mechanism, not a tuning pass on the old one.
  //
  // One card per assembled event (thread/container), left-to-right,
  // chronological, uniform width/spacing (cardLayout). Height is tier
  // (CARD_TIER_H). Card face = snapshot only, fetched eagerly (unlike the
  // old lazy hover-only fetch — every card needs its image up front, not
  // just a hovered one); falls back to a plain tier-fill when no snapshot
  // exists. No on-face domain label (dropped 2026-08-11 follow-up): site
  // name now shows only in the below-card hover text (cardHoverText,
  // above), keeping the card face pure image. Containers get a plain
  // corner count badge — no drop-down shelf (Stage 3). Click-to-open stays;
  // the floating tooltip is replaced by cardHoverText for cards.
  const cardEls = new Map();

  // Hover-gap effect (Stage 5, 2026-08-15) — see CARD_GAP_MAX_PX's own
  // comment for the design. lastCardSegs is cardLayout's most recent
  // output (rest positions only — never mutated by the gap effect itself,
  // which is why the traveling card's rest slot is always recoverable),
  // refreshed each paintCards call so the gap math never reads stale
  // layout after a repaint (day paging, live data refresh, tier changes).
  let lastCardSegs = [];
  // The expanded card's own lastCardSegs entry, held here while it's
  // excluded from lastCardSegs (2026-08-15) — toggleCardExpand pulls it out
  // on expand, splices it back on collapse, so the exclusion and its
  // reversal both take effect the instant a click happens rather than
  // waiting for the next paintCards repaint to catch up (that lag was the
  // actual bug: live scanning right after a click still found the
  // expanded card in a stale lastCardSegs and translateX'd it).
  let fullCardSeg = null;
  // Splices fullCardSeg (if set) back into lastCardSegs at its original
  // chronological (rest-x) position, then clears fullCardSeg. Shared by
  // both toggleCardExpand branches (collapse, and expand-while-swapping-
  // directly-between-two-expanded-cards) — same restore, same reasoning.
  function restoreFullCardSeg() {
    if (!fullCardSeg) return;
    const idx = lastCardSegs.findIndex((s) => s.x > fullCardSeg.x);
    if (idx === -1) lastCardSegs.push(fullCardSeg);
    else lastCardSegs.splice(idx, 0, fullCardSeg);
    fullCardSeg = null;
  }
  // Which seg key currently owns the offset, and how much — module-level
  // (not recomputed from scratch each frame) purely so applyCardTransform
  // can distinguish "this card, clear its offset" from "every other card,
  // leave untouched" without a full pass over cardEls every pointermove.
  let gapKey = null;
  let gapOffsetPx = 0;
  // The two piles' own offsets — normally fixed at ±CARD_GAP_HALF_PX (per
  // the "piles are fixed" model) whenever a gap is active, but relaxCardGap
  // tweens them independently of gapOffsetPx on exit (all three shrink to 0
  // together, but they're separate values, not one shared one — a pile
  // never has a "live" value while hovering, only while relaxing). Both 0
  // at rest/no-gap.
  //
  // Centering fix (2026-08-15): previously only the right pile moved (to
  // CARD_GAP_MAX_PX) while the left pile stayed at identity — that anchored
  // the visible gap's LEFT edge to the left pile's rest position, so the
  // cursor (tracking the gap's midpoint by feel) always read as sitting on
  // the gap's left side, not centered. Now both piles shift by half the
  // total gap width, in opposite directions, so the gap opens evenly
  // around wherever the cursor actually is.
  let leftPileOffsetPx = 0;
  let rightPileOffsetPx = 0;
  let gapRafId = null; // in-flight exit-relax OR enter-ease tween, if any
  // Entry ease (2026-08-15 follow-up): mirrors the exit relax below, but for
  // OPENING a gap instead of closing one. gapEnterT0 is the timestamp the
  // current entry-ease run started, or null when no entry-ease is in flight
  // (steady state: pointermove writes gap*/pile offsets directly, no easing
  // lag). Unlike the exit relax — which has no live cursor input and so
  // tweens toward a fixed end value (0) — entry has to keep tracking a
  // MOVING cursor, so this can't capture one start/end pair up front. Model:
  // updateCardGap always computes the raw cursor-driven TARGET offsets first
  // (unchanged math); while gapEnterT0 is set, the three displayed offsets
  // (gapOffsetPx/leftPileOffsetPx/rightPileOffsetPx) ease toward whatever
  // that target currently is, re-read fresh every tick — not toward a
  // snapshot — so a still-moving cursor during entry doesn't fight the ease.
  // Once t reaches 1 (GAP_ENTER_MS elapsed), gapEnterT0 clears and later
  // calls go back to writing the target directly, same as before this
  // feature existed.
  let gapEnterT0 = null;
  let lastCursorX = 0; // most recent #ribbon-relative cursor X; entry-ease's self-tick re-invokes updateCardGap with this when the pointer itself hasn't moved
  // Whether the pointer is currently over #ribbon. Lets card-collapse decide
  // whether to resume live gap tracking or ease the gap shut.
  let ribbonHovered = false;
  // Post-click dead zone: gapFreezeX is the cursor X at the moment the
  // expanded card was clicked; gapDeadZoneActive is a one-way latch, true on
  // every fresh expand, that flips permanently false once the cursor strays
  // past CARD_GAP_HALF_PX from gapFreezeX. See updateCardGap for how it's
  // used. Both meaningless when cardExpandedKey is null.
  let gapDeadZoneActive = false;
  let gapFreezeX = 0;

  // Steady-state vs. entry-ease dispatch for the three cursor-driven
  // offsets (2026-08-15, entry-ease follow-up). Called every updateCardGap
  // with this call's freshly-computed targets. While gapEnterT0 is set,
  // eases the painted values toward the targets over GAP_ENTER_MS,
  // re-reading the target fresh each call (not a captured snapshot) so a
  // still-moving cursor during entry doesn't fight the ease — once t
  // reaches 1 the ease is done, gapEnterT0 clears, and later calls fall
  // through to the direct-write branch, same as before entry-ease existed.
  function applyGapOffsets(targetGap, targetLeft, targetRight) {
    if (gapEnterT0 == null) {
      gapOffsetPx = targetGap;
      leftPileOffsetPx = targetLeft;
      rightPileOffsetPx = targetRight;
      return;
    }
    const t = Math.min(1, (performance.now() - gapEnterT0) / GAP_ENTER_MS);
    gapOffsetPx = gapOffsetPx + (targetGap - gapOffsetPx) * t;
    leftPileOffsetPx = leftPileOffsetPx + (targetLeft - leftPileOffsetPx) * t;
    rightPileOffsetPx = rightPileOffsetPx + (targetRight - rightPileOffsetPx) * t;
    if (t >= 1) {
      gapEnterT0 = null;
    } else {
      // Keep ticking even if the cursor stops moving mid-entry — without a
      // self-driven rAF loop here, the ease would stall at whatever t the
      // last pointermove happened to land on, since nothing else calls
      // updateCardGap on its own. gapRafId is shared with the exit-relax
      // loop (mutually exclusive: entry only ever runs while the cursor is
      // actively over #ribbon, exit only after it leaves).
      if (gapRafId != null) cancelAnimationFrame(gapRafId);
      const key = gapKey;
      gapRafId = requestAnimationFrame(() => {
        gapRafId = null;
        if (gapKey === key) updateCardGap(lastCursorX);
      });
    }
  }

  // Applies ONE card's full transform: base swivel (rotateY, unchanged) is
  // set separately in paintCards (it's on .card-face, not .card — see
  // index.html's splitting-rationale comment); THIS writes .card's own
  // transform — just the gap-effect translateX (the old translateY riffle
  // lift is gone, see CARD_GAP_MAX_PX-adjacent history — it's redundant
  // with the gap effect itself now).
  //
  // Three roles a card can have, each a different translateX (2026-08-15,
  // rebuilt after two rounds of feel-testing, then widened again the same
  // day to shift both piles for centering — see CARD_GAP_MAX_PX's comment
  // for the full model this now implements):
  //   - key === gapKey: the traveling card, translateX(gapOffsetPx) —
  //     the ONLY continuously-animated value in the whole mechanism,
  //     lerping between the two pile boundaries below as cursor moves.
  //   - side === "right" (every card right of gapKey, the "right pile"):
  //     translateX(CARD_GAP_HALF_PX) — a FIXED constant, not gapOffsetPx.
  //     Never varies while gapKey stays the same; only steps when gapKey
  //     itself changes (one card transferring piles at handoff).
  //   - side === "left" (every card left of gapKey, the "left pile"):
  //     translateX(-CARD_GAP_HALF_PX) — same fixed-constant treatment,
  //     mirrored to the other side.
  //   - side === null (no gap active): identity — translateX(0).
  // Every card's transform is written explicitly every call this fires
  // from (not left alone), so a card that changed piles doesn't visibly
  // stick at its previous role's value.
  function applyCardTransform(el, key, side) {
    // gap-active (2026-08-15, handoff-disambiguation): border highlight on
    // whichever card is currently key === gapKey. Handled here (not a
    // separate pass, not a CSS class) because this function already runs
    // every frame for every card off the exact key === gapKey condition
    // the highlight needs, AND face.style.borderColor is already
    // inline-set every full repaint (paintCards, TIER_RIM/EARNED_RIM) — an
    // inline write always beats a CSS class selector regardless of
    // specificity, so a CSS-only .gap-active rule silently never won
    // (index.html's original attempt). `key != null` guard: relaxCardGap's
    // settle() calls this with key/gapKey BOTH null (gapKey is cleared
    // just before), which would otherwise read as a false match and strand
    // the highlight on. Falls back to el.dataset.restBorderColor (stashed
    // by paintCards alongside its own borderColor write) rather than "" —
    // clearing to empty would drop back to .card-face's unstyled default
    // border, not this card's real tier/earned color.
    // Excludes the expanded card outright (2026-08-15 bug fix) — the
    // highlight is a ribbon-deck concept ("which card would a click act
    // on"), meaningless once a card has actually expanded below the deck;
    // without this, the highlight rode down with the expanding card's own
    // animateCardTo transition (border/glow visibly traveling to the
    // enlarged slot) since nothing had ever cleared gap-active on expand.
    const isGapActive = key != null && key === gapKey && key !== cardExpandedKey;
    el.classList.toggle("gap-active", isGapActive);
    const faceEl = el.firstChild;
    if (faceEl) faceEl.style.borderColor = isGapActive ? GAP_ACTIVE_BORDER : el.dataset.restBorderColor || "";
    if (key === gapKey) {
      el.style.transform = `translateX(${gapOffsetPx}px)`;
      // Label does NOT ride with the card (2026-08-15 follow-up — this WAS
      // the original Stage 5 design, "have the label... move with the
      // card... reinforce the fact that the card we're focusing on has the
      // same label," but Scott's later feel-test: pixel-for-pixel tracking
      // the fast traveling card made the label "nearly impossible to read."
      // Replacement lives in updateLabelGapCenter/labelGapCenterPx — a
      // separately-eased position stable while gapKey stays the same, only
      // re-targeted at a handoff. Nothing to do here anymore.)
    } else if (side === "right" && rightPileOffsetPx !== 0) {
      el.style.transform = `translateX(${rightPileOffsetPx}px)`;
    } else if (side === "left" && leftPileOffsetPx !== 0) {
      el.style.transform = `translateX(${leftPileOffsetPx}px)`;
    } else {
      el.style.transform = "";
    }
  }

  // Core position formula: given raw cursor X in #ribbon's own coordinate
  // space (offsetLeft space — same space cardLayout's seg.x lives in),
  // find which gap it falls in and compute that gap's card's lerp offset.
  // "Piles are fixed, only the traveling card moves" (2026-08-15 rebuild,
  // Scott's catch on the previous cut: the right pile was re-shifting
  // every frame in lockstep with the traveling card, which is why the gap
  // never read as visible — the two were moving together, so no
  // separation ever opened between them). The LEFT pile boundary is
  // always -CARD_GAP_HALF_PX and the RIGHT pile boundary is always
  // +CARD_GAP_HALF_PX — both fixed constants, only ever stepping (not
  // easing) when gapKey itself changes at a handoff. The traveling card
  // is the only thing that's a continuous function of cursorX, lerping
  // between those same two fixed boundaries. (Centering fix, same day:
  // both boundaries used to be 0 and CARD_GAP_MAX_PX — i.e. the gap's
  // left edge was pinned to the left pile's untouched rest position — now
  // split evenly so the cursor reads as sitting in the gap's middle.)
  function updateCardGap(cursorX) {
    // The expanded card (if any) has left the deck row entirely — it's
    // WAAPI-driven to its own expanded slot below the deck, so gap math
    // against its rest x would be meaningless there. But scanning past it is
    // still allowed once the cursor clears the post-click dead zone: within
    // CARD_GAP_HALF_PX of the click point, hold the gap exactly where it was
    // (stable target for the click-then-move-down gesture); past that, latch
    // the dead zone off for good and fall through to live scanning below.
    if (cardExpandedKey != null && gapDeadZoneActive) {
      if (Math.abs(cursorX - gapFreezeX) <= CARD_GAP_HALF_PX) return;
      gapDeadZoneActive = false;
    }
    const segs = lastCardSegs;
    if (!segs.length) return;
    const wasInactive = gapKey == null; // entry-ease trigger, see gapEnterT0's comment
    // Gap i is the span between segs[i]'s rest left edge and segs[i+1]'s —
    // segs[i] is the traveling card for that whole span (deliberately the
    // LEFT card of the pair, not the right: "the card currently hovered/
    // peak stays traveling until fully handed off," decided explicitly
    // during design — see decisions/timeline_design.md). Before the first
    // card and after the last, there is no gap to travel across.
    let i = -1;
    for (let j = 0; j < segs.length - 1; j++) {
      if (cursorX >= segs[j].x && cursorX < segs[j + 1].x) {
        i = j;
        break;
      }
    }
    let frac; // 0 = at the gap's near/left boundary, 1 = at the far/right boundary
    if (i === -1) {
      const nearest = cursorX < segs[0].x ? segs[0] : segs[segs.length - 1];
      gapKey = nearest.key;
      frac = cursorX < segs[0].x ? 0 : 1;
    } else {
      const left = segs[i];
      const right = segs[i + 1];
      const span = right.x - left.x;
      frac = span > 0 ? Math.min(1, Math.max(0, (cursorX - left.x) / span)) : 0;
      gapKey = left.key;
    }
    // Card moves AGAINST the cursor, not with it (design doc: "as I
    // traverse right to left of the expansion, the target card moves left
    // to right" — cursor and card close the distance from opposite ends).
    // At the gap's near (left) edge — cursor just arrived from the left,
    // card is furthest right, i.e. still reaching TOWARD where the cursor
    // came from — offset is at its max (+CARD_GAP_HALF_PX, matching the
    // right pile's own fixed position); it eases down to -CARD_GAP_HALF_PX
    // (matching the left pile's fixed position) as the cursor advances
    // toward the right boundary, where handoff to the next card happens.
    // (1 - frac), not frac, for the direction; the -CARD_GAP_HALF_PX offset
    // recenters the whole lerp range around 0 instead of 0..CARD_GAP_MAX_PX.
    //
    // These three are the cursor-driven TARGETs, not necessarily what gets
    // painted this frame (2026-08-15, entry-ease follow-up) — see
    // applyGapOffsets below, which either writes them straight through
    // (steady state) or eases the painted values toward them (entry, first
    // GAP_ENTER_MS after a gap opens).
    const targetGapOffsetPx = (1 - frac) * CARD_GAP_MAX_PX - CARD_GAP_HALF_PX;
    const targetLeftPileOffsetPx = -CARD_GAP_HALF_PX;
    const targetRightPileOffsetPx = CARD_GAP_HALF_PX;
    if (wasInactive) {
      // Fresh entry: start painted offsets at identity (0) and let
      // applyGapOffsets ease them toward the target below, instead of
      // snapping straight to it — the open mirrors the existing close.
      gapOffsetPx = 0;
      leftPileOffsetPx = 0;
      rightPileOffsetPx = 0;
      gapEnterT0 = performance.now();
    }
    applyGapOffsets(targetGapOffsetPx, targetLeftPileOffsetPx, targetRightPileOffsetPx);
    // Full pass every call, not just the traveling card (the SET of cards
    // in each pile changes as gapKey itself moves from gap to gap, so a
    // card that changed piles since the last call needs its transform
    // explicitly reset, not just left at its last value). segs is already
    // in chronological/left-to-right rest-x order, so index vs. gapKey's
    // own index is exactly the left/right pile split.
    const gapIdx = segs.findIndex((s) => s.key === gapKey);
    for (let j = 0; j < segs.length; j++) {
      const s = segs[j];
      const el = cardEls.get(s.key);
      if (!el) continue;
      applyCardTransform(el, s.key, j === gapIdx ? null : j > gapIdx ? "right" : "left");
    }
    // The card IN THE GAP is the sole hover/label target while a gap is
    // active (2026-08-15, Scott's catch): "there should always be a
    // concept of a card in the gap... only the card in the gap should be
    // the label that is shown, and that label should animate across the
    // gap with the card." gapKey already IS that card — updateCardGap is
    // now the single authority for cardHoverText whenever a gap exists,
    // superseding raw pointerover (which would otherwise show whatever
    // STATIC neighbor the cursor happens to be physically over). Runs
    // every pointermove, so this stays correct continuously, not just at
    // the moment of a DOM element-enter.
    //
    // Label X itself is NOT gapOffsetPx (2026-08-15 follow-up, Scott: the
    // label riding pixel-for-pixel with the fast-traveling card made it
    // "nearly impossible to read") — updateLabelGapCenter (below) tracks a
    // separately-eased position, stable while gapKey stays the same and
    // only re-targeted (then eased, not snapped) at a handoff.
    updateLabelGapCenter(segs[gapIdx]);
    const gapEl = cardEls.get(gapKey);
    if (gapEl !== cardEls.get(cardExpandedKey)) {
      showCardHoverTextFor(gapEl, gapKey, labelGapCenterPx);
    }
  }

  // Exit relax (Stage 5): the one place actual time-based easing applies
  // — cursor has left #ribbon, so there's no cursor X left to derive a
  // position from. Plain JS rAF tween, not a CSS transition (index.html's
  // .card comment explains why: a CSS transition would also fight the
  // live per-pointermove writes above while the pointer is still moving).
  const GAP_EXIT_MS = 180;
  // Entry ease (2026-08-15 follow-up, Scott: "can we add an animated open
  // as well? just the reverse"): same duration as exit, for symmetry — see
  // applyGapOffsets/gapEnterT0's own comments for how entry differs
  // mechanically (has to keep tracking a live cursor, exit doesn't).
  const GAP_ENTER_MS = 180;
  function relaxCardGap() {
    if (gapRafId != null) cancelAnimationFrame(gapRafId);
    // Bug fix (2026-08-15): if gapKey still equals cardExpandedKey (true
    // right after a click-to-expand — nothing resets gapKey synchronously
    // at expand time, only the next live scan would, and that scan is
    // exactly what this function runs INSTEAD OF), settle it immediately
    // rather than let the eased step() loop below run its translateX slide
    // against the expanded card's own element. lastCardSegs already
    // excludes the expanded card (so gapIdx below correctly comes back -1,
    // pile keys empty) — but the TRAVELING card itself is read straight
    // from gapKey, not from lastCardSegs, so that one card's eased slide
    // was the one path the lastCardSegs filter didn't cover: the expanded
    // card visibly sliding when the cursor returned to its old deck X.
    if (gapKey === cardExpandedKey) {
      gapKey = null;
      gapOffsetPx = 0;
      leftPileOffsetPx = 0;
      rightPileOffsetPx = 0;
      return;
    }
    // Pile keys: snapshotted once at the start of the relax, not
    // recomputed per tick — the SET doesn't change mid-relax (no cursor
    // input driving it anymore), only the offset magnitudes do.
    const gapIdx = lastCardSegs.findIndex((s) => s.key === gapKey);
    const rightPileKeys = gapIdx === -1 ? [] : lastCardSegs.slice(gapIdx + 1).map((s) => s.key);
    const leftPileKeys = gapIdx === -1 ? [] : lastCardSegs.slice(0, gapIdx).map((s) => s.key);
    const settle = () => {
      gapRafId = null;
      gapEnterT0 = null; // in case exit interrupted a still-in-flight entry ease
      const key = gapKey;
      gapKey = null;
      gapOffsetPx = 0;
      leftPileOffsetPx = 0;
      rightPileOffsetPx = 0;
      const el = key != null ? cardEls.get(key) : null;
      if (el) applyCardTransform(el, null, null);
      for (const k of rightPileKeys) {
        const pEl = cardEls.get(k);
        if (pEl) applyCardTransform(pEl, null, null);
      }
      for (const k of leftPileKeys) {
        const pEl = cardEls.get(k);
        if (pEl) applyCardTransform(pEl, null, null);
      }
    };
    if (gapKey == null || (gapOffsetPx === 0 && leftPileOffsetPx === 0 && rightPileOffsetPx === 0)) {
      settle();
      return;
    }
    const key = gapKey;
    const startCard = gapOffsetPx;
    const startLeftPile = leftPileOffsetPx;
    const startRightPile = rightPileOffsetPx;
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / GAP_EXIT_MS);
      gapOffsetPx = startCard * (1 - t);
      leftPileOffsetPx = startLeftPile * (1 - t);
      rightPileOffsetPx = startRightPile * (1 - t);
      const el = cardEls.get(key);
      if (el) applyCardTransform(el, key, null);
      for (const k of rightPileKeys) {
        const pEl = cardEls.get(k);
        if (pEl) applyCardTransform(pEl, null, "right");
      }
      for (const k of leftPileKeys) {
        const pEl = cardEls.get(k);
        if (pEl) applyCardTransform(pEl, null, "left");
      }
      if (t < 1) {
        gapRafId = requestAnimationFrame(step);
      } else {
        settle();
      }
    };
    gapRafId = requestAnimationFrame(step);
  }

  {
    const ribbon = qs("ribbon");
    ribbon.addEventListener("pointermove", (ev) => {
      if (gapRafId != null) {
        cancelAnimationFrame(gapRafId); // live cursor input pre-empts any in-flight exit relax or entry-ease self-tick
        gapRafId = null;
      }
      const rect = ribbon.getBoundingClientRect();
      lastCursorX = ev.clientX - rect.left; // entry-ease's self-driven rAF re-tick (applyGapOffsets) needs this when the cursor itself hasn't moved
      ribbonHovered = true;
      updateCardGap(lastCursorX);
    });
    ribbon.addEventListener("pointerleave", () => {
      ribbonHovered = false;
      // Dead-zone freeze survives leaving the ribbon (the move onto the
      // expanded card below routinely exits the ribbon's own bottom edge).
      if (cardExpandedKey != null && gapDeadZoneActive) return;
      relaxCardGap();
    });
    // Click redirect (2026-08-15, Scott's catch — same root cause as the
    // label bug above, same fix shape): "there should always be a concept
    // of a card in the gap... as long as there's a gap opened, only the
    // card in the gap should open on click." Per-card el.onclick (set in
    // paintCards) is bound to whatever DOM element receives the click,
    // which is the STATIC neighbor once a sibling has traveled away from
    // its own screen position — same DOM-hit-testing mismatch as the
    // label bug, not a second issue. Fix takes the SAME shape as the label
    // fix (redirect to gapKey, don't touch geometry/z-index/DOM order):
    // capture phase, so this runs and can stopPropagation BEFORE the
    // clicked element's own bubble-phase onclick fires. Only intercepts
    // while a gap is genuinely active (gapKey set AND not already the
    // expanded card, matching updateCardGap's own suppression) — outside
    // a gap, cards behave exactly as before, untouched.
    ribbon.addEventListener(
      "click",
      (ev) => {
        if (gapKey == null || gapKey === cardExpandedKey) return;
        const target = ev.target.closest(".card");
        if (!target) return; // clicks outside any card (e.g. empty ribbon space) pass through unchanged
        // Bug fix (2026-08-15): a click on the ALREADY-EXPANDED card (its
        // close button, its body, anywhere inside it) must never be
        // redirected — the expanded card lives below the deck row, still
        // inside #ribbon's DOM, and gapKey keeps tracking whatever the
        // cursor last scanned over up in the deck; those two can easily
        // disagree while the user reaches down to close the open card.
        // Without this guard, closing re-triggered toggleCardExpand(gapKey,
        // ...) on a DIFFERENT card before closeBtn's own bubble-phase
        // handler ever ran (this listener is capture-phase, so it always
        // goes first) — closing looked like "a previous card reopens."
        if (target === cardEls.get(cardExpandedKey)) return;
        ev.stopPropagation();
        ev.preventDefault();
        toggleCardExpand(gapKey, Math.max(CARD_TIER_H.high, 1));
      },
      true
    );
  }

  // Click-to-expand state (Stage 2, distinct from the dormant fence
  // ribbon's own `expandedKey` above — named separately so the two don't
  // get confused while the old code sits alongside this, per the plan's
  // "keep the code, don't delete it" direction). At most one card expanded
  // at a time; el._anim (per element, set in animateCardTo) is how an
  // in-flight animation is found and interrupted.
  let cardExpandedKey = null;
  // Container child carousel (Stage 3, 2026-08-11): which item is in the
  // big expanded slot for the CURRENTLY expanded card — 0 is always the
  // container itself, 1..N are s.e.children in chronological order (see
  // carouselItemsOf). Always resets to 0 on a fresh expand (Scott: reset,
  // don't remember the last-viewed child) — toggleCardExpand's job, not
  // this declaration's.
  let cardCarouselIndex = 0;
  // One shared reused strip (same pattern as cardHoverText/quickLabel) —
  // repositioned per expanded card rather than one per card in the deck,
  // since at most one card is ever expanded. Lives outside .card-face
  // (Scott: "below the whole expanded card, own strip") so it isn't
  // subject to the card's own rotateY/flatten transform.
  const cardChildRow = document.createElement("div");
  cardChildRow.id = "card-child-row";
  cardChildRow.className = "card-child-row";
  cardChildRow.hidden = true;
  qs("ribbon").appendChild(cardChildRow);

  function hideCardChildRow() {
    cardChildRow.hidden = true;
    cardChildRow.textContent = "";
  }

  // The carousel's item list for one container card: item 0 is the
  // container's own event, 1..N are its children in chronological order
  // (s.e.children is already stored chronologically — spec §6 container
  // assembly). Non-containers (no children) get a one-item list — callers
  // check .length > 1 to decide whether the row/carousel applies at all.
  function carouselItemsOf(e) {
    return [e, ...(e.children || [])];
  }

  // Deck (collapsed) geometry for one card, as painted by paintCards —
  // recomputed on demand (not cached) since it's cheap and paintCards is
  // the only writer of the authoritative s.x/s.w/s.h values baked into
  // el.dataset at paint time.
  function cardDeckGeom(el) {
    return {
      left: parseFloat(el.dataset.deckLeft),
      top: parseFloat(el.dataset.deckTop),
      width: parseFloat(el.dataset.deckWidth),
      height: parseFloat(el.dataset.deckHeight),
      perspective: parseFloat(el.dataset.deckPerspective),
    };
  }

  // Expanded geometry for one card: native snapshot aspect (CARD_ASPECT),
  // capped to fit BOTH viewport axes, horizontally centered under the
  // card's own deck left edge, positioned below the deck's bottom edge
  // (maxH + CARD_HOVER_TEXT_H) so it can never overlap a deck card by
  // construction (Scott, 2026-08-11: "when it's done, it is not
  // overlapping any cards at all").
  //
  // Height cap (Stage 3, 2026-08-11 — see CARD_EXPAND_VIEWPORT_BOTTOM_
  // MARGIN's comment): the page is a normal scrolling document, not a
  // locked viewport shell, so "avoid vertical scrolling" means fitting the
  // WHOLE expanded assembly — image + (for a container) its child row —
  // inside whatever window height remains below the deck, read once at
  // click time same as the width cap. hasChildren is passed by the caller
  // (toggleCardExpand knows the event; this function only sees the DOM
  // element) since the child row's reserved space only applies to
  // containers.
  function cardExpandGeom(el, maxH, hasChildren) {
    const deck = cardDeckGeom(el);
    const wrapEl = qs("ribbon-wrap");
    const viewportW = Math.max(wrapEl.clientWidth - CARD_EXPAND_VIEWPORT_MARGIN, CARD_TIER_W.low);
    const deckBottom = maxH + CARD_HOVER_TEXT_H;
    // + CARD_HOVER_TEXT_H when there's a child row: budgets room for that
    // row's own below-thumbnail hover label too (see setRibbonExpandedHeight
    // for the matching #ribbon-height reserve and why).
    const childRowReserve = hasChildren ? CARD_CHILD_ROW_GAP + CARD_CHILD_THUMB_H + CARD_HOVER_TEXT_H : 0;
    const availableH = Math.max(
      window.innerHeight -
        wrapEl.getBoundingClientRect().top -
        deckBottom -
        CARD_EXPAND_GAP -
        childRowReserve -
        CARD_EXPAND_VIEWPORT_BOTTOM_MARGIN,
      CARD_TIER_H.low
    );
    // "Native" size means the snapshot's own captured resolution, not the
    // deck tier height scaled up. SNAP_WIDTH lives in background.js
    // (capture-side); rather than import it, use the loaded <img>'s own
    // naturalWidth/naturalHeight when available (the true native size of
    // THIS card's snapshot), falling back to CARD_ASPECT at a generous
    // fixed width if the image hasn't resolved yet.
    const img = el._img;
    const nativeW = img && img.naturalWidth ? img.naturalWidth : 1280;
    const nativeH = img && img.naturalHeight ? img.naturalHeight : Math.round(nativeW / CARD_ASPECT);
    // Shrink to fit: fixed CARD_EXPAND_SCALE is the normal target (clean,
    // predictable downscale, not an arbitrary fit-to-window fraction); the
    // viewport/height caps still apply beneath it so a small window can't
    // force overflow/scrolling — whichever of the three is most
    // constraining wins.
    const scale = Math.min(CARD_EXPAND_SCALE, viewportW / nativeW, availableH / nativeH);
    const width = Math.round(nativeW * scale);
    const height = Math.round(nativeH * scale);
    const centerX = deck.left + deck.width / 2;
    // Clamp to the wrap's current scroll position, not 0: .card is
    // positioned absolute inside the scrolling wrap, so left/top are
    // scroll-content coordinates, and wrapEl.scrollLeft is where the
    // visible viewport's left edge currently sits in that space. Cards
    // near the left edge would otherwise center under the cursor and run
    // off-screen.
    const minLeft = wrapEl.scrollLeft + CARD_EXPAND_VIEWPORT_MARGIN;
    return {
      left: Math.max(Math.round(centerX - width / 2), minLeft),
      top: Math.round(deckBottom + CARD_EXPAND_GAP),
      width,
      height,
    };
  }

  // Runs (or interrupts + replaces) the WAAPI animation moving one card
  // between its deck and expanded geometry. `toExpanded` picks the target;
  // `.card` owns left/top/width/height/perspective, `.card-face` owns the
  // rotateY — two synced animations (same duration, started in the same
  // tick) since WAAPI keyframes apply to one element's properties at a
  // time. Only `top` overshoots (CARD_EXPAND_BOUNCE_PX) — width/height/
  // rotation ease in plainly alongside it, per Scott's "just the vertical
  // drop bounces" answer. Interruption (clicking a different card mid-
  // animation) is exactly why WAAPI over CSS @keyframes/class-toggling:
  // el._anim is a live Animation object, so a new call here just cancels
  // whatever's in flight and starts fresh from wherever the card actually
  // is right now (computed via getComputedStyle), no snap.
  function animateCardTo(el, target, rotateDeg, maxH) {
    if (el._anim) el._anim.forEach((a) => a.cancel());
    const cs = getComputedStyle(el);
    const from = {
      left: parseFloat(cs.left) || 0,
      top: parseFloat(cs.top) || 0,
      width: parseFloat(cs.width) || 0,
      height: parseFloat(cs.height) || 0,
      perspective: parseFloat(cs.perspective) || Math.round(maxH * CARD_PERSPECTIVE_RATIO),
    };
    const face = el.firstChild;
    const fromRotate = /rotateY\(([-\d.]+)deg\)/.exec(face.style.transform);
    const startDeg = fromRotate ? parseFloat(fromRotate[1]) : swivelDegFor(el._e && el._e.band);
    // Only the collapse-to-deck callers pass a nonzero rotateDeg (expand
    // always flattens to 0, where the pivot is moot) — both animate `top`
    // TOWARD target.top, so that's the right basis, not a per-frame value.
    const pivotPx = swivelPivotPx(target.top);
    face.style.transformOrigin = `0px ${pivotPx}px`;
    el.style.perspectiveOrigin = `0px ${pivotPx}px`;

    // Scaling (left/width/height/perspective) finishes at CARD_EXPAND_SIZE_
    // DONE_AT (Scott, 2026-08-11: "scaling be done in roughly 70-80%... of
    // the duration of the vertical drop") — WITHOUT that intermediate
    // keyframe, left/width/height/perspective only had offset-0/offset-1
    // values and so interpolated linearly across the FULL duration, same
    // as `top`. But `top` visually settles by 0.75 (it's already at target
    // ± bounce there) while size kept growing all the way to 1 — reading as
    // "movement stopped, scaling continues" (Scott's diagnosis, exactly
    // right). Fix: give left/width/height/perspective their own keyframe at
    // CARD_EXPAND_SIZE_DONE_AT holding the final value, then repeat that
    // value at offset 1 (a WAAPI keyframe list needs a value at 1 for the
    // property to stay resolved through the rest of the timeline).
    const boxAnim = el.animate(
      [
        { left: from.left + "px", width: from.width + "px", height: from.height + "px", top: from.top + "px", perspective: from.perspective + "px", offset: 0 },
        {
          left: target.left + "px",
          width: target.width + "px",
          height: target.height + "px",
          perspective: target.perspective + "px",
          offset: CARD_EXPAND_SIZE_DONE_AT,
          easing: CARD_EXPAND_EASE,
        },
        { top: target.top + (target.top > from.top ? CARD_EXPAND_BOUNCE_PX : -CARD_EXPAND_BOUNCE_PX) + "px", offset: 0.75, easing: CARD_EXPAND_EASE },
        { left: target.left + "px", width: target.width + "px", height: target.height + "px", top: target.top + "px", perspective: target.perspective + "px", offset: 1 },
      ],
      { duration: CARD_EXPAND_MS, easing: CARD_EXPAND_EASE, fill: "forwards" }
    );
    const faceAnim = face.animate(
      [
        { transform: `rotateY(${startDeg}deg)`, offset: 0 },
        { transform: `rotateY(${rotateDeg}deg)`, offset: 1 },
      ],
      { duration: CARD_EXPAND_MS, easing: CARD_EXPAND_EASE, fill: "forwards" }
    );
    el._anim = [boxAnim, faceAnim];
    Promise.all([boxAnim.finished, faceAnim.finished])
      .then(() => {
        // Bake the final values into inline style and cancel the WAAPI
        // animation (which only holds its result via `fill: forwards` on
        // top of the underlying style) so paintCards's own inline-style
        // writes on the next paint aren't fighting a lingering animation.
        el.style.left = target.left + "px";
        el.style.top = target.top + "px";
        el.style.width = target.width + "px";
        el.style.height = target.height + "px";
        el.style.perspective = target.perspective + "px";
        face.style.transform = `rotateY(${rotateDeg}deg)`;
        boxAnim.cancel();
        faceAnim.cancel();
        if (el._anim && el._anim[0] === boxAnim) el._anim = null;
      })
      .catch(() => {}); // interrupted mid-flight by a newer animateCardTo call — that call owns el._anim now
  }

  // Toggles expand/collapse for one card. Handles both directions of the
  // simultaneous pair (Scott: "these two forward and backward animations
  // need to happen simultaneously") — each card animates along its own
  // path (old expanded card -> its own deck spot, new card -> its own
  // expanded spot), not a shared slot, since re-centering is per-card.
  function toggleCardExpand(key, maxH) {
    const prevKey = cardExpandedKey;
    const prevEl = prevKey ? cardEls.get(prevKey) : null;
    const el = cardEls.get(key);
    if (!el) return;

    if (prevKey === key) {
      // Collapse the currently-expanded card back to its deck spot.
      // Bug fix (2026-08-15): closing while parked on a child carousel item
      // used to leave that child's screenshot/tipData/onclick on the deck
      // face — toggleCardExpand never repaints (see comment below), so
      // nothing else would restore the container's own view. Snap back to
      // the container (index 0) BEFORE collapsing, same as reopening does.
      if (cardCarouselIndex !== 0) selectCarouselItem(el, 0);
      cardExpandedKey = null;
      // Bug fix (2026-08-15): lastCardSegs' expanded-card exclusion (see
      // paintCards) is only as fresh as the last REPAINT (~every 10s / on
      // data change), but cardExpandedKey changes on every click — live
      // scanning (updateCardGap) right after this click, before the next
      // repaint lands, would otherwise still find this card's stale entry
      // (or lack of one) in lastCardSegs. rest-x/w/h don't change between
      // paints (cardLayout is a pure function of events, unaffected by
      // expand state), so re-syncing the ONE entry that changed — no
      // reflow, no data recompute — is enough: restore this card's rest
      // slot (fullCardSeg, stashed at expand time below) back into the
      // list, in its original chronological position.
      restoreFullCardSeg();
      el._closeBtn.hidden = true;
      el._info.hidden = true;
      el.classList.remove("expanded"); // same direct-set-on-click reasoning as _closeBtn/_info above
      hideCardChildRow();
      animateCardTo(el, cardDeckGeom(el), swivelDegFor(el._e && el._e.band), maxH);
      setRibbonExpandedHeight(maxH, null);
      // Gap stays open through the click; resolve it now that the card is
      // back in the deck — resume live tracking if the cursor's still over
      // the ribbon, else ease it shut like an ordinary pointerleave.
      gapDeadZoneActive = false;
      if (ribbonHovered) updateCardGap(lastCursorX);
      else relaxCardGap();
      return;
    }

    // The expanding card must not carry its live gap translateX/Y offset
    // into animateCardTo's target below — but animateCardTo only ever
    // animates left/top/width/height/perspective + the face's rotateY, never
    // .card's own transform, so the offset just rides along harmlessly and
    // needs no explicit clearing here.
    if (gapRafId != null) {
      cancelAnimationFrame(gapRafId);
      gapRafId = null;
    }
    gapEnterT0 = null; // in case expand interrupted a still-in-flight entry ease

    // Fresh dead zone for this expand, including when swapping directly
    // between two expanded cards via a live-scan click.
    gapDeadZoneActive = true;
    gapFreezeX = lastCursorX;

    // Restore the PREVIOUS expanded card's entry (if any — direct swap
    // between two expanded cards via live-scan click) before pulling this
    // new one out, same immediacy reasoning as the collapse branch above.
    restoreFullCardSeg();
    cardExpandedKey = key;
    // Pull THIS card's entry out of lastCardSegs immediately (see
    // fullCardSeg's own comment) — stash it so collapse can restore it
    // without needing to re-run cardLayout.
    {
      const idx = lastCardSegs.findIndex((s) => s.key === key);
      if (idx !== -1) fullCardSeg = lastCardSegs.splice(idx, 1)[0];
    }
    cardCarouselIndex = 0; // always reopen on the container itself, never a remembered child
    // paintCards is the only other writer of _closeBtn.hidden/_info.hidden,
    // and it only runs on a data repaint — set them directly here too so
    // the button/info panel show/hide immediately on click, not whenever
    // the next repaint happens to land. hideCardChildRow unconditionally:
    // it's one shared element (like _info would be per-card if it weren't
    // per-card) — belongs to whichever card is expanding NOW, so any prior
    // card's row must clear before (maybe) repainting it below for the new
    // card, or a childless new card would inherit the old card's row.
    if (prevEl) {
      prevEl._closeBtn.hidden = true;
      prevEl._info.hidden = true;
      prevEl.classList.remove("expanded");
    }
    hideCardChildRow();
    el._closeBtn.hidden = false;
    fillCardInfo(el);
    el._info.hidden = false;
    el.classList.add("expanded"); // set immediately, not on next repaint (matches _closeBtn/_info above)
    // Strip the gap highlight explicitly (2026-08-15 bug fix): paintCards'
    // deck-repaint loop skips applyCardTransform entirely for whichever
    // card is cardExpandedKey (see its own "expanded cards are exempt"
    // comment) — so once a card expands, NOTHING ever calls
    // applyCardTransform for it again to clear gap-active, no matter what
    // gapKey does afterward. The card almost always WAS gap-active at the
    // instant of the click (that's the card the click redirect targets),
    // so without this it expands still carrying the blue highlight
    // forever. Restore the plain rest color directly, same fallback
    // applyCardTransform itself uses.
    el.classList.remove("gap-active");
    const faceEl = el.firstChild;
    if (faceEl) faceEl.style.borderColor = el.dataset.restBorderColor || "";
    if (prevEl) animateCardTo(prevEl, cardDeckGeom(prevEl), swivelDegFor(prevEl._e && prevEl._e.band), maxH);
    const items = carouselItemsOf(el._e);
    const hasChildren = items.length > 1;
    const target = cardExpandGeom(el, maxH, hasChildren);
    setRibbonExpandedHeight(maxH, target, hasChildren);
    // Perspective is moot once flattened to rotateY(0) (no convergence to
    // preserve), but scale it the same way deck cards do (CARD_PERSPECTIVE_
    // RATIO x this card's own height) rather than an arbitrary value, so
    // there's no visible discontinuity in the split second before rotation
    // finishes settling to 0.
    const perspective = Math.round(target.height * CARD_PERSPECTIVE_RATIO);
    animateCardTo(el, { ...target, perspective }, 0, maxH);
    if (hasChildren) paintCardChildRow(el, items, target);
  }

  // Switches the big expanded slot to a different carousel item (container
  // itself, index 0, or one of its children) without re-running the
  // expand/collapse animation — the card is already flattened/grown; only
  // the SNAPSHOT and info-panel content swap. Row stays in place; only the
  // "active" highlight moves (see .card-child-thumb.active, index.html).
  // `hostNames` is threaded through from paintCards's own closure argument
  // (stashed on the card element, el._hostNames) — same lookup tipDataOf's
  // caller uses elsewhere, just reached via the element since this can
  // fire long after the paint that created it.
  function selectCarouselItem(el, index) {
    const items = carouselItemsOf(el._e);
    const item = items[index];
    if (!item) return;
    cardCarouselIndex = index;
    const siteName = el._hostNames.get(labelKeyOf(item.host, item.url)) || item.host;
    el._tipData = tipDataOf(item, siteName, null);
    fillCardInfo(el);
    const ids = (item.snapIds || [item.id]).filter(Boolean);
    el._img.hidden = true;
    el._img.removeAttribute("src");
    if (ids.length) {
      const keys = ids.map((id) => "snap:" + id);
      // Own token, not a re-check against cardExpandedKey: collapse
      // (2026-08-15 fix) legitimately calls this for index 0 and THEN nulls
      // cardExpandedKey in the same tick, which would make the old
      // cardEls.get(cardExpandedKey) !== el guard always look stale and
      // silently drop the fetch, leaving the face blank. A fetch is only
      // truly stale once a DIFFERENT call (child click or another
      // selectCarouselItem) has superseded it on this same el.
      const token = Symbol();
      el._carouselFetchToken = token;
      chrome.storage.local
        .get(keys)
        .then((r) => {
          if (el._carouselFetchToken !== token) return;
          const stored = ids.map((id) => r["snap:" + id]).find(Boolean);
          if (!stored) return;
          el._img.src = stored;
          el._img.decode().then(() => { el._img.hidden = false; }).catch(() => {});
        })
        .catch(() => {});
    }
    el._img.onclick = (ev) => {
      if (cardEls.get(cardExpandedKey) !== el) return; // still swiveled/small: let the toggle handler run instead
      ev.stopPropagation();
      chrome.tabs.create({ url: item.url });
    };
    for (const t of cardChildRow.children) t.classList.toggle("active", Number(t.dataset.idx) === index);
  }

  // Builds/repositions the child-carousel thumbnail strip below the
  // expanded card (Stage 3). `target` is the expanded card's own geometry
  // (cardExpandGeom's return) — the row sits CARD_CHILD_ROW_GAP below it,
  // left-aligned to the same left edge, one square-ish thumbnail per
  // carousel item (container first, then children, chronological).
  function paintCardChildRow(el, items, target) {
    cardChildRow.textContent = "";
    const thumbW = Math.round(CARD_CHILD_THUMB_H * CARD_CHILD_THUMB_ASPECT);
    const snapFetches = [];
    items.forEach((item, i) => {
      const thumb = document.createElement("div");
      thumb.className = "card-child-thumb";
      thumb.dataset.idx = String(i);
      thumb.style.width = thumbW + "px";
      thumb.style.height = CARD_CHILD_THUMB_H + "px";
      // Same hover label as deck cards (cardHoverText), just on the child
      // thumbnails now (2026-08-12) — data-tip marks it for the delegated
      // #ribbon pointerover handler, _tipData computed once here (not
      // recomputed on hover) same as selectCarouselItem does for the click
      // path, reusing the same tipDataOf/siteName lookup.
      thumb.dataset.tip = "1";
      const siteName = el._hostNames.get(labelKeyOf(item.host, item.url)) || item.host;
      thumb._tipData = tipDataOf(item, siteName, null);
      const img = document.createElement("img");
      img.alt = "";
      img.hidden = true;
      thumb.appendChild(img);
      thumb.onclick = (ev) => {
        ev.stopPropagation();
        selectCarouselItem(el, i);
      };
      cardChildRow.appendChild(thumb);
      const ids = (item.snapIds || [item.id]).filter(Boolean);
      if (ids.length) snapFetches.push({ img, ids });
    });
    cardChildRow.children[cardCarouselIndex]?.classList.add("active");
    cardChildRow.style.left = target.left + "px";
    cardChildRow.style.top = target.top + target.height + CARD_CHILD_ROW_GAP + "px";
    cardChildRow.hidden = false;
    if (snapFetches.length) {
      const allKeys = [...new Set(snapFetches.flatMap((f) => f.ids.map((id) => "snap:" + id)))];
      chrome.storage.local
        .get(allKeys)
        .then((r) => {
          for (const { img, ids } of snapFetches) {
            const stored = ids.map((id) => r["snap:" + id]).find(Boolean);
            if (!stored) continue;
            img.src = stored;
            img.decode().then(() => { img.hidden = false; }).catch(() => {});
          }
        })
        .catch(() => {});
    }
  }

  // Closes whichever card is currently expanded, if any — a no-op
  // otherwise. Three ways in (Scott, 2026-08-11: "many ways... whichever
  // one they find should work") funnel through this one function: the
  // close (×) button, a click outside the expanded card, and Escape. Added
  // because a card's own deck slot — the ONLY thing toggleCardExpand's
  // el.onclick listens on — is mostly covered by overlapping neighbors
  // once it's sitting collapsed-but-empty behind them (CARD_STEP << card
  // width), so re-clicking the same card to close it isn't reliably
  // reachable in practice. maxH is always CARD_TIER_H.high (not data-
  // dependent — see maxH's own definition in paintCards) so it's safe to
  // recompute here rather than thread it through every caller.
  function closeExpandedCard() {
    if (!cardExpandedKey) return;
    toggleCardExpand(cardExpandedKey, Math.max(CARD_TIER_H.high, 1));
  }

  // Click-outside-to-close (one of the three close paths above). Listens
  // on `document`, not #ribbon, so it also catches clicks on the rest of
  // the page (header, week strip) while a card is expanded. The expanded
  // card's own click already toggles it closed via el.onclick, and the
  // close button stops its own click from reaching here (ev.stopPropagation
  // in both) — this only needs to fire for clicks that landed OUTSIDE the
  // currently-expanded card entirely.
  document.addEventListener("click", (ev) => {
    if (!cardExpandedKey) return;
    const el = cardEls.get(cardExpandedKey);
    if (el && !el.contains(ev.target)) closeExpandedCard();
  });

  // Escape (the third close path). No target check needed — Escape has no
  // other meaning on this page.
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeExpandedCard();
  });

  // Grows #ribbon (and so #ribbon-wrap, which sizes to its only child) to
  // reserve room for the expanded card below the deck+hover-text band —
  // see CARD_EXPAND_GAP comment: this is what makes "no overlap" true by
  // construction rather than needing any neighbor-shifting logic.
  function setRibbonExpandedHeight(maxH, target, hasChildren) {
    const ribbon = qs("ribbon");
    const base = maxH + CARD_HOVER_TEXT_H;
    if (!target) {
      ribbon.style.height = base + "px";
      return;
    }
    // Reserve the child row's own space too (Stage 3) so #ribbon's height
    // still guarantees no overlap by construction, same reasoning as
    // CARD_EXPAND_GAP's own comment — just extended to cover the new row.
    // + CARD_HOVER_TEXT_H (2026-08-12): child thumbnails now show the same
    // below-item hover label deck cards do, positioned below the thumbnail
    // row — without this, #ribbon-wrap's forced overflow-y: auto (Stage 1
    // build log #4) clips that label exactly like the original deck
    // hover-text bug it was fixed for.
    const childRowReserve = hasChildren ? CARD_CHILD_ROW_GAP + CARD_CHILD_THUMB_H + CARD_HOVER_TEXT_H : 0;
    ribbon.style.height = target.top + target.height + childRowReserve + CARD_EXPAND_GAP + "px";
  }

  function paintCards(events, hostNames) {
    const { segs, total } = cardLayout(events);
    // Stage 5: refreshed every paint so the hover-gap effect's boundary
    // lookup (updateCardGap) never reads stale rest positions after a
    // repaint (day paging, live data refresh, tier changes) — gapKey
    // itself is left alone here; the next pointermove (or the applyCard-
    // Transform calls below, for the currently-gapped card) reconciles it
    // against the new layout. gapBlockIdx: same "index > gapKey's own
    // index" block-shift boundary updateCardGap uses, recomputed against
    // THIS paint's fresh segs (a repaint mid-hover must not leave a card
    // block-shifted, or not, based on the previous paint's ordering).
    //
    // lastCardSegs EXCLUDES the expanded card (2026-08-15, structural fix —
    // "if it's expanded, it's not really in the ribbon"): this is the one
    // list updateCardGap/relaxCardGap scan to find gaps/piles, and an
    // expanded card has already left the deck row for its own WAAPI-driven
    // slot below — including it there meant every consumer of that scan had
    // to separately remember "oh, except the expanded one" (the click
    // redirect, hover-text suppression, gap-active exclusion, and this
    // function's own translateX guard all grew their own copy of that
    // check, and one was still missed — the bug where resumed scanning
    // visibly translateX'd the already-expanded card). Filtering ONCE here
    // means gap adjacency naturally treats the expanded card's former left/
    // right neighbors as directly adjacent, same as if it were never laid
    // out at all — no separate guard needed at each scan site.
    // segs itself (unfiltered) still keeps the expanded card's entry — its
    // rest x/y still needs to exist for the per-card loop below (dataset
    // bookkeeping, animating back to the deck on collapse) and for every
    // OTHER card's uniform CARD_STEP position to stay correct.
    lastCardSegs = segs.filter((s) => s.key !== cardExpandedKey);
    // Keep fullCardSeg (toggleCardExpand's stash of the expanded card's own
    // rest slot, restored on collapse) in sync with THIS repaint's fresh
    // positions — a repaint can legitimately land while a card is expanded
    // (day paging, live data refresh; see the "must not overwrite mid-
    // animation" guard below), and collapse must restore the CURRENT rest
    // slot, not whatever stale one was captured back at click time.
    if (cardExpandedKey != null) {
      fullCardSeg = segs.find((s) => s.key === cardExpandedKey) || null;
    }
    const gapBlockIdx = segs.findIndex((s) => s.key === gapKey);

    const ribbon = qs("ribbon");
    const maxH = Math.max(CARD_TIER_H.high, 1);
    // + CARD_GAP_MAX_PX (2026-08-15 follow-up): the block-shift fix above
    // moves the right-hand block up to CARD_GAP_MAX_PX past its rest
    // position via `transform`, which — per the CSS spec — does NOT grow
    // an element's layout/scroll size. Without this padding, #ribbon-wrap's
    // overflow-x: auto clips the shifted tail instead of it being
    // scrollable into view whenever the gap is live near the right edge of
    // the deck. Reserved unconditionally (not just while a gap is active)
    // so #ribbon's width never jumps between hovered/idle, which would
    // itself shift scroll position underfoot. Kept as the full
    // CARD_GAP_MAX_PX (not just CARD_GAP_HALF_PX, even though the right
    // pile itself now only ever shifts by the half distance) — cheap slack,
    // no harm in reserving more than currently needed on this side.
    ribbon.style.width = total + CARD_GAP_MAX_PX + "px";
    // Left-side counterpart (2026-08-15, centering fix): the left pile now
    // also shifts — by -CARD_GAP_HALF_PX — while a gap is active, which
    // would otherwise carry the leftmost cards left of #ribbon-wrap's own
    // left edge (clipped, since scrollLeft can't go negative — #ribbon is
    // left-justified at rest by design, see index.html's #ribbon-wrap
    // comment). A permanent CARD_GAP_HALF_PX left margin reserves exactly
    // enough room for that shift without ever clipping. NOT the same
    // mechanism as the lead-spacer that was tried and reverted for zoom
    // (2026-08-08, index.html's #ribbon-wrap comment) — that was a large
    // spacer div that made scrollLeft:0 show blank space and read as
    // drifting; this is a small fixed margin sized to a real, permanent
    // shift the gap effect performs, not a zoom-anchoring device, and
    // (being constant) never itself moves under panning.
    ribbon.style.marginLeft = CARD_GAP_HALF_PX + "px";
    // + CARD_HOVER_TEXT_H reserves room for cardHoverText below the deck —
    // see that constant's comment: #ribbon-wrap clips anything positioned
    // below #ribbon's own height, so the hover-text band must be counted
    // into it, not left to float past the bottom edge. Skipped while a
    // card is expanded (Stage 2) — setRibbonExpandedHeight already grew
    // this to fit the expanded card, and a repaint (e.g. live data
    // refresh) shouldn't yank that back out from under an open card.
    if (!cardExpandedKey) ribbon.style.height = maxH + CARD_HOVER_TEXT_H + "px";
    qs("ribbon-empty").hidden = segs.length > 0;

    // No hour axis, no gap plates, no fences in Stage 1 — the .transient
    // sweep still clears any leftover nodes from the old paint() path in
    // case both ever ran against the same #ribbon (they don't, but this
    // keeps the DOM honest if that ever changes).
    ribbon.querySelectorAll(".transient").forEach((el) => el.remove());

    const seen = new Set();
    const snapFetches = [];
    for (const [j, s] of segs.entries()) {
      seen.add(s.key);
      let el = cardEls.get(s.key);
      if (!el) {
        el = document.createElement("div");
        el.className = "card";
        const face = document.createElement("div");
        face.className = "card-face";
        const img = document.createElement("img");
        img.className = "card-img";
        img.alt = "";
        img.hidden = true;
        const info = document.createElement("div");
        info.className = "card-info";
        info.hidden = true;
        const closeBtn = document.createElement("button");
        closeBtn.className = "card-close";
        closeBtn.type = "button";
        closeBtn.textContent = "×";
        closeBtn.hidden = true;
        closeBtn.setAttribute("aria-label", "Collapse card");
        // stopPropagation so this doesn't also hit el.onclick (which would
        // immediately re-toggle it back open). maxH isn't captured from
        // this paint's closure — it's always CARD_TIER_H.high regardless of
        // data (see maxH's own definition below), so closeExpandedCard just
        // recomputes it fresh rather than risk a stale value from whichever
        // paint happened to create this button.
        closeBtn.onclick = (ev) => {
          ev.stopPropagation();
          closeExpandedCard();
        };
        face.append(img, info, closeBtn);
        el.appendChild(face);
        el._img = img;
        el._info = info;
        el._closeBtn = closeBtn;
        ribbon.appendChild(el);
        cardEls.set(s.key, el);
      }
      // Bottom-flush within the max tier height, left-to-right at uniform
      // spacing — the swivel transform (CSS) rotates off the card's own
      // left edge, so position here is the pre-swivel box. Recorded into
      // dataset regardless of expand state (cardDeckGeom's source of
      // truth for animating back to the deck) even though the inline
      // style writes below are skipped for the currently-expanded card.
      const deckPerspective = Math.round(s.h * CARD_PERSPECTIVE_RATIO);
      el.dataset.deckLeft = Math.round(s.x);
      el.dataset.deckTop = maxH - s.h;
      el.dataset.deckWidth = s.w;
      el.dataset.deckHeight = s.h;
      el.dataset.deckPerspective = deckPerspective;
      const face = el.firstChild;
      // Stage 2: the currently-expanded card owns its own left/top/width/
      // height/perspective/rotation via animateCardTo — a live repaint
      // (e.g. data refresh while a card is open) must not overwrite those
      // mid-animation or snap it back to the deck.
      if (s.key !== cardExpandedKey) {
        el.style.left = Math.round(s.x) + "px";
        el.style.top = maxH - s.h + "px";
        el.style.width = s.w + "px";
        el.style.height = s.h + "px";
        // perspective lives on .card (the rotated element's PARENT), scaled
        // to THIS card's own height (CARD_PERSPECTIVE_RATIO comment above) so
        // the vertical convergence ratio — not just the rotation angle or
        // projected width — reads the same regardless of tier; origin pinned
        // to the same left edge the rotation itself is anchored to.
        el.style.perspective = deckPerspective + "px";
        // Shared pivot (see CARD_PIVOT_Y_FRAC/swivelPivotPx), set on both
        // the rotated element (transform-origin) and its parent
        // (perspective-origin — must live on the parent).
        {
          const pivotPx = swivelPivotPx(maxH - s.h);
          face.style.transformOrigin = `0px ${pivotPx}px`;
          el.style.perspectiveOrigin = `0px ${pivotPx}px`;
        }
        face.style.transform = `rotateY(${swivelDegFor(s.band)}deg)`;
        // Rest border color, stashed BEFORE applyCardTransform (below) so
        // its gap-active branch can restore exactly this value when the
        // card is NOT the gap card, instead of guessing/clearing to an
        // unstyled default. See applyCardTransform's own comment for why
        // this can't just be a CSS rule.
        el.dataset.restBorderColor =
          s.band === "high" && hasEarnedHigh(s.e) ? EARNED_RIM : TIER_RIM[s.band];
        // Stage 5: reapply this card's current gap-effect transform (its
        // own live offset if it's the traveling card, a pile shift if it's
        // left/right of the gap, identity otherwise) — a freshly-created
        // card, or one whose transform predates this paint, must not sit
        // at a stale value. Expanded cards are exempt (see the `s.key !==
        // cardExpandedKey` guard this sits inside): they're WAAPI-driven
        // and never participate in the gap effect.
        applyCardTransform(
          el,
          s.key === gapKey ? gapKey : null,
          s.key === gapKey ? null : j > gapBlockIdx ? "right" : "left"
        );
      }
      face.style.background = TIER_FILL[s.band];
      el.classList.toggle("earned-high", s.band === "high" && hasEarnedHigh(s.e));
      el.classList.toggle("tier-low", s.band === "low");

      const siteName = hostNames.get(labelKeyOf(s.e.host, s.e.url)) || s.e.host;
      // Stashed so selectCarouselItem (fired long after this paint, on a
      // child-thumbnail click) can look up this card's children and
      // resolve host names without threading extra params through.
      el._e = s.e;
      el._hostNames = hostNames;

      // Close button + info overlay only on the currently-expanded card
      // (Stage 2) — one of three close paths, see closeExpandedCard's
      // comment.
      const isExpanded = s.key === cardExpandedKey;
      el._closeBtn.hidden = !isExpanded;
      el._info.hidden = !isExpanded;
      el.classList.toggle("expanded", isExpanded);

      // Snapshot: eager fetch (Stage 1 needs every visible card's image up
      // front, not just a hovered one — spec §6's lazy tooltip fetch stays
      // for the tooltip path below, this is a separate eager one for the
      // card face). Best-scoring member that HAS a picture wins, same rule
      // as the tooltip. Skip the fetch if we already resolved this card's
      // image in a prior paint (img.dataset.snapKey matches). Skipped
      // entirely while this card is expanded on a CHILD carousel item
      // (Stage 3) — s.e is the container's own data; overwriting the image/
      // tipData here would yank the view back to the container out from
      // under a live data repaint, same reasoning Stage 2 already applies
      // to left/top/width/height below.
      const onChildItem = isExpanded && cardCarouselIndex !== 0;
      const snapKey = (s.e.snapIds || [s.e.id]).join(",");
      if (!onChildItem && el._img.dataset.snapKey !== snapKey) {
        el._img.dataset.snapKey = snapKey;
        el._img.hidden = true;
        el._img.removeAttribute("src");
        const ids = (s.e.snapIds || [s.e.id]).filter(Boolean);
        if (ids.length) snapFetches.push({ img: el._img, ids });
      }

      // Tooltip stays the interim interaction model (plan Stage 1 scope).
      el.dataset.tip = "";
      if (!onChildItem) {
        el._tipData = tipDataOf(s.e, siteName, null);
        el.dataset.snapIds = (s.e.snapIds || [s.e.id]).join(",");
      }
      // Info panel content rebuilt here too (not just on click) so a data
      // repaint while this card is open keeps it current, same as the
      // image fetch above.
      if (isExpanded && !onChildItem) fillCardInfo(el);

      // Stage 2 click split (Scott, 2026-08-11): clicking the card (its
      // deck hit-box) opens/closes the expand animation; clicking the
      // flattened snapshot image underneath — only reachable once expanded,
      // since it's the same element just grown/flattened in place — is what
      // actually navigates. img.onclick stops propagation so it doesn't
      // ALSO re-toggle the card it sits inside. Skipped while on a child
      // carousel item — selectCarouselItem already set the correct
      // (child-URL) onclick, and this would overwrite it back to the
      // container's own URL.
      el.onclick = () => toggleCardExpand(s.key, maxH);
      if (!onChildItem) {
        el._img.onclick = (ev) => {
          if (s.key !== cardExpandedKey) return; // still swiveled/small: let the toggle handler run instead
          ev.stopPropagation();
          chrome.tabs.create({ url: s.e.url });
        };
      }
    }
    for (const [key, el] of cardEls) {
      if (!seen.has(key)) {
        el.remove();
        cardEls.delete(key);
      }
    }

    // Batch the eager snapshot fetch in one storage.local.get (Stage 1: a
    // busy day can be 30-50+ cards, so one call beats one per card).
    if (snapFetches.length) {
      const allKeys = [...new Set(snapFetches.flatMap((f) => f.ids.map((id) => "snap:" + id)))];
      chrome.storage.local
        .get(allKeys)
        .then((r) => {
          for (const { img, ids } of snapFetches) {
            const stored = ids.map((id) => r["snap:" + id]).find(Boolean);
            if (!stored || img.dataset.snapKey !== ids.join(",")) continue; // stale by the time this resolved
            img.src = stored;
            img.decode().then(() => { img.hidden = false; }).catch(() => {});
          }
        })
        .catch(() => {});
    }

    log(`rendered ${segs.length} cards, ${total}px wide`);
  }

  // Zoom relayout (spec §6, 2026-08-08): re-paints from the CACHED
  // assembly — no thread/container work — so a scroll-wheel zoom stays
  // cheap enough to run every frame. No-op before the first real render.
  // Stage 1's card layout doesn't scale with zoom (uniform width/spacing,
  // no PX_PER_SEC dependency) — relayout still short-circuits through
  // paintCards so a stray wheel event repaints harmlessly rather than
  // erroring, but visually nothing changes with zoom level.
  function relayout() {
    if (!lastAssembly) return;
    if (ribbonMode === "cards") paintCards(lastAssembly.events, lastAssembly.hostNames);
    else paint(lastAssembly.events, lastAssembly.hostNames);
  }

  window.renderTimeline = render;
  window.setRibbonMode = setRibbonMode;
  window.FS_getRibbonMode = () => ribbonMode;
  window.setHeightMode = setHeightMode;
  window.FS_getHeightMode = () => heightMode;
  // Open-tabs entry point (Active Tab Manager Phase 2, spec §7b, UNIFIED
  // 2026-08-22; markOpenTabs corrected + strip data source split out
  // 2026-08-22 same day — see each function's own comment for why): the
  // overlay's own driver (switcher.js) calls this instead of
  // renderTimeline() directly. Two genuinely different consumers now:
  // the RIBBON (tiered) still goes through markOpenTabs → the one real
  // render()/assembleThreads()/parseSessions() pipeline, day-filtered,
  // real data only. The STRIP (uniform) reads lastOpenTabs directly
  // (stripEventsFromOpenTabs, inside paint()) — categorical, every
  // currently open tab, no day filter, since a stale-but-open tab must
  // never vanish from the strip just because its last real activity
  // wasn't today.
  window.FS_renderOpenTabs = (openTabs, sessions) => {
    lastOpenTabs = openTabs;
    render(markOpenTabs(openTabs, sessions));
  };
  // Single source of truth for scoring — the Score-table button in
  // dashboard.js uses these so diagnostics can never drift from the render.
  window.FS_SCORING = { scoreSession, attendedSeconds, bandFor, hostOf };
})();
