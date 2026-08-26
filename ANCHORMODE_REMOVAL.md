# Handoff: collapse anchorMode, right-anchoring always

**Written 2026-08-25.** Scope, evidence, and sequence for removing the
left/right anchor split from FocusStream, making right-anchoring
unconditional. Delete this file when the work is done.

Read `CLAUDE.md` and `SPEC.md` first. This document assumes them.

---

## Why this is happening now

`anchorMode` was introduced (§7b, 2026-08-21) to let ONE module serve two
surfaces: the standalone dashboard left-anchored (day's first event flush
left, historical behaviour), and the injected overlay right-anchored to
"now". `switcher.js` set `window.__fsTimelineAnchor = "right"` before
`import()`-ing the module.

**`switcher.js` was deleted in §8 Phase 1 (2026-08-25.)** It is not on
disk, not in `manifest.json`, and there is no `web_accessible_resources`
entry, so nothing can dynamically import `timeline.js` into a content-script
realm any more. Nothing sets `__fsTimelineAnchor`. The declaration already
defaults to `"right"`:

```js
const anchorMode =
  (typeof window !== "undefined" && window.__fsTimelineAnchor) || "right";
```

So **`anchorMode` is permanently `"right"` today** — the dashboard is
already right-anchored and has been since §8 Phase 1. This change does not
alter behaviour; it deletes the unreachable left-anchored half and the flag.

**This is NOT the fence question.** Fences worked in both anchor modes;
`anchorMode` is only the flag currently gating them. See
`FENCE_REMOVAL.md`. **Do the fence removal FIRST if both are approved** —
see Ordering below.

**Decide before starting:** this forecloses a left-anchored ribbon. §8
Phases 2-4 are unbuilt and the parking lot is a live surface whose display
needs are unsettled. If a left-anchored view might return, leave the flag.

---

## Ordering against `FENCE_REMOVAL.md`

The two tasks overlap at exactly one line — `clusterEvents`' run gate
(~513), which tests `anchorMode !== "right"` AND is fence code.

**Do fences first.** That deletes `clusterEvents` entirely, removing the
overlap and one `anchorMode` site for free. Doing anchorMode first means
collapsing a condition inside a function the other task then deletes —
wasted work, and it briefly makes fencing LIVE again (the gate that
suppresses it is the thing being removed), which would be a real behaviour
change mid-sequence.

If only THIS task is approved, see Step 2's note on the fence gate.

**The hazard is silent.** If anchorMode runs first, Step 2 would drop the
`&& anchorMode !== "right"` conjunct at ~513, leaving
`if (event.band === "low" && !event.isOpenTab)` — and `run.push()` starts
executing. Fences render again: sticks and plates reappear on the ribbon.
`replay-rules.mjs` would still report **394/187**, because fencing is
display-side and `assembly.js` never sees it, so **the acceptance test
passes while the ribbon visibly changes.** Only loading the extension
catches it. This is the single strongest reason for the ordering.

### If fences ran first, re-derive before starting

Every line number in this file was captured against the pre-fence tree.
After `FENCE_REMOVAL.md` lands, **13 of the 16 `anchorMode` sites shift up
by roughly 60-190 lines** (only ~93, ~168 and ~455 sit before the first
fence cut and stay put). Do not follow the numbers here; re-locate by
symbol:

```sh
grep -n "anchorMode\|__fsTimelineAnchor" dashboard/timeline.js
```

Two rows in this plan also disappear entirely once fences are gone — the
~513 gate (Step 2) and the ~509 comment (Step 5), both of which live
inside `clusterEvents`. Expect **14 sites, not 16**.

### One comment both plans edit

`render()`'s comment at ~1760 ("A real render (new data, day paging, fence
toggle — never a zoom relayout) always resets to the resting edge …
left-justified for the standalone dashboard … the overlay RIGHT-pins").
`FENCE_REMOVAL.md` removes "fence toggle" from it; this plan rewrites its
left/right contrast. **Whoever goes second must edit the rewritten text,
not restore the original.** Read the comment as it actually stands before
touching it.

---

## Why this is a small job with two sharp edges

Verified 2026-08-25 by inspection. **Do not re-derive this.**

Only **16 `anchorMode` mentions**, and 6 of those are comments. Unlike the
fence removal there is no threading through the paint path. Expect ~40-60
lines net.

The two edges:

1. **Branches point BOTH ways.** Three sites test `!== "right"` (dead arm —
   delete the guard, keep what follows). Three test `=== "right"` (live arm
   — unwrap, delete the `else`). Reading the direction wrong inverts
   behaviour, and `node --check` cannot catch it.
2. **Two dead branches are load-bearing FEATURES, not dead weight.** See
   the boundary section — this is the part most likely to be got wrong.

---

## What dies, and what only LOOKS like it dies

**DIES — the flag and its left-anchored arms:**
* `anchorMode` itself and the `window.__fsTimelineAnchor` read
* the three `!== "right"` guards at ~168, ~455, ~1633
* the `else wrap.scrollLeft = 0` left-justify arm (~1790)
* the `if (anchorMode === "right")` wrappers at ~1756, ~1788, ~1831 —
  unwrapped, contents kept

**SURVIVES — `captureFromRight` / `applyFromRight`.** These sound like the
flag but are the right-pin mechanics themselves. `captureFromRight` has
**four** call sites (~1415, ~1554, ~1566, ~1634 — only the last sits behind
an `anchorMode` guard) and `applyFromRight` is the resting pin. All keep
working; they simply stop being conditional.

**SURVIVES — the padding block's own `else` (~1845).** The `if
(anchorMode === "right")` at ~1831 wraps the WHOLE padding computation, and
the `else` at ~1845 is *nested inside it* — it is the "at rest, revert to
flush-right" arm of `pendingAnchor`, not a left-anchor arm. **Unwrap the
outer `if` only. Do not delete that inner else** or the ribbon stops
pinning right at rest.

**OUT OF SCOPE — two features whose ONLY gate is this flag.** Removing
`anchorMode` naively deletes them silently. Both are separate product
decisions:

| Feature | Site | What happens |
|---|---|---|
| Floating **quick label** (instant site name on LOW/MEDIUM hover) | `quickLabelLive` ~1241 | `anchorMode !== "right"` means it can never show today. The element is still built and appended every load. |
| **`.rtitle` run titles** (persistent on-face HIGH-run labels) | `runTitlesLive` ~2193 | Same — `titleRuns` (28 lines) + `groupRuns` (56 lines) unreachable. |

Neither is in `spec/display.md` at all; they exist only in code comments
that (falsely) claim "the standalone dashboard keeps it."

**Decide explicitly per feature, and say which you chose in the commit:**
either (a) **restore** — drop the gate so it runs again, which is a real
visible change needing a look, or (b) **remove** — delete the feature and
its helpers, which is a deletion decision of its own.
**Do not silently pick (b) by deleting the flag and letting the code fall
away.** That is the failure mode this section exists to prevent.

---

## Step 0 — branch

Standing rule (`CLAUDE.md`): never `git commit`/`git push` without
approval. Confirm the tree state before starting.

---

## Step 1 — decide the two out-of-scope features

Do this BEFORE touching code; it changes what Steps 2-4 look like. Write
the decision down. If restoring either, do it as its own commit so the
visible change is bisectable, separate from the mechanical flag collapse.

---

## Step 2 — the dead-arm guards (`!== "right"`)

Each is a one-line guard whose body is unreachable. Delete the guard line,
keep everything after it.

| line | site | note |
|---|---|---|
| ~168 | `bandFloorFor` — `if (anchorMode !== "right") return MIN_W;` | the open-tab floor logic below it becomes unconditional |
| ~455 | `maybeLoadOlderDay` — `if (anchorMode !== "right") return;` | §7e/§7h cross-day loading becomes unconditional |
| ~1633 | scroll handler — `if (anchorMode !== "right") return;` | `captureFromRight(wrap)` becomes unconditional |
| ~513 | `clusterEvents` run gate | **fence code.** If `FENCE_REMOVAL.md` ran first this line no longer exists. If it did NOT, do **not** simply drop the conjunct — that would make fencing live again. Leave this one site alone and note it. |

---

## Step 3 — the live-arm branches (`=== "right"`)

Unwrap; delete only genuine left-anchor else-arms.

* **~1756** `if (anchorMode === "right") applyDefaultZoomWindow(events, wrap);`
  -> call unconditionally. No else.
* **~1788-1790**
  ```js
  if (anchorMode === "right") {
    if (!pendingAnchor && !panning) applyFromRight(wrap);
  } else wrap.scrollLeft = 0;
  ```
  -> keep the inner `if`, **delete the `else`**. This is the only real
  left-justify arm in the file.
* **~1831** `if (anchorMode === "right") { ... }` -> unwrap the block,
  keeping its nested `if/else` (~1837/~1845) intact. See boundary section.

---

## Step 4 — the declaration and its comment

Delete the `anchorMode` const (~93-94) and the comment above it (~84-92).
That comment explains a two-surface split and names `switcher.js`; it
cannot be kept.

`node --check dashboard/timeline.js` after this step.

---

## Step 5 — comments that reference the flag

Six mentions are prose. Each states or implies a dashboard/overlay split
that no longer exists; rewrite rather than delete, or the surrounding code
loses its reason.

| line | problem |
|---|---|
| ~509 | fence-gate rationale naming `anchorMode === "right"` (may be gone with fences) |
| ~1595 | "NOT gated on anchorMode: the standalone dashboard gets panning too" — the contrast is meaningless now |
| ~1628 | "Ahead of the anchorMode guard" |
| ~1744-1748 | the §7c default-window gate. **Also cites `heightMode === "tiered"`/`"uniform"` — `heightMode` is not a variable anywhere in the file, only stale §7-strip comment residue.** Rewrite both halves. |
| ~1760 | "left-justified for the standalone dashboard ... the overlay RIGHT-pins" — describes both arms |
| ~2191 | "standalone dashboard (anchorMode "left") is untouched" |

While here: the module header (~14) and the `qs()`/`rootContainer()` block
(~55-68) still describe `switcher.js` mounting into a shadow root, and
`window.__fsTimelineRoot` is read at ~68. **That is the sibling dead path
to this one** — same deleted overlay, different flag. Genuinely separate,
already noted in the 2026-08-25 audit; leave it unless you decide to fold
it in deliberately, and say so if you do.

---

## Step 6 — docs

Deletion pass, so `/updatedocs` (adds only) is the wrong tool. Edit
directly.

* **`spec/display.md`** — the run-title/quick-label situation is unspecced
  either way; if Step 1 restored either feature, it now needs a rule.
  Search for `anchorMode` and the §7b split.
* **`spec/ribbon.md`** — §7d/§7e describe right-pinning and cross-day
  loading as overlay behaviour gated by anchor. They become unconditional
  ribbon behaviour. §7e's cross-day loading in particular is described as
  gated; that gate is gone.
* **`SPEC.md`** — §7b's "anchorMode split" is cited in the display-path
  discussion; check ~line 74-100.
* **`decisions/timeline_design.md`** — add a dated entry: the flag existed
  to serve two surfaces, one surface was deleted in §8 Phase 1, the
  remaining surface had already been right-anchored since then, so this
  removes an unreachable half rather than changing behaviour. **Record the
  Step 1 decision on quick label and run titles explicitly** — a future
  reader must not have to infer whether they were dropped deliberately.

---

## Verification

No build step, no test suite. In order:

1. `node --check dashboard/timeline.js` after each step.
2. `grep -n "anchorMode\|__fsTimelineAnchor" dashboard/timeline.js` —
   expect zero hits when done.
3. **`testing/replay-rules.mjs` — counts must be IDENTICAL.** `anchorMode`
   is display-side only and `assembly.js` never reads it. Baseline:
   **394 blocks / 187 containers over 8 days.**
4. Load unpacked via `chrome://extensions`. This task's whole claim is "no
   visible change," so check the right-anchored behaviours specifically:
   * ribbon rests pinned RIGHT, newest time at the right edge
   * zoom anchors under the cursor and does not jump to the left edge
   * panning left loads older days (§7e/§7h) — the ~455 guard
   * day paging still rests at the right edge, not scrollLeft 0
   * the default resting window still shows ~12 blocks on first open
   * if Step 1 restored quick label / run titles, confirm they appear

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
* **Lock down scope.** Fences (`FENCE_REMOVAL.md`), `__fsTimelineRoot`, and
  `CUT_SEAM` are separate decisions. Do not fold them in because the code
  sits nearby.
* **Never commit or push without explicit approval.**
* If an approach fails twice, stop and reconsider the model rather than
  retrying variants.
