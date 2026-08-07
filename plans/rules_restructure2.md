# Rules restructure proposal #2 — 2026-08-06

Same exercise as `plans/rules_restructure.md` (2026-07-18), three weeks and
roughly a dozen rule changes later: pause, re-read every rule as a closed
system (SPEC §5/§6 only — no code, no plans/ history), and ask whether the
system we'd design today is shaped like the one we have. That review found
the rulebook had gone block-first while the code had gone thread-first, and
proposed (and shipped) the boundary-taxonomy/thread-atom rewrite. This
review asks: did the thread-first frame hold, and what's drifted since?

## Overall impression

**The thread-first frame held up well.** Nothing in the last three weeks
required walking back "boundary reason decides fate" or "thread is the
display atom" — every subsequent change (succession join, spawn-edge
discount, adjacent-container chaining, same-tab HIGH pass-through) is a new
*case* inside that frame, not a competing frame. That's a good sign for the
07-18 rewrite: it was the right abstraction.

But three weeks of "one knob at a time" tuning have left visible wear in two
places the 07-18 review didn't anticipate because they hadn't happened yet:

1. **Time-threshold sprawl.** The system now has seven-plus independently-
   named gap/duration constants, several confessed as "not data-derived, a
   judgment call," with no stated relationship to each other even where a
   reader would expect one (why is a container-of-containers bridge *longer*
   than the container's own bridge? why is absence-bridging LOW noise the
   same 5 minutes as container-return, a completely different kind of
   evidence?).
2. **Atomicity guard 1 has been amended three times** (2026-07-15 → 07-19 →
   07-24 → 08-06), each time narrowing "an individually-HIGH session owns
   its story" a little further, to the point that the rule as currently
   written is easier to understand as a list of exceptions than as a
   principle. This is the same shape of problem the 07-18 review found in
   the *old* container rule (750 words, "our longest rule") — it's
   recurring in a new location.

There's also one real bug: **SPEC.md itself has drifted from the shipped
code** (§6 Color & labels still documents the focus-count `(N)` label,
which was built, then fully reverted in favor of the earned-HIGH border —
see below). That's not a design question, it's a docs-discipline miss, and
should be fixed regardless of what else this review recommends.

Net verdict: no frame-level rewrite is warranted this time — thread-first
is still the right shape. What's warranted is (a) a **threshold audit**
that gives the sprawling gap constants one coherent story or shrinks their
number, (b) a **restatement of atomicity guard 1** now that its exceptions
have accumulated past the point of being readable as amendments to the
original sentence, and (c) the SPEC.md correction below.

---

## Finding 0 — SPEC.md is currently wrong about a shipped feature (fix regardless)

§6 Color & labels (line 265) still documents:

> **Container labels append a focus count (2026-08-06):** a container/
> merged-visit label appends the count of distinct MEDIUM+-band titles...
> Rendered as a trailing `(N)` — `Gmail (1)`, `Gmail (3)`...

This was built, then **reverted the same day** once data showed N wasn't a
valid proxy for "earned importance" (11/13 N=1 HIGH containers were HIGH by
summing, not by one fragment being individually HIGH). It was replaced by
the `hasEarnedHigh` border mechanism, which is correctly documented two
bullets below it. The count-suffix code is gone from `dashboard/timeline.js`
— confirmed no `focusCountOf` or label-suffix code remains, only
`hasEarnedHigh`/`earnedRimOf`.

The watch list (line 295) compounds it: `~~Key-email visibility inside
merged runs~~ **Resolved 2026-08-06** by the focus-count label suffix` — a
watch-list item marked resolved by a mechanism that no longer exists.

**Recommendation:** delete the focus-count bullet from §6, and re-point the
watch-list resolution to the earned-HIGH border (which addresses a related
but not identical concern — it marks *that* something earned its tier, not
*which* member did, so "Key-email visibility" may need to go back to open
rather than resolved). This is a same-day correction, not a design decision
— happy to make the edit directly once you confirm the framing.

---

## Finding 1 — Time-threshold sprawl

Reading straight through, these are every independent gap/duration constant
currently governing some join, split, or filter decision:

| Constant | Value | Governs |
|---|---|---|
| `TRANSIT_MS` | 10s | admission rung 2 / snapshot capture birthday |
| `TERMINAL_KEY_MS` | 500ms | discounts one keystroke at session end |
| `SPA_DEBOUNCE_MS` | 15s | capture-side SPA URL-churn absorption |
| machinery/succession sanity bound | 30s | caps machinery join + succession join |
| `IDLE_SPLIT_MS` | 5 min | capture-side idle split |
| `VISIT_GAP_MS` | 5 min | absence-bridge join (LOW-only) + container-return + title-run split |
| `CONTAINER_CHAIN_GAP_MS` | 10 min | pass-2 container-of-containers bridge |
| `AUDIO_BOOKEND_GAP_MS` / `FENCE_BRIDGE_GAP_MS` | 30 min | gap-audio container bridge + fence split + away-plate gate |

That's eight thresholds spanning three orders of magnitude (500ms → 30min),
governing capture and five different display joins, with three different
epistemic statuses freely mixed:

- **Principled, derived from a real quantity:** `TRANSIT_MS` (= one
  heartbeat window, the attention quantum — this one is genuinely load-
  bearing and well-justified).
- **Data-derived, validated against a real distribution:**
  `FENCE_BRIDGE_GAP_MS` (bimodal histogram, though the spec itself flags
  the dead zone as untested against a real lunch break).
- **Judgment calls, explicitly flagged as such:** `CONTAINER_CHAIN_GAP_MS`
  ("not data-derived... a judgment call"), `IDLE_SPLIT_MS`, the `<30s`
  machinery sanity bound (no stated rationale at all beyond "sanity bound").

Two specific relationships a from-scratch design would want to make
explicit but the current spec leaves implicit or unexplained:

- **`VISIT_GAP_MS` (5 min) does three unrelated jobs**: it licenses
  LOW-only absence-bridging (a noise-tolerance argument — "grazing may
  bridge small absences"), it licenses container-return chaining (an
  intent argument — "returning is the strongest intent signal"), and it
  splits title runs. The first two are different *kinds* of evidence
  (tolerance for noise vs. credit for intent) sharing one constant by
  coincidence of value, not by argument. If they ever need to diverge
  (there's no reason 5 minutes of LOW grazing tolerance and 5 minutes of
  "you came back to something you cared about" credit should be forced to
  move together), the shared name will actively mislead whoever tunes one
  of them.
- **`CONTAINER_CHAIN_GAP_MS` (10min) > `VISIT_GAP_MS` (5min), and the
  stated reason is "an already-assembled container/visit is a coarser
  claim than a raw fragment, so it earns a longer bridge."** That's a
  real, statable principle — coarser objects get longer bridges — but it's
  argued once, locally, for exactly one pair of constants. It's not
  connected to `FENCE_BRIDGE_GAP_MS` (30min, the *longest* bridge, gating
  the *least* assembled objects — raw LOW fragments in a fence). If
  "coarser claims earn longer bridges" is a real principle, the fence
  bridge is the counterexample; if it isn't a real principle, the
  container-chain justification is ad hoc.

**Recommendation:** not a single-constant fix — a naming/documentation
pass. Group the eight thresholds explicitly by what kind of evidence they
encode (noise-tolerance vs. intent-credit vs. capture-mechanics vs.
wall-clock "left the machine" judgments), state which ones are *allowed*
to move independently and which are coincidentally equal today, and retire
shared values that aren't conceptually shared (start by asking whether
`VISIT_GAP_MS`'s two display-side jobs should split into two named
constants even if they keep the same 5-minute value for now — cheap
insurance against a future silent coupling bug). This is exactly the kind
of "one knob at a time" work the project already does well; it just hasn't
been done *across* knobs yet.

---

## Finding 2 — Atomicity guard 1 needs restating, not re-amending

The individually-HIGH guard, read as one sentence today:

> An individually-HIGH session owns its story against foreign frames — it
> never joins a foreign-host chain, and any chain whose span would cover it
> is rejected regardless of tab tree — **except** it MAY seed or join its
> own host's chain in its own tab tree, and **except** it MAY also join the
> machinery join (merge, not chain) with a same-tab same-host neighbor when
> at least one edge is machinery-typed.

Three amendments (07-19 tree-scoping, 07-24 reverting part of that
scoping, 08-06 machinery pass-through) is not by itself a problem — each
was a real, data-justified fix to a real specimen (the ping-pong
decapitation, the YouTube-binge split). The problem is structural: the
guard is now stated as "X, except when Y, except when Z," and the reader
has to hold three dates and two specimens in their head to know what
"owns its story" currently means. This is precisely the shape the 07-18
review flagged in the old container rule before rewriting it.

What the guard has actually converged on, read as a single principle
rather than as a sequence of patches:

> **A HIGH fragment can never be absorbed by or subordinated to a foreign
> thread — but it can always fully participate in its own.** Foreign-chain
> containment and foreign-chain merging are both blocked outright, no
> exceptions. Same-host merging and same-host chaining are both allowed
> outright, no exceptions (the "own thread" exemptions are not really
> separate rules — they're one exemption stated twice, once for chains and
> once for merges, because those are the two join mechanisms).

If that restatement is accurate, the three amendments collapse into one
clean rule ("HIGH is untouchable by foreigners, unrestricted among its
own") and the dated amendment history moves entirely into `plans/` as
color, with §6 stating only the current shape. **Recommendation:** verify
the restatement against the actual join/chain code (this is the one place
in this review worth a quick code check, since getting the restatement
wrong would be worse than leaving the verbose version), then replace the
three-clause guard with the single principle + a plans/ pointer for the
history.

---

## Finding 3 — Two-pass container chaining is a seam, worth naming honestly

"Adjacent-container chaining" (2026-08-02) runs the *entire* chain-and-
qualify pipeline a second time on its own first-pass output. This works,
and the spec is honest that it's "no natural cliff... a judgment call" for
the threshold — but structurally it means "thread is the display atom" is
not quite true: there are now two kinds of thread-like objects (fragments
and already-assembled containers/visits) and a second recursive pass to
paper over the fact that containers can't directly recognize other
containers as chainable members the way fragments do.

This isn't necessarily wrong — recursion via a second pass at a looser
threshold is a reasonable, minimal way to get "coarser objects get longer
bridges" without a bigger rewrite. But if a *third* level ever turns out
to be needed (a chain of chained containers), a two-pass special case
won't generalize — it'd need to become genuinely recursive with a
threshold that scales with assembly depth, which is a bigger change than
"run it again."

**Recommendation:** no action now (no third-level specimen exists, and
building for a hypothetical is exactly the kind of premature generality
this project avoids elsewhere). Just name it explicitly as a watch-list
entry: *if a third chaining pass is ever proposed, that's the signal to
stop patching with more passes and make assembly genuinely recursive.*

---

## Finding 4 — Identity vs. label key: one clean pattern, currently read as a one-off

`google.com`'s label split (Search vs. Maps sharing a hostname) is
documented as a deliberate, non-generalized special case
(`LABEL_SPLIT_HOSTS`). Reading the whole labeling section together, though,
this is actually an instance of a clean general pattern that's already
implicit everywhere else: **identity (color, merge/chain eligibility,
atomicity) is always hostname-keyed; the *label* is a separate, coarser-or-
finer-grained decision layered on top** (site-name invariance mining,
word-boundary fallback, the google.com path-segment split are all "how do
we *name* this identity," never "what *is* this identity").

The spec currently treats the google.com split as an exception to
hostname-keying ("a deliberate special case... never generalized
speculatively") rather than as the one case so far where the *labeling*
layer's natural grain (finer than hostname) became visible. That's a
framing choice, not a behavior bug, but the current framing invites a
future reader to treat every multi-app host as requiring its own bespoke
`LABEL_SPLIT_HOSTS` entry rather than recognizing they're all the same
shape of problem (one identity, several socially-distinct sub-identities)
that the project has already, correctly, decided *not* to solve generally
for now.

**Recommendation:** no behavior change. Restate the rule as "labels may be
keyed finer than identity when a host demonstrably hosts multiple
sub-applications (§6 google.com is the sole recorded instance); identity
itself never splits" — this makes the *shape* of the decision legible
without pretending it's solved generally, and gives a future Slack/Notion/
Amazon multi-app specimen an obvious slot instead of feeling like a new
kind of exception.

---

## Finding 5 — The watch list has grown past one screen and mixes three different states

The watch list is now ~27 entries (line 272–304) and reading it end to end,
entries are in at least three different states that aren't visually
distinguished except by scanning each one's prose:

1. **Genuinely open, awaiting a specimen** (resumed-read containers,
   covered-HIGH guard tree-blindness, sub-quantum anchor-return debounce).
2. **Resolved, kept as a struck-through record** (audio-bookend false
   positive, week-strip-vs-thread-bands, all-transit-interruptions gap) —
   these are valuable history but read, at a glance, identically to open
   items unless you notice the strikethrough.
3. **Provisional-by-design, not really "watching for a problem" so much as
   "known simplification, revisit if it matters"** (MEDIUM=150 threshold
   held, W_NAV single-day-validated, palette compression) — these are
   closer to "known limitations" than "watch items."

This isn't a rule conflict, just an organizational one, but it's the kind
of thing that makes a fresh reader (or Scott, six months from now) have to
re-derive "is this still a live concern" for all 27 every time. **Recommendation:**
split into two lists — *Open* (genuinely awaiting data/a specimen) and
*Resolved/Known-limitations* (kept for history, visually separated) — no
content changes, pure filing. Cheap to do, meaningfully reduces the
re-scan cost the list already imposes on every future review like this one.

---

## What's *not* wrong — worth saying explicitly

Things this review specifically checked for conflicts and found none:

- **Rung 1/Rung 2 admission and the boundary taxonomy don't fight.** A
  session dropped at rung 1 (< 2s, zero everything) never reaches the
  boundary-taxonomy question at all; rung 2 operates only on survivors.
  Clean layering, no overlap.
- **The three merge joins (machinery/succession/absence-bridge) have
  disjoint trigger conditions** (boundary reason × host-vs-tree key ×
  band restriction) — verified no session's boundary can satisfy two of
  them ambiguously; they read like a real partition, not three
  independently-evolved rules that happen not to collide yet.
- **Score v1's provisional weights are consistently flagged** — every
  weight/threshold that's been tuned on less than a full week (`W_NAV`,
  `CONTAINER_CHAIN_GAP_MS`, `FENCE_BRIDGE_GAP_MS`) says so in-line, and the
  "one knob at a time" discipline is actually followed (checked: no two
  provisional constants were changed in the same dated entry). This is
  good practice and worth explicitly not touching.
- **The 2026-08-06 "missing axis" entry (activity-induced intent vs.
  social context) doesn't conflict with anything — it's a ceiling
  statement, not a rule, and correctly doesn't try to constrain Score v1's
  existing behavior.** Its presence in §5 is the right home for it.

---

## Summary of recommendations, ranked

1. **Fix SPEC.md's stale focus-count text (Finding 0).** Factual bug, not
   a design call — do this regardless of the rest.
2. **Restate atomicity guard 1 as one principle instead of three amendments
   (Finding 2).** Verify against code first; this is the one place a wrong
   restatement would be worse than the verbose original.
3. **Threshold audit across the eight gap/duration constants (Finding 1).**
   Group by evidence-kind, name which are coincidentally-equal vs.
   load-bearing-equal, consider splitting `VISIT_GAP_MS`'s two display jobs.
4. **Split the watch list into Open vs. Resolved/Known-limitations
   (Finding 5).** Pure filing, no content risk. **Superseded 2026-08-07:**
   the watch list was extracted wholesale to `WATCHLIST.md` instead (spec §6
   had grown to ~2,250 words, hurting the spec's job of describing current
   rules for a coding agent) — a bigger move than this finding proposed, and
   one that still leaves the open/resolved/known-limitation distinction
   unaddressed inside the new file.
5. **Reframe the google.com label split as an instance of a general
   identity-vs-label pattern (Finding 4).** Docs-only, no behavior change.
6. **Name the two-pass container chaining as a watch item for a
   hypothetical third pass (Finding 3).** No action now.

Nothing here calls for the kind of frame-level rewrite the 07-18 review
did — thread-first is holding. This is closer to routine debt-paydown:
the rules are still individually sound, but three weeks of real
"one knob at a time" tuning have left threshold sprawl and one
over-amended guard that are cheap to clean up now and only get more
expensive to untangle later.
