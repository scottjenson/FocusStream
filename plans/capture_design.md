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
