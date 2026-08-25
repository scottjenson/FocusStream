# Handoff: delete the card view

**Written 2026-08-25.** Scope, evidence, and sequence for removing the card
deck (`paintCards()` and its runtime) from FocusStream, leaving the block
ribbon as the one display path. Delete this file when the work is done.

Read `CLAUDE.md` and `SPEC.md` first. This document assumes them.

---

## Why this is happening now

The card view was kept alive as a **live A/B** for one stated reason,
recorded in `WATCHLIST.md` (`card-view-unspecced`): its layout ideas —
specifically **uniform width per tier**, the "sliver fix" — were to be
harvested into `layout()` before the path was deleted.

**Scott settled this on 2026-08-25: the harvest will not happen.** Width in
`layout()` is duration-based and stays that way — that is the ribbon's
core claim (width = time), and uniform-width-per-tier contradicts it. It is
a **rejected** idea, not a pending one.

So the watch item's condition ("resolve by deleting the card path once the
harvest is done") is satisfied vacuously. Deleting now banks nothing and
discards nothing.

---

## Why this is a deletion, not a rewrite

Verified 2026-08-25 by inspection, not assumed. **Do not re-derive this;
it is the finding that sizes the job.**

* **The card runtime is one contiguous region: `dashboard/timeline.js`
  lines ~2931–4156 (~1,226 lines).** Gap spreading, card transforms, the
  expand/collapse animation, the child carousel, and `paintCards()` all
  live inside it, in that order.
* **`paint()` — the block path — touches none of it.** Not `gapKey`, not
  `updateCardGap`, not `cardHoverText`. Checked directly.
* **Nearly every reference to the card region from outside it is a
  COMMENT, not a call.** The live code callers number **three**, and all
  three sit in mode-switch plumbing that is itself being deleted:
  | call | line (pre-edit) | inside |
  |---|---|---|
  | `hideCardChildRow()` | ~2152 | `setRibbonMode` |
  | `paintCards(...)` | ~2263 | `render` |
  | `paintCards(...)` | ~4159 | `relayout` |

Total footprint including constants and helpers earlier in the file:
**~1,400–1,500 lines of 4,169, about 35%.**

Line numbers WILL have shifted — Scott committed pending lock-affordance
work before this started. Locate by symbol, never by line number.

---

## Step 0 — branch

Scott's standing rule (`CLAUDE.md`): never `git commit`/`git push` without
approval. Ask before creating the branch if unsure, but a branch is the
agreed shape for this — it is a 1,400-line deletion in the primary view.

---

## Step 1 — delete the card runtime (`dashboard/timeline.js`)

Delete the contiguous region and its dispatchers.

**Functions and state to delete** (locate by name):
```
restoreFullCardSeg   applyGapOffsets      applyCardTransform
updateCardGap        relaxCardGap         hideCardChildRow
carouselItemsOf      cardDeckGeom         cardExpandGeom
animateCardTo        toggleCardExpand     selectCarouselItem
paintCardChildRow    closeExpandedCard    setRibbonExpandedHeight
paintCards           cardLayout           fillCardInfo
swivelDegFor         swivelPivotPx
```
```
lastCardSegs  fullCardSeg  gapKey  gapOffsetPx  gapRafId  gapEnterT0
gapDeadZoneActive  gapFreezeX  cardExpandedKey  cardCarouselIndex
cardChildRow  cardEls  ribbonMode
```

**The mode toggle goes entirely:**
* `ribbonMode`, `setRibbonMode`, `window.FS_getRibbonMode`,
  `window.setRibbonMode`.
* The `storedMode` / `localStorage.getItem("fs_ribbon_mode")` read and its
  try/catch.
* `window.__fsTimelineMode` (dead since the §7 strip was deleted).
* Both `if (ribbonMode === "cards")` dispatches — `render()` and
  `relayout()` call the block path unconditionally.

**Watch for:** the big comment above `storedMode` explains a
localStorage-throws hazard in terms of an overlay/content-script context
that no longer exists (`switcher.js`, deleted in §8 Phase 1). Delete it
with the code rather than preserving a false explanation.

---

## Step 2 — the `cardHoverText` family

**Delete it — but read this first, it is the one place a careless sweep
gets it wrong.**

`cardHoverText` is the below-card label that *replaced* the floating
tooltip **for cards only**. It has live callers in the SHARED
pointerover/pointerout handlers, which is why it looks shared. It is not.
Verified 2026-08-25:

* The two **show** calls are gated on `isCard` / `isChildThumb`, both of
  which are permanently false once cards are gone. Dead.
* The remaining calls are defensive **hide** calls (in `pointerout`,
  `pointerdown`, `markPanningMoved`). They become no-ops. **Delete the
  calls too**, do not leave them as harmless nubs.

Delete: `cardHoverText` (element), `cardHoverTextKey`, `fillCardHoverText`,
`hideCardHoverText`, `showCardHoverTextFor`, `updateLabelGapCenter`,
`labelGapCenterPx`, `labelGapCenterTargetKey`.

Blocks use the parked `#tip` card instead (the 2026-08-25 lock work).

---

## Step 3 — constants

~28 `CARD_*` constants. **Most die; a few must survive under new names.
Untangle by hand — a regex sweep on `CARD_` WILL break the build.**

Known survivors / traps:
* **`CARD_ASPECT` (640/342)** — used by `cardExpandGeom` (dying), but it
  also expresses the **snapshot's native aspect**, which is capture-side
  truth (`SNAP_WIDTH`, `background.js`), not a card concept. If anything
  still needs it, rename to `SNAP_ASPECT`. If nothing does, delete.
* **`CARD_TIER_H` / `CARD_TIER_W`** — used by `cardLayout` (dying) and
  referenced in `spec/display.md` line ~125. Both die with `cardLayout`,
  but see Step 5: that spec bullet must be rewritten, not just deleted.
* `CARD_HOVER_TEXT_H` — dies with Step 2.

After deleting, grep for `CARD_` and confirm every remaining hit is either
a renamed survivor or gone. **`node --check dashboard/timeline.js` after
this step**; it catches the reference errors a hand-untangle produces.

---

## Step 4 — CSS and HTML

**`dashboard/timeline.css`** — 41 card selectors. Delete:
```
.card  .card-face  .card-img  .card-info  .card-badge  .card-close
.card-child-row  .card-child-thumb  #card-hover-text  #card-child-row
```
Leave `.blk-lock`, `#tip`, `#tip-close`, `#tip-img` alone — those are the
block ribbon's, added 2026-08-25.

**`dashboard/index.html`** — delete the toggle button, line ~16:
`<button id="ribbon-mode-toggle">Classic view</button>`

**`dashboard/dashboard.js`** — delete the whole toggle block (~lines
215–230), the one starting with the comment "Ribbon view toggle
(decisions/card_deck.md, 2026-08-12)".

---

## Step 5 — docs

Follow `CLAUDE.md`'s documentation map: **five files, five jobs, never the
same content in two.** This is a deletion pass, so `/updatedocs` (adds
only) is the wrong tool — edit directly, or use `/docaudit` if a wider
drift pass is wanted.

**`SPEC.md`** — the display-path table (~line 84) currently lists two
paths. Reduce to one: the block ribbon. Delete the card-deck row and the
sentences after it about `decisions/card_deck.md` and
`card-view-unspecced` (~lines 87–89).

**`WATCHLIST.md`** — delete the `card-view-unspecced` item (~lines 66–73)
outright. It is resolved, and `CLAUDE.md` is explicit that resolved watch
items get deleted, not annotated.

**`spec/display.md`** — line ~125 is the trap. It currently says `TIER_H`
is "dormant since the Stage 1 stack-ribbon rewrite" and that the live
layout sizes from `CARD_TIER_H`. **That inverts once cards are gone:**
`TIER_H` becomes the live and only tier-height source. Rewrite the bullet
to say that plainly; do not merely delete it, or the spec goes silent on
where tier heights come from. Check lines ~118 and ~144 for stale card
mentions too (~144 contrasts on-block snapshots with "the card deck's
eager one" — that contrast needs rephrasing once there is no card deck).

**`decisions/card_deck.md`** — do NOT delete the file's history silently.
Per `decisions/README.md`'s convention, move it to the **"Retired logs"**
section there with a one-line note and the date (2026-08-25), recording
that the card view was deleted and *why*: uniform-width-per-tier was
rejected because width is duration-based. Whether the file itself is
deleted (text recoverable from git) or kept is the retired-logs
convention's call — follow what that section already does for
`plans/stack-ribbon.md` etc.

**`decisions/timeline_design.md`** — add a dated entry recording the
deletion and the rejected-not-harvested reasoning. This is the durable
"why" behind a now-single display path, and `timeline_design.md` is the
display-side log.

---

## Verification

No build step, no test suite. In order:

1. `node --check dashboard/timeline.js` and `node --check
   dashboard/assembly.js` after each step.
2. `grep -riE "card|paintCards|gapKey" dashboard/` — every surviving hit
   should be deliberate. Expect hits in `assembly.js` for unrelated words;
   read, don't assume.
3. **`testing/replay-rules.mjs`** — `assembly.js` is untouched by this
   work, so container/block counts must be **identical**, not merely
   close. Any change means something shared was cut. Usage:
   `testing/README.md`.
4. Load unpacked via `chrome://extensions` and confirm the ribbon renders,
   hover cards park correctly, and the lock affordance still works.

**Scott tests locally** (`CLAUDE.md`) — do not spin up dev servers or
headless screenshots. Report what was verified and what was left to him.

---

## Encoding warning

`dashboard/timeline.js` contains **146 `§` and 6 `→`** characters. A
`perl -0pi` rewrite without a UTF-8 layer mangled every one of them during
the 2026-08-25 lock work (caught via a diff stat jumping from 185 to 1,269
changed lines; reversed by decoding UTF-8 → encoding latin-1).

**Use `python3` with explicit `encoding='utf-8'`, or the Edit tool.** After
any scripted rewrite, verify:
```
grep -c '§' dashboard/timeline.js   # expect 146 (fewer only if you deleted some)
grep -c 'Â\|â€\|Ã' dashboard/timeline.js   # expect 0
```

---

## Standing constraints (from `CLAUDE.md`)

* **Discuss before coding.** Scott expects a proposal and approval before
  edits. This document is the approved plan for *this* scope — anything
  beyond it needs a fresh conversation.
* **Lock down scope.** Do not wander into the `spec/ribbon.md` → §6 drain
  or the `§7x` comment renumbering. Both are explicitly deferred
  (`SPEC.md`), gated on two unresolved §6 conflicts, and are NOT part of
  this cleanup.
* **Never commit or push without explicit approval.**
* If an approach fails twice, stop and reconsider the model rather than
  retrying variants.
