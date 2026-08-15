# Stack Ribbon — staged rewrite plan

**Status:** Stage 0 (harness) DONE. Stage 1 (flat swivel strip) DONE
(Scott, 2026-08-11). Stage 2 — retargeted from its original scope (dock-
style magnify-on-hover, never built) to click-to-expand, which is what was
actually discussed and shipped — is DONE (Scott, 2026-08-11: "stage two is
wrapped"). Both closures are staging milestones, distinct from — and NOT
the same as — a verdict that cards beat the old block ribbon outright:
that larger question ("does this replace the original ribbon") is what
the full Stage 1→N arc is FOR, and stays open until enough stages exist to
judge it against real browsing. Don't conflate "Stage N is done, proceed"
with "the whole rewrite has won" in future status updates. This is a
working doc, not a SPEC.md rule — see CLAUDE.md's doc map. Deliberately
NOT folded into `spec/display.md` yet (Scott, 2026-08-11): this is still
an experiment: "I don't want you to write it to the existing spec.md
files. We'll do that later once we've determined that this is correct."
When a stage ships for real, its truth moves into `spec/display.md` (+ a
`decisions/` story if real reasoning was involved) and this file's entry
for that stage gets struck through or trimmed. When the whole rewrite
lands or is abandoned, this file goes away.

**If resuming cold:** read this whole file (especially "Stage 1 build log"
below before touching the rotation/perspective code again — FOUR separate
rounds happened there before the real cause was found, and the geometry is
genuinely non-obvious), then `testing/README.md` for the harness. The OLD
block-ribbon code (`layout()`, `paint()`, `clusterEvents()`/fence-stick,
hour axis, `TIER_H`) is still in `timeline.js`, fully intact and DORMANT —
kept per Scott's explicit "keep the code to the side, don't delete it"
direction, not called by anything live. The LIVE path is
`cardLayout()`/`paintCards()`, wired in via `render()`/`relayout()`.

**What to do next, concretely:** Stages 1 and 2 are both closed (see
Status above); Stage 3 (container drop-down shelf) is next — see its
section below for the two open questions it needs to resolve before/while
building (always-visible child-count affordance vs. hover-only discovery;
confirm one-level nesting is really the ceiling).

## Why (recap of the discussion, 2026-08-11)

The current ribbon (`spec/display.md` §5-6) encodes duration as block width
and has collapsed tier distinction down to fill/border luminance only
(`TIER_H` all 144px, 2026-08-07) — the fence/stick mechanism
(picket-fencing LOW runs into click-to-expand slivers) is the current
answer to "too many tiny blocks to browse." Scott's read: the fence makes
the *important* blocks findable, but the *rest* are still too small and too
numerous to casually browse — the hover-domain-label mechanism was a patch
on that symptom, not a fix.

Proposed direction: replace the flat block ribbon with a horizontal deck of
screenshot cards, swiveled backward in Z (Mac Stage Manager-ish), left edge
fixed. Key ideas from the discussion, in order of confidence:

1. **Decouple duration from x-extent; encode importance in height instead.**
   Three distinct heights for LOW/MEDIUM/HIGH (not the two the first
   prototype collapsed into). This is the actual structural change — width
   goes back to roughly uniform/log-compressed, which directly fixes "tiny
   sliver blocks."
2. **The swivel plane carries both image and domain label** — one rotated
   surface, two payoffs, replacing the separate floating hover-label layer
   that prompted this whole rethink.
3. **Dock-style magnify-on-hover** for browsing the mid/low tier — approach
   with the mouse, nearby cards grow/rotate toward legibility. Interaction
   cost flagged as unproven: reading a screenshot's content is slower than
   recognizing a dock icon, so the magnify curve likely needs to be gentler
   and wider than macOS's dock, tuned by feel, not borrowed constants.
4. **Containers collapse to a badge; children live in an on-hover drop-down
   shelf** rather than being cut into the parent block's interior
   (§5-6's current `.cut` treatment). Solves the "Gemini session scoops up
   everything into one dishonest container" complaint by making the
   container an honest single card + optional disclosure, not a block that
   claims to *be* the whole span.

Explicitly deferred, not designed yet: behavior at high item-density (a
200-item day) — fixed swivel angle with clip/scroll vs. Stage-Manager-style
nonlinear compression. Agreed to build the flat version first and feel it
before answering this.

Third candidate flagged 2026-08-12 (Scott): bring back something like the
old fence/stick mechanism's LOW-tier compaction, adapted to cards — the
fence's whole reason for existing was compacting a large run of low-
priority items to free up space for the ones that matter, which is exactly
the Stage 4 problem. Structurally distinct from the other two candidates:
fence compaction is a discrete "a run of LOW cards collapses into one
sliver/cluster" move, vs. clip/scroll (no compaction, just more scroll) or
Stage-Manager compression (continuous shrink, every card still present
individually just smaller). Not designed yet — how a fenced cluster of
cards would look/expand is unscoped — but should be discussed alongside
the other two when Stage 4 is actually taken up.

## Open questions carried forward (not yet answered)

- Container nesting depth: today's containers are block→children, one
  level. Does the drop-down shelf ever need to itself contain a
  container, or is one level confirmed as the ceiling? (Affects whether
  the shelf is a flat strip or needs its own recursion.)
- Container disclosure trigger: hover-only means a container's *existence*
  (does this card have children at all?) is invisible until hover. Does
  the top-level card need an always-visible affordance (count badge,
  stacked-edge peek) so children aren't hidden behind a discovery step?
- High-density behavior (see above) — explicitly deferred to post-Stage-1
  feel testing.
- ~~Whether width goes fully uniform or stays log-compressed by duration~~
  — RESOLVED by how Stage 1 was built: width is fully uniform per tier
  (`CARD_STEP`, unrelated to duration) and card width itself is now driven
  by `CARD_ASPECT`, not duration either. Duration plays no role in card
  layout at all as of Stage 1. Revisit only if flat/heavy-overlap feels
  wrong once Scott has browsed it for real.

## Stage 0 — Playwright verification harness (2026-08-11) — DONE

Built and proven against real data. Lives at `testing/` — see
`testing/README.md` for exact usage, known-good IDs/paths, and how to
re-derive them if they change. Run it with:

```sh
cd testing && npm install && node screenshot-real-data.js
```

Confirmed 2026-08-11: opens the real dashboard (1903 real sessions, real
week strip, real containers — not fixtures) and saves
`testing/dashboard-real-data.png`. The real Chrome profile is read-only
in this flow; nothing is written back to it.

Amendment to CLAUDE.md's "I test locally, don't spin up headless
browsers" default — Scott has asked that, given the scope of this
rewrite, structural/regression passes be delegated so he isn't the one
catching every broken layout by eye each iteration. Scope is
**structural checks only** ("did it render right" — tier heights differ,
transforms applied, no overlap, no console errors); **"does it feel more
browsable" stays Scott's call, always**, never something I answer for him.

Real captured data only, never fixtures (simulated data was explicitly
rejected — this rewrite is about real-world browsability) — mechanism for
that (copy real leveldb storage into a disposable scratch profile under a
fixed extension ID) is implemented in `testing/screenshot-real-data.js`,
explained in `testing/README.md`. Adds this project's first `npm`/Node
dependency, scoped entirely to `testing/` — never shipped in the
extension, which stays a no-build-step vanilla JS extension per
CLAUDE.md.

Still TODO within Stage 0, before leaning on it heavily for Stage 1
passes: the structural **assertions** themselves (tier heights, overlap,
console errors) — so far the harness only proves it can reach real data
and screenshot it; it doesn't yet assert anything about what it sees.
Add assertions once Stage 1's actual markup exists to assert against.

## Staging

Each stage should be felt (loaded, browsed against real data) before the
next is built. Do not batch stages — this is a "build simple, see how it
feels, then decide the follow-up" process per Scott's explicit direction,
not a spec to implement end to end blind.

### Stage 1 — flat swivel strip (no interaction beyond today's click/hover-tooltip)

**Implemented as of 2026-08-11.** Scope, as built (all constants in
`timeline.js`, grouped near `CARD_TIER_H`):
- Card height = tier: `CARD_TIER_H = { high: 260, medium: ~173, low: ~87 }`
  (medium/low are 2/3 and 1/3 of high).
- Card width = height × `CARD_ASPECT` (640/342, the real snapshot capture's
  own aspect ratio) — **not** a fixed width. See build log below for why a
  fixed width was tried first and was wrong.
- X-axis: uniform per-card spacing, `CARD_STEP = 20` px between consecutive
  cards' own left edges (chronological order; true duration does not drive
  width or spacing at all — no log-compression, that open question resolved
  itself once cards went to heavy overlap). No gap-as-absence scaling, no
  hour axis — both fully dropped for Stage 1 per Scott's explicit answer
  ("drop the gap encoding entirely").
- Each card swivels independently around its OWN left edge (NOT a shared
  deck anchor — Scott was explicit: "dominoes," each card rotates on its
  own). `CARD_SWIVEL_DEG = 65`; perspective is `CARD_PERSPECTIVE_RATIO =
  900/260` (a ratio, NOT a fixed px value — see build log #1d for why a
  fixed perspective was wrong) applied per-card as `height × ratio`, with
  `perspective-origin: left center`. Left edge stays frontmost; right edge
  recedes in Z.
- Cards overlap heavily (`CARD_STEP` ≪ card width) — later (rightward)
  cards are later DOM siblings so they paint over the receded right edge
  of their predecessor for free, no z-index needed.
- **Superseded 2026-08-11 follow-up:** on-face domain label and the
  floating `#tip` tooltip are both retired for cards — see the
  "cardHoverText" entry in the build log below.
- Card face = snapshot image ONLY, no favicon, no label. No-snapshot
  fallback = plain tier-colored fill (`TIER_FILL`, reused from the old
  block ribbon), no placeholder glyph.
- Containers: plain non-interactive corner count badge. No drop-down shelf.
- Click-to-open-top-fragment stays. Hover now shows `cardHoverText` (below-
  deck plain text) instead of the floating tooltip — see build log.
- Snapshot fetch is EAGER now, not lazy-on-hover: `paintCards()` batches
  one `chrome.storage.local.get()` for every visible card's snapshot,
  since every card needs its image up front, not just a hovered one.
- Explicitly OUT of scope for Stage 1 (unchanged): magnify-on-hover,
  container drop-down shelf, high-density compression strategy.

Exit criterion: Scott browses a real busy day in this layout and forms an
opinion on whether height-as-tier + swivel cards is more browsable than
the old fence/stick ribbon. Visual/structural correctness is confirmed
("looks like you've got it," 2026-08-11), and Scott has separately
confirmed Stage 1 itself is DONE as a staging milestone (2026-08-11) —
**this is not yet the same as a verdict that cards beat the old ribbon**;
that larger call stays open across the whole staged arc (see Status at
top of file) and doesn't gate starting Stage 2.

#### Stage 1 build log — lessons, so they aren't re-learned the hard way

1. **Perspective/rotation took FOUR rounds to get right; the geometry is
   genuinely subtler than it looks — three were wrong, and the third wrong
   fix was itself caused by an incomplete verification, not a fresh guess.**
   Each round confirmed wrong by *measuring* (computed transform matrix,
   projected bounding-box width AND height, hand-derived CSS perspective
   formula), not by eyeballing screenshots — eyeballing caused two of the
   wrong turns, and trusting an INCOMPLETE measurement (width only) caused
   the fourth bug to ship undetected the first time:
   a. Shared `perspective` on `#ribbon` (the huge scrolling content box)
      put the vanishing point at the horizontal center of the whole DAY,
      not the viewport — cards raked harder the further they sat from that
      center (Scott: "gets deeper and deeper" toward the right). Fix:
      perspective must be **per-card**, so a card's angle can't depend on
      its scroll position at all.
   b. Per-card perspective with the CSS default `perspective-origin: 50%
      50%` put the vanishing point at each card's own vertical center — a
      point that moves per tier since height varies — so top edges weren't
      parallel across tiers. Fix: pin `perspective-origin: left center`
      (matches the rotation's own `transform-origin`).
   c. Believed (wrongly) that a taller box rotated the same `rotateY()`
      angle inherently foreshortens *more* under finite perspective, and
      "fixed" it by pushing perspective to 8000px (near-orthographic) —
      this actually made convergence vanish almost entirely, so cards read
      as horizontally squashed rectangles, not rotated cards at all
      (Scott's catch: "no skewing... don't look like rotated cards"). An
      isolated synthetic test (plain colored divs, no screenshots) proved
      the ORIGINAL 900px depth already gave identical projected WIDTH
      across all three tier heights — the "HIGH cards rake harder" read
      had been the 8000px squashing artifact, not that bug. Reverted to
      900px.
   d. A fixed `CARD_W` with per-tier height made LOW/MEDIUM/HIGH three
      **differently-shaped** rectangles (aspect ratios 2.53 / 1.27 / 0.85).
      Rotating different shapes by an identical angle legitimately
      produces different-looking trapezoids. Fix: `CARD_ASPECT` — width
      now scales with height at one fixed ratio (640/342, matching the
      real snapshot capture shape) so every tier is the same shape at 3
      sizes. **Declared fixed at this point on WIDTH-ratio verification
      alone (constant across tiers) — this was the incomplete check that
      let round (e) ship as "done."**
   e. **The actual last bug**, caught only when Scott screenshotted a real
      HIGH card next to a real LOW card and called it out again: HIGH
      converged sharply (far edge ≈67% of near edge) while LOW barely
      converged (≈86%) — the VERTICAL foreshortening ratio, never
      measured before, was NOT constant across tiers even though the
      width ratio was. Root cause, confirmed by hand-deriving the CSS
      perspective-projection formula: a card's far corners sit at a Z
      distance proportional to the card's OWN SIZE at a fixed rotation
      angle, and foreshortening is driven by Z ÷ perspective-distance — one
      FIXED perspective (900px) inevitably gives a bigger box more
      vertical convergence than a smaller one, independent of the aspect-
      ratio fix. Fix: perspective must scale WITH each card's own height,
      not be a fixed px value — `CARD_PERSPECTIVE_RATIO = 900/260`, applied
      per-card as `height × ratio` in `paintCards`, keeps HIGH's own look
      unchanged (its height, 260, is what the ratio was calibrated against)
      while correcting LOW/MEDIUM to match. Verified: both width-ratio AND
      height-ratio spread are now ~0.000 across all rendered tiers.
   - **Takeaway for future 3D CSS work here:** (1) when a rotation "looks
     wrong" across elements of different sizes, check aspect ratio/shape
     parity FIRST, before touching perspective depth or origin. (2) once
     shape parity is fixed, perspective ITSELF still needs to scale with
     element size, not stay a fixed px value, or vertical convergence
     alone will drift even when everything else measures identical — and
     (3) a structural check that measures only ONE axis (width) can pass
     clean while the real defect sits on the other axis (height/vertical
     convergence) — measure both before calling a rotation bug closed.
2. **Screenshot resolution vs. HiDPI displays.** Cards now display the full
   snapshot at up to ~487px CSS width (HIGH tier) instead of the old
   ~480px tooltip preview. `SNAP_WIDTH` (`background.js`) was still 640,
   sized for the old, smaller tooltip use case. On a 2x-DPI (Retina/HiDPI)
   display that's ~970 physical px for a ~485px CSS-wide layout box — the
   640px source was being visibly upscaled, which read as fuzzy. Confirmed
   with actual layout-box-physical-px vs. `naturalWidth` measurement, not
   by eye. Fixed by raising `SNAP_WIDTH` to 1280 (2x-DPI headroom; a 3x
   display like Scott's 4K/300ppi monitor still slightly upscales HIGH
   cards, accepted as a size/disk tradeoff). **This only affects captures
   from now on** — existing stored snapshots stay at 640px; judging the
   sharpness fix requires fresh browsing data to accumulate first.
3. **Harness got extended along the way, not just used as-is** (Scott
   explicitly authorized this, both for structural checks and to unblock
   debugging): `testing/screenshot-real-data.js` now also reports console
   errors, card count, distinct tier heights, overlap-pair count, and —
   for the rotation debugging — BOTH width-ratio and height-ratio
   foreshortening spread across cards (width alone missed build-log #1e;
   added height after that). These are real, reusable structural
   assertions — lean on them before eyeballing a screenshot again, and
   remember eyeballing/incomplete-axis measurement is what let bugs ship
   as "fixed" twice in this stage.
4. **`cardHoverText` follow-up (2026-08-11): on-face `.card-label` and the
   floating `#tip` tooltip retired for cards, replaced by a single reused
   plain-text block below the deck** (site name / time·duration / top page
   title, shown instantly on hover — same one-shared-element pattern as
   `quickLabel`). Two rounds to get right, both the same root cause:
   `#ribbon-wrap` sets `overflow-x: auto` with no explicit `overflow-y` —
   per the CSS overflow spec, a non-`visible` value on one axis forces the
   other to compute as `auto` too, so anything positioned below `#ribbon`'s
   own height silently clipped. Fix was two-part: (a) `#ribbon`'s height
   (`paintCards`) must include a reserved band for the text, not just the
   tallest card (`CARD_HOVER_TEXT_H`, repurposing the now-dead
   `CARD_LABEL_H` slot), and (b) `#ribbon-wrap` needs an explicit
   `overflow-y: hidden` — otherwise the forced `auto` can also surface a
   spurious vertical scrollbar even with no real overflow. Takeaway: any
   element positioned relative to `#ribbon` that can extend past its
   current height needs that height accounted for explicitly — the wrap's
   implicit auto/auto overflow doesn't give it for free.

### Stage 2 — click-to-expand — DONE (2026-08-11)

**Retargeted from the original scope.** The plan's original Stage 2 idea
— dock-style magnify-on-hover (approach with the mouse, nearby cards grow
toward legibility) — was never built; it's superseded by click-to-expand,
a different mechanic that was actually discussed and shipped under the
Stage 2 slot. Not pursued further; if hover-magnify is wanted later it
would need to be scoped fresh as its own stage, not resumed from this
paragraph.

Scope, as built (constants in `timeline.js`, grouped near
`CARD_EXPAND_MS`; button styling in `index.html` near `.card-close`):
- Click a card → it animates out of the deck: drops down below the deck
  (translateY), flattens (`rotateY` → 0), and grows to the snapshot's own
  native captured resolution (`img.naturalWidth/Height`), capped to fit
  the visible viewport width (`CARD_EXPAND_VIEWPORT_MARGIN`). Horizontally
  centered under the card's own deck-left edge, not the viewport.
- At most one card expanded at a time. Clicking a different card while one
  is open animates BOTH simultaneously — the open one back to its deck
  spot, the new one out to its own expanded spot — each along its own
  path, not a shared slot (`toggleCardExpand`).
- `#ribbon` (and so `#ribbon-wrap`, which sizes to it) grows to reserve
  room below the deck for the expanded card — this, not any neighbor-
  shifting logic, is what guarantees the expanded card never overlaps a
  deck card: it always sits entirely below the deck's bottom edge by
  construction (`setRibbonExpandedHeight`).
- Compound animation via the Web Animations API (`el.animate()`), not CSS
  `@keyframes`/class-toggling — chosen specifically so a card's animation
  can be interrupted and re-targeted mid-flight (`el._anim`, cancelled and
  replaced) when a different card is clicked before the first one
  finishes settling, which class-toggling handles awkwardly. Two synced
  `.animate()` calls per card: one on `.card` (left/top/width/height/
  perspective), one on `.card-face` (rotateY) — same duration, started in
  the same tick.
- Timing, tuned by feel (Scott, 2026-08-11): `CARD_EXPAND_MS = 840`
  (doubled from an initial 420 — "felt very quick"). Only the vertical
  drop (`top`) overshoots-and-settles for a sense of weight
  (`CARD_EXPAND_BOUNCE_PX = 14`, a keyframe offset — WAAPI has no native
  spring easing); rotation/size ease in plainly alongside it, no
  overshoot. Size (left/width/height/perspective) is keyframed to finish
  at `CARD_EXPAND_SIZE_DONE_AT = 0.75` of the total duration rather than
  linearly across the full timeline — without that intermediate keyframe,
  size kept growing for the entire animation while position visually
  settled well before it (Scott's diagnosis: "the movement has pretty
  much stopped and the scaling continues to grow" — backwards from what
  should read as weight). 0.75 landed inside Scott's requested 70-80%
  range; still a knob to retune by feel, not derived.
- Click semantics split across two targets on the same card: clicking the
  card's own deck-position hit-box toggles expand/collapse; clicking the
  expanded snapshot image itself (only reachable once expanded — same
  element, just grown/flattened in place) navigates to the URL
  (`chrome.tabs.create`), same as every card's click did pre-Stage-2.
- **Three redundant close paths** (Scott: "many ways... whichever one they
  find should work"), because a card's own deck slot is mostly covered by
  overlapping neighbors once it's sitting open-but-empty behind them
  (`CARD_STEP` ≪ card width, by design) — clicking the same spot to close
  isn't reliably reachable in practice:
  1. A visible close (×) button, upper-left corner of the expanded card,
     33px (sized up 50% from an initial 22px), `.card-close` in
     `index.html`.
  2. Click anywhere outside the expanded card's own element (document-level
     click listener, checks `!el.contains(ev.target)`).
  3. Escape key (document-level keydown listener, no target check needed).
  All three funnel through one `closeExpandedCard()` function.
- Hover text (`cardHoverText`, Stage 1's below-deck plain-text block) is
  suppressed specifically for the currently-expanded card — its position
  math reads `el.style.left/top/height`, which only get baked in when
  `animateCardTo`'s WAAPI animation finishes, so mid-flight (or even at
  rest, expanded) that math would read stale deck-position values and
  misplace the text box. Regular deck cards are unaffected and keep their
  hover text exactly as Stage 1 built it — this was walked back once
  after an overcorrection accidentally disabled hover text for ALL cards,
  not just the expanded one; watch for that distinction if touched again.
- Explicitly OUT of scope for Stage 2 (unchanged): container drop-down
  shelf (Stage 3), high-density compression strategy (Stage 4).

### Stage 3 — container drop-down shelf — up next (Stages 1 + 2 both DONE)

Scope (see the open questions above, still unresolved):
- Hovering a container badge drops a shelf of child screenshots (smaller)
  below/above the top-level strip.
- Resolve: always-visible child-count affordance vs. hover-only discovery.
- Resolve: nesting depth (confirm one-level assumption against
  `spec/display.md` §5-6's current container model before building).

### Stage 4 (maybe) — high-density behavior

Only scoped once Stage 1-3 exist and a genuinely busy day can be felt in
the new layout. Candidates noted in the discussion: fixed angle with
clip/scroll, nonlinear Stage-Manager-style compression, or fence-style
LOW-tier compaction brought back for cards (see the recap section above
for how the three differ). No decision yet.

### Stage 5 (maybe) — single-traveling-card hover-gap effect — Implemented, awaiting feel (2026-08-15)

**Implemented as of 2026-08-15**, per the design discussion recorded
below (kept intact as the design record, not trimmed, since the "why"
still lives here rather than in `decisions/timeline_design.md`'s own
entry, which stays a summary). Not yet folded into `spec/display.md` —
per this file's top-of-file convention, that happens only once Scott has
browsed real data in it and it's confirmed as staying, same as every
other stage here. Supersedes the original Stage 2 "dock-style magnify-
on-hover" idea (see Stage 2's note above) with a materially different
mechanic.

**As built — CURRENT state, after all fix rounds below** (this block is
kept in sync with the code; if you're skimming, this is the accurate
picture — the numbered fix-history entries after it are "how we got
here," not superseding corrections you also need to apply):
- `CARD_STEP` is uniform across all tiers at 10px (the old LOW-only
  pitch); `CARD_STEP_LOW` and its per-band branch in `cardLayout` are
  gone.
- `CARD_GAP_MAX_PX = 96` (history: started 48 → 192 → 96, see fix entries
  below for why each change happened) and derived `CARD_GAP_HALF_PX = 48`
  are the tuning knobs, defined near `CARD_STEP`. `CARD_GAP_LIFT_PX` is
  gone (2026-08-15 follow-up, see below) — the riffle lift is retired
  outright, not folded into the gap-offset write.
- **Piles-are-fixed model, now centered (2026-08-15 follow-up — see that
  entry below for the full "why")** (near `cardEls`, just above
  click-to-expand state): `lastCardSegs` (cardLayout's last rest-position
  output), `gapKey` (the ONE traveling card's key), `gapOffsetPx` (that
  card's live offset, a pure function of cursor X within its gap — the
  only continuously cursor-driven value, lerping between
  `-CARD_GAP_HALF_PX` and `+CARD_GAP_HALF_PX`, not `0`/`CARD_GAP_MAX_PX`
  as originally built), `leftPileOffsetPx`/`rightPileOffsetPx` (BOTH
  piles now shift — `∓CARD_GAP_HALF_PX` — fixed constants for the whole
  time any gap is active, only ever stepping, not easing, at a handoff;
  originally only the right pile moved), `gapRafId` (in-flight exit-relax
  OR entry-ease tween — the same slot now serves both, see the entry-ease
  entry below), `gapEnterT0` (non-null while an entry-ease is in flight).
  `applyCardTransform(el, key, side)` writes one card's transform per its
  role (traveling / `"left"` pile / `"right"` pile / neither — `side`
  replaced the original `isRightPile` boolean once the left pile started
  moving too); `updateCardGap(cursorX)` is the per-`pointermove` entry
  point that resolves which gap the cursor is in, computes the three
  cursor-driven TARGET offsets, hands them to `applyGapOffsets` (direct
  write in steady state, eased toward the target during entry — see
  below), and does a full pass over `lastCardSegs` calling
  `applyCardTransform`; `relaxCardGap()` is the JS rAF exit-tween,
  easing all three offsets to 0 together on `pointerleave`. All-JS, no CSS
  transition anywhere in the mechanism (a `pointermove`/`pointerleave`
  pair on `#ribbon`).
- **Label tracking, decoupled from the card (2026-08-15 follow-up — see
  that entry below):** `showCardHoverTextFor(el, key, leftPx)` (module
  scope, near `cardHoverText`) fills + positions + shows the label for
  one card at an explicit left X; `fillCardHoverText(d)` is the shared
  content-only builder. `updateCardGap` calls `showCardHoverTextFor` for
  `gapKey`'s own card at the end of every call, unconditionally, passing
  `labelGapCenterPx` — NOT `gapOffsetPx` (the original design; reverted,
  see below) — this is the sole authority for the label whenever a gap is
  active. The `#ribbon` `pointerover` delegate still drives it when NO gap
  is active (unchanged pre-Stage-5 behavior).
- **Click routing:** a capture-phase `click` listener on `#ribbon`
  redirects any click on any `.card` to `toggleCardExpand(gapKey, …)`
  whenever a gap is active, before the physically-clicked element's own
  (bubble-phase, per-card) `onclick` can fire.
- The old CSS `.card:not(.expanded):hover { transform: translateY(-6px) }`
  riffle rule is retired (index.html). Originally (first cut) the lift was
  folded into the gap-offset's own inline `transform` write instead;
  2026-08-15 follow-up dropped it outright — see below.
- Expanded-card interaction: the gap effect is fully suppressed while
  `cardExpandedKey` is set (`updateCardGap` early-returns), and
  `toggleCardExpand` explicitly clears any live gap state (`gapOffsetPx`,
  `leftPileOffsetPx`, `rightPileOffsetPx`, `gapEnterT0`, plus every
  pile card's own transform, both sides) on whichever card is being
  expanded before handing it to `animateCardTo` — that WAAPI animation
  only ever writes `left/top/width/height/perspective` + `rotateY`, never
  `.card`'s own `transform`, so a stale `translateX` would otherwise
  silently ride along into the expanded position.
- **Hard constraint, established after a reverted z-index attempt (see
  fix history below) — treat as a rule, not a preference:** this
  mechanism may ONLY ever write `transform` (translateX/translateY) on a
  `.card` element. No z-index, no DOM reordering, no other paint/stacking
  property, even to fix a real bug — route around the problem (e.g. via
  `gapKey` as the hit-testing authority) instead.
- **Direction bug, caught on first real feel-test and fixed same day:**
  the first cut had `gapOffsetPx = frac * ...` — offset GREW as the
  cursor advanced through the gap, so the traveling card moved WITH the
  cursor. Design called for the opposite (card reaches back toward where
  the cursor came from, easing to 0 as the cursor arrives at the next
  handoff — see CARD_GAP_MAX_PX's own comment). Fix: `(1 - frac)`.
  Worth flagging for future direction-sensitive tuning here: this formula
  is easy to flip twice by mistake, verify against the exact right-to-
  left walkthrough in the design discussion below before touching it
  again, not just by eyeballing the running effect.
- **No visible gap bug, caught on second feel-test and fixed same day:**
  even with direction and magnitude fixed, the gap still didn't read as
  visible space — because cards overlap heavily at rest (`CARD_STEP` ≪
  card width, by design, so later DOM siblings paint over their
  predecessor's receded right edge), moving ONLY the traveling card just
  slides it further under its still-stationary right neighbor; there's no
  empty background for it to reveal. Scott's fix, explicitly chosen as
  the simpler of two options over shifting both directions Mac-Dock-
  genie-style (which risks pushing left-side cards off-screen): the
  ENTIRE block of cards to the right of the gap now rigidly shifts right
  by the same live `gapOffsetPx` — same value the traveling card itself
  uses, so it's still only one animated quantity, just applied to more
  elements (`applyCardTransform`'s new `isBlockShift` parameter,
  `updateCardGap`'s and `relaxCardGap`'s now-full per-call passes over
  `lastCardSegs` instead of touching only `prevKey`/`gapKey`). Left of the
  gap stays fixed — **explicitly provisional**, Scott: "let's get this
  working first and we may tweak the which-cards-are-animated question a
  bit further, but let's take small steps." One follow-on fix this
  required: `#ribbon`'s width (fixed from `cardLayout`'s rest-space
  `total`) now pads by `CARD_GAP_MAX_PX` unconditionally, since a CSS
  `transform` doesn't grow an element's layout/scroll size — without the
  pad, `#ribbon-wrap`'s `overflow-x: auto` would clip the shifted tail
  near the right edge of the deck instead of it scrolling into view.
  **Hit-testing still resolves against REST positions only** (not the
  live shifted positions) — a deliberate simplification to keep this
  first cut small; watch for a visual/hit mismatch once shifted blocks
  are actually felt against real data; that's the natural next tuning
  conversation if it feels off, not a bug to silently work around.
- **Model rebuilt a third time, same day, on Scott's third feel-test
  catch — the block-shift fix above was itself still wrong.** Symptom
  report: "the gap is not 192 pixels... extremely small" AND "the
  animation is constantly animating the cards to the right" when it
  should only ever move once per handoff. Root cause: the block-shift fix
  re-shifted the ENTIRE right pile by the live `gapOffsetPx` every single
  `pointermove` — i.e. the right pile was moving IN LOCKSTEP with the
  traveling card the whole time, so the visual distance between them
  (the actual "gap") never grew past ~0 regardless of how large
  `CARD_GAP_MAX_PX` was; the pile only ever looked like it does today
  because it was always right behind the traveling card, not because the
  gap was small. **Corrected model — "piles are fixed, only the
  traveling card moves":** confirmed explicitly with Scott before
  rebuilding. The right pile's offset (`rightPileOffsetPx`, a value now
  SEPARATE from the traveling card's own `gapOffsetPx`) is a constant —
  always exactly `CARD_GAP_MAX_PX` for the entire duration a gap is
  active, REGARDLESS of cursor position within the gap. It only changes
  value at all during `relaxCardGap`'s exit tween, or when it steps
  (not eases) to match a NEW gapKey at handoff (one card transferring
  from the right pile to become the traveling card, or vice versa — the
  pile's MEMBERSHIP changes, not its per-member offset). The left pile
  stays identity (0) throughout, unchanged from before. The traveling
  card (`gapOffsetPx`) remains the only continuously cursor-driven value
  in the whole mechanism, lerping between the two now-fixed boundaries
  (0 and `CARD_GAP_MAX_PX`) exactly as before — only the pile's own
  behavior changed. `toggleCardExpand`'s gap-clearing (added for the
  first cut) was widened at the same time: it now clears the whole gap
  state (both piles, not just the specific clicked card) whenever ANY
  card expands, and explicitly snaps stray right-pile cards back to
  identity rather than leaving them stuck until the next `pointermove`
  — a related staleness bug the original narrower clear didn't cover.

- **Gap halved + label now travels with the card, same day (2026-08-15),
  once the piles-are-fixed rebuild made the effect legible enough to
  tune:** `CARD_GAP_MAX_PX` 192 → 96 (Scott: now that it's visibly
  working, the previous "make it bigger" correction had overshot).
  Separately, `cardHoverText` (the below-deck site name/meta/title label)
  now rides along with the traveling card instead of sitting fixed at its
  rest X the whole time it travels — Scott: "have the label... move with
  the card... reinforce the fact that the card we're focusing on has the
  same label." Mechanism: `cardHoverTextKey` (new) records which card's
  key the currently-visible label belongs to, set where the `#ribbon`
  `pointerover` delegate first shows it; `applyCardTransform`'s
  `key === gapKey` branch — already the single place that repositions the
  traveling card every frame — now also repositions the label in the same
  branch, reading the same live `gapOffsetPx`, whenever
  `cardHoverTextKey` matches. Free side effect: since `relaxCardGap`'s
  per-tick loop already calls `applyCardTransform(el, key, false)` with
  `key === gapKey` unchanged until `settle()`, the label eases back down
  together with the card on exit with no separate wiring.
- **Hover/click hit-testing bug, caught immediately after the label change
  shipped — real, distinct from every fix above.** Scott's report: the
  label shown (and the card that actually opened on click) was the
  STATIC neighbor immediately left of the gap, not the visibly-traveling
  card — confirmed by discussion that the traveling-card ASSIGNMENT
  (`gapKey = segs[i]`, the left-of-gap card peeling off and animating
  right) was correct and matched what Scott saw moving; the bug was that
  hover/click were landing on a DIFFERENT element than the one moving.
  Root cause: cards carry no z-index at rest — Stage 1's "no z-index
  needed" design (index.html's `.card` comment) relies entirely on later
  DOM siblings painting over earlier ones, which only holds as long as
  every card stays at its own natural chronological x. The traveling
  card breaks that the instant it moves RIGHT via `translateX`: it slides
  into its later (and so higher-DOM-stacked) right-pile neighbor's
  territory, which keeps painting on top of it regardless of the
  transform — so the pixels the cursor was actually over there belonged
  to the static neighbor the whole time, not the card that visually
  appeared to occupy that space.
  **First fix attempt — z-index — REVERTED same day, Scott: "there
  should be no z-index changes at all... this breaks the animation. The
  only animation that should be happening is that the X locations of the
  cards change."** `applyCardTransform` briefly set `el.style.zIndex = "1"`
  on the traveling card; reverted in full (code and this file's
  description of it) without a replacement fix yet. Root-cause diagnosis
  above (no z-index at rest, later DOM siblings painting over an
  out-of-chronological-order traveling card) is believed still correct
  and is NOT what got rejected — only z-index as the mechanism was.
  **Second fix — SHIPPED, 2026-08-15: stop DOM-hit-testing for cards
  entirely; make gapKey itself the authority.** Rather than fix WHICH
  element sits visually on top (z-index, DOM reorder — both change
  something other than X position, which Scott ruled out), this fix
  accepts that raw pointer/click hit-testing against overlapping absolute-
  positioned cards can't be trusted once any card leaves its natural
  chronological screen slot, and routes hover-label and click through
  `gapKey` directly instead — the mechanism ALREADY tracks "the card in
  the gap" continuously; it just wasn't being consulted for either
  concern yet. Scott's framing, adopted verbatim: "there should always be
  a concept of a card in the gap... as long as there's a gap opened, only
  the card in the gap should open on click. And only a card in a gap
  should be the label that is shown, and that label should animate across
  the gap with the card." Two changes, same shape:
    - **Label:** `fillCardHoverText` (content) pulled out of the
      `pointerover` closure to module scope; new `showCardHoverTextFor(el,
      key, offsetPx)` fills + positions + shows it for one specific card.
      `updateCardGap` now calls this for `gapKey`'s own card at the end of
      every `pointermove`, unconditionally, using the live `gapOffsetPx` —
      so the label is driven by the SAME authority that positions the
      card, continuously, not by a one-shot `pointerover` DOM-enter event.
      The old `pointerover` card branch is suppressed outright whenever
      `gapKey != null` (comment there explains why: it would only ever
      fight the new authority, showing the static neighbor it's actually
      sitting over).
    - **Click:** new capture-phase `click` listener on `#ribbon` (added
      alongside the existing `pointermove`/`pointerleave` pair) — whenever
      `gapKey` is set and the click landed on ANY `.card` (regardless of
      which one), it stops the event and calls `toggleCardExpand(gapKey,
      …)` directly instead of letting the clicked element's own
      `el.onclick` fire. Capture phase specifically so this runs and can
      `stopPropagation` BEFORE the per-card bubble-phase handler.
  Both changes touch zero geometry/paint properties — `transform` remains
  the only thing that ever moves a card, per Scott's constraint.

- **Riffle lift removed outright, gap centered on the cursor, same-day
  follow-up session (2026-08-15).** Two requests: (1) the pre-Stage-5
  translateY hover lift, already folded into the gap-offset's inline
  write, was now redundant with the gap effect itself — deleted, not kept
  as a separate mechanism. `CARD_GAP_LIFT_PX` removed. (2) Scott's
  diagnosis, confirmed against the code before any change: because only
  the RIGHT pile ever moved (fixed at `CARD_GAP_MAX_PX`) while the left
  pile stayed at identity, the visible gap's left edge was pinned to the
  left pile's untouched rest position — so the cursor, which the user
  feels as centered in the gap, always read as sitting on the gap's LEFT
  side. Rejected fix: just open the gap further right of the cursor (would
  create a visual discontinuity, gap appearing outside where the cursor
  currently is). Adopted fix, confirmed with Scott before building: BOTH
  piles now shift, by half the total gap width each, in opposite
  directions (`CARD_GAP_HALF_PX = CARD_GAP_MAX_PX / 2`) — traveling card's
  lerp range becomes `-CARD_GAP_HALF_PX..+CARD_GAP_HALF_PX` (was
  `0..CARD_GAP_MAX_PX`). `applyCardTransform`'s `isRightPile` boolean
  became a three-way `side` param (`"left" | "right" | null`).
  Viewport-edge concern (left pile now moves toward the screen edge,
  could clip at `scrollLeft: 0`): a permanent `margin-left:
  CARD_GAP_HALF_PX` on `#ribbon`, mirroring the existing unconditional
  right-side `ribbon.style.width` pad for the same "no rest-state jump"
  reason. Explicitly confirmed with Scott this is NOT the same mechanism
  as the lead-spacer tried and reverted for zoom (2026-08-08, `index.html`
  `#ribbon-wrap` comment) — that was a large empty anchor div that made
  `scrollLeft: 0` show blank space and read as the ribbon drifting/
  centering; this is a small fixed margin sized to a real, permanent,
  constant shift the gap effect performs, unrelated to zoom-anchoring.

- **Animated open + label decoupled from the card, same follow-up session
  (2026-08-15), two more requests.** (1) *Animated open:* the exit relax
  (`relaxCardGap`) already eased back to rest on `pointerleave`; entry was
  still instant (deliberate per the original design — "position is a pure
  function of cursor X... no special-cased entry animation"). Scott asked
  for the reverse animation on open too. Harder than exit because the
  cursor is still actively moving during entry (exit has no live cursor
  input to fight, so it tweens toward a fixed end value, 0). Mechanism:
  `updateCardGap` now always computes the three cursor-driven TARGET
  offsets first (unchanged math); a new `applyGapOffsets(targetGap,
  targetLeft, targetRight)` either writes them straight through (steady
  state) or — while `gapEnterT0` is set (started the moment a gap opens
  from inactive) — eases the painted offsets toward the target, re-reading
  the target fresh every call rather than a captured snapshot, so a
  still-moving cursor doesn't fight the ease. `GAP_ENTER_MS = 180`, same
  as `GAP_EXIT_MS`, for symmetry. A small self-driven `requestAnimationFrame`
  re-tick (sharing the `gapRafId` slot with exit-relax — the two are
  mutually exclusive) keeps the ease progressing even if the cursor stops
  moving mid-entry. `relaxCardGap` and `toggleCardExpand`'s gap-clear both
  reset `gapEnterT0`, covering exit/expand interrupting an in-flight
  entry.
  (2) *Label decoupled from the card:* the ORIGINAL Stage 5 label design
  (see the "Gap halved + label now travels with the card" entry above)
  had the label ride pixel-for-pixel with `gapOffsetPx`, same as the
  traveling card — Scott's framing at the time: "reinforce the fact that
  the card we're focusing on has the same label." Same-day feel-test,
  Scott: "the speed is so fast that it actually fights that too much" —
  "nearly impossible to read." Fix, confirmed with Scott before building:
  the label now sits at the GAP's stable center instead — a card's own
  rest-left (`seg.x`), which is exactly the midpoint of `gapOffsetPx`'s
  symmetric `±CARD_GAP_HALF_PX` lerp range, so no new geometry was needed
  — and only moves when `gapKey` itself changes at a handoff, not on every
  `pointermove` within the same gap. New state: `labelGapCenterPx`
  (painted) / `labelGapCenterTargetKey` (which gap it reflects) in
  `updateLabelGapCenter`, called from `updateCardGap` every frame but only
  actually writing on a `gapKey` change. `applyCardTransform`'s old
  per-frame "reposition the label to match the card" branch is deleted
  entirely — the label is no longer touched by that function at all.
  `showCardHoverTextFor`'s `offsetPx` param (added to a card's rest-left)
  became `leftPx` (an explicit absolute X), since the two callers (gap vs.
  plain `pointerover`) now have different semantics.
  **First cut of the handoff move eased over `LABEL_EASE_MS = 150`ms —
  REVERTED same day**, Scott's next feel-test: at real sweep speed across
  several gaps, the ease itself read as flickery, "fighting what's
  happening... trying to do too much in too little time," not smooth.
  Simplified to a plain snap — `updateLabelGapCenter` just writes
  `labelGapCenterPx = seg.x` directly on a `gapKey` change, no
  `requestAnimationFrame` loop, no timing constant. The label moves
  exactly once per handoff, instantly, same as the card's own handoff.

- **Label flicker during travel, follow-up session (2026-08-15): the
  gap-authoritative label above (`showCardHoverTextFor`/
  `updateLabelGapCenter`) still blanked/re-snapped once or twice per
  sweep.** Root cause was NOT in the gap mechanism itself — it was two
  unconditional `hideCardHoverText()` calls in the plain `#ribbon`
  `pointerover`/`pointerout` delegate (the pre-Stage-5 hover path, still
  live for the no-gap case). Raw `pointerover`/`pointerout` fire on
  whatever DOM element the cursor's REAL screen position is physically
  over/leaving — which is a STATIC card's real (unmoved) hit-box, since a
  traveling card's box never actually moves, only its paint does via
  `transform`. Every time the cursor's real position crossed one of those
  stale hit-box boundaries mid-sweep, `pointerover`/`pointerout` fired and
  blindly hid the label `updateCardGap` had just shown, which then
  re-snapped on the next `pointermove` — same DOM-hit-testing mismatch
  already solved for click routing and for label positioning itself, just
  not yet closed for the hide path. Fix: both handlers now skip
  `hideCardHoverText()` whenever `gapKey != null` — `updateCardGap` is
  already the sole per-`pointermove` authority for this label while a gap
  is active, so the raw delegate has nothing correct left to contribute
  during that window and must stay out of the way entirely, not just
  avoid fighting the position.

- **Rotation pivot, landed (2026-08-15):** LOW cards read as "over-rotated"
  next to HIGH despite provably parallel top edges — a thin post-rotation
  sliver reading as "rotated harder," not an angle bug. Fixed by moving the
  rotation pivot off each card's own edge (which always trades top-edge
  alignment for bottom-edge alignment or vice versa) to one SHARED absolute
  height — `CARD_PIVOT_Y_FRAC` (0.8 of the deck's max height), converted
  per-card to a px offset via `swivelPivotPx`, since CSS `%` can't express
  a point shared across differently-sized boxes. `CARD_SWIVEL_DEG` = 64°,
  `CARD_PERSPECTIVE_RATIO` = 6.0, `CARD_STEP` stays 10 (briefly tried at 20,
  reverted same day — too wide against real data). Tuned using an
  interactive slider tool (`test.html`, Desktop, not in the repo).
- **LOW-tier cleanup, same day:** the Stage 4 demotion scrim (gradient
  fade on LOW cards) is removed — wasn't earning its keep. LOW also
  rotates 10° less than every other tier (`CARD_SWIVEL_DEG_LOW_DELTA`),
  on top of the shared pivot above — confirmed keeper, not provisional.

**Not yet done / still open:**
- Perf at real on-screen card counts — implemented straightforwardly (one
  card's transform touched per `pointermove`), not load-tested.
- `CARD_GAP_MAX_PX`/`CARD_GAP_LIFT_PX`/`GAP_EXIT_MS` are first-guess
  constants, not derived or felt yet.
- The whole effect hasn't been felt against a full real busy day yet —
  everything above is confirmed only against the specific bugs Scott hit
  while testing, not a general "this works well" verdict.

**Resolved, kept here only so it isn't re-litigated:** `cardHoverText`'s
dual hover-detection path — `updateCardGap` is the sole authority
whenever `gapKey != null`; raw `pointerover` only still drives it when NO
gap is active (unchanged pre-Stage-5 behavior in that case). Click is
unified the same way. Not revisited further unless the two are ever seen
to disagree.

**Original design discussion (kept as the record of why), 2026-08-14/15
with Scott — no code existed yet when this was written:**

**Trigger for revisiting this at all:** cards today are cramped
(`CARD_STEP = 20`, `CARD_STEP_LOW = 10`) and Scott wants to go tighter
still — make ALL tiers use the current LOW pitch (uniform, more cramped
than today) — while adding a hover effect that opens breathing room
around whichever card has focus, so density and browsability aren't in
tension.

**Why the obvious version (move the hovered card, or push both
neighbors) doesn't work — read this before re-proposing either:**
1. Moving the hovered card itself, or widening a symmetric gap by pushing
   the left AND right neighbor apart, both risk **hover retrigger
   thrash**: shifting a neighbor's hitbox can sweep it toward/away from
   the cursor, re-firing hover state, which moves things again.
2. The specific failure mode found by walking through it step by step:
   if only the hovered card is treated as the fixed anchor and a neighbor
   "opens" toward it, crossing from card X to card X−1 means the cursor
   has to physically cross the gap region **while that same region is
   being animated by the handoff**, and the animated motion runs opposite
   the cursor's travel direction. That mismatch is what produces flicker,
   not z-order or hitbox ambiguity.

**The mechanism actually agreed on** (full reasoning trail is the
conversation itself; this is the settled shape):
- **Rest state** (cursor not over `#ribbon`): all cards at one uniform
  tight pitch (today's `CARD_STEP_LOW` value), no tier-based stagger, no
  animation running, no listener doing per-frame work.
- **Open state** (cursor over `#ribbon`): exactly **one card is ever
  offset from rest** — the "traveling" card — everything else stays put.
  Which card is traveling is determined purely by which gap (between two
  rest-position boundaries) the cursor's X currently falls in — no other
  state needed.
- **Position is a pure function of cursor X, not a chase/velocity/spring
  model:** within its gap, the traveling card's X = `lerp` between the
  two flanking rest slots, driven by the cursor's position between those
  same two boundaries — cursor at the gap's near edge → card fully at the
  departing side; cursor at the gap's far edge → card fully at the
  approaching side; centered cursor → centered card. Directly reversible:
  jittering the cursor back and forth just re-evaluates the same formula,
  no separate state to unwind.
- **Cursor and card move toward each other (Scott's Mac-Dock-genie
  reference, adapted):** as the cursor moves in one direction, the
  traveling card moves in the OTHER direction — that's what the lerp
  above produces. This is what keeps the physical mouse-travel needed to
  hand focus to the next card small: the card is closing part of the
  distance too, not sitting still waiting to be reached. It also removes
  the crossing problem in (2) above, since the card is always positioned
  exactly where the current cursor X implies — there's no independently-
  animated region for the cursor to cross through.
- **Handoff is a hard swap, not a crossfade:** the instant the cursor
  crosses a gap boundary, the just-traveling card snaps back to its own
  rest slot and the next card begins its own journey from ITS rest slot.
  Only one card is ever in motion. Deliberately NOT eased/blended at the
  boundary — a shared transition window would reintroduce two cards
  moving at once, which is the cascade/thrash risk this design avoids
  everywhere else.
- **Entry is instant, not a fade/expand-in:** because position is a pure
  function of cursor X with no separate "gap opening" state, the first
  frame after the cursor enters `#ribbon` already evaluates the formula
  correctly for wherever it entered — no special-cased entry animation.
- **Exit is the one place actual easing applies:** cursor leaving
  `#ribbon` has no cursor X to evaluate against, so the traveling card
  eases back to rest — the only genuinely time-based (not position-driven)
  animation in the whole mechanism.
- **All JS, no CSS transitions in the mechanism itself:** confirmed
  explicitly with Scott — CSS's role stays exactly what it already is for
  cards (the static per-card `rotateY` swivel/perspective presentation,
  set once at layout time); it does not grow a new role for this effect.
  The gap offset is pure continuous mouse-tracking math (current gap
  lookup + lerp) computed in JS on `pointermove` over `#ribbon`, written
  directly into the same per-card inline `transform` string that already
  carries the swivel (i.e. one more translateX term composed alongside
  the existing rotateY, not a separate property). The exit relax is ALSO
  JS-driven (e.g. a rAF tween toward offset 0), not a CSS `transition` —
  a CSS transition racing a live JS-driven value was flagged explicitly
  as its own stutter/flicker risk, separate from the crossing problem
  above, and rejected for that reason.

**Open items an implementer still needs to pick (not discussed to a
conclusion — defaults noted, confirm with Scott before/while building
rather than assuming):**
- Exact gap boundaries: derived from `cardLayout()`'s existing rest `x`
  values per card (tier width already known via `CARD_TIER_W`) — should
  be a direct reuse, not a new coordinate system, but hasn't been
  wired through.
- Whether the existing `.card:not(.expanded):hover` Y-lift and
  `cardHoverText` below-deck label continue to key off real CSS `:hover`
  as today, or need to be driven by the same "which card is current"
  computation this mechanism already derives each `pointermove` (keeping
  two separate hover-detection paths in sync could drift).
- Interaction with the expanded-card state (`toggleCardExpand`) — almost
  certainly needs the same suppression `.card.expanded` already gets
  elsewhere (Y-lift, hover text), but not yet decided explicitly for this
  mechanism.
- Perf of a `pointermove`-driven per-frame write at real on-screen card
  counts — untested; likely fine (only one card's transform is touched
  per frame) but worth confirming, not assumed.
- Uniform-pitch rest state removes `CARD_STEP` vs. `CARD_STEP_LOW`'s
  distinction — needs an explicit decision on what happens to the
  now-unused constant (delete vs. repurpose as the new uniform pitch).

## Non-goals / things this rewrite does NOT change

- Capture-side code (`background.js`, `content.js`, `spec/capture.md`) —
  this is a display-only rewrite of the ribbon's rendering, not the
  session/thread/container assembly logic in §6. Thread assembly,
  scoring, and container qualification rules are inputs to this new view,
  unchanged, unless a stage's "feel" testing surfaces a reason to revisit
  assembly itself (e.g. the Gemini over-containerization complaint might
  turn out to need an assembly-side fix, not just a display-side one —
  flag if that comes up, don't silently scope-creep into §6).
  **One deliberate exception (2026-08-11):** `SNAP_WIDTH` in
  `background.js` (640 → 1280) — see Stage 1 build log #2. Scott
  explicitly asked for this one constant despite it being capture-side;
  everything else in `background.js`/`content.js` is untouched.
- Week strip (`spec/display.md` §5's skyline cells) — out of scope unless
  explicitly pulled in later.

## When a stage ships

Per CLAUDE.md's doc map: update `spec/display.md` (rules) and/or
`decisions/` (the "why," if real reasoning/rejected-alternatives were
involved — e.g. why fully-uniform width vs. compressed, why the magnify
curve landed where it did) FIRST, then add a one-line pointer in
`HISTORY.md` LAST. This plan file's corresponding stage entry gets struck
or trimmed at that point, not left duplicating what SPEC.md now says.
