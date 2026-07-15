# Code & Doc Review — 2026-07-15

**Status: all P0s, all P1s, and the CLAUDE.md restructure implemented 2026-07-15
(approved by Scott). P2s deliberately skipped for the demo, except the
`checkMedia` allocation micro-fix, folded into the P0 content.js edit.**

Scope: full read of `manifest.json`, `content.js`, `background.js`, `dashboard/`
(index.html, dashboard.js, timeline.js), spec, CLAUDE.md. Focus per Scott:
(1) is the capture code heavy enough to slow page execution? (2) doc hygiene —
keep CLAUDE.md lean, link subsystems into `plans/`. This is a demo: findings are
prioritized so most P2s can be deliberately skipped.

---

## A. Verdict on the main concern: is capture too heavy?

**No. A single healthy instance of `content.js` is about as light as a capture
script can be.** Per page it costs:

- **8 event listeners**, all `{ capture: true, passive: true }`, each with a
  one-statement body (`activity.keyboard++`, `activity.mouse = true`).
  `passive: true` means the browser never waits on us before scrolling — there
  is structurally no scroll-jank path. Even mousemove at ~120 Hz is a property
  assignment per event: microseconds per second of CPU.
- **One 10s interval** doing a visibility check, one `querySelectorAll("video")`
  (tag-name query — fast even on huge pages), and at most one `sendMessage`.
- **One layout read per heartbeat** (`scrollHeight`) — a forced-layout risk at
  60 Hz, a non-event at 0.1 Hz.
- No DOM mutation, no MutationObserver, no rAF loop, no per-keystroke messaging
  (batched into the 10s snapshot).

The honest cost ranking of what content.js does is: (1) `console.log` traffic
(the logging convention — every active heartbeat plus a "quiet window" line
every 10s), (2) everything else. The convention is load-bearing for debugging
(CLAUDE.md says keep it), so no change proposed — just naming it.

**But two multipliers can make this light script heavy in practice — both hit
exactly your dev workflow.** They are P0 and P1 below.

---

## B. Prioritized findings

### P0 — worth fixing now (real effect, cheap)

**P0-1. Zombie content scripts accumulate across extension reloads.**
`content.js:82-101` — when the extension reloads, every existing tab's content
script is orphaned. It catches the "extension context gone" error and logs it…
and then **keeps running forever**: the 10s interval, all 8 listeners, the
querySelectorAll. Meanwhile `injectIntoExistingTabs()` adds a fresh copy. Reload
the extension 10 times in a dev day and a long-lived pinned tab (Gmail, Bluesky)
is running **10 zombie instances + 1 live one** — 88 mousemove listeners and 11
timers. This is the one path by which "capture slows the page" actually happens,
and it's the dev-workflow path.
*Fix (~8 lines):* register all listeners through one `AbortController` signal;
on the context-gone catch (and on a failed `sendMessage`), `abort()` +
`clearInterval` — the orphan fully self-destructs on its first post-reload tick.

**P0-2. Double injection can double-count activity.**
`manifest.json` declares `content_scripts` for `<all_urls>` AND
`background.js:134-146` injects `content.js` via `executeScript` on
`onInstalled`. A tab that finishes loading between the reload and the injection
loop gets **both** — two live instances, every keystroke counted twice, scores
inflated 2×. Silent (both instances send valid heartbeats), and it corrupts
exactly the data you're using for threshold tuning.
*Fix (1 line):* top-of-file guard — `if (window.__fsLoaded) return;` (or
`throw`) `window.__fsLoaded = true;`. Also makes P0-1's re-injection idempotent.

**P0-3. Spec corruption + one stale contradiction (doc, but P0 because the spec
is the source of truth).**
- `ChromeExtensionSetup.md` §6, the "SPA-continuation merging — DEFERRED"
  bullet: its final sentences ("…a hostname is often not a site — google.com
  hosts both Maps and Search. Pages suffix their titles…") are the **"Labels
  are title-derived site names" bullet fused on without its header** — an edit
  casualty. The label-derivation rule currently has no home.
- §6 score section still says *"Open question: Chrome-internal pages …
  Undecided whether to skip at capture or exclude at display"* — this was
  decided and implemented the same day (§3: web-documents-only capture,
  "agreed 2026-07-15"). The spec contradicts itself.

### P1 — worth fixing soon (scaling / workflow quality)

**P1-1. Session store: unbounded growth × full-array rewrite per finalize.**
`background.js:107-109` — every finalize reads the **entire** `sessions` array,
pushes one, and rewrites the whole thing. Storage cost per session is O(total
history); the array is never pruned, and the dashboard also reads it in full on
every render. Fine at day 3; at day 30 (~10-20k sessions) every tab-switch
serializes megabytes and the dashboard render pipeline chews the same. Also
walks toward the 10MB `storage.local` cap (snapshots will share it).
*Fix (~6 lines):* prune inside `finalizeCurrent` — drop sessions older than N
days (7?) before writing. Keeps writes O(week) forever. (Per-day keys are the
"right" fix but pointless before day-paging exists.)

**P1-2. Dashboard fully re-renders every 10s while open.**
`dashboard.js:262` re-renders on **any** storage change — including every
heartbeat's `storage.session` write. With the dashboard tab open during active
browsing (your normal setup), the entire pipeline (parse → merge → containers →
fence → layout → DOM diff) plus the full debug-list rebuild runs every 10
seconds. Doesn't slow *web pages* (it's the dashboard's own tab, usually
backgrounded and throttled) but it's the biggest CPU consumer in the extension
and makes live-watching janky.
*Fix (~4 lines):* in the listener, skip the timeline (or the whole render) when
the only change is `session`-area `currentSession`; the live row alone can
update. Or simply debounce render to ≥2s.

**P1-3. CLAUDE.md restructure** — see section C.

### P2 — noted, probably not worth it for a demo

- **Worker never sleeps during active browsing:** 10s heartbeats keep resetting
  the ~30s idle timer. Inherent to the design (heartbeats must land somewhere);
  battery cost is modest. No action.
- **webNavigation listeners fire for every navigation in every tab**, waking
  the worker just to log "ignoring nav in non-tracked tab". URL filters
  (`{schemes: ["http","https"]}`) would trim wakes slightly. Micro.
- **`checkMedia` allocates** (`Array.from(...).some(...)`) — a plain `for…of`
  over the NodeList avoids the copy. Nanoseconds; only worth folding into some
  other edit.
- **`title.href = s.url` / `chrome.tabs.create({url})` trust stored URLs.**
  Capture already restricts to http/https/file so no `javascript:` can get in
  today; a scheme check at render would be defense-in-depth against old/foreign
  data. Skip for a personal tool.
- **O(n²) micro-scans** (`hostOrder.includes` per event, `indexOf` per block,
  `hourMarks` linear scan per hour): all on ≤ hundreds of items at render time.
  Explicitly fine — do not "optimize".
- **Console volume on every page** is the logging convention working as
  designed. Revisit only if/when this stops being a personal debug build.

### Checked and explicitly fine (no action)

- Security posture: counts only, never key identity or clipboard contents; all
  dashboard DOM via `createElement`/`textContent` — page-controlled strings
  never reach innerHTML; tooltip uses `textContent`.
- MV3 discipline: no state in worker memory, no keepalive hacks; the `enqueue`
  promise chain serializes overlapping events correctly and doesn't leak.
- Heartbeat → storage.session get/set per beat: storage.session is in-memory;
  cheap.
- Flush-on-hidden + interval can't double-count (snapshot resets on send).
- `blockEls` map is pruned by the `seen` set — no element leak across renders.

---

## C. Documentation review

**The problem:** CLAUDE.md (217 lines) has become a dated decision changelog.
Most bullets duplicate spec §6 (which is authoritative) at nearly full detail —
the color-registry story appears in three places (CLAUDE.md, spec §6, code
comments). CLAUDE.md's stated job is *orientation*; a new session currently
reads ~180 lines of history to find the 30 lines of orientation. It also
carries stale status ("Phase 2 … awaiting manual verification" — long since
overtaken).

**Proposed restructure** (mirrors how `plans/tooltip_snapshot_plan.md` already
works — spec gets the condensed rule, plans/ gets the reasoning):

1. **CLAUDE.md shrinks to ~70 lines:** stack/workflow, logging convention,
   debug tools, design philosophy one-liners, load-bearing capture decisions
   (the short list), current status, and a **linked subsystem index**:
   - `plans/timeline_design.md` — NEW: color registry + Kelly-16 + transient
     prefix rule; two time scales; fences; labels; containers — the full dated
     rationale, moved out of CLAUDE.md verbatim.
   - `plans/capture_design.md` — NEW (or fold into the spec): blip/transit
     filters, audible bookends, SPA debounce history, watch-list items.
   - `plans/tooltip_snapshot_plan.md` — exists.
   - `plans/code_review_2026-07-15.md` — this file.
2. **Spec stays source of truth for rules;** plans/ holds *why the rule beat
   its alternatives*. CLAUDE.md holds neither — just pointers.
3. Fix the two spec defects (P0-3) while in there.
4. Refresh the CLAUDE.md status block to reality (phases 1-3b live, transit
   filter display-time, snapshots Part 2 approved/unbuilt).

The watch-list (buff, MED=150, two-videos container, passive reading, …) should
live in ONE place — suggest the spec, since it gates future rule changes;
CLAUDE.md links to it.

---

## D. Suggested order of work

| # | Item | Effort | Why this rank |
|---|------|--------|---------------|
| 1 | P0-2 double-injection guard | 1 line | Corrupts tuning data silently |
| 2 | P0-1 orphan self-destruct | ~8 lines | The actual "capture is heavy" path |
| 3 | P0-3 spec fused-bullet + stale open-question | doc edit | Spec is source of truth |
| 4 | P1-1 finalize-time pruning | ~6 lines | Only scaling cliff in the system |
| 5 | P1-3 CLAUDE.md → plans/ restructure | doc session | Scott's explicit ask |
| 6 | P1-2 dashboard render debounce | ~4 lines | Quality-of-life while tuning |
| — | All P2s | — | Skip for the demo |

Items 1, 2, and 4 touch `content.js`/`background.js` — after them the extension
needs a ⟳ reload (and 1-2 briefly double-count until open tabs are re-injected
with the guard in place).
