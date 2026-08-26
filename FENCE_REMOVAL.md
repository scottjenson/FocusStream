# Handoff: delete the fence

**Written 2026-08-25.** Scope, evidence, and sequence for removing picket
fencing (LOW runs collapsing to click-to-expand sticks) from FocusStream.
Delete this file when the work is done.

Read `CLAUDE.md` and `SPEC.md` first. This document assumes them.

---

## Why this is happening now

Fencing has not rendered since §8 Phase 1 (2026-08-25). `clusterEvents`
builds a run ONLY inside `if (event.band === "low" && !event.isOpenTab &&
anchorMode !== "right")`, and `anchorMode` is permanently `"right"` since
`switcher.js` was deleted — nothing sets `window.__fsTimelineAnchor` any
more. So `run.push()` never executes, `flush()` never sees a non-empty run,
no `{kind:"cluster"}` item is ever emitted, and no stick or plate is ever
painted.

The docs were corrected 2026-08-25 to say so (`spec/display.md` "The fence
— REINSTATED 2026-08-08, DORMANT since 2026-08-25"). This task removes the
code that dormancy describes.

**This is NOT the `anchorMode` question.** Fencing worked in both anchor
modes historically; `anchorMode` is merely the flag currently gating it.
The two are independent decisions and this document covers only fences.
`anchorMode`'s own dead branches (`quickLabel`, `titleRuns`/`groupRuns`,
`bandFloorFor`'s first line, the scroll-capture guard) are **explicitly out
of scope** — leave every one of them, including the ones this work sits
next to.

## Ordering against `ANCHORMODE_REMOVAL.md`

If both tasks are approved, **do this one FIRST.** The two overlap at one
line — `clusterEvents`' run gate (~513), which is both fence code and an
`anchorMode` test. Removing `anchorMode` first would drop that gate's
conjunct and make fencing LIVE again (sticks and plates reappear), and
`replay-rules.mjs` would still report 394/187 while it happened, because
fencing is display-side only. Doing fences first deletes the whole function
and removes the overlap.

This plan's line numbers are captured against the current tree and are
correct as long as nothing else lands first. `ANCHORMODE_REMOVAL.md`
carries the note about re-deriving ITS numbers after this one ships.
One shared edit: `render()`'s comment at ~1760 names "fence toggle" as a
render trigger; the anchorMode plan rewrites the same comment's left/right
contrast. Whoever goes second edits the rewritten text.

---

**Decide before starting:** removing this forecloses a return to fencing.
The rule is well-archived (`decisions/timeline_design.md`, "Fences",
"Fences bridge breaks, split at departures", "Only departures earn an away
plate") and recoverable from git, but it is a real product decision, not a
tidy-up. If fencing might come back, stop here and leave the code dormant.

---

## Why this is harder than the card deletion

Verified 2026-08-25 by inspection. **Do not re-derive this; it is the
finding that sizes the job.**

The card view was one contiguous region that `paint()` never touched. This
is the opposite: fencing is **threaded through the shared paint path**.
`s.collapsed` alone is read at ~18 sites inside `paint()`, interleaved with
live logic for favicons, snapshots, labels, locking, and hit-testing.

There is no contiguous region to cut. Expect to work site-by-site, and
expect the mechanical part (deleting a `!s.collapsed &&` conjunct) to be
easy while the reading is not.

Rough size: ~200-250 lines across `dashboard/timeline.js`, 2 lines of CSS.

---

## What is FENCE and what only looks like it

Getting this boundary wrong is the main risk. Three families share
vocabulary and only the first one dies.

**DIES — the fence:**
* `clusterEvents`, `gapIsLockBounded`
* `MIN_RUN`, `STICK_W`, `STICK_GAP`, `STICK_FILL`, `FENCE_IMPLIED_BREAK_MS`
* `{kind:"cluster"}` items, `clusterKey`, `s.collapsed`, `s.stick`, `plates`
* the whole expand/collapse interaction: `expandedKey`, `expandedBox`,
  `expandFence`, `collapseFence`, `collapseAllFences`, `scheduleOpen`,
  `cancelOpen`, `closeTimer`, `openTimer`, `FENCE_OPEN_DELAY_MS`,
  `FENCE_CLOSE_DELAY_MS`
* `.plate` CSS

**SURVIVES — the away plate.** `FENCE_BRIDGE_GAP_MS` (30 min) sounds like
fencing and is not. Since 2026-08-08 it does exactly one job: gating which
gaps earn an `away 12:04 – 1:38` tooltip. That loop is in `paint()`, is
NOT behind the dead `anchorMode` gate, and runs on every repaint today. It
is live, user-visible behaviour.
**Keep `FENCE_BRIDGE_GAP_MS`, keep the `for (const g of gaps)` loop, keep
the `.gap` CSS.** Watch item `away-plate-threshold` tracks its tuning.
Consider renaming it `AWAY_PLATE_GAP_MS` in a separate pass — not this one.

**SURVIVES — contained children.** `CUT_SEAM`, `CONTAIN_INSET`,
`CONTAIN_BOTTOM_INSET`, `CONTAIN_CHILD_H`, `.cut`, `s.contained` are the
container cut-out treatment (`spec/display.md`, "Children are cut out of
the interior"). Unrelated to fences despite "cut"/"seam" wording.
`CUT_SEAM` IS dead (referenced once, its own declaration — the real seam
width is `timeline.css`'s `.blk.cut`), but it is dead for its own reasons
and is **out of scope here.**

---

## Step 0 — branch

Standing rule (`CLAUDE.md`): never `git commit`/`git push` without
approval. Confirm the working tree is clean or knowingly dirty before
starting — at time of writing it holds the uncommitted card-view deletion
plus doc fixes.

---

## Step 1 — `clusterEvents` and its feed

`clusterEvents` currently maps `events[]` -> `items[]`, tagging each as
`{kind:"event", event}` or `{kind:"cluster", key, members}`. With fences
gone every item is `{kind:"event"}`, so **the wrapper layer disappears
entirely and `layout()` takes plain events.**

Delete `clusterEvents` (timeline.js ~492-535) and `gapIsLockBounded`
(~484-490; it has no other caller — confirm with a grep before cutting).

Then update the three call sites to pass events straight through:
| line (pre-edit) | current |
|---|---|
| ~1694 | `layout(clusterEvents(sorted, lockIntervals), null).timeToX(...)` |
| ~1709 | `layout(clusterEvents(events, lastLockIntervals), null).total` |
| ~1811 | `const items = clusterEvents(events, lastLockIntervals);` |

`lastLockIntervals` itself stays — lock intervals are still used elsewhere
(`§3` lock evidence, the lock affordance). Only fencing's use of them goes.

---

## Step 2 — `layout()`

`layout(items, expandedKey)` becomes `layout(events)`. Inside it:

* Delete the `if (item.kind === "cluster" && item.key !== expandedKey)`
  branch (~679-698) — the stick-emitting loop and its `plates.push`.
* Delete `const plates = []` (~641) and `const bars = []` (~641) with
  `plates`/`bars` from the returned object (~770). **`bars` is entirely
  fence-owned** — pushed only inside the `kind === "cluster"` branch (~765,
  the expanded run's hit box) and read only to compute `expandedBox`
  (~2121). It is not a general layout output despite sitting beside `gaps`
  and `dividers`, which both survive.
* `paint()`'s destructuring at ~1803/~1813 lists `plates` and `bars`;
  narrow both. The closing `log(...)` (~2391) reports
  `${plates.length} fences + ${bars.length} expanded` — rewrite it.
* Collapse every `item.kind === "cluster" ? A : B` ternary to `B`
  (~700, ~730, ~734, ~764), and `item.event` to the event itself.
* Lines ~629/633/637 also test `item.kind` — the `.filter()` at 633 keeps
  its `bandDroppedAt` logic (that is §7e band-dropping, NOT fencing) but
  loses the `item.kind === "cluster" ||` disjunct.
* `clusterKey` and `collapsed` disappear from every seg. `stick: false`
  (~756) is a vestige set once and never true — delete it and its readers.

**Trap:** `s.collapsed || s.w <= 0` appears at ~551 and ~790 as a guard for
"carries no usable span." With `collapsed` gone the `s.w <= 0` half must
STAY — dropped blocks (§7e band ladders) still hit it.

---

## Step 3 — the expand/collapse interaction

Delete outright (~908-1000): `expandedKey`, `expandedBox`, `closeTimer`,
`openTimer`, `FENCE_CLOSE_DELAY_MS`, `FENCE_OPEN_DELAY_MS`, `expandFence`,
`collapseFence`, `scheduleOpen`, `cancelOpen`, `collapseAllFences`, and the
pointer-ownership helper reading `expandedBox` (~994).

Callers to clean:
* ~1018 `collapseAllFences()` inside the Escape handler — Escape still
  releases the tip lock, so remove only the fence call, not the handler.
* ~1802 `cancelOpen()` at the top of `paint()`.
* ~2110 `el.addEventListener("mouseenter", () => scheduleOpen(p.key))` —
  goes with the plate rendering (Step 4).
* ~1725 a comment naming `expandFence()/collapseFence()` as render
  triggers — rewrite, don't just delete, or the comment lies about why
  `render()` is called.

---

## Step 4 — `paint()`

The long tail. Delete the plate-rendering loop (~2100-2115, the one whose
elements get `.plate` and the `scheduleOpen` mouseenter).

Then simplify each `collapsed`/`stick` read. Every one is a conjunct that
becomes constant-true or constant-false:

| line (pre-edit) | edit |
|---|---|
| ~1887 | `s.collapsed \|\| s.stick ? STICK_FILL : TIER_FILL[s.band]` -> `TIER_FILL[s.band]` |
| ~1926 | drop `!s.collapsed && !s.stick &&` |
| ~1932-1942 | the `s.collapsed` rim/branch and the `if (s.collapsed)` early-out |
| ~1983 | `s.collapsed \|\| s.w < MIN_W ? "none" : "auto"` -> keep ONLY the `s.w < MIN_W` test |
| ~1984 | `el.onclick = s.collapsed ? ... : ...` -> keep the non-collapsed arm |
| ~1995 | `const lockable = !s.collapsed && s.w >= LOCK_MIN_BLOCK_W` -> drop the conjunct |
| ~2260, ~2293, ~2329 | favicon / label / snapshot gates: drop `!s.collapsed && !s.stick &&` |
| ~819 | `seg.band === "high" && !seg.collapsed` -> drop the conjunct |

**Do not** touch the neighbouring `!s.contained` conjuncts at ~2293/~2329 —
those are contained children (see boundary section).

---

## Step 5 — constants

Delete `MIN_RUN`, `STICK_W`, `STICK_GAP`, `STICK_FILL`,
`FENCE_IMPLIED_BREAK_MS`.

**Keep `FENCE_BRIDGE_GAP_MS`** (away plate — see boundary section). Its
declaration comment at ~233 and the comparison comment at ~244 both
reference `FENCE_IMPLIED_BREAK_MS`; rewrite them rather than leaving
pointers to a deleted constant. Likewise the away-plate loop's long comment
(~2044-2057) explains itself entirely in terms of fence bridging — it needs
rewriting to state the plate rule on its own terms.

`node --check dashboard/timeline.js` after this step.

---

## Step 6 — CSS

`dashboard/timeline.css`: delete `.plate` and `.plate:hover` (~301-302) and
the comment above them.

**Leave `.gap` and `.gap:hover`** — away plates use them.

---

## Step 7 — docs

Deletion pass, so `/updatedocs` (adds only) is the wrong tool. Edit
directly.

* **`spec/display.md`** — "The fence — REINSTATED 2026-08-08, DORMANT since
  2026-08-25" (~line 80) is now wrong in the other direction: it says the
  code path is intact. Rewrite to record fencing as REMOVED, keeping one
  sentence of what it was. Also check the two-break-mechanisms bullet
  (~81), which is entirely about `FENCE_IMPLIED_BREAK_MS` and dies with it,
  and the `FENCE_BRIDGE_GAP_MS`/`FENCE_IMPLIED_BREAK_MS` pairing in the
  constants section (~156, ~158) — the pairing is the whole point of those
  entries and it no longer exists.
* **`spec/display.md`** — "Contained LOW sticks — RETIRED" says `STICK_W`
  "remains defined and load-bearing for collapsed fence sticks." False once
  this ships.
* **`spec/ribbon.md`** (~70) — "Fences are retired entirely in this view
  ... the code path remains." Second half becomes false.
* **`WATCHLIST.md`** — `away-plate-threshold` explains itself partly in
  terms of fencing being dead-but-present; trim to the live doubt.
  `fixed-overhead-dilation` mentions `STICK_W` parenthetically.
* **`decisions/timeline_design.md`** — add a dated entry: what was removed,
  that it had been unreachable since §8 Phase 1, and that the away plate
  was deliberately kept. Note explicitly that this was NOT the `anchorMode`
  decision, so a later reader doesn't infer that one was made.

---

## Verification

No build step, no test suite. In order:

1. `node --check dashboard/timeline.js` after each step.
2. **`testing/replay-rules.mjs` — counts must be IDENTICAL, not close.**
   `assembly.js` contains no fence code (only a comment at ~860 pointing
   at `timeline.js`; update that comment). Fencing is display-side only,
   so any movement in block/container counts means something shared was
   cut. Baseline at time of writing: **394 blocks / 187 containers over 8
   days.**
3. `grep -n "collapsed\|stick\|cluster\|plate\|MIN_RUN" dashboard/timeline.js`
   — every surviving hit should be the away plate, a contained child, or a
   comment you rewrote deliberately.
4. Load unpacked via `chrome://extensions`. Confirm: the ribbon renders; a
   long absence still shows its `away …` tooltip (that is the away plate —
   the thing that must NOT have gone); hover cards park; the lock
   affordance works; Escape still releases a lock.

**Scott tests locally** (`CLAUDE.md`) — do not spin up dev servers or
headless screenshots. Report what was verified and what was left to him.

---

## Encoding warning

`dashboard/timeline.js` contains **142 `§`** characters. A `perl -0pi`
rewrite without a UTF-8 layer mangled every one of them during the
2026-08-25 lock work.

**Use `python3` with explicit `encoding='utf-8'`, or the Edit tool.** After
any scripted rewrite, verify:
```
grep -c '§' dashboard/timeline.js        # expect 142 (fewer only if deliberate)
grep -c 'Â\|â€\|Ã' dashboard/timeline.js  # expect 0
```

---

## Standing constraints (from `CLAUDE.md`)

* **Discuss before coding.** This document is a proposal, not an approval.
* **Lock down scope.** `anchorMode`, `CUT_SEAM`, `quickLabel`,
  `titleRuns`/`groupRuns` are all separate decisions. Do not fold them in
  because the code sits nearby.
* **Never commit or push without explicit approval.**
* If an approach fails twice, stop and reconsider the model rather than
  retrying variants.
