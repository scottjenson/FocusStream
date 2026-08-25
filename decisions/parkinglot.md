# Parking Lot — Decision Log

Reasoning/story behind `spec/parkinglot.md` (§8). One accumulating file
across all phases — new phases append dated entries here rather than
spawning per-phase files.

## Origin (2026-08-25)

**What prompted it:** a long design conversation that started as "is there
any reason to keep the injected tab strip?" and ended by identifying a
population of tabs the project had no model for at all.

The §7 Active Tab Manager was built to answer one question — *what does it
mean for tabs to transition into a ribbon view* — and four days of animation,
marking, ordering and zoom work returned a negative result. Scott's framing:
"it's clear there's none. The ribbon view is literally the last X places
you've visited. That does overlap with your current tabs, but is usually
just a subset."

**The structural reason the merge failed.** The tab bar holds populations
that are not all history:
* **Working set** — what you are doing now. Genuinely the ribbon's leading
  edge; these merge fine, and §7 merged them well.
* **Standing tabs** — Gmail, Calendar, pinned things. Present because the
  user *declared* them present, not because they were visited. Can be
  weeks old and absent from recent history entirely.
* **Open loops** — opened to read later. Near-zero attention *by
  construction*.

The code had already conceded this twice without it being named. §7c had to
build the strip by **bypassing the day-filtered ribbon pipeline entirely**
(Chrome order, not temporal, not scoped to today), and `decisions/
tabmanager.md` carved pinned tabs out of eviction as "the user explicitly
declaring importance through a channel telemetry cannot infer" — which is
really an exemption from the whole attention model, not just from eviction.
The dying strip→ribbon animation (§7's "Pending: strip -> ribbon animation
rework") was the same fact surfacing a third time as a symptom: you cannot
animate between two orderings that do not correspond.

**The counterexample that broke score-based eviction.** Phase 3's rule was
"close the lowest-scoring tab." A read-later tab has zero attention and
maximal intent — it was opened *precisely* because the user means to return.
Score is not a noisy proxy there; it is **anti-correlated** with what the
user wants. The rule would target the most deliberately-opened tabs first,
and no reweighting fixes an inverted signal. This is what made the
long-standing plan unshippable as designed.

**The tense insight — why the two surfaces can never merge.** Parking lot and
ribbon are different *tenses*, which is why they need different retrieval:
* **Parking lot = future tense.** Things you intend to do. Unordered by
  time, because "when I opened it" is nearly meaningless — nobody says "the
  article I parked Tuesday," they say "the one about the Mac Mini." Retrieved
  **semantically**.
* **Ribbon = past tense.** Things you did. Ordered by time, because that is
  the only handle available — "the thing I was looking at before lunch."
  Retrieved **temporally**.

Every bridge attempted in §7 was connecting a to-do list to a diary through
a time axis only one of them has. Scott: "this parking lot idea is completely
orthogonal to the tab ribbon approach. They are just two completely
different products and should be solved differently."

**Closure, not attention, is the discriminator.** The project already had
three fates for a low-attention visit, distinguished by how the tab *ended*:

| shape | evidence | fate |
|---|---|---|
| Quick detour | opened → scanned/copied → **closed by user** | admitted or dropped per §3; either way, finished |
| Grazing bounce | opened → nothing → closed | never admitted, vanishes |
| **Open loop** | opened → nothing → **still open** | had no home before this feature |

All three have near-zero attention. The only separator is **closure** — a
detour is a *completed* act with a small footprint, an open loop is an
*incomplete* act with an identical footprint. This needs no inference about
intent: an open tab is by definition unfinished, because closing is how
finishing gets expressed. It also means **§3's admission threshold is
correct and needs no change** — a detour that falls below it is genuinely
gone because it was complete and unimportant, both facts. The parking lot is
not a rescue for things below the bar; it is a home for things that never
got a verdict.

**Displacement, not classification (decided).** Two candidate rules for what
parks a tab:
* *Displacement* — the bar holds N, anything beyond overflows regardless of
  what it is. No model, nothing to be wrong about, and the user's own
  behaviour does the sorting.
* *Classification* — detect a deferral (background-opened, never activated)
  and park it early.

Displacement won, and the reason is the same one that killed score-based
eviction: classification reintroduces a judgment about intent, which is
exactly what failed. Scott: "displacement is the only rule that we can do
that has got any definitive and predictable meaning." Classification survives
only as a possible *sorting hint inside the lot*, never as a gate into it.

**Eviction inverts from ranking to membership.** "Close the lowest score"
becomes "keep the highest-interaction ones." This sounds arithmetic and is
not: the old rule asserts *this tab was worthless*, the new one asserts *the
tab bar is a working set and you exceeded it*. No judgment about the tab is
implied — which is what makes it safe on a tab that was never attended.

**Aggressive membership: N and X are one policy.** Scott proposed also
parking a tab untouched for X minutes. This is not a second mechanism. If
the working set is small and constantly touched, "unused for X" is not a
proxy for unimportance — it is a *direct observation that this tab is not
currently in the working set*, which is the lot's membership condition. N and
X are two expressions of one limit, and they fail differently: N protects
against a burst, X against slow accumulation. **Noted risk:** X is more
aggressive than pure displacement and reintroduces a tab leaving the bar with
the user having done nothing at all. Ship N before X, and start X generous
(order of an hour, not minutes).

**The counter must stay uncomfortable.** The badge count does the job the
cluttered tab bar used to do — it is the shame, compressed into one glyph.
Scott: users open tabs to say "get in my face and make me get rid of it."
If the lot gets pleasant enough to browse, the counter stops nagging and the
result is Pocket — a place things go to die. The counter and the
categorization work are in genuine tension; the counter wins.

### What was considered and rejected

* **Continue the §7 strip/ribbon merge.** Rejected — four days of work
  returned a clear negative result (above). Keeping it would mean polishing
  a bridge between two orderings that do not correspond.
* **Change what a pinned tab does.** Rejected outright (Scott): "it's too
  well ingrained." Standing tabs stay a user declaration; the system does not
  reinterpret them. This also retires the earlier idea in this conversation
  of *deriving* a standing set from history.
* **Classification as the gate into the lot** — see above; survives only as
  in-lot sorting.
* **Score-ranked eviction (§7 Phase 3 as designed)** — retired, not deferred.
  The read-later counterexample is structural.
* **Build the whole thing in one pass** (retire strip + badge + popup + live
  auto-close + categorization). Rejected for the same reason the original
  tab-manager doc was phased down in 2026-08-21: auto-closing a real tab is
  destructive and irreversible, and here it would ship on an *unmeasured*
  premise (that the working set is narrow).

## Two tracks, and why this file only owns one (2026-08-25)

The project runs two orthogonal tracks. Neither gates the other; the only
coupling is a one-time handoff (Phase 1 below).

* **Track A — the live surface.** Extension icon as UI, the parking lot,
  displacement, eviction. New, nothing built, and **phased** — each phase
  licenses something progressively more destructive, so each is a real
  go/no-go. This file owns Track A.
* **Track B — the history surface.** The ribbon: what it inherits from the
  card deck, click-to-reveal, findability, the band ladders, panning. Mostly
  built, ongoing, and deliberately **not phased** — it is a running design
  conversation with no destructive gate, and imposing phases on it would be
  false precision. Owned by `decisions/timeline_design.md` (§5–§6).

`decisions/tabmanager.md` is closed and drains into both: its strip content
is historical, its ribbon content (§7c–§7h) is Track B and folds into §6 when
the code moves.

**Phase 1 was originally scoped across both tracks** — "retire the strip,
move the ribbon to the dashboard, close out the card views" — which put Track
B work under a Track A gate. Renumbered below: Phase 1 is now only the
handoff, and everything about what the ribbon *becomes* is Track B, ungated.

## Phase breakdown (adopted 2026-08-25, renumbered same day)

Each phase is a separate go/no-go.

1. **Handoff: remove the injected strip (destroys no user data).** Delete
   `switcher.js` and its `content_scripts`/`web_accessible_resources`
   entries; flip the dashboard's defaults to `ribbonMode: "blocks"` and
   `anchorMode: "right"`; remove the now-dead `heightMode: "uniform"` /
   strip-tile paths. **Flip the defaults BEFORE deleting anything** — 13
   code paths are gated on `anchorMode === "right"` (cross-day loading, band
   ladders, the default-zoom window, fence retirement, right-pinning) and the
   dashboard runs today with all of them off, so the flip is the diagnostic
   that tells you the §7c–§7h work stands on its own while its original host
   still exists to compare against.
   Scope ends there. What the ribbon should *gain* (click-to-reveal, card-deck
   inheritance) is Track B and does not gate this. Search is not a gap: it
   already exists in the dashboard (`dashboard/index.html`, §6) — only the
   injected overlay lacked it, having nowhere to put a text input.
2. **Observe only — measure, do not close.** Badge count + popup list
   (favicon + title), and instrumentation logging working-set size and
   time-since-touch across real days. **Ships no auto-close.** The badge and
   the logging are the same query, deliberately: the number shown is how many
   open tabs exceed a hypothetical working set, which makes Phase 2's
   measurement the visible product rather than something bolted on later.
   Validates the riskiest assumption in the design — Scott's hypothesis that
   "most people only have two or three tabs that they stay active with,
   everything else is noise" — before anything destructive is built on it.
   Three later decisions hang off it: whether `N` is a real number, whether
   time-since-touch is bimodal (giving `X` a natural value) or a smooth
   continuum (making it an arbitrary knob — the same objection that rejected
   the `kbd` co-condition in §6), and how big the lot actually gets, which
   decides whether Phase 4 is load-bearing or solves a problem that does not
   exist.
3. **Displacement live.** The N-cap actually closes tabs into the lot. Gated
   on Phase 2's measurement and on `parkinglot-recovery-trust`. `X` ships
   after `N`, not with it.
4. **Making the lot worth browsing.** Sorting/grouping using the reader-mode
   `pageText` already captured (§3), possibly LLM-assisted. Only reachable if
   Phase 2 says the lot is big enough to need it.

**Note the sequence ends before any tab is closed.** Nothing in Phases 1–2
decides `N`; that is Phase 2's output and Phase 3's input.

### Explicitly undecided

* **What the popup shows beyond favicon + title.** The first version is
  deliberately no richer than what a tab already shows — Scott: "it just
  simply shoves the problem into a different format," and that is accepted
  for a dry run. Whether it needs more is Phase 2's measurement to answer.
* **`N` and `X` themselves.** Deliberately unset. Phase 2 exists to produce
  them; picking them first would be the guess this phasing exists to avoid.
* **Whether the lot needs completion state.** Reopening a parked tab makes it
  an ordinary active tab again (§8) — so the lot is a pure overflow buffer
  with no "done" concept. Whether that is elegantly minimal or quietly
  missing what makes read-later lists useful is unresolved, and is the seam
  where "parking lot" and "the reading list I actually wanted" diverge.
* **Whether the popup is enough, or the lot eventually needs a full page.**
  A Chrome popup cannot be resized past ~800×600 and closes on focus loss —
  fine for a list, not for a browsing surface with previews and grouping.
  The natural escalation is popup-for-the-grab, full-page-for-the-browse,
  the same relationship the popup has to the dashboard.

### Feasibility confirmed (2026-08-25, before any code)

Checked against the current `manifest.json`, which today has no
`default_popup` and makes no badge use:
* **Badge count:** `chrome.action.setBadgeText` (+`setBadgeBackgroundColor`
  if the number should get uglier as it grows). This is what badges are for.
* **Popup:** a `default_popup` entry — the popup deliberately not built in §2
  ("full tab, not a popup"), which was the right call for a *timeline* and is
  the wrong call for a *list*.
* **Auto-close survives the strip's removal unchanged.** `chrome.tabs.remove()`
  has always lived in the service worker; §7 routed every close through it
  precisely because content scripts do not hold that capability. Removing the
  strip removes a *caller*, not the ability — the path shortens from
  `strip → message → worker → remove()` to `worker observes → worker closes`.
  This was Scott's one flagged concern and it is unfounded.
* **What removal buys:** no injection into every page, no per-navigation
  remount, no `web_accessible_resources`, no shadow-DOM `<body>`-tag
  gymnastics (§7b). The badge is also *more* ambient than the strip ever was
  — the strip was absent on `chrome://` pages, the new tab page, the web
  store and PDFs, and flashed on every navigation.

## Consequence for the ribbon, recorded elsewhere (2026-08-25)

§8 changed what the ribbon's LOW band is *made of*, which is Track B work and
lives in `decisions/timeline_design.md`, "The history view's mandate got
clearer, not narrower". Short version: removing open loops from the ribbon's
concern does not license dropping LOW blocks — it makes every LOW block a
real visit, which strengthens the case for keeping them browsable.
