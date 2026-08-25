# Card deck (stack-ribbon) — decision log

Merged here 2026-08-25 from `plans/stack-ribbon.md`, which was dissolved
along with the `plans/` directory. That file and this one had both claimed
to be the reasoning archive for the same subject — each pointing at the
other for the "durable why" — which is what made the parallel structure
worth collapsing. Build-log detail and per-stage fix history that only
described how the code got to its current state was dropped in the merge;
the as-built state is the code, and the rules are `spec/display.md`.

**Status (2026-08-25):** the card deck is still the standalone dashboard's
default view (`ribbonMode`, `dashboard/timeline.js`) but is NOT the
direction — the Active Tab Manager (§7) is. Card code stays until its
capabilities are carried over; several have no §7 equivalent yet (below-deck
hover text, expanded-card info panel, child carousel, riffle-on-hover).
Stages 0-2 and 5 shipped; Stage 3 (container drop-down shelf) and Stage 4
(high-density behavior) were never built and now likely never will be as
specified — see the §7 migration note in `SPEC.md`.

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


## What the stages actually delivered

- **Stage 0** — Playwright verification harness (2026-08-11). Superseded by
  `testing/replay-rules.mjs` for rule work.
- **Stage 1** — flat swivel strip. Width fully uniform per tier
  (`CARD_STEP`), card width driven by `CARD_ASPECT`. Duration plays no role
  in card layout at all, which was the point: it fixes "tiny sliver blocks".
- **Stage 2** — click-to-expand. Retargeted from its original scope
  (dock-style magnify-on-hover, never built).
- **Stage 3** — container drop-down shelf. NOT BUILT.
- **Stage 4** — high-density behavior. NOT BUILT; the three candidates above
  were never chosen between.
- **Stage 5** — single-traveling-card hover-gap effect (2026-08-15).
  Implemented. Full reasoning, including the two rejected alternatives, is in
  `decisions/timeline_design.md`, "Single-traveling-card hover-gap effect".

## Non-goals (unchanged by the rewrite)

Capture, scoring, assembly, and the transit filter were never in scope — the
card deck is a display treatment over the same `assembleThreads()` output the
block ribbon uses.
