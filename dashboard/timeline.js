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

(() => {
  const log = (...args) => console.log("[FS timeline]", ...args);

  // --- Score (spec §6). ⚠ Provisional weights inherited from Desktop4's
  // demo-tuned values — expected to be revisited against real data.
  const W_COPY = 150; // shared by cut — same weight, one constant (copyCutWeight below)
  const W_PASTE = 80;
  const W_DOWNLOAD = 200;
  const KBD_CAP = 200; // 1 point per keystroke, capped: composition ≈ copy-tier
  // Floor-attended copy/cut discount (spec §6, 2026-08-02): at ≤2 heartbeats
  // attended, a copy/cut is copying-in-passing (stray selection, SMS 2FA
  // code) — W_COPY/W_CUT alone was crossing MED_SCORE regardless of
  // context. Drops to W_PASTE's tier, same as paste already gets. Gates on
  // attended time only — kbd count has no natural noise/signal split.
  const COPY_CUT_FLOOR_ATTENDED_S = 20;
  // "The read" premium (spec §6, 2026-07-15): per active scroll window, ONLY
  // on scrollable pages — app-style SPAs (feeds, Maps, Gemini) scroll inner
  // containers and read scrollable=false, so the gate excludes exactly the
  // grazing/churn false positives. Tuned offline against a real day: W=5
  // promoted one block (a read article); W=3 rescued nothing.
  const W_SCROLL = 5;
  // The traversal term (spec §6 Score v1, 2026-07-24): thread assembly adds
  // this per JOIN — machinery navigations and returns alike — on top of the
  // summed member totals. Multiple committed page views are intent the
  // per-signal totals can't see; the joins counted are exactly the
  // survivors of the SPA debounce, blip, and transit filters, so
  // view-state churn and redirect machinery contribute nothing. No
  // user-act gate (rejected on data — plans). Single-day-validated;
  // retest before tuning (watch list).
  const W_NAV = 50;
  const HIGH_SCORE = 1000;
  const MED_SCORE = 150;

  // "Earned" vs. "accumulated" HIGH (2026-08-06, exploratory — see plans):
  // a thread's tier is the band of the SUMMED fragments (spec §6
  // Aggregation), which conflates two different shapes of intent — one
  // fragment that was HIGH on its own (a real, concentrated moment) vs.
  // several lesser fragments piling up via revisits/W_NAV traversal until
  // the sum crosses HIGH_SCORE. A week's data showed these are NOT
  // proxies for each other (only 4/35 HIGH containers that week had an
  // individually-HIGH member) — earned HIGH is rare and worth marking.
  function hasEarnedHigh(e) {
    const members = e.members ? e.members.flatMap((m) => m.members || [m]) : [e];
    return members.some((m) => m.score >= HIGH_SCORE);
  }

  const HOUR = 3600 * 1000;
  // Visit-merge gap limit: a brief tab-away stays the same visit; coming
  // back after minutes of absence is a NEW visit (interruption-by-absence).
  const VISIT_GAP_MS = 5 * 60 * 1000;
  // Container chains bridge longer gaps on gap-audio testimony (revised
  // 2026-07-24; was audible-dominated bookends): the resuming fragment's
  // audibleSinceTs must predate the gap — the tab's own audio testifies
  // the context never ended while the user was off on a whiteboard
  // (spec §6 containers).
  // Currently equals FENCE_BRIDGE_GAP_MS below by coincidence, not by
  // reference (rules audit, 2026-08-06 — WATCHLIST.md "Time-threshold sprawl"):
  // this is a fact about the TAB (its audio never stopped); the fence
  // constant is a fact about the USER (how long a break reads as leaving
  // the machine). Keep them independently tunable — retune one without
  // assuming the other should follow.
  const AUDIO_BOOKEND_GAP_MS = 30 * 60 * 1000;
  // Adjacent-container chaining (spec §6, 2026-08-02): detectContainers only
  // ever chains RAW fragments — two already-assembled same-host containers
  // (or a container and a leftover merged visit) sitting a few minutes
  // apart never get a second look, so a returning-to-LinkedIn pattern with
  // brief step-aways reads as unrelated blocks. Looser than VISIT_GAP_MS
  // (chaining assembled threads is a coarser claim than chaining raw
  // fragments) but tighter than AUDIO_BOOKEND_GAP_MS (no audio evidence
  // requirement at this level) — no natural cliff in a week's gap
  // distribution (9s–29min, smooth), so this is a judgment call pending
  // more data (story: decisions/timeline_design.md).
  const CONTAINER_CHAIN_GAP_MS = 10 * 60 * 1000;

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
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 8;
  let PX_PER_SEC = BASE_PX_PER_SEC;
  const MIN_W = 8; // floor: smallest visible/hoverable block
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
  // 2026-08-11 correction: negative had the left edge receding and the
  // right edge frontmost, backwards) around transform-origin: left keeps
  // the card's own left edge frontmost and swings its RIGHT edge back in
  // Z, which both (a) foreshortens its own projected width to well under 50%
  // of
  // CARD_W (cos(65°) ≈ 0.42) and (b) is what makes tight left-edge spacing
  // read as a physical overlapping stack rather than cards floating apart
  // — CARD_STEP (how far each card's own left edge sits from the previous
  // one) is deliberately narrower than the foreshortened width, so a card
  // visually overlaps/obscures the start of its neighbor (magnify-on-hover,
  // Stage 2, is what un-hides it). Both tuned by eye, not derived.
  const CARD_SWIVEL_DEG = 65;
  // Perspective depth, RATIO not a fixed px value (2026-08-11, corrected
  // AGAIN — see index.html .card comment for the fix history; this was
  // fix #4 for rotation-consistency, not #3). A large fixed perspective
  // (an earlier pass tried 8000px) kills convergence almost entirely —
  // cards read as horizontally SQUASHED rather than rotated (Scott's
  // catch: "no skewing... don't look like rotated cards at all"). A SHORT
  // fixed perspective (900px, the previous value here) does give every
  // card an IDENTICAL PROJECTED WIDTH regardless of tier (verified
  // empirically) — but width was the wrong thing to verify: it does NOT
  // give every card the same VERTICAL convergence ratio (far edge length ÷
  // near edge length), because a taller box's far corners sit at a larger
  // absolute Z at the same rotation angle, and Z ÷ a FIXED perspective
  // distance is what actually drives foreshortening — bigger box, bigger
  // Z, more foreshortening, even though the rotation angle and projected
  // width both matched. This is what Scott's screenshot caught: HIGH
  // converged hard (far edge ≈67% of near edge) while LOW barely converged
  // at all (≈86%) — confirmed by hand-deriving the CSS perspective-
  // projection formula, not by eye. The actual fix: perspective must scale
  // WITH each card's own height, so the Z÷perspective RATIO — not either
  // value alone — stays constant across tiers. CARD_PERSPECTIVE_RATIO is
  // that constant (perspective_px = height × CARD_PERSPECTIVE_RATIO,
  // computed per-card in paintCards); chosen so HIGH (height 260) lands on
  // the same 900px this constant used to be fixed at, leaving HIGH's own
  // look unchanged and correcting LOW/MEDIUM to match it instead.
  const CARD_PERSPECTIVE_RATIO = 900 / 260;
  // px between consecutive cards' own left edges — deliberately less than
  // even the smallest tier's own width (LOW ≈163px post-CARD_ASPECT) so
  // any tier adjacency still overlaps into a stack. Tightened to a third
  // (2026-08-11, Scott: "should be lining up on top of each other") — was
  // 60.
  const CARD_STEP = 20;
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

  // Measured attention: active windows OR audible playback (max, not sum —
  // same-frame video counts in both; audible catches cross-origin embeds).
  function attendedSeconds(s) {
    return Math.max((s.heartbeats || 0) * 10, Math.round((s.audibleMs || 0) / 1000));
  }

  function scoreSession(s) {
    const a = s.activity || {};
    const attended = attendedSeconds(s);
    const copyCutWeight = attended <= COPY_CUT_FLOOR_ATTENDED_S ? W_PASTE : W_COPY;
    return (
      attended +
      copyCutWeight * (a.copy || 0) +
      copyCutWeight * (a.cut || 0) +
      W_PASTE * (a.paste || 0) +
      W_DOWNLOAD * (a.download || 0) +
      Math.min(a.keyboard || 0, KBD_CAP) +
      (s.scrollable ? W_SCROLL * (a.scroll || 0) : 0)
    );
  }

  const bandFor = (score) =>
    score >= HIGH_SCORE ? "high" : score >= MED_SCORE ? "medium" : "low";

  // "www." is scan noise — stripped BEFORE hashing/grouping, so www and
  // naked variants share one identity (color, runs, labels).
  function hostOf(s) {
    try {
      return new URL(s.url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

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

  function fmtDuration(ms) {
    const secs = Math.round(ms / 1000);
    if (secs < 60) return secs + "s";
    const mins = Math.floor(secs / 60);
    if (mins < 60) return mins + "m" + String(secs % 60).padStart(2, "0") + "s";
    // Hour scale drops seconds: "3h49m", not "229m00s" — a multi-hour away
    // span is read at minute precision (spec §6 gap plates).
    return Math.floor(mins / 60) + "h" + String(mins % 60).padStart(2, "0") + "m";
  }

  function hourNum(t) {
    const h = new Date(t).getHours();
    return h % 12 === 0 ? 12 : h % 12;
  }

  function fmtHour(t) {
    return `${hourNum(t)}${new Date(t).getHours() < 12 ? "am" : "pm"}`;
  }

  function fmtClock(t) {
    return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  // Two-section tooltip data (spec §6, 2026-07-18): a user section (bold
  // site name, start + duration, member pages sorted by score) and a debug
  // section gated by TIP_DEBUG. Every string here is page-controlled — the
  // renderer (fillTip) lands them via textContent only, never innerHTML.
  const TIP_DEBUG = true; // demo period: scores + signals visible; flip off for normal use
  const TIP_TITLES_MAX = 8;
  // Untitled pages fall back to the URL, which can be a 2000-char OAuth
  // monster — cap every listed string (display truncation is CSS ellipsis;
  // this bounds what we store on the element). Module-level: both the page
  // dedupe below and tipDataOf's debug section need it.
  const cap = (t) => (t.length > 80 ? t.slice(0, 80) + "…" : t);
  // Flatten a thread (container/merged-visit/lone session) to its member
  // pages, cleaned and deduped by title (best score wins) — used by the
  // tooltip's page list.
  function dedupedPagesOf(e, siteName) {
    // A container's fragments can themselves be merged visits — flatten to
    // the underlying pages so callers see what was actually read.
    const members = e.members ? e.members.flatMap((m) => m.members || [m]) : [e];
    // Page titles carry noise callers shouldn't see: leading unread
    // counters ("(379) …" — they also churn, defeating dedupe) and the
    // boilerplate site-name segment ("… - YouTube") that the bold headline
    // already states. Both stripped generically, front or back position
    // (same separator alphabet as siteNameOf).
    const esc = siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const clean = (t) =>
      t
        .replace(/^\(\d+\)\s*/, "")
        .replace(new RegExp(`\\s+[-–—|·/]\\s+${esc}\\s*$`), "")
        .replace(new RegExp(`^${esc}\\s+[-–—|·/]\\s+`), "");
    const byTitle = new Map(); // dedupe: one entry per title, best score wins
    for (const m of members) {
      const t = cap(clean(m.title || m.url || ""));
      if (!t) continue;
      const prev = byTitle.get(t);
      if (!prev || m.score > prev.score) byTitle.set(t, m);
    }
    let pages = [...byTitle.entries()]
      .map(([title, m]) => ({ title, score: m.score, band: m.band }))
      .sort((a, b) => b.score - a.score);
    // A lone page repeating the site name says nothing — drop it.
    if (pages.length === 1 && pages[0].title === siteName) pages = [];
    return pages;
  }

  function tipDataOf(e, siteName, ctx) {
    const pages = dedupedPagesOf(e, siteName);
    const debug = [
      e.children
        ? `container: ${e.members.length} visits` +
          (e.children.length
            ? ` + ${e.children.length} excursions inside`
            : " (interruptions outside the browser)")
        : e.members
          ? `${e.members.length} pages merged`
          : "",
      Object.entries(e.activity || {})
        .filter(([, v]) => v)
        .map(([k, v]) => `${k} ${v}`)
        .join(" · "),
      // Exact wall-clock span stays here as ground truth (spec §6 hour axis).
      `score ${Math.round(e.score)} (${e.band}) · attended ${attendedSeconds(e)}s · ` +
        `${fmtClock(e.startTime)} – ${fmtClock(e.endTime)}`,
      cap(e.url || ""),
    ].filter(Boolean);
    return {
      siteName,
      meta: `${fmtClock(e.startTime)} · ${fmtDuration(e.durMs)}`,
      pages,
      ctx: ctx || "",
      debug,
    };
  }

  // Admission filter, display rung (spec §3). The predicate and its knobs
  // moved to shared/transit.js (2026-07-24): the service worker applies the
  // SAME rule at finalize to delete snapshots of rejected sessions, so the
  // two sides can never drift.
  const { isTransit } = FS_TRANSIT;

  // Day window (spec §6, 2026-07-16): the ribbon shows ONE local calendar
  // day. A session belongs to the day it ENDS in — midnight-straddlers are
  // rare and short, since tab switches finalize. setHours (not epoch math)
  // keeps midnights honest across DST.
  function dayStartOf(t) {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  function nextDayStart(t) {
    const d = new Date(t);
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }
  function prevDayStart(t) {
    const d = new Date(t);
    d.setHours(-24, 0, 0, 0);
    return d.getTime();
  }
  let viewDayStart = dayStartOf(Date.now());

  // Tab trees (spec §3/§6, 2026-07-19): capture stores the raw opener edge
  // (session.openerTabId); display resolves each tab to its tree ROOT and
  // threads chain per tree — "one tab and its spawn" (the feed pattern:
  // videos middle-clicked into their own tabs are one journey). Edges are
  // read from ALL stored sessions — an edge is a fact about the tab, not
  // the day, and transit-filtered sessions still testify (a filtered hop
  // can be the link between a grandchild and the root). An edgeless tab is
  // a tree of one, so cold tabs and pre-opener data stay flat.
  // Raw edges kept for the spawn-edge dominance discount (spec §6,
  // 2026-07-25): the discount walks the opener PATH, not the resolved
  // root — same-tree via a common ancestor is not spawn testimony.
  let openerEdges = new Map();
  function treeRootsOf(sessions) {
    const opener = new Map();
    for (const s of sessions) {
      if (s.tabId != null && s.openerTabId != null) opener.set(s.tabId, s.openerTabId);
    }
    openerEdges = opener;
    const roots = new Map();
    return function rootOf(id) {
      if (roots.has(id)) return roots.get(id);
      const seen = new Set();
      let t = id;
      while (opener.has(t) && !seen.has(t)) {
        seen.add(t);
        t = opener.get(t);
      }
      seen.add(id);
      for (const v of seen) roots.set(v, t);
      return t;
    };
  }

  function parseSessions(sessions) {
    const from = viewDayStart;
    const to = nextDayStart(viewDayStart);
    const rootOf = treeRootsOf(sessions);
    const inDay = sessions.filter((s) => s.endTime >= from && s.endTime < to && s.url);
    const transits = inDay.filter(isTransit);
    if (transits.length) log(`transit filter dropped ${transits.length} sessions`);
    // Exit inheritance (spec §6, 2026-07-24): dropping a transit stub must
    // not drop its boundary testimony. A stub that would have machinery-
    // joined its same-tab SAME-HOST predecessor is that run's true TAIL —
    // and a visit's exit is its last member's exit — so the predecessor
    // inherits the stub's endReason (overlay only; stored sessions stay
    // untouched). The host test carries the full join conditions: a
    // foreign-host stub (a link-out bounce) was never a would-be member
    // and must not manufacture succession licenses or departure testimony.
    // Without this a 3s next-video stub carries the run's tab_closed away
    // with it and the next queued tab can't succession-join (the Castella
    // specimen, plans); a stub ending tab_hidden likewise bequeaths honest
    // departure testimony for container guard 1.
    const inheritedExit = new Map(); // kept session id -> exit from dropped tail stubs
    const runTail = new Map(); // tabId -> { keeperId, end, reason, host } of the tab's live run
    for (const s of [...inDay].sort((a, b) => a.startTime - b.startTime)) {
      if (s.tabId == null) continue;
      const t = runTail.get(s.tabId);
      if (!isTransit(s)) {
        runTail.set(s.tabId, { keeperId: s.id, end: s.endTime, reason: s.endReason, host: hostOf(s) });
      } else if (
        t &&
        t.keeperId != null &&
        t.host === hostOf(s) &&
        MACHINERY_BOUNDARY.has(t.reason) &&
        s.startTime - t.end < CONTINUATION_GAP_MS
      ) {
        inheritedExit.set(t.keeperId, s.endReason);
        runTail.set(s.tabId, { keeperId: t.keeperId, end: s.endTime, reason: s.endReason, host: t.host });
      } else {
        // A stub that DIDN'T continue the run starts no run of its own —
        // it still occupies the tab slot so a later session can't inherit
        // across it.
        runTail.set(s.tabId, { keeperId: null, end: s.endTime, reason: s.endReason });
      }
    }
    return inDay
      .filter((s) => !isTransit(s))
      .map((s) => {
        const score = scoreSession(s);
        return {
          ...s,
          endReason: inheritedExit.get(s.id) ?? s.endReason,
          host: hostOf(s),
          score,
          band: bandFor(score),
          durMs: s.endTime - s.startTime,
          treeId: s.tabId != null ? rootOf(s.tabId) : undefined,
        };
      })
      .sort((a, b) => a.startTime - b.startTime);
  }

  // Same-host visit merging (spec §6): three merge licenses, all strict-
  // adjacency (nothing between members to hide):
  //   1. LOW rule (2026-07-15): consecutive same-host LOW events with gaps
  //      < VISIT_GAP_MS merge — a fragmented-but-engaged session (Maps
  //      pans, Gmail puttering) earns its combined stature.
  //   2. Continuation rule (2026-07-18): same-tab same-host fragments whose
  //      boundary is navigation machinery (spa_navigation/navigated —
  //      attention never left the tab) merge REGARDLESS of band. Three
  //      back-to-back YouTube videos are one watch, not three slivers.
  //   3. Succession rule (2026-07-24): same-TREE same-host fragments whose
  //      boundary is tab_closed merge REGARDLESS of band — closing a
  //      finished tab to land on the next queued same-host tab is
  //      cross-tab machinery, not departure (the middle-click batch
  //      pattern: one session across the tabs it spawned; the tree key is
  //      the intent test).
  // Individually-HIGH events never merge — they split the run and stand
  // alone (a block that's HIGH by itself owns its story). tab_hidden
  // boundaries never merge under rules 2/3: the user actually left, which
  // is container territory. Scored and banded on the MERGED totals.
  const CONTINUATION_GAP_MS = 30_000; // sanity bound; machinery gaps are ~0
  const MACHINERY_BOUNDARY = new Set(["spa_navigation", "navigated"]);
  function mergeVisits(events) {
    const out = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      if (run.length === 1) {
        out.push(run[0]);
      } else {
        const activity = {};
        let heartbeats = 0;
        let audibleMs = 0;
        let durMs = 0;
        for (const e of run) {
          heartbeats += e.heartbeats || 0;
          audibleMs += e.audibleMs || 0;
          durMs += e.durMs;
          for (const [k, v] of Object.entries(e.activity || {})) {
            if (v) activity[k] = (activity[k] || 0) + v;
          }
        }
        const top = run.reduce((a, b) => (b.score > a.score ? b : a));
        const merged = {
          id: "v" + run[0].id,
          url: top.url, // click target: the visit's top-scoring page
          favIconUrl: top.favIconUrl, // same member as the click target (spec §6, 2026-08-07)
          // Snapshot candidates in score order (spec §6): the tooltip shows
          // the best member that HAS a picture — sub-10s stubs can win the
          // top score (flush-inflated attended) yet are never photographed.
          snapIds: [...run].sort((a, b) => b.score - a.score).map((m) => m.id),
          title: top.title,
          host: run[0].host,
          // Containers chain by tab TREE (2026-07-19; was tabId); a merged
          // visit keeps an identity only if unambiguous across members —
          // notably a cross-tab LOW merge within one tree stays
          // chain-eligible now (the feed pattern's glue used to strip it).
          tabId: run.every((m) => m.tabId === run[0].tabId) ? run[0].tabId : undefined,
          treeId: run.every((m) => m.treeId === run[0].treeId) ? run[0].treeId : undefined,
          // The LAST member's exit is the visit's exit — container guard 1
          // reads it to recognize departure-boundaries (spec §6).
          endReason: run[run.length - 1].endReason,
          startTime: run[0].startTime,
          endTime: run[run.length - 1].endTime,
          durMs, // sum of member durations (attention-honest width)
          heartbeats,
          audibleMs,
          activity,
          // OR of members: the merged score must keep the scroll premium a
          // member earned (the gate would otherwise silently drop it).
          scrollable: run.some((m) => m.scrollable),
          // The FIRST member is the one that resumed after any preceding
          // gap — its gap-audio testimony is the visit's (spec §6).
          ...(run[0].audibleSinceTs != null ? { audibleSinceTs: run[0].audibleSinceTs } : {}),
          members: run,
        };
        // Merged totals + the traversal term: every join — machinery
        // navigation or absence-bridge return — is a committed page view
        // the per-signal totals can't see (spec §6 Score v1, 2026-07-24).
        merged.score = scoreSession(merged) + W_NAV * (run.length - 1);
        merged.band = bandFor(merged.score);
        out.push(merged);
      }
      run = [];
    };
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const prev = run[run.length - 1];
      const lowMerge =
        e.band === "low" &&
        prev &&
        prev.band === "low" &&
        prev.host === e.host &&
        e.startTime - prev.endTime < VISIT_GAP_MS;
      const machineryIn =
        prev &&
        prev.host === e.host &&
        prev.tabId != null &&
        prev.tabId === e.tabId &&
        MACHINERY_BOUNDARY.has(prev.endReason) &&
        e.startTime - prev.endTime < CONTINUATION_GAP_MS;
      // Same-tab HIGH pass-through (2026-08-06; incoming edge fixed
      // 2026-08-07): a HIGH fragment joined to its same-tab same-host
      // neighbor(s) by machinery (spa_navigation/navigated) never left the
      // tab — the boundary is page turnover, not departure, so it's exactly
      // the continuation join's territory (spec §6). Guard 1 says a HIGH
      // "owns its story against foreign frames", not against its own tab's
      // continuation run: the neighbor is already the same host by
      // construction. Either edge being machinery is enough, but the two
      // edges need different handling because `run` can already hold an
      // unrelated leftover event (often on a different tab/host) by the
      // time we reach here:
      //   - INCOMING edge (prev navigated/spa_navigated into this HIGH):
      //     prev is the run's own tail, already correctly placed — the HIGH
      //     simply joins as the run's next member (`continuation`, no
      //     flush). A HIGH reached by machinery but ending in tab_hidden
      //     (read closely, then switched tabs) used to split from its
      //     predecessor here; it no longer does.
      //   - OUTGOING edge only (this HIGH opens a fresh tab, or its
      //     predecessor isn't a same-tab/host match, then it spa_navigates
      //     onward): `run` may hold garbage, so the HIGH must FLUSH first
      //     and then lead a fresh run (`highLeadsRun`) rather than join
      //     blind. The 7:25/7:41 YouTube specimen: a HIGH video opened a
      //     fresh tab (no incoming edge) and spa_navigated into a shorts
      //     binge — outgoing edge alone lets it lead the run instead of
      //     splitting it.
      // A HIGH with no machinery edge at all still stands alone.
      const next = events[i + 1];
      const machineryOut =
        next &&
        next.host === e.host &&
        next.tabId != null &&
        next.tabId === e.tabId &&
        MACHINERY_BOUNDARY.has(e.endReason) &&
        next.startTime - e.endTime < CONTINUATION_GAP_MS;
      // NOTE: highLeadsRun gates on !machineryIn, not !prev — run[] almost
      // always holds SOME leftover event (often on an unrelated tab/host)
      // by the time we reach here, so !prev was true so rarely it never
      // fired on real data.
      const highLeadsRun = e.band === "high" && !machineryIn && machineryOut;
      // A HIGH with an incoming machinery edge joins on that edge alone —
      // machineryIn already implies "same tab, same host, page turnover, no
      // departure", so no further test is needed even when band === "high".
      const continuation = machineryIn;
      const successionIn =
        prev &&
        prev.host === e.host &&
        prev.treeId != null &&
        prev.treeId === e.treeId &&
        prev.endReason === "tab_closed" &&
        e.startTime - prev.endTime < CONTINUATION_GAP_MS;
      // Same-tree HIGH pass-through (2026-08-07; mirrors the 2026-08-06
      // machinery-join fix): succession is cross-tab machinery, same
      // category as the machinery join's page-turnover exception — closing
      // a finished tab to land on the next queued same-host tab is a
      // "binge" pattern regardless of which fragment happens to be HIGH.
      // Same incoming/outgoing split as machineryIn/machineryOut, and for
      // the same reason (`run` may hold an unrelated leftover fragment):
      //   - INCOMING edge (prev was tab_closed, e lands on the queued
      //     tab): prev is already the run's tail — e joins directly via
      //     successionIn, HIGH or not.
      //   - OUTGOING edge only (e itself is HIGH, e's OWN tab is about to
      //     tab_close, and the successor hasn't arrived yet to test): e
      //     must flush and lead a fresh run rather than join blind.
      const successionOut =
        next &&
        next.host === e.host &&
        next.treeId != null &&
        next.treeId === e.treeId &&
        e.endReason === "tab_closed" &&
        next.startTime - e.endTime < CONTINUATION_GAP_MS;
      const highLeadsSuccessionRun = e.band === "high" && !successionIn && successionOut;
      if (lowMerge || continuation || successionIn) {
        run.push(e);
      } else if (e.band !== "high" || highLeadsRun || highLeadsSuccessionRun) {
        flush();
        run.push(e);
      } else {
        flush();
        out.push(e);
      }
    }
    flush();
    return out;
  }

  // Container events (spec §6): a tab the user keeps RETURNING to is a
  // journey context — returning is the strongest intent signal we have.
  // Same-TREE fragments chain (2026-07-19; was same-tabId — treeId is the
  // opener-resolved root, a tab tree being "one tab and its spawn") when
  // the excursion returns within
  // VISIT_GAP_MS, or within AUDIO_BOOKEND_GAP_MS on gap-audio testimony
  // (the tab stayed audible through the gap — 2026-07-24, see the bridge
  // test below). A chain whose SUMMED score reaches MEDIUM (lowered
  // from HIGH, 2026-07-18 — containers map the journey's shape, tier maps
  // importance) becomes a container: fragments merge into the anchor
  // (width = wall-clock span), foreign events inside the span become
  // contained children. Guards so the big-email case can never trigger
  // this: foreign interruptions are REQUIRED (≥1 child), and a HIGH event
  // never joins a FOREIGN-host chain — and no chain whose span would cover
  // a HIGH non-member survives qualification (tree-blind, 2026-07-24).
  // Since 2026-07-19 a HIGH MAY seed or join its own
  // host's chain in its own tab: excluding the anchor's HIGHs decapitated
  // the true anchor in territory contests (the bsky/gemini ping-pong —
  // the rump bsky chain summed 455 against gemini's 924 while the bsky
  // thread's two HIGHs held 2315 inadmissible points, so the tool framed
  // the work; replay evidence in plans). Sub-HIGH chains additionally
  // require ANCHOR DOMINANCE (anchor sum > children sum; spawn-edge
  // discount 2026-07-25 — see the guard below) — a weak anchor
  // framing stronger children is a launcher, and the children are the
  // story (validated 2026-07-18: dominance rejected all five launcher
  // patterns in a week's replay, e.g. interleaved shop/pay ping-pong
  // where two sites each tried to containerize the other). The HIGH path
  // keeps its original guards; dominance is deliberately not applied there.
  function detectContainers(events, quiet, chainGapMs = VISIT_GAP_MS) {
    // Chains key on the (tree, host) PAIR (2026-07-19): a thread is a
    // same-host chain in one tab tree, so each host runs its own chain per
    // tree — a spawned foreign-host read neither joins nor breaks its
    // parent's chain (it becomes a child by falling inside the span), and
    // two hosts ping-ponging inside one tree each keep their own thread.
    // The pair key also makes relaxed guard 1 structural: a HIGH can only
    // ever extend its own host's thread; any HIGH non-member a chain's
    // span would cover is handled by the tree-blind covered-HIGH
    // rejection below (2026-07-24).
    // chainGapMs (2026-08-02): the bridging gap is a parameter, not always
    // VISIT_GAP_MS — assembleThreads calls this fn a second time at
    // CONTAINER_CHAIN_GAP_MS to chain already-assembled containers/visits
    // (adjacent-container chaining, below).
    const open = new Map(); // treeId|host -> fragments of the open chain
    const chains = [];
    const close = (frags) => {
      if (frags.length >= 2) chains.push(frags);
    };
    for (const e of events) {
      if (e.treeId == null) continue;
      const key = e.treeId + "|" + e.host;
      const frags = open.get(key);
      if (frags) {
        const last = frags[frags.length - 1];
        const gap = e.startTime - last.endTime;
        // Gap-audio testimony (spec §6, 2026-07-24): a long gap bridges
        // only when the resuming fragment's unbroken audible stretch began
        // BEFORE the previous fragment ended — the tab demonstrably kept
        // playing the whole time the user was away (a meeting talks
        // through its whiteboard gap; a paused video cannot testify).
        // Replaces the audible-dominated bookend proxy, which the fused
        // YouTube binge defeated (plans). Old sessions lack the stamp and
        // never long-bridge — fails closed.
        // Earned-HIGH atomicity in pass two (spec §6, 2026-08-07): an
        // already-assembled container that earned HIGH from one
        // individually-HIGH member (a real, concentrated moment — not
        // summed via revisits) is a resolved, standalone event. Pass two
        // exists to credit returning to UNFINISHED business (the LinkedIn
        // out-and-back pattern); bridging two resolved events doesn't
        // complete a story, it erases the boundary between two stories
        // (two same-tree back-to-back Meet calls specimen). Applies to
        // EITHER side, not just when both are earned-HIGH — the same
        // dilution happens if a lesser neighbor absorbs an earned-HIGH one.
        // Pass-two only: raw fragments in pass one haven't been
        // individually qualified as containers yet, so hasEarnedHigh isn't
        // the right test there (existing raw-fragment Atomicity covers it).
        const earnedHighAtomic =
          chainGapMs === CONTAINER_CHAIN_GAP_MS &&
          (hasEarnedHigh(last) || hasEarnedHigh(e));
        const bridged =
          !earnedHighAtomic &&
          (gap < chainGapMs ||
            (gap < AUDIO_BOOKEND_GAP_MS &&
              e.audibleSinceTs != null &&
              e.audibleSinceTs <= last.endTime));
        if (bridged) {
          frags.push(e);
          continue;
        }
        close(frags);
        open.delete(key);
      }
      open.set(key, [e]);
    }
    for (const frags of open.values()) close(frags);

    // Summed fragment scores + the traversal term for returns (spec §6
    // Score v1, 2026-07-24): fragment scores already carry their internal
    // join bonuses, so the chain adds only its own returns. Flows into
    // qualification (sum ≥ MEDIUM) and anchor dominance — returning
    // strengthens the anchor's claim, which is the point.
    const chainScore = (frags) =>
      frags.reduce((t, f) => t + f.score, 0) + W_NAV * (frags.length - 1);
    const queue = chains
      .map((frags) => ({ frags, score: chainScore(frags) }))
      .filter((c) => c.score >= MED_SCORE)
      .sort((a, b) => b.score - a.score);

    const containers = [];
    const absorbed = new Set();
    while (queue.length) {
      const c = queue.shift();
      const from = c.frags[0].startTime;
      const to = c.frags[c.frags.length - 1].endTime;
      // Overlap contest (trim-and-retest, 2026-07-19): the higher sum wins
      // the contested span, but the loser is trimmed, not discarded — a
      // handoff between two interleaved threads must not shatter the
      // loser's uncontested run (the 07-18 specimen: bsky's 13-minute
      // chain lost wholesale over a 4-minute seam). Fragments overlapping
      // an accepted container drop out (span-covered ones become its
      // children); the rest re-enter the contest as runs, split wherever
      // an accepted container sits between consecutive fragments,
      // re-summed and re-inserted in score order. Every trimmed piece is
      // strictly smaller than its chain, so the worklist terminates.
      if (containers.some((k) => from < k.endTime && to > k.startTime)) {
        const kept = c.frags.filter(
          (f) => !containers.some((k) => f.startTime < k.endTime && f.endTime > k.startTime)
        );
        const runs = [];
        let run = [];
        for (const f of kept) {
          const prev = run[run.length - 1];
          if (
            prev &&
            containers.some((k) => k.startTime < f.startTime && k.endTime > prev.endTime)
          ) {
            runs.push(run);
            run = [];
          }
          run.push(f);
        }
        if (run.length) runs.push(run);
        for (const r of runs) {
          if (r.length < 2) continue;
          const score = chainScore(r);
          if (score < MED_SCORE) continue;
          const i = queue.findIndex((q) => q.score < score);
          queue.splice(i < 0 ? queue.length : i, 0, { frags: r, score });
        }
        continue;
      }
      const fragSet = new Set(c.frags);
      const children = events.filter(
        (e) => !fragSet.has(e) && e.startTime >= from && e.endTime <= to
      );
      // Guard 1 (spec §6, revised 2026-07-16): interruptions are required,
      // but a departure-boundary counts — a non-final fragment that ended
      // tab_hidden means the user left and RETURNED, even when the
      // destination is invisible by design (another app, a browser-internal
      // page — both finalize as tab_hidden and render as gaps, not events).
      // spa_navigation/navigated boundaries never count: attention stayed,
      // the page turned over — continuous same-tab reading can't
      // self-containerize.
      const departures = c.frags.filter(
        (f, i) => i < c.frags.length - 1 && f.endReason === "tab_hidden"
      ).length;
      if (!children.length && !departures) continue; // no interruptions at all
      // Covered-HIGH guard, tree-blind (spec §6 atomicity, 2026-07-24):
      // containment is a demotion and must be earned by evidence, never
      // inferred from time-overlap — ANY individually-HIGH non-member
      // inside the span rejects the chain. Members are exempt by
      // construction: a HIGH in its own host's chain is a fragment, not a
      // child, so a thread can never break its own container.
      if (children.some((e) => e.band === "high")) continue;
      // Anchor dominance (sub-HIGH only): the anchor must outscore its
      // children, or it's a launcher and the children are the story.
      // Spawn-edge discount (spec §6, 2026-07-25): a child whose tab's
      // stored opener path reaches a member tab (≥1 edge — the anchor's
      // own tab never counts, so same-tab redirect interleaves keep full
      // weight) is the anchor's own dispatch and leaves the denominator;
      // the anchor must still INDIVIDUALLY outscore every discounted
      // spawn — a chain never frames a single event bigger than itself.
      if (c.score < HIGH_SCORE) {
        const memberTabs = new Set(
          c.frags.flatMap((f) => (f.members ? f.members.map((m) => m.tabId) : [f.tabId]))
        );
        const spawned = (e) =>
          (e.members ? e.members.map((m) => m.tabId) : [e.tabId]).every((t) => {
            if (t == null || memberTabs.has(t)) return false;
            const seen = new Set();
            while (openerEdges.has(t) && !seen.has(t)) {
              seen.add(t);
              t = openerEdges.get(t);
              if (memberTabs.has(t)) return true;
            }
            return false;
          });
        let denom = 0;
        let spawnTooBig = false;
        for (const e of children) {
          if (spawned(e)) spawnTooBig ||= e.score >= c.score;
          else denom += e.score;
        }
        if (spawnTooBig || c.score <= denom) continue;
      }
      const activity = {};
      let heartbeats = 0;
      let audibleMs = 0;
      for (const f of c.frags) {
        heartbeats += f.heartbeats || 0;
        audibleMs += f.audibleMs || 0;
        for (const [k, v] of Object.entries(f.activity || {})) {
          if (v) activity[k] = (activity[k] || 0) + v;
        }
      }
      const top = c.frags.reduce((a, b) => (b.score > a.score ? b : a));
      containers.push({
        id: "k" + c.frags[0].id,
        url: top.url, // click target: the anchor's top-scoring fragment
        favIconUrl: top.favIconUrl, // same member as the click target (spec §6, 2026-08-07)
        // Snapshot candidates in score order (spec §6). A fragment can
        // itself be a merged visit whose synthetic "v…" id has no snapshot —
        // flatten through ITS snapIds to the underlying raw sessions.
        snapIds: [...c.frags]
          .sort((a, b) => b.score - a.score)
          .flatMap((f) => f.snapIds || [f.id]),
        title: top.title,
        host: c.frags[0].host,
        tabId: c.frags[0].tabId,
        // treeId (2026-08-02): needed so a container can itself become a
        // fragment on assembleThreads' second, looser chaining pass
        // (adjacent-container chaining, below) — without it a container
        // silently can't ever be chained again.
        treeId: c.frags[0].treeId,
        startTime: from,
        endTime: to,
        durMs: to - from, // SPAN — the width-rule exception (spec §6)
        heartbeats,
        audibleMs,
        activity,
        scrollable: c.frags.some((f) => f.scrollable),
        score: c.score, // summed fragment scores + returns traversal term: add up, then judge
        band: bandFor(c.score),
        // The LAST fragment's exit is the container's exit (2026-08-02,
        // same principle as mergeVisits): needed so a container can
        // testify as a departure boundary if it becomes a non-final
        // fragment on the second, adjacent-container chaining pass.
        endReason: c.frags[c.frags.length - 1].endReason,
        members: c.frags,
        children,
      });
      for (const f of c.frags) absorbed.add(f);
      for (const ch of children) absorbed.add(ch);
      if (!quiet)
        log(
          `container: ${c.frags[0].host} ${fmtClock(from)}–${fmtClock(to)} · ` +
            `${c.frags.length} visits + ${children.length} excursions · score ${Math.round(c.score)}`
        );
    }
    if (!containers.length) return events;
    const out = events.filter((e) => !absorbed.has(e));
    out.push(...containers);
    out.sort((a, b) => a.startTime - b.startTime);
    return out;
  }

  // Thread assembly (spec §6 aggregation, restructured 2026-07-18): the
  // display atom is the THREAD — merge across machinery boundaries, then
  // frame departures as containers. One name for the rulebook's central
  // operation; every consumer (ribbon, week strip, color anchoring) goes
  // through here.
  function assembleThreads(events, quiet) {
    // Adjacent-container chaining (spec §6, 2026-08-02): the first pass
    // chains raw fragments at VISIT_GAP_MS; a second pass re-runs the exact
    // same chain-building + qualification on ITS OWN output (containers and
    // leftover merged visits alike), at the looser CONTAINER_CHAIN_GAP_MS —
    // an already-assembled same-host container/visit is a coarser claim
    // than a raw fragment, so it earns a longer bridge. Idempotent when
    // nothing chains (detectContainers returns its input unchanged).
    return detectContainers(detectContainers(mergeVisits(events), quiet), quiet, CONTAINER_CHAIN_GAP_MS);
  }

  // Threads for every stored day (admission-filtered, scored, assembled;
  // quiet — the viewed day's loud assembly happens in render). Feeds the
  // week strip and color anchoring so both judge the same objects the
  // ribbon draws.
  function threadsByDay(sessions) {
    const rootOf = treeRootsOf(sessions);
    const byDay = new Map();
    for (const s of sessions) {
      if (!s.url || isTransit(s)) continue;
      const score = scoreSession(s);
      const e = {
        ...s,
        host: hostOf(s),
        score,
        band: bandFor(score),
        durMs: s.endTime - s.startTime,
        treeId: s.tabId != null ? rootOf(s.tabId) : undefined,
      };
      const day = dayStartOf(e.endTime);
      let arr = byDay.get(day);
      if (!arr) byDay.set(day, (arr = []));
      arr.push(e);
    }
    const out = new Map();
    for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
      const events = byDay.get(day).sort((a, b) => a.startTime - b.startTime);
      out.set(day, assembleThreads(events, true));
    }
    return out;
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
      if (event.band === "low") {
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

  function layout(items, expandedKey) {
    // Leading pad from the floor hour at GAP scale — absence is absence,
    // including the absence before the first block (spec §6: hour labels
    // stay clean whole hours; the pad does the honesty).
    const first = items[0] && (items[0].kind === "cluster" ? items[0].members[0] : items[0].event);
    let cursor = first ? (msPastHour(first.startTime) / HOUR) * GAP_HOUR_PX : 0;
    const segs = [];
    const plates = [];
    const bars = [];
    const gaps = [];
    let prevEnd = null; // wall-clock end of the previously laid element
    // Absence at gap scale (spec §6 two time scales): every gap between
    // drawn elements — fence sticks included — gets width proportional to
    // its true duration, ticks interpolated linearly inside. No hour-
    // boundary special case; a 30s tab-hop allocates a fraction of a px.
    const allocGap = (nextStart) => {
      if (prevEnd === null) return;
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
    const widthOf = (e) => Math.max(MIN_W, (e.durMs / 1000) * PX_PER_SEC);
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
    return { segs, plates, bars, gaps, total: Math.max(cursor - GAP, 0) };
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
    const segs = events.map((e, i) => {
      const h = CARD_TIER_H[e.band];
      return { e, key: e.id, band: e.band, w: CARD_TIER_W[e.band], h, x: i * CARD_STEP };
    });
    const last = segs[segs.length - 1];
    const total = last ? last.x + last.w : 0;
    return { segs, total };
  }

  // Ribbon X is NOT linear time (widths are floored), so each whole hour is
  // placed at the time-interpolated X within whichever block was active
  // then. Hours that fell between blocks already own uniform gap slots from
  // layout — the old clamp-to-edge case (which shingled labels when a
  // multi-hour absence stacked its hours on one x) no longer exists.
  function hourMarks(segs, gaps) {
    if (!segs.length) return [];
    const first = segs[0];
    const gapX = new Map();
    for (const g of gaps) for (const m of g.marks) gapX.set(m.t, m.x);
    // First tick: the floor hour, sitting at the left edge of the pad (the
    // pad is absence, so it's gap-scaled) — a clean whole-hour label with
    // the first block proportionally inset.
    const floorT = first.e.startTime - msPastHour(first.e.startTime);
    const marks = [{ t: floorT, x: first.x - (msPastHour(first.e.startTime) / HOUR) * GAP_HOUR_PX }];
    const lastEnd = segs[segs.length - 1].e.endTime;
    for (let t = floorT + HOUR; t <= lastEnd; t += HOUR) {
      if (gapX.has(t)) {
        marks.push({ t, x: gapX.get(t) });
        continue;
      }
      for (const s of segs) {
        if (t >= s.e.startTime && t <= s.e.endTime) {
          const span = s.e.endTime - s.e.startTime;
          marks.push({ t, x: s.x + (span > 0 ? ((t - s.e.startTime) / span) * s.w : 0) });
          break;
        }
      }
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

  // Label = the site's own name, one per LABEL KEY per render (spec §6,
  // 2026-07-18; key = host, except label-split hosts — see labelKeyOf):
  // the label names the site's identity, so it derives from ALL admitted
  // titles across the stored week — never per-run (two runs of one hue
  // answering to two names broke self-legending on NotebookLM).
  // The site name is the INVARIANT segment: split each title on
  // separators, candidates = first + last segments, winner = the
  // candidate present in the most titles (majority of separator-bearing
  // titles required). Ties prefer the FIRST-position candidate — the
  // "App - page" house style (Voice, Meet) is invariant-first, while the
  // classic "page - Site" shape never ties because leading segments vary.
  // A lone separator-bearing title keeps the old trailing rule (no
  // invariance evidence). Hostname is the fallback — and identity
  // (color/grouping) stays hostname-keyed regardless.
  // Hostname match wins outright (spec §6, 2026-07-19; widened 2026-07-28):
  // a segment that IS the domain name — exact equality after normalization
  // against a hostname label OR the full hostname, never containment
  // ("googledocs" must not match "docs") — is the site declaring its own
  // name, corroborated by the URL, so it skips the count contest and the
  // majority guard. Recurrence required (≥2 titles, waived for a lone
  // title) so a one-off doc literally named "Docs" can't claim
  // docs.google.com. Born of WorkFlowy's invariant "Organize your brain. -
  // WorkFlowy": both segments tied every week and the first-position
  // tie-break crowned the tagline.
  //
  // The two rules are separate passes over one loop (2026-07-28): the
  // hostname match reads every segment of every title (separator-free
  // titles included — they are one-segment titles), while invariance keeps
  // its first/last candidates over separator-bearing titles only. That
  // split subsumed the 2026-07-25 middles carve-out and fixed rutracker,
  // where ten "RuTracker.org" titles were filtered out before the match
  // could see them and two "Smart girl" torrent listings won by majority.
  function siteNameOf(titles, host) {
    const SEP = /\s+[-–—|·/]\s+/;
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    // Hostname labels AND the full hostname (spec §6, 2026-07-28): a title
    // may carry the TLD ("RuTracker.org", "Amazon.com", "social.coop"),
    // where label-only matching missed or truncated the name.
    const labels = new Set(host.split(".").slice(0, -1).map(norm).filter(Boolean));
    labels.add(norm(host));
    const declared = new Map(); // exact spelling -> n  (hostname match, equality)
    const contained = new Map(); // exact spelling -> n  (hostname match, word-boundary)
    const counts = new Map(); // first/last -> { n, first }  (invariance)
    let parted = 0; // titles with a separator — invariance evidence
    let lastTail = null;
    for (const t of titles) {
      const segs = (t || "").split(SEP).map((s) => s.trim()).filter(Boolean);
      if (!segs.length) continue;
      // Hostname match sees EVERY segment of EVERY title — a separator-free
      // title is a one-segment title, not an excluded one. Subsumes the
      // 2026-07-25 middles carve-out (all positions participate now).
      for (const s of new Set(segs)) {
        if (s.length > 30) continue;
        if (labels.has(norm(s))) {
          declared.set(s, (declared.get(s) || 0) + 1);
          continue;
        }
        // Word-boundary containment fallback (2026-08-02): the brand is
        // embedded in the segment ("Car Rentals from Avis"), not the whole
        // segment. Weaker than equality, so it's a separate tally consulted
        // only when equality finds nothing.
        const words = s.split(/[^a-zA-Z0-9]+/).filter(Boolean);
        for (const w of words) {
          if (labels.has(norm(w))) contained.set(w, (contained.get(w) || 0) + 1);
        }
      }
      // Invariance needs an App/page structure, so it alone filters to
      // separator-bearing titles and to first/last candidates, where
      // recurring middle noise can never win on popularity.
      if (segs.length < 2) continue;
      parted++;
      lastTail = segs[segs.length - 1];
      const cands = new Map(); // per-title dedupe: count once per title
      if (segs[0].length <= 30) cands.set(segs[0], true);
      if (segs[segs.length - 1].length <= 30 && !cands.has(segs[segs.length - 1]))
        cands.set(segs[segs.length - 1], false);
      for (const [name, isFirst] of cands) {
        const c = counts.get(name) || { n: 0, first: false };
        c.n++;
        c.first = c.first || isFirst;
        counts.set(name, c);
      }
    }
    // The site declaring its own name, corroborated by the URL: most
    // frequent spelling, returned verbatim (shortening would invent a name).
    let match = null;
    for (const [name, n] of declared) {
      if (n < 2 && titles.length > 1) continue;
      if (!match || n > match.n) match = { name, n };
    }
    if (match) return match.name;
    // Weaker fallback: the brand embedded mid-segment (2026-08-02).
    let containMatch = null;
    for (const [name, n] of contained) {
      if (n < 2 && titles.length > 1) continue;
      if (!containMatch || n > containMatch.n) containMatch = { name, n };
    }
    if (containMatch) return containMatch.name;
    if (!parted) return null;
    if (parted === 1) return lastTail && lastTail.length <= 24 ? lastTail : null;
    let best = null;
    for (const [name, c] of counts) {
      if (!best || c.n > best.c.n || (c.n === best.c.n && c.first && !best.c.first)) {
        best = { name, c };
      }
    }
    return best && best.c.n * 2 >= parted ? best.name : null;
  }

  // google.com label split (spec §6, 2026-07-25): the one recorded
  // multi-app host — Search and Maps share the hostname, namespaced by
  // first path segment. For LABELS ONLY, the grouping key appends that
  // segment (google.com/maps, google.com/search) and the invariance
  // machinery names each group from its own titles. Identity — color,
  // merging, chains — stays hostname-keyed. Extended per specimen, never
  // speculatively; the rejected general mechanism is in plans.
  const LABEL_SPLIT_HOSTS = new Set(["google.com"]);
  function labelKeyOf(host, url) {
    if (!LABEL_SPLIT_HOSTS.has(host)) return host;
    try {
      const seg = new URL(url).pathname.split("/")[1];
      return seg ? host + "/" + seg : host;
    } catch {
      return host;
    }
  }

  // Names for every label key with admitted sessions this week. Recomputed
  // per render (cheap); merged-visit member titles are covered because this
  // walks RAW sessions, pre-assembly.
  function computeHostNames(sessions) {
    const titlesByKey = new Map();
    for (const s of sessions) {
      if (!s.url || isTransit(s) || !s.title) continue;
      const host = hostOf(s);
      const key = labelKeyOf(host, s.url);
      let g = titlesByKey.get(key);
      if (!g) titlesByKey.set(key, (g = { host, titles: [] }));
      g.titles.push(s.title);
    }
    const names = new Map();
    for (const [key, g] of titlesByKey) {
      const name = siteNameOf(g.titles, g.host); // hostname matching stays host-level
      if (name) names.set(key, name);
    }
    return names;
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
  document.getElementById("ribbon").addEventListener("mousemove", (e) => {
    if (expandedKey === null || !expandedBox) return;
    const ribbon = document.getElementById("ribbon");
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
    const strip = document.getElementById("week-strip");
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
  document.body.appendChild(tip);
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
  document.getElementById("ribbon").appendChild(quickLabel);

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
  document.getElementById("ribbon").appendChild(cardHoverText);

  function hideCardHoverText() {
    cardHoverText.hidden = true;
  }

  {
    const ribbonEl = document.getElementById("ribbon");
    ribbonEl.addEventListener("pointerover", (ev) => {
      hideTip();
      hideQuickLabel();
      hideCardHoverText();
      const el = ev.target.closest("[data-tip]");
      if (!el) return;
      const isCard = el.classList.contains("card");
      // Stage 1 cards show their own below-card text instead of the
      // floating quick label (which would duplicate it).
      if (el._tipData && el.dataset.runLabeled !== "1" && !isCard) {
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
      if (isCard && el._tipData && el !== cardEls.get(cardExpandedKey)) {
        const d = el._tipData;
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
        const left = parseFloat(el.style.left) || 0;
        const top = parseFloat(el.style.top) || 0;
        const height = parseFloat(el.style.height) || 0;
        cardHoverText.style.left = left + "px";
        cardHoverText.style.top = top + height + LABEL_GAP + "px";
        cardHoverText.hidden = false;
      }
      if (isCard) {
        return; // cards never fall through to the delayed #tip below
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
      hideCardHoverText();
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
    const wrap = document.getElementById("ribbon-wrap");
    const ribbonEl = document.getElementById("ribbon");
    const ZOOM_SENSITIVITY = 0.0018; // wheel-delta-to-zoom-factor curve; retune to taste
    const ZOOM_IDLE_MS = 150; // quiet period after the last tick before .zooming lifts (re-arms .blk's transition)
    let pendingDy = 0;
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
      const cursorX = lastPointerX - rect.left + wrap.scrollLeft;
      const oldTotal = ribbonEl.scrollWidth || 1;
      const frac = cursorX / oldTotal;
      zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * Math.exp(-pendingDy * ZOOM_SENSITIVITY)));
      pendingDy = 0;
      PX_PER_SEC = BASE_PX_PER_SEC * zoom;
      GAP_HOUR_PX = BASE_GAP_HOUR_PX * zoom;
      relayout();
      const newTotal = ribbonEl.scrollWidth || 1;
      wrap.scrollLeft = frac * newTotal - (lastPointerX - rect.left);
    };
    wrap.addEventListener("pointermove", (ev) => {
      lastPointerX = ev.clientX;
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
    const hostNames = computeHostNames(sessions);
    renderWeekStrip(dayThreads);
    const events = assembleThreads(parseSessions(sessions));
    lastAssembly = { sessions, dayThreads, hostNames, events };
    paintCards(events, hostNames);
    // A real render (new data, day paging, fence toggle — never a zoom
    // relayout, which calls paint() directly) always resets to left-
    // justified (spec §6, 2026-08-08): the day's first event flush against
    // the viewport's left edge, regardless of wherever zoom/pan left the
    // scroll position on the previous day — visual stability across day
    // paging, not a preserved viewport.
    const wrap = document.getElementById("ribbon-wrap");
    if (wrap) wrap.scrollLeft = 0;
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
    // Fences reinstated (spec §6, 2026-08-08): LOW runs collapse to sticks
    // again, with two independent split rules (clusterEvents: a recorded
    // lock interval unconditionally splits; otherwise FENCE_IMPLIED_BREAK_MS
    // gates bridging) — see decisions/timeline_design.md for why. lastLockIntervals
    // is read directly (closure) rather than threaded as a paint() param,
    // since relayout() (zoom) calls paint() without re-fetching data.
    const items = clusterEvents(events, lastLockIntervals);
    const { segs, plates, bars, gaps, total } = layout(items, expandedKey);

    const ribbon = document.getElementById("ribbon");
    const bandBottom = TITLE_AREA + BAND_H;
    ribbon.style.width = total + "px";
    ribbon.style.height = TITLE_AREA + BAND_H + AXIS_AREA + "px";
    document.getElementById("ribbon-empty").hidden = segs.length > 0;

    ribbon.querySelectorAll(".transient").forEach((el) => el.remove());

    const seen = new Set();
    for (const s of segs) {
      seen.add(s.key);
      let el = blockEls.get(s.key);
      if (!el) {
        el = document.createElement("div");
        el.className = "blk";
        ribbon.appendChild(el);
        blockEls.set(s.key, el);
      }
      // Contained children render at one uniform height regardless of band
      // (spec §6, 2026-08-07) — containment frames, never confers stature;
      // standalone blocks, collapsed sticks, and expanded fence members
      // keep the three-way tier heights.
      const h = s.contained ? CONTAIN_CHILD_H : TIER_H[s.band];
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
      el.style.top = bandBottom - h + topInset + "px";
      el.style.height = h - topInset - bottomInset + "px";
      // Containers paint like any other solid block (spec §6, 2026-07-17 —
      // wash retired); contained children are cut out of the interior by a
      // page-background seam (.cut CSS carries the width) and inset off the
      // container's top/bottom edges (spec §6, 2026-08-02).
      el.classList.toggle("cut", !!s.contained);
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
      // expand bar or Escape).
      el.style.pointerEvents = s.collapsed ? "none" : "auto";
      el.onclick = s.collapsed ? null : () => chrome.tabs.create({ url: s.e.url });
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

    const marks = hourMarks(segs, gaps);
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
    for (const run of titleRuns(groupRuns(segs.filter((s) => !s.contained)), total)) {
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

    log(`rendered ${segs.length} blocks in ${plates.length} fences + ${bars.length} expanded, ${total}px wide`);
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
  document.getElementById("ribbon").appendChild(cardChildRow);

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
    const wrapEl = document.getElementById("ribbon-wrap");
    const viewportW = Math.max(wrapEl.clientWidth - CARD_EXPAND_VIEWPORT_MARGIN, CARD_TIER_W.low);
    const deckBottom = maxH + CARD_HOVER_TEXT_H;
    const childRowReserve = hasChildren ? CARD_CHILD_ROW_GAP + CARD_CHILD_THUMB_H : 0;
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
    // Shrink to fit BOTH caps, preserving aspect — whichever axis is more
    // constraining wins (same "scale by the smaller ratio" rule either
    // width-bound or height-bound needs).
    const scale = Math.min(1, viewportW / nativeW, availableH / nativeH);
    const width = Math.round(nativeW * scale);
    const height = Math.round(nativeH * scale);
    const centerX = deck.left + deck.width / 2;
    return {
      left: Math.round(centerX - width / 2),
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
    const startDeg = fromRotate ? parseFloat(fromRotate[1]) : CARD_SWIVEL_DEG;

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
      cardExpandedKey = null;
      el._closeBtn.hidden = true;
      el._info.hidden = true;
      hideCardChildRow();
      animateCardTo(el, cardDeckGeom(el), CARD_SWIVEL_DEG, maxH);
      setRibbonExpandedHeight(maxH, null);
      return;
    }

    cardExpandedKey = key;
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
    }
    hideCardChildRow();
    el._closeBtn.hidden = false;
    fillCardInfo(el);
    el._info.hidden = false;
    if (prevEl) animateCardTo(prevEl, cardDeckGeom(prevEl), CARD_SWIVEL_DEG, maxH);
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
      chrome.storage.local
        .get(keys)
        .then((r) => {
          // Stale by the time this resolved: either a different card is now
          // expanded, or this same card moved to a different carousel item.
          if (cardEls.get(cardExpandedKey) !== el || cardCarouselIndex !== index) return;
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
    const ribbon = document.getElementById("ribbon");
    const base = maxH + CARD_HOVER_TEXT_H;
    if (!target) {
      ribbon.style.height = base + "px";
      return;
    }
    // Reserve the child row's own space too (Stage 3) so #ribbon's height
    // still guarantees no overlap by construction, same reasoning as
    // CARD_EXPAND_GAP's own comment — just extended to cover the new row.
    const childRowReserve = hasChildren ? CARD_CHILD_ROW_GAP + CARD_CHILD_THUMB_H : 0;
    ribbon.style.height = target.top + target.height + childRowReserve + CARD_EXPAND_GAP + "px";
  }

  function paintCards(events, hostNames) {
    const { segs, total } = cardLayout(events);

    const ribbon = document.getElementById("ribbon");
    const maxH = Math.max(CARD_TIER_H.high, 1);
    ribbon.style.width = total + "px";
    // + CARD_HOVER_TEXT_H reserves room for cardHoverText below the deck —
    // see that constant's comment: #ribbon-wrap clips anything positioned
    // below #ribbon's own height, so the hover-text band must be counted
    // into it, not left to float past the bottom edge. Skipped while a
    // card is expanded (Stage 2) — setRibbonExpandedHeight already grew
    // this to fit the expanded card, and a repaint (e.g. live data
    // refresh) shouldn't yank that back out from under an open card.
    if (!cardExpandedKey) ribbon.style.height = maxH + CARD_HOVER_TEXT_H + "px";
    document.getElementById("ribbon-empty").hidden = segs.length > 0;

    // No hour axis, no gap plates, no fences in Stage 1 — the .transient
    // sweep still clears any leftover nodes from the old paint() path in
    // case both ever ran against the same #ribbon (they don't, but this
    // keeps the DOM honest if that ever changes).
    ribbon.querySelectorAll(".transient").forEach((el) => el.remove());

    const seen = new Set();
    const snapFetches = [];
    for (const s of segs) {
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
        face.style.transform = `rotateY(${CARD_SWIVEL_DEG}deg)`;
      }
      el.style.perspectiveOrigin = "left center";
      face.style.background = TIER_FILL[s.band];
      face.style.borderColor = s.band === "high" && hasEarnedHigh(s.e) ? EARNED_RIM : TIER_RIM[s.band];
      el.classList.toggle("earned-high", s.band === "high" && hasEarnedHigh(s.e));

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
    paintCards(lastAssembly.events, lastAssembly.hostNames);
  }

  window.renderTimeline = render;
  // Single source of truth for scoring — the Score-table button in
  // dashboard.js uses these so diagnostics can never drift from the render.
  window.FS_SCORING = { scoreSession, attendedSeconds, bandFor, hostOf };
})();
