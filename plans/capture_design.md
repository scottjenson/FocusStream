# Capture Design — Decision Log (content script + service worker)

The spec (`SPEC.md` §2–§4) holds the **current rules**; this
file holds the dated decisions and the reasoning — moved out of CLAUDE.md
2026-07-15 to keep it lean.

## Session model
- Only active (visible, focused) tabs accrue activity. Tab switch *finalizes*
  the session; returning starts a new block with the same URL. Repeated-URL
  blocks are correct — the dashboard aggregates at display time.
- The unfinalized session lives in `chrome.storage.session`, never in worker
  memory — MV3 workers die after ~30s idle. Finalized blocks append to
  `chrome.storage.local`. No keepalive hacks or alarms.
- `id` is opaque (not `Date.now()` — SPA navigations can collide on
  milliseconds); `startTime`/`endTime` are explicit fields.
- Every SessionBlock carries `tabId` and `endReason` specifically to make
  captured data debuggable.
- **Retention (2026-07-15, from code review):** blocks older than 7 days are
  pruned at finalize — the array is rewritten in full per finalize, so
  unbounded growth made every tab switch serialize the whole history.

## Heartbeat model
- Content script sends only *active* heartbeats (10s windows); silent windows
  send nothing. Duration comes from `startTime`/`endTime`, not heartbeat
  counting; the `heartbeats` counter (×10 = attended seconds) is the dwell term
  of the score.
- Activity is per-signal totals, never a single summed score, and units are
  hybrid: discrete signals (keyboard, click, cut, copy, paste — clipboard types
  are separate signals) record raw event counts; continuous signals (mouse,
  scroll, media) record active-window counts, because their raw event rates
  measure hardware sampling, not attention.
- `scrollable` flag measured per heartbeat (last wins) so the dashboard can
  weight scroll fairly on pages that can't scroll.
- Titles are refreshed on heartbeat/finalize, never captured only at session
  start (SPAs set the title late).

## What is and isn't captured
- **Only http/https/file URLs** (2026-07-15): browser-internal pages
  (chrome://newtab etc.) are skipped at capture — content scripts can't run
  there → guaranteed zero-attention noise; browser-UI time renders as a gap.
  This guard replaced the narrower own-dashboard self-exclusion.
- **Blip filter (2026-07-15):** finalize discards sessions <2s with zero
  heartbeats/activity/audible — redirect hops and instant bounces are
  transition machinery, not journey. (The display-time transit filter is the
  same idea one rung up — see `plans/timeline_design.md`.)
- **`download` signal** (2026-07-15): `chrome.downloads.onCreated`,
  background-observed — "Save image as…" fires no DOM event, so it does not
  ride the heartbeat. Likely the strongest single intent signal.
- **Audible tracking** (2026-07-15): `audibleMs` per session via
  `tabs.onUpdated` events (no polling) — catches cross-origin embedded players
  (YouTube inside Bluesky). Attention = max(heartbeats×10, audibleSeconds), max
  not sum. Muted iframe playback still invisible; `all_frames` injection
  rejected (ad iframes would fake attention).
- Video detection is content-script-side (`!video.paused` in the heartbeat
  check), not `tab.audible` polling.

## SPA navigation
- Via `chrome.webNavigation` events **with a same-URL noise filter AND a 15s
  debounce** (spec Edge Case 3 — both required): URL changes in quick
  succession are view-state churn (Google Maps pans produced ~90 micro-blocks
  without it) and get absorbed into the current session, last URL wins.
- The debounce is correct at the high level but watch for over-collapse of
  high-intent moments (e.g., composing a reply inside Bluesky); stay flexible.

## Injection & lifecycle hardening
- **Auto-inject on install/reload:** background injects `content.js` into
  existing http(s) tabs (`scripting` + host permissions) — otherwise every
  extension reload silently stops tracking in open tabs until refreshed.
- **Duplicate-injection guard (2026-07-15, from code review):** manifest
  injection + install-time executeScript could both land in a tab loading
  during the injection loop — two live instances double-counted every signal.
  `window.__fsLoaded` in the isolated world bails the second copy; per
  extension lifetime, so reloads still re-inject.
- **Orphan self-destruct (2026-07-15, from code review):** instances orphaned
  by a reload previously kept their timer + listeners forever (one zombie per
  reload per long-lived tab — the one real "capture weighs on pages" path).
  All listeners register through one AbortController; teardown fires on the
  first tick without `chrome.runtime.id` or on a failed send.

## Performance posture (2026-07-15 review verdict)
A single healthy content.js instance is negligible: 8 passive one-statement
listeners (no scroll-jank path exists), one 10s tick with one tag-name query
and one layout read. The honest cost ranking is (1) the logging convention,
(2) everything else — and the logging is load-bearing for debugging, kept
deliberately. (Full analysis was in `plans/code_review_2026-07-15.md`,
retired 2026-07-18 — remaining P2s deliberately not planned; git history has
the text.)

## Open capture holes — UNDER INVESTIGATION (2026-07-17)

Two independent holes surfaced while diagnosing a 106-minute Amazon Prime
movie (*Slow*, 2023) that rendered as "away 8:02–9:48 PM". Neither is fixed
yet — Scott is recreating the journey to gather more data before we commit
to rules. Do not lose these.

### 1. The focus-NONE blackhole (fullscreen-Space suspect)

Evidence from the stored sessions of 2026-07-17 evening:
- Exactly ONE amazon row exists in 7 days of data: a 1s product-page
  `tab_closed` at 21:50 (post-movie tab cleanup). The watch page, the
  browsing, the purchase flow: zero sessions.
- The blind period starts 19:39:11, not at the movie: from 19:39:11 to
  20:02:09 only three mail micro-sessions exist (2s/16s/22s), every one
  ending `tab_hidden` with NO successor session. Scott's amazon
  browse/purchase (~19:39–20:02) fell entirely inside it; the movie
  followed (20:02–21:48); capture resumed 21:48:12 (IMDb, the
  ending-explained search, closing the amazon tab).
- Diagnostic: a `tab_hidden` finalize with no successor can only be
  `onFocusChanged(WINDOW_ID_NONE)` ("idle until refocused"). Three
  returns to the amazon tab never fired onActivated/onFocusChanged(id) —
  so that tab lived in a DIFFERENT window whose focus reports NONE.
  Prime suspect: a macOS fullscreen-Space Chrome window (focusing one
  can fire NONE with no follow-up refocus). Unconfirmed — Scott to check
  the window state / re-run the journey.
- The audible events DID arrive during the movie (they wake the worker)
  and were dropped by design at the `!current || tabId mismatch` guard
  in the audible handler — no session existed to credit.

Agreed fix direction (rule NOT yet drafted — awaiting recreation data):
**fullscreen rescue** — on `onFocusChanged(NONE)`, query windows; if one
is in state `fullscreen`, track its active tab instead of idling. Keyed
on fullscreen state alone (NOT audible), so silent fullscreen content —
a presented Google Slides deck — is covered too, scoring through its
natural channel (keyboard/click heartbeats vs audible). Rejected
narrower guard: fullscreen+audible (misses Slides). Rejected broader
rescue: heartbeat-based re-acquisition (macOS delivers hover
mousemove/scroll to unfocused windows — leaks exactly what the focus
gate exists to block; keyboard-only evidence would be sound but narrow).
Accepted edges to watch-list when implemented: fullscreen-on-display-2
while working elsewhere gets credited; an unattended playing movie keeps
accruing audible; only one specimen so far.

### 2. The new-tab blind spot (found while tracing, NOT the cause above)

A fresh tab starts at `chrome://newtab` → filtered → no session starts.
The subsequent navigation to a real site hits onCommitted's "ignoring
nav in non-tracked tab" guard (current is null) → still no session. The
tab stays invisible until the user switches away and back (onActivated
adopts it, URL now https). Open a new tab, go straight to a site, read
for an hour without tab-switching → the hour vanishes. Self-heals on
any revisit, which is why it can't explain the amazon case (three
returns happened, no adoption). Candidate fix: when onCommitted fires
with no current session AND the tab is the active tab of the focused
window, adopt it. Guard stays for true background-tab navs.

### Recreation run (2026-07-18, worker-console log captured live)

Scott recreated the amazon journey with the worker console open. Findings:

1. **Nothing is Amazon-specific — the pipeline is healthy.** In a normal
   window the whole flow captured perfectly: search (onCommitted), SPA
   absorb within debounce, product page, trailer audible intervals +
   media signals, snapshots stored. The control test passes.
2. **Live specimen of idle blindness:** `heartbeat DROPPED from tab
   940822238 (tracking: undefined)` — an ACTIVE heartbeat (user input on
   a visible amazon page) arrived while the extension sat in
   "idle until refocused". Chrome's focus state was simply wrong. The
   `onFocusChanged(940821383)` that ended the blindness fired only
   AFTER the first dropped heartbeat (delayed, not instant).
3. **A third NONE source identified: DevTools windows.** The log both
   opens and closes in NONE state because focusing the worker-console
   DevTools window fires `onFocusChanged(-1)`. So WINDOW_ID_NONE is
   generic "focus went somewhere that is not a this-profile Chrome
   window": other apps, DevTools, macOS fullscreen Spaces (suspected),
   and — untested — OTHER CHROME PROFILE windows, which extensions
   cannot see at all.
4. **The recreation did NOT reproduce the blackhole** — tonight's amazon
   tab lived in the main window (session started via
   onFocusChanged(mainWindow) → active tab = amazon). Last night's
   mystery window is still unidentified. Key question pending: does
   Scott use a second Chrome profile? If the movie ran in another
   profile's window, the extension is structurally blind there (no
   events, no content script) and NO rescue can fix it — only installing
   the extension in that profile. If it was a same-profile
   fullscreen-Space window, the fullscreen rescue covers it.

Sharpened fix menu (still awaiting the profile/fullscreen answer):
- **Audible rescue, fullscreen-guarded:** on NONE (or while idle), an
  audible=true tab in a FULLSCREEN window → track it. (Audible alone is
  too loose: background music in an unfocused window would re-acquire.)
- **Keyboard-heartbeat rescue, self-evident:** while idle, a heartbeat
  carrying keyboard counts → track that tab. Typing requires focus, so
  this can never misfire; covers DevTools blindness, delayed focus, and
  silent fullscreen (Slides) — mouse/scroll heartbeats stay excluded
  (macOS hover delivers them to unfocused windows).
- Other-profile windows: out of scope by nature (no events arrive).

Addendum (same run, score table): the recreation used the SAME flow as
the movie night — same profile, normal tab, element fullscreen on the
trailer — and captured perfectly (amazon home 18s → search 6s → product
72s with 27s audible; heartbeats kept flowing through fullscreen
playback, no NONE fired mid-flow). Element fullscreen from a normal
window is therefore NOT the trigger. The remaining variable is the
WINDOW itself: hypothesis is the movie-night window was macOS-fullscreen
(own Space, green button) the whole time, so every focus of it fired
NONE — the browsing/purchase was already blind BEFORE the video went
fullscreen. Decisive pending test: green-button a Chrome window into
macOS fullscreen, browse ~30s, watch for NONE + missing sessions.

### New-tab blind spot: live specimen (2026-07-18, Slides deck run)

Scott opened a fresh tab and went to Google Slides. The log shows hole #2
end to end, with Chrome FOCUSED the whole time (no NONE until he clicked
into DevTools at the end to copy the log):
- `onActivated tab 940822242` → `startSession: skipping non-web page
  chrome://newtab/` — no session (correct per URL filter).
- `onCommitted https://docs.google.com/presentation/...` → "ignoring nav
  in non-tracked tab" — the first real navigation is discarded because
  current is null.
- Everything after — deck open, ~30 slide advances (one
  onHistoryStateUpdated each), five active heartbeats — delivered and
  ignored/DROPPED. An entire deck review, invisible, with every event
  arriving on time. No switch-away happened, so it never self-healed.
This is the bigger hole in daily practice: ANY Cmd-T → type URL → dwell
flow is blind until the first switch-away-and-return. It also cleanly
explains the movie night's START (19:39:11 mail finalize via onActivated
+ newtab skip); the movie night's non-adopting RETURNS still require the
NONE surface (green-button test still pending).

**Hole #2 FIXED (2026-07-18):** tab adoption landed in the onCommitted
handler — on commit with no current session, an active-tab + focused-
window check starts the session (rule in spec §3). Hole #1 (focus-NONE)
remains open pending the green-button test.

### Signal hole #3: iframe input blindness — FIXED (2026-07-18)

Confirmed twice on live tests:
- Slides present mode (96s, arrow-key heavy): hb=10 but kbd=2, score
  102 → LOW. Present mode renders in an iframe; keys never reach the
  top window's capture listener (capture:true defeats stopPropagation,
  not frame boundaries).
- Google Docs (56s: typed ~1 min, selected, cut): kbd=0, cut=0, hb=3.
  Docs routes keystrokes AND clipboard through its hidden about:blank
  input iframe. Composition — the highest-intent browser activity —
  was near-invisible, and pure-typing windows sent NO heartbeat (no
  top-frame activity), so attended time undercounted too.

Fix shape (Scott's ad-flood concern drove the design):
- `all_frames: true` + `match_about_blank: true` (the Docs input iframe
  IS about:blank; without that flag nothing injects there).
- Subframe instance: same-origin probe first (`window.top.document`
  throws for cross-origin) — ad frames exit before registering a single
  listener, silently (a 12-ad blog = 12 instant stillbirths, zero
  logs/messages). Same-origin frames register the same 8 passive
  listeners, batch counts locally, and postMessage totals to the top
  frame at most once per second while active; flush-on-hidden for the
  sub-second remainder.
- Top instance: folds relayed counts into its activity as if local
  (discrete += n, continuous |= flag) and stays the SOLE heartbeat
  sender — the "one heartbeat per active window" invariant and all
  background traffic are unchanged; relayed activity makes the window
  active, so pure-typing Docs windows now heartbeat (attended fixed
  too). Origin-gated message check only: a page could already spoof
  untrusted synthetic events into the local listeners, so heavier auth
  on the relay would defend a door standing next to an open one.
- Rejected: naive all_frames (per-frame heartbeat timers double-count
  attended); relay-to-background (worker would need per-window
  bookkeeping to keep hb honest; postMessage-to-top reuses the existing
  aggregation for free); host allowlist (spec forbids host
  special-casing). checkMedia stays top-frame-only: embedded players
  are mostly cross-origin (dead to us) and audible covers real playback
  at the tab level regardless of frames.

### Verification round (2026-07-18): both fixes confirmed, hole #1 unreproduced

- **Iframe relay verified:** Docs retest captured all keystrokes and
  clipboard events (Scott confirmed).
- **Adoption verified in daily use** (new-tab flows now record from the
  first navigation).
- **Green-button test result:** entering macOS fullscreen fired a
  TRANSIENT onFocusChanged(-1) followed immediately by a proper refocus
  (window id), and ~60s of browsing captured normally — no adoption
  needed. So fullscreen-Space windows are fine on this machine; the
  movie-night state (NONE persisting for 2+ hours across repeated
  returns) is NOT reproduced and its cause remains unknown.
- **Hole #1 downgraded to watch status.** Fingerprint if it recurs:
  `ignoring nav in non-tracked tab … (no session, window unfocused)` —
  the one line adoption cannot rescue. The fullscreen-rescue design
  above stays on the shelf until a natural specimen justifies it.

## Opener-edge capture: tab trees (2026-07-19)
- **The specimen (07-18, 13:52–14:28):** Scott's YouTube feed session —
  videos middle-clicked from the subscriptions tab into SIX separate tabs
  (317/320/323/326 + a substack read spawned from a video + a "red hulk"
  search spawned from another), each watched and closed. Tab-keyed chains
  couldn't combine any of it: five unframed blocks plus one small container
  where he happened to return to the feed tab itself. The cross-tab LOW
  merge glued three videos but blanked its tabId, making the glue
  chain-ineligible — it even stole the one legitimate same-tab pair.
- **Why capture, not display:** the opener relationship is ephemeral
  browser runtime state — Chrome drops `openerTabId` from the Tab object
  once the opener closes, and nothing stored lets display reconstruct the
  edge (tabId adjacency is an undocumented internal, not evidence). The
  worker must record the edge at `tabs.onCreated` or it is lost. Fits the
  philosophy: capture stores the raw fact, display interprets — which is
  what let every 2026-07-19 display rule be validated by replay.
- **Capture (spec §3):** `onCreated` writes `tabId → openerTabId` into an
  `openerEdges` map in `chrome.storage.session` (worker-death-proof;
  empties on browser restart, matching the accepted tabId lifetime), entry
  pruned when the tab itself closes (edges pointing AT a closed tab stay —
  still-valid tree keys). `startSession` stamps the edge onto the session
  (`openerTabId?: number`, superseding the deferred `parentId` stub);
  `tab.openerTabId` is the fallback path for pre-listener tabs. Score
  table gains an `opener` audit column.
- **Display (spec §6):** `treeRootsOf(sessions)` resolves every tabId to
  its tree root by following stored edges (memoized, cycle-guarded; edges
  read from ALL stored sessions — transit-filtered ones still testify).
  Chains key on the **(treeId, host) pair** — refined during
  implementation from plain treeId: a tree legitimately hosts one chain
  PER host (feed + a repeatedly-visited spawned article), a spawned
  foreign-host read neither joins nor breaks its parent's chain (it
  becomes a child by falling inside the span), and relaxed guard 1 turns
  structural — a HIGH cannot reach any chain but its own host's. The
  covered-HIGH rejection keeps foreign frames off same-tree HIGHs.
- **Validation:** cannot replay retroactively (stored week has no edges) —
  the one 2026-07-19 change where evidence only accrues after shipping.
  Shipped both sides anyway: display is structurally a no-op where edges
  are absent, proven by a no-edge week replay reproducing the day's
  validated containers line-for-line. A synthetic-edge replay of the
  specimen (edges injected into the real 07-18 data) assembles the whole
  episode as one youtube container 13:52–14:28 · 7 visits + 2 excursions
  (substack, google search) · score 2104. First real-data audit: the
  Score table's opener column, next feed session.

## Idle split: the focused-but-idle tab (2026-07-24)
- **The specimen (07-23, dinner):** Scott left for dinner with a Gemini tab
  focused; the Mac never slept. Nothing triggered finalize — no tab switch,
  no hide, no navigation — so one session ran 17:35:48–19:59:40: **8,632
  seconds of wall clock carrying 10 heartbeats (100s attended)**. The
  heartbeat data told the truth; the display couldn't use it, because block
  width comes from start→finalize timestamps, and visit merging then glued
  the slab to the genuine 17:30–17:35 HIGH session (same host, adjacent),
  which donated its "Google Gemini" label. Two hours of absence rendered as
  the day's biggest block.
- **Why capture, not display:** band gating is irrelevant — even scored LOW
  the block is 2.4 hours wide, because width IS duration. And sessions store
  per-signal *counts*, not heartbeat timestamps, so display can never know
  *where* inside the span the activity sat. Only the worker, at heartbeat
  arrival time, knows the gap. (Corollary: pre-2026-07-24 sessions are
  unrepairable — no `lastActiveTs` — and simply age out with the 7-day
  prune.)
- **The rule (spec §3):** session carries `lastActiveTs` — refreshed on
  every heartbeat, pinned to now while the tab is audible (a movie playing
  without input must never split; audible is already event-driven state in
  the worker). A heartbeat arriving > `IDLE_SPLIT_MS` (5 min) late finalizes
  the current session at `lastActiveTs + 10s` (reason `idle_split` — the
  +10s honors the heartbeat's trailing window) and starts a fresh session
  for the same tab/URL. Ordinary finalize applies the same clamp to a
  trailing gap, covering "left and never came back before closing."
- **Rejected: `chrome.idle` API.** It would split at idle *onset* instead of
  retroactively, but costs a new permission, a polled detection interval,
  and measures machine-wide idle rather than this-tab attention (a user
  mousing in another app is idle to us already — no heartbeats). The
  retroactive split needs no polling and no alarms: the worker wakes on the
  next heartbeat anyway, and duration-from-timestamps means the correction
  is exact.
- **Downstream: no amendments needed.** The resulting away-gap exceeds
  `VISIT_GAP_MS`, so fences, title runs, and visit merging already treat the
  two halves as separate — the dinner renders as absence at gap scale with
  the away hover plate.
- **Threshold:** 5 minutes, named constant `IDLE_SPLIT_MS`, provisional per
  the one-knob rule. Too low risks splitting slow reads (long-form articles
  produce sparse heartbeats but rarely 5-minute silences — scroll and mouse
  are continuous signals); too high leaks idle presence into blocks.

## Keyboard counting: modifiers + terminal-keystroke evidence (2026-07-24)
- Trigger: the transit filter's terminal-keystroke discount (full admission
  story in `plans/timeline_design.md`, transit section). Capture's role is
  two changes to what/how keydowns are recorded — judgment stays display-side.
- **Pure-modifier keydowns don't count** (`Meta`/`Control`/`Alt`/`Shift` as
  `e.key`, top frame and relay frames alike). A lone modifier press is half
  a chord or a no-op, never typing; the chord's action key still counts, so
  Cmd+F remains one keystroke of engagement. Necessary for the discount to
  work at all: a fresh Cmd+W fires TWO keydowns (Meta, then W) — counting
  the Meta would leave kbd=2 and a one-key discount couldn't drop the
  session. (Scott's real specimen showed kbd=1 only because he held Cmd
  across a run of tab closes, so each tab saw just the W.) Side effect on
  scoring: keyboard counts everywhere shrink slightly (no more +1 per chord
  for the modifier itself) — direction is honest, magnitude is noise against
  the 200-key cap.
- **`lastKeyGapMs` evidence field:** the top frame tracks the timestamp of
  the last counted keydown; relay frames send theirs in the relay payload
  (absolute epoch ms — same machine, same clock) and the top frame keeps the
  max. Only the flush-on-hidden heartbeat computes and sends the gap
  (`now - lastKeyTs`); the worker stamps it onto the session, overwriting is
  moot since a hide ends the session. Interval heartbeats never send it —
  the evidence is specifically about the terminal moment. `lastKeyTs` is
  page-instance state, not session state: after an SPA split it can predate
  the current session, which is harmless — a stale keydown yields a LARGE
  gap (no discount), and the discount only matters when the session actually
  counted a keydown.
- Pre-2026-07-24 sessions have no field and keep old behavior until the
  7-day prune (same stance as `lastActiveTs`).

## Audible continuity — gap-audio testimony (2026-07-24)

**Why:** the display's audio-bookend container bridge (both bookend
fragments ≥50% audible → bridge up to 30 min) was defeated by the fused
YouTube binge the day the succession join shipped: an 82%-audible binge
bridged its 7-minute lunch gap and swallowed an independent Claude session
as a contained child. Scott's insight: the real discriminator between a
meeting and a video session isn't how audible the bookends were — it's
whether the audio ran THROUGH the gap. A meeting keeps talking while the
user is at a whiteboard (browser-based or not); a paused video is silent.
That fact was structurally invisible: sessions only exist for the active
tab, so gaps are dataless by design.

**Design constraint (Scott):** no background heartbeats, no polling, no
redundant sampling — one derived fact, not many samples. The refinement:
"audible at return" alone is insufficient (already captured via
tab.audible at adoption) — it can't distinguish continuous audio from
stopped-and-restarted. Continuity needs exactly one remembered thing per
tab: when the current unbroken audible stretch began.

**As built:** the existing chrome.tabs.onUpdated audible listener (which
already fires for every tab; only the current tab accrues audibleMs) now
also maintains `audibleContinuity` in storage.session — {tabId: sinceTs},
set on audible-on, cleared on audible-off. Writes only on transitions: a
meeting talking through a 20-minute gap costs zero events; a stopping
video costs one. Seeded at onInstalled/onStartup from
tabs.query({audible:true}) with NOW (true start unknowable — fails
closed: "now" can never predate an existing gap); entry dies with the tab
in onRemoved. startSession stamps the value as `audibleSinceTs` on the
session (stored, survives finalize; fallback to now when tab.audible but
no entry). Display use: `plans/timeline_design.md` (gap-audio bridge).
Additive schema — old data simply never long-bridges; no history wipe
needed.

## Download presence gate (2026-07-26)

**Why:** Scott rebooted his Mac; `utweb.rainberrytv.com` (BitTorrent
Web's own UI tab, auto-restored by Chrome) scored 313,200 — `download`
count 1566 × `W_DOWNLOAD` (200) — with 0 attended seconds. No torrents
were active afterward, so this wasn't real download traffic: the web
UI's local daemon replays its download history to the browser tab on
reconnect, and `chrome.downloads.onCreated` fires once per replayed
entry, indistinguishable at the API level from a real "Save As". The
first fix considered — capping `W_DOWNLOAD` or requiring a minimum
attended time — was a scoring-formula patch; Scott redirected to the
actual defect: capture is trusting an event that isn't proof of user
intent, so the fix belongs at capture time, not display time.

**Rejected: burst detection.** Drop/clamp counts when N downloads fire
within a short window. General-purpose, but indirect — it infers
non-intent from event shape rather than checking for user presence
directly, and needs its own threshold tuning.

**Rejected: domain special-case.** Blocklist `rainberrytv.com`. Violates
the project's standing preference for general mechanisms over
site-specific patches (cf. the google.com label-split precedent, which
designed and rejected a general multi-app mechanism rather than
special-casing further).

**Considered and refined: heartbeat-only gate.** Require
`current.heartbeats >= 1` before counting a download — reuses the
existing attention proxy (`attendedSeconds = heartbeats × 10`) with no
new plumbing. Kills the rainberrytv burst (fires before any heartbeat
can land). But Scott caught a real miss: email → click a download
button in a fresh tab → download starts → tab closes, all inside one
10s window, before the first heartbeat. A heartbeat-only gate drops
this legitimate, fast, click-driven download — worse than the bug being
fixed, since it silently loses signal instead of adding noise.

**Apparent rule conflict, resolved:** gating on anything other than
heartbeats looked like it might contradict a "heartbeat required" rule.
Checked against spec §3 Rung 1 (session admission): the existing rule
there is already "one click OR one heartbeat" — clicks are co-equal
proof-of-life, not a heartbeat substitute. So a click-or-heartbeat gate
for downloads isn't a competing rule, it's the same Rung-1 bar applied
to a second gate. The real difference: Rung 1 reads stored
`heartbeats`/`activity.click` at *finalize*, long after content.js's
batched signals have flushed. The download gate needs presence proof
**in real time**, mid-session — `activity.click` isn't reliably in
storage yet when `onCreated` fires seconds after the click. That's a
timing gap, not a rule conflict.

**As built:** `mousedown` gets a dedicated real-time cue, parallel to
but distinct from `cueSnapshot()` (deliberately not folded into it —
`cueSnapshot` was scoped to exclude clicks as the noisiest, least
intentional signal for triggering screenshots; this is a different
consumer with a different bar). Content script sends a one-shot
`{type: "click-cue"}` message on first `mousedown` per session;
background sets `current.hadClick = true`, awaited into storage like
the existing `snapshot-cue` listener. The download handler gates on
`current.heartbeats || current.hadClick` — drop, not defer, when
neither is present.

**Known miss, accepted:** a download that starts from raw navigation
with no in-tab click (a direct link straight to a file, no landing page
— the content script may not have attached listeners yet) still won't
be caught. Narrower than Scott's email example; out of scope for now.

## Page-text search capture (stage 1, 2026-08-07)

Prototype to judge whether title/url search is too weak to be useful —
extract page text with Mozilla's Readability.js (vendored unmodified,
`vendor/Readability.js`) and search over it too, before investing in any
privacy hardening. Deliberately naive: full plain text, capped at 5000
chars, stored inline on the session as `pageText`, no domain allowlist/
blocklist, no redaction. Search-only — never displayed in the dashboard's
results row.

**Where it runs:** content.js, against `document.cloneNode(true)` — the
library's own docs say `parse()` mutates whatever DOM it's given, so a
clone is required or the live page would visibly change under the user
mid-visit (elements disappearing, layout shifting). Confirmed by reading
the library source before implementing, not assumed.

**When it runs:** riding the exact same one-shot trigger as snapshots
(first qualifying interval heartbeat or keyboard/cut/copy/paste cue),
rather than a new message or timer — the outgoing heartbeat/cue message
just gains an optional `pageText` field. Excluded on `flush-on-hidden`,
matching the snapshot's exclusion (the tab isn't "on glass" by then).
Lifecycle mirrors snapshots at finalize too: a transit-rejected session
has `pageText` deleted, same as `snap:<id>`; ages out with the normal
7-day retention automatically since it's inline (no separate key, no
orphan-sweep needed — unlike snapshots).

**Bug found and fixed the same day — SPA navigation:** the one-shot
guard (`textExtracted`) was a closure boolean scoped to the content
script's *injection* lifetime. On an SPA like Gmail, one injection spans
many FocusStream sessions (each email-open is its own session via
`SPA_DEBOUNCE_MS`), but the flag never reset — so only the very first
Gmail page landed on (the inbox) ever got extracted; every email opened
after that in the same tab was silently skipped. A week of testing
initially looked like Readability just didn't work on Gmail; the
Score-table-style storage query (`chrome.storage.local.get("sessions")`
filtered to the host, `pageText` length per row) showed the real
pattern — one row with real text, every subsequent row zero-length, even
rows whose titles named specific opened emails. Root cause confirmed by
running `new Readability(document.cloneNode(true)).parse()` directly in
the content-script's own DevTools console context (not the page's `top`
context, where the content-script's globals aren't visible at all) — it
returned real text on demand, proving the library worked and the bug was
purely in *when* extraction ran. Fixed by tracking `location.href` and
resetting the one-shot flag on change, checked lazily inside
`extractPageText()` — SPA navigation is exactly the case
`SPA_DEBOUNCE_MS` already treats as "a new page," so the same signal
re-arms extraction. Screenshots never had this bug: `snapped` lives on
the *session object* in `chrome.storage.session`, which `startSession`
resets fresh per session — not on a content-script-lifetime closure.

**Container implication (2026-08-07):** confirmed by design, not by new
code — a container's tooltip already flattens to its member sessions
(`dedupedPagesOf`, dashboard/timeline.js), each a fully independent
stored session with its own `pageText`. Containers are a display-time
aggregation over already-captured, already-finalized sessions; text
capture happens per-session before any container logic runs. So once
the SPA-navigation fix landed, every member email opened inside a Gmail
container view gets its own independent extraction attempt — no
container-aware capture logic needed.

**Open tension, deliberately held (2026-08-07):** the input-cue/heartbeat
trigger measures *intent/engagement*, not *reading*. A short but
important email — read for a few seconds, no keyboard/copy, dies before
the first 10s interval heartbeat — generates no signals and is never
extracted, same blind spot screenshots already have. This is currently
*safe by construction*: the extraction trigger is a subset of the
transit filter's own admission bar, so nothing captured can be a session
transit later rejects, which makes the finalize-time `pageText` deletion
a redundant backstop today, not load-bearing. The risk is specifically
what happens if a future iteration widens the trigger to catch short
reads (a dwell-only or reading-cue signal, weaker than today's bar) —
then the finalize deletion becomes the *only* thing standing between
"searchable" and "the dashboard shows this session never happened."
Explicitly not solved now: fixing it would mean designing a way to tell
"declined to engage" apart from "read and moved on" from signal-free
sessions, which is a harder problem than this stage-1 prototype is
trying to answer. Recorded on the watch list (`WATCHLIST.md`, was SPEC §6
until the 2026-08-07 extraction) so it survives past this conversation.
