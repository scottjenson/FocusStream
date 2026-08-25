# Parking Lot Spec — §8

Created 2026-08-25 as a **stub, before any code** — deliberately, per
`/newfeature`: a rule needs somewhere to land the moment it becomes true, and
the card deck's failure was having nowhere. Grows by dated entry like
`capture.md`/`display.md`/`tabmanager.md`. This file holds only what is
decided and true today; the phase roadmap and all reasoning live in
`decisions/parkinglot.md`. Open doubts: `WATCHLIST.md`.

**Nothing in this file is built yet.** Every phase is unstarted as of
2026-08-25. What follows is the decided model, not a description of running
code — the one thing this file must never do is describe an intention as if
it shipped.

**Relationship to §7:** §8 supersedes the Active Tab Manager. §7's Phase 3
(score-ranked eviction) is **retired, not deferred** — a read-later tab has
zero attention and maximal intent, so ranking by score targets the most
deliberately-opened tabs first. §7's built work (§7–§7i) is not deleted by
this: the ribbon survives and moves to the dashboard (Phase 1), and the
injected strip is what goes. Story: `decisions/parkinglot.md`, "Origin".

## 8. The Parking Lot

### The three populations (fixed 2026-08-25)
The Chrome tab bar holds three kinds of thing, and they are not all history:
* **Working set** — what the user is doing now. High recent attention. The
  ribbon's leading edge.
* **Standing tabs** — Gmail, Calendar, pinned tabs. Present because the user
  *declared* them present. May be weeks old and absent from recent history
  entirely. **The system does not reinterpret these** — pinned-tab behaviour
  is unchanged, deliberately (too well ingrained to alter).
* **Open loops** — opened to read later. Near-zero attention by
  construction. These are what the parking lot is for.

### Closure, not attention, is the discriminator (2026-08-25)
An open loop and a quick detour have the same near-zero attention footprint.
They are separated by whether the tab was **closed**: a detour is a completed
act, an open loop an incomplete one. An open tab is by definition unfinished,
because closing is how finishing is expressed. No inference about intent is
involved.

**§3's admission filter is unaffected by this feature.** A detour falling
below the admission bar is genuinely gone because it was complete and
unimportant. The parking lot is not a rescue for sub-threshold visits; it is
a home for tabs that never got a verdict.

### Membership is displacement, never classification (2026-08-25)
A tab parks because the tab bar is full, not because the system judged it.
* The bar holds a working set; anything beyond overflows into the lot.
* **No classification gate.** Detecting a deferral (background-opened, never
  activated) and parking it early was considered and rejected — it
  reintroduces the judgment about intent that made score-ranked eviction
  fail. Classification may later serve as a *sorting hint inside* the lot;
  it never decides entry.
* Eviction is therefore a statement about the *bar* ("you exceeded the
  working set"), never about the *tab* ("this was worthless").
* **`N` (bar capacity) and `X` (untouched timeout) are two expressions of one
  limit,** not two mechanisms: if the working set is small and constantly
  touched, "untouched for X" directly observes non-membership. They fail
  differently — N against a burst, X against slow accumulation. **`N` ships
  before `X`.** Neither value is chosen yet (Phase 2 exists to produce them).

### Reopening (2026-08-25)
Clicking a parked item makes it an ordinary active tab again, by the same
membership rule as any other tab. The lot is a pure overflow buffer with **no
completion state** — nothing is ever marked done, because reopening is the
only interaction.

### Surface (decided 2026-08-25, unbuilt)
* **Count on the extension icon** (`chrome.action.setBadgeText`). The count
  is the forcing function — it does the job the cluttered tab bar used to do.
  It is meant to be uncomfortable as it grows.
* **Dropdown on the icon** (`default_popup`) listing parked items as favicon
  + title, plus an entry opening the dashboard. Deliberately no richer than
  what a tab already shows in its first version.
* **No injected DOM anywhere.** The §7 strip is retired (Phase 1); the
  extension's UI is the icon, its popup, and the dashboard tab.
* `chrome.tabs.remove()` stays in the service worker, as it always has —
  removing the strip removes a caller, not the capability.

### Phase status (2026-08-25)
| phase | what | status |
|---|---|---|
| 1 | Handoff: remove injected strip, flip dashboard defaults to `blocks`+`right` | not started |
| 2 | Badge + popup + measurement instrumentation, **no auto-close** | not started |
| 3 | Displacement live (`N`, then `X`) | not started, gated |
| 4 | Sorting/grouping the lot via captured `pageText` | not started |

**Phase 1 is a handoff, not a redesign.** What the ribbon should *gain* after
the move — click-to-reveal, whatever else it inherits from the card deck — is
Track B (see below) and does not gate any §8 phase. Search is not a gap: the
dashboard already has it (§6).

Phase 3 is **gated**, not merely unstarted: no `chrome.tabs.remove()` ships
until Phase 2's measurement has run on real days and `WATCHLIST.md`'s
`parkinglot-recovery-trust` is answered. This carries forward the standing
dry-run-before-destructive rule from §7's Phase 3.

### Two tracks (2026-08-25)
§8 is one of two orthogonal tracks; neither gates the other.
* **Track A — live surface (this file).** Extension icon, parking lot,
  displacement, eviction. Phased, because each phase licenses something more
  destructive.
* **Track B — history surface (§5–§6, `decisions/timeline_design.md`).** The
  ribbon's continued evolution. Not phased — ongoing design with no
  destructive gate.

Phase 1's handoff is the only coupling between them.

### Deferred / undecided
Named in `decisions/parkinglot.md`, "Explicitly undecided": popup contents
beyond favicon + title, the values of `N` and `X`, whether the lot ever needs
completion state, and whether the popup eventually needs a full-page
counterpart. The dashboard's view defaults are no longer open — Phase 1 sets
them to `blocks` + `right`.
