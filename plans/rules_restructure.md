# Rules restructure proposal — 2026-07-18 — ADOPTED

Written at Scott's request: pause, re-read every rule, and ask whether the
system we'd write from scratch today is structured like the one we have.

**ADOPTED 2026-07-18** (Gemini co-reviewed and concurred) and merged into
SPEC.md with five amendments to the merge plan:
1. §3 IS touched — both admission rungs lived there, so the unified filter
   stays in §3 with rungs labeled capture-time/display-time.
2. Original agreement dates preserved on individual rules; only the
   restructure itself is tagged 2026-07-18.
3. No duplication into `timeline_design.md` — this file is the story's one
   home; the design log carries a one-line cross-reference.
4. The block taxonomy was recast at thread level, not deleted (side-quest
   remains load-bearing as atomicity guard 2).
5. Loose end 1 decided: resumed-read containers CLOSED as subsumed by the
   MEDIUM-container path; the same-URL-anchor restriction survives as a
   watch-list tightening knob. Loose ends 2–3 became watch-list items;
   loose end 4 became the unified atomicity rule.

The text below is the proposal as reviewed (kept verbatim as the record).

## Verdict first

The rules are individually sound but the *architecture of the rulebook* no
longer matches the system it describes. The spec is written as
**block-first**: the session block is the atom, display rules are phrased as
prohibitions on combining blocks, and containers are labeled "the one
principled exception." After this week's changes (continuation merge, MEDIUM
containers, chain-level color anchoring), the working system is
**thread-first**: nearly every load-bearing display decision — merging,
containment, tier, color — is made on *chains of same-host engagement*, and
the untouchable solitary block is now the exception. Scott's hypothesis
("grouping/containers primary, side-quests the exception") is confirmed by
the code: `mergeVisits` + `detectContainers` do the structural work, and the
never-absorb rules survive as three guards, not as the frame.

The drift is larger than the sum of the edits because the *presumption*
flipped. 2026-07-15: every session boundary is presumed meaningful;
combining requires justification. 2026-07-18: boundaries are presumed to be
machinery unless their reason testifies otherwise; **separation** requires
justification (a departure, an absence, a foreign host, an individually-HIGH
block). Half a week's sessions (318/652) turned out to be machinery
fragments — the data forced the flip.

## The alternative rule set

What follows is the display-side rulebook rewritten from scratch around the
system we actually built. Capture rules (§2–§4) are NOT restructured — they
were designed granular-and-neutral precisely so display could reorganize
freely, and that bet paid off; they'd be written the same way today.

### Rule 0 — Two layers, one direction
Capture records **sessions** (continuous focus on one URL in one tab),
granular and unjudged, with per-signal counts. Display builds **threads**
out of them. Information flows one way: display never feeds capture, and
capture never pre-aggregates. (Unchanged in substance; stated as the frame
instead of being scattered.)

### Rule 1 — The boundary taxonomy (the new heart)
Every session boundary has a recorded reason, and the reason — not the gap
size — decides its display fate. Three kinds:

1. **Machinery** (`spa_navigation`, `navigated`; attention never left the
   tab): not an event. Joined silently — same-tab same-host neighbors merge
   into one visit, any band.
2. **Departure** (`tab_hidden` mid-thread, with a later return): an
   interruption — the strongest intent evidence we have (the user chose to
   come back). Never erased, never merely adjacent: **framed** — the thread
   becomes a container and whatever interrupted it becomes a visible child
   (or, when the interruption left the browser, the departure count itself
   testifies).
3. **Absence** (gap ≥ `VISIT_GAP_MS` to the next same-thread fragment): a
   real break. Preserved as a gap; nothing spans it. One exception:
   audio-bookended absences < 30 min (a meeting's audio testifies through a
   whiteboard excursion).

Today these three behaviors exist but are phrased as properties of *rules*
(merge licenses, container guards). Phrased as properties of *boundaries*,
the merge rule, the container guard, and the "can't self-containerize"
guarantee all become corollaries of one classification.

### Rule 2 — The thread is the display atom
A **thread** is a maximal chain of same-host fragments in one tab, joined
across machinery boundaries and departure boundaries, broken by absences,
foreign-host merges (never), and the atomicity rule (Rule 3). Everything is
judged at thread level:
* **Score/tier** = band of the summed fragments (add up, then judge).
* **Shape**: a thread with no departures and no children renders as one
  solid block (width = summed duration). A thread with departures/children
  renders as a container (width = wall-clock span; children cut out on
  top). Same object, two silhouettes — "joined by continuity, framed by
  return."
* **Color** anchors to threads: a host with a HIGH *thread* in the stored
  week holds a palette slot; everything that host touches shares the hue.
* A single unmerged session is just a thread of length 1 — no special
  rules.

Container qualification inside this rule: summed band ≥ MEDIUM, plus anchor
dominance below HIGH (a weak anchor outweighed by its children is a
launcher; the children are the story).

### Rule 3 — Atomicity: what a thread may never swallow (the exceptions)
The old §5 protections survive as exactly three guards:
1. **An individually-HIGH session owns its story.** It never joins a merge,
   never chains, and poisons any chain whose span would cover it.
2. **A side-quest is foreign by definition** — the A→B→A sandwich. B never
   merges into A (different host), never disappears (transit filter's
   discrete-signal rescue at the short end; MEDIUM+ never fences at the
   display end), and inside a container it stays a visible cut-out child.
   Side-quests keep height and label but currently NOT hue (anchored-only
   color — watch-listed bet).
3. **Foreign hosts never merge, ever.** Same-host is a necessary condition
   for every join.

### Rule 4 — Admission (what enters the ribbon at all)
One filter, two rungs, one principle: *we only display what we measured*.
* Rung 1 (capture-time): < 2s, zero everything — never stored (redirect
  machinery).
* Rung 2 (display-time): < 10s — one attention quantum — with no
  high-intent discrete signal (keyboard/cut/copy/paste/download) — dropped.
  Clicks don't save (how you leave a page); audible doesn't save (the
  page's action, not yours); flush artifacts don't save.
Written from scratch these are obviously one rule at two thresholds; today
they're two separately-named filters ("blip", "transit") with separately
argued rationales. Proposal: name the pair the **admission filter** and
present the rungs together (behavior unchanged).

### Rule 5 — Salience (how a thread looks)
Unchanged in substance, restated thread-first:
* Width = time (duration for solid threads, span for containers; MIN_W
  floor). Two time scales: presence 135px/hr, absence 22px/hr.
* Height = tier of the thread sum (100/80/60%).
* Brightness = tier (HIGH full color, below HIGH the 50% mix); rims always
  full-strength (border carries identity).
* Color = weekly HIGH anchoring, Kelly-prefix registry with in-place
  tombstones.
* LOW threads fence (collapse to sticks); MEDIUM+ structurally cannot hide.
* Labels: importance-gated, title-derived, collision-dropped.

## What the rewrite changes about existing text (if adopted)

Zero behavior changes — this is a restructure of the rulebook, not the
system. But the rewrite would:
* Rewrite §5 "Consequences": the "strict adjacency / gap-tolerant merging
  is forbidden" paragraph is now actively misleading — continuation merging
  and containers are both gap-shaped mechanisms, justified by boundary
  reasons. The §5 *thesis* (importance = intent, not duration) survives
  untouched; it's the consequences section that aged out.
* Recast the block taxonomy (bounce / side-quest / dwell) at thread level —
  the current implementation vocabulary (LOW/MEDIUM/HIGH threads,
  containers, children, fences) has no home in §5 where the taxonomy lives.
* Merge the blip + transit filters into the two-rung admission filter.
* Fold the container rule and the merge rule into the boundary taxonomy +
  thread rule; the current §6 container bullet (750+ words, our longest
  rule) decomposes into Rule 1.2 + Rule 2 + Rule 3 guards.

## Loose ends the re-read surfaced (flagged, not acted on)

1. **Resumed-read containers (deferred 2026-07-16) may now be subsumed.**
   The general path now fires at sum ≥ MEDIUM with dominance — an
   out-and-back M-detour-M read chains to a MEDIUM container under today's
   rules without the special same-URL trigger. The deferred proposal's
   extra strictness (same URL anchor, ≥2 MEDIUM+ fragments) may no longer
   buy anything. Suggest: close it as subsumed, or keep only the same-URL
   idea as a future *tightening* if MEDIUM containers over-fire.
2. **Week strip divergence is growing.** The strip skylines raw per-session
   bands while the ribbon increasingly shows thread-level bands; every
   grouping improvement widens the honesty gap (already watch-listed —
   the restructure would make "extract shared thread-banding" the obvious
   fix since threads become the named unit).
3. **`SPA_DEBOUNCE_MS` (capture) and the continuation merge (display) now
   overlap in purpose.** Both exist to heal SPA fragmentation. With the
   display-side merge proven, the capture-side debounce could in principle
   shrink toward honesty (smaller debounce → more granular URLs → the
   merge reassembles them). Not urgent; noted because a from-scratch
   design would probably not build both.
4. **"MEDIUM+ never fences" and "individually-HIGH never merges" are the
   same instinct at two tiers** (importance resists structural demotion /
   absorption); the rewrite states them as one atomicity principle.

## Recommendation

Adopt the restructure as a spec rewrite of §5's Consequences + §6's
Aggregation/admission sections (the thesis, capture layer, salience rules,
and watch list carry over nearly verbatim). It removes one filter name, one
"exception" label that no longer describes the system, and our longest rule,
and replaces them with two concepts (boundary taxonomy, thread) that the
code already implements by other names. Compare and decide; nothing moves
until then.
