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
