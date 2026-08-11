# Stack Ribbon — staged rewrite plan

**Status:** Stage 0 (verification harness) is DONE and on disk — see below.
Stage 1 (flat swivel strip) not started; still discussion/design. This is a
working doc, not a SPEC.md rule — see CLAUDE.md's doc map. When a stage
ships, its truth moves into `spec/display.md` (+ a `decisions/` story if
real reasoning was involved) and this file's entry for that stage gets
struck through or trimmed. When the whole rewrite lands or is abandoned,
this file goes away.

**If resuming cold:** read this whole file, then `testing/README.md` for
the harness. Nothing about the new ribbon design itself is implemented yet
— only the ability to screenshot the CURRENT (old) ribbon against real
data is built. Stage 1 is the first actual design change.

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
- Whether width goes fully uniform or stays log-compressed by duration as a
  secondary, minor signal (not yet decided; Stage 1 should probably try
  fully uniform first since it's simpler, and add compression back only if
  flat-uniform feels wrong).

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

Scope:
- Replace block-width-as-duration with **card height as tier**: three
  distinct heights for LOW / MEDIUM / HIGH (reintroducing real tier-height
  separation that §5-6 retired 2026-08-07 — this stage is a deliberate
  reversal of that call, for a different reason: height is now the
  *primary* signal, not a redundant one alongside luminance).
- X-axis: roughly uniform per-card spacing (chronological order preserved,
  true duration no longer drives width). Confirm during this stage whether
  fully uniform reads fine or needs light compression.
- Each card is a screenshot, swiveled backward in Z off a **fixed left
  edge** (Stage Manager framing) — static angle, no motion/magnify yet.
- Domain label rendered on the same swiveled plane as the screenshot, not
  a separate floating layer.
- Containers render as a plain, non-interactive badge on the card (e.g. a
  count indicator) — no drop-down shelf yet. Children are not browsable in
  this stage; the container just doesn't lie about being a single event.
- Existing click-to-open-top-fragment and tooltip behavior can stay as the
  interim interaction model.
- Explicitly OUT of scope for Stage 1: magnify-on-hover, container
  drop-down shelf, high-density compression strategy.

Exit criterion: Scott has browsed a real busy day in this layout and has
an opinion on whether height-as-tier + swivel cards is more browsable than
the current fence/stick ribbon. That opinion decides whether Stage 2
proceeds as planned or the direction gets revised.

### Stage 2 — dock-style magnify-on-hover

Scope (pending Stage 1 outcome):
- Approach-based magnification of nearby cards, tuned by feel against the
  concern raised above (screenshots need reading time, not icon
  recognition — likely a gentler/wider curve than macOS's dock).
- No specific curve/constants decided yet — this is explicitly a "tune by
  feel" stage, not a formula to derive up front.

### Stage 3 — container drop-down shelf

Scope (pending Stage 1 + 2 outcome, and the open questions above):
- Hovering a container badge drops a shelf of child screenshots (smaller)
  below/above the top-level strip.
- Resolve: always-visible child-count affordance vs. hover-only discovery.
- Resolve: nesting depth (confirm one-level assumption against
  `spec/display.md` §5-6's current container model before building).

### Stage 4 (maybe) — high-density behavior

Only scoped once Stage 1-3 exist and a genuinely busy day can be felt in
the new layout. Candidates noted in the discussion: fixed angle with
clip/scroll, or nonlinear Stage-Manager-style compression. No decision
yet.

## Non-goals / things this rewrite does NOT change

- Capture-side code (`background.js`, `content.js`, `spec/capture.md`) —
  this is a display-only rewrite of the ribbon's rendering, not the
  session/thread/container assembly logic in §6. Thread assembly,
  scoring, and container qualification rules are inputs to this new view,
  unchanged, unless a stage's "feel" testing surfaces a reason to revisit
  assembly itself (e.g. the Gemini over-containerization complaint might
  turn out to need an assembly-side fix, not just a display-side one —
  flag if that comes up, don't silently scope-creep into §6).
- Week strip (`spec/display.md` §5's skyline cells) — out of scope unless
  explicitly pulled in later.

## When a stage ships

Per CLAUDE.md's doc map: update `spec/display.md` (rules) and/or
`decisions/` (the "why," if real reasoning/rejected-alternatives were
involved — e.g. why fully-uniform width vs. compressed, why the magnify
curve landed where it did) FIRST, then add a one-line pointer in
`HISTORY.md` LAST. This plan file's corresponding stage entry gets struck
or trimmed at that point, not left duplicating what SPEC.md now says.
