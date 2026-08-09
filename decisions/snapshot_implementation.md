# Snapshot Previews — Implementation Notes

The single home for the tooltip + snapshot story (the separate plan doc,
`tooltip_snapshot_plan.md`, was folded in here 2026-07-18): the original
reasoning and decided knobs, plus the *how* — the concrete code changes, keyed
to the codebase, for Part 2 (snapshot capture + tooltip preview). Part 1 (the
custom tooltip layer) is live; its design is recorded just below.

**Implemented 2026-07-16** — this doc was reviewed before building (fixes below
marked **[review]**) and now records the as-built shape.

## Original reasoning (2026-07-15)

Two forces converged on one mechanism:

1. **Native `title` tooltips have uncontrollable timing** — ~1s cold, then a
   "warm" state with near-instant tooltips until any click resets it cold.
   Observed on the ribbon: hover felt random, and opening a fence (a click +
   a re-render) reset the warm state. No API exists to tune native delay.
2. **Snapshot previews can't ride native tooltips at all** (text-only).

So the custom tooltip layer isn't merely nicer — it's the prerequisite for the
preview feature Scott has wanted since Desktop4 (whose screenshot feature did
NOT port; this is its return, minus the heatmaps, which stay out of scope).

### Part 1 — custom tooltip layer (live 2026-07-15)

One `#tip` div: dark panel matching the ribbon aesthetic, multi-line, all text
via `textContent` — page-controlled strings (titles, URLs) never touch
innerHTML. One delegated listener pair on `#ribbon`: `pointerover` starts a
fixed `TIP_DELAY_MS = 300` timer; `pointerout` / `pointerdown` cancels and
hides. Every hover pays exactly 300ms — uniform, and snappier than the native
cold ~1s. Positioned near the cursor, clamped to the viewport.

### Capture API and sizing (the arguments behind the knobs)

- `chrome.tabs.captureVisibleTab()` is the only MV3 screenshot API, and it
  fits the architecture: it can only photograph the *currently visible* tab,
  and that is exactly the only tab that ever accrues attention. The existing
  `<all_urls>` host permission covers it; Chrome's ~2 captures/sec rate limit
  is far above our use.
- **Fixed target width (~640px), not screen-relative** — proportional sizing
  would make a 4K user pay 4× the disk of a laptop user for the same tooltip.
  Fixed width ≈ the intended 1/16 area on a typical screen, but predictable:
  ~20–40KB per snapshot at JPEG ~0.6.
- The quota math that forced `unlimitedStorage`: ~100 attended sessions/day ×
  30KB ≈ 3MB/day against the 10MB `storage.local` cap — full in ~3 days
  without the permission plus a retention policy.
- Snapshots live under separate `snap:<id>` keys, **never inside
  SessionBlocks** — the sessions array is read in full on every render and
  every Score-table click; embedded images would bloat every read.

### Failure modes (all soft — skip silently, tooltip just lacks an image)

Minimized window / locked screen (`captureVisibleTab` throws), DRM video
(frames capture black), `file://` pages (need the "allow file URLs" toggle),
incognito (extension not enabled there; nothing captured).

### Privacy note (recorded deliberately)

This puts images of everything browsed on disk. Fine for a personal
experiment; it is a real property change of the tool and is stated here and
in the spec.

## The five changes at a glance

| # | File | Change | New surface area |
|---|------|--------|------------------|
| 1 | `manifest.json` | add `unlimitedStorage` permission | one array entry |
| 2 | `content.js` | heartbeat message carries its `reason` **[review]** | one field |
| 3 | `background.js` | capture + downscale on first heartbeat (never on flush); store under `snap:<id>`; prune at finalize; orphan sweep on startup | ~3 new functions, ~4 lines in the heartbeat handler, ~4 lines in finalize |
| 4 | `dashboard/timeline.js` | tooltip grows an `<img>`; lazy-fetch `snap:<id>` on hover; pick the right id for merges/containers | tooltip becomes structured (not one `textContent` string) |
| 5 | `dashboard/index.html` + `dashboard.js` | `#tip` gets an image child; "Clear data" wipes `snap:*` | CSS for the image; one loop in the clear handler |

---

## 1. manifest.json

Add `"unlimitedStorage"` to `permissions`. That's the whole change. It lifts the
10MB `storage.local` cap so snapshots don't evict session data. Host permission
(`<all_urls>`) already covers `captureVisibleTab` — no new host grant.

```json
"permissions": ["storage", "unlimitedStorage", "webNavigation", "tabs", "scripting", "downloads"],
```

---

## 2. content.js — heartbeat reason

`sendHeartbeat(why)` already knows its reason ("interval" | "flush-on-hidden");
it just never sent it. Add `reason: why` to the message so the background can
refuse to capture on flush (§3). One field, no behavior change otherwise.

---

## 3. background.js — capture, downscale, store, prune

### Where capture hooks in

The heartbeat handler at [background.js:290](../background.js#L290) is the hook.
Today it does `current.heartbeats = (current.heartbeats || 0) + 1`.

**Capture once, on the first heartbeat only** (Scott, 2026-07-16 — dropped the
refresh). The first-heartbeat frame lands ~10s in: page painted, user
demonstrably attending. Most sessions are only open a few minutes, so a
mid-session refresh buys little and adds real complexity (it reopened the
"every N active windows vs every 60s wall-clock" ambiguity — gone now). The one
cost is an SPA that changes a lot after 10s shows its early state; acceptable
for a personal tool, and it can be revisited if a specimen bugs us.

- **First heartbeat** = the tick where `heartbeats` transitions `0 → 1`. Capture
  there, and only there.

**[review] The flush-on-hidden trap.** The roadmap's crux — "capturing at
finalize photographs the *next* tab" — sneaks back in through the flush path:
`content.js` sends a heartbeat the instant the tab is hidden (flush-on-hidden),
and for a page attended < 10s that flush IS the first heartbeat, firing capture
exactly while the next tab becomes visible. So the heartbeat message now
carries its `reason` ("interval" | "flush-on-hidden"), and **flush heartbeats
never capture** — a page hidden before its first 10s tick doesn't merit a
picture (it's borderline-blip).

Capture keys off `current.id` — the session UUID minted in `startSession`
([background.js:63](../background.js#L63)) — so the snapshot and its SessionBlock
share an identifier with zero extra plumbing.

```js
// inside the heartbeat enqueue callback, after current.heartbeats++ :
if (current.heartbeats === 1 && msg.reason !== "flush-on-hidden") {
  captureSnapshot(current.id, sender.tab.windowId); // fire-and-forget; never blocks the beat
}
```

Fire-and-forget on purpose: a failed or slow capture must never delay or drop a
heartbeat. It is not `await`ed inside the queued callback.

### The capture function (new, standalone)

Lives near the top of `background.js` alongside the other helpers. All of it is
best-effort — every failure path just logs and returns, leaving the tooltip
image-less (the plan's "all soft" failure contract).

```js
const SNAP_WIDTH = 640;        // fixed target width (plan: predictable disk, not screen-relative)
const SNAP_QUALITY = 0.6;      // JPEG quality; tune by eye vs disk

async function captureSnapshot(sessionId, windowId) {
  try {
    // captureVisibleTab photographs the *currently visible* tab of the window —
    // which is exactly the tracked tab: only the visible tab sends interval
    // heartbeats, and flush-on-hidden beats are excluded upstream.
    // Double JPEG encode (q90 here, 0.6 after downscale) is deliberate: the
    // generational loss is invisible at 640px, and a PNG intermediate of a
    // large screen is a multi-MB string.
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "jpeg",
      quality: 90, // pre-downscale; we re-encode smaller below
    });
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const scale = SNAP_WIDTH / bmp.width;
    const w = SNAP_WIDTH;
    const h = Math.round(bmp.height * scale);
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
    const small = await canvas.convertToBlob({ type: "image/jpeg", quality: SNAP_QUALITY });
    const stored = await blobToDataUrl(small); // data: URL, stored as a string
    await chrome.storage.local.set({ ["snap:" + sessionId]: stored });
    log(`snapshot stored snap:${sessionId} (${Math.round(stored.length / 1024)}KB)`);
  } catch (e) {
    // Minimized window, DRM-black frame, locked screen, file:// without the
    // toggle — all land here. Soft-fail: the tooltip just shows text.
    log("snapshot skipped:", e.message);
  }
}
```

`blobToDataUrl` is a small helper (`FileReader` isn't in workers). **[review]
It must chunk:** `String.fromCharCode(...bytes)` on a 30–40KB buffer flirts
with engine argument limits — works in testing, blows the stack on a taller
screenshot. Build the binary string in ~32KB `subarray` chunks, then one
`btoa`. Storing a `data:` URL string sidesteps the fact that `storage.local`
can't hold a `Blob` — and lets the tooltip set `img.src` directly with no
object-URL lifecycle to manage.

> **`createImageBitmap` with resize options** — the plan text mentions
> `{resizeWidth, resizeHeight}` on `createImageBitmap`. That works too and skips
> the manual canvas draw. Either is fine; I've shown the canvas path because
> `convertToBlob` quality control is explicit there. Pick one when building.

### Cleanup — two layers (snapshots never live indefinitely)

Snapshots are ~20–40KB each; a stray one that never gets deleted is real disk
(unlike a session block, which is a few KB). Two layers guarantee they're
bounded — the first is the common path, the second is the garbage collector that
catches everything the first can miss.

**Layer 1 — aligned prune at finalize.** `finalizeCurrent`
([background.js:114](../background.js#L114)) already prunes SessionBlocks past
`RETENTION_MS`. A snapshot must die with its session, so when a block is dropped
from `kept`, delete its `snap:` key in the same pass:

```js
const dropped = sessions.filter((s) => s.endTime < cutoff);
if (dropped.length) {
  await chrome.storage.local.remove(dropped.map((s) => "snap:" + s.id));
}
```

This keeps snapshot retention exactly equal to session retention (and to
day-paging: a day you can no longer reach has no snapshots on disk).

**Layer 2 — orphan sweep on startup.** Layer 1 alone has a hole: finalize only
runs on a tab switch/close. Close the browser for a week and reopen, and the
stale snapshots sit until the *next* finalize fires. Worse, any `snap:` key that
ever loses its session by another route — a pre-snapshot build's already-pruned
sessions, a failed write, a UUID mismatch — becomes **immortal**, because
nothing else ever scans for snapshots without a matching session. So sweep once
per service-worker wake:

```js
// runs on onStartup / onInstalled (cheap: key names + the small sessions array)
async function sweepOrphanSnapshots() {
  // [review] getKeys(), NEVER get(null): at steady state the snapshots total
  // ~15-25MB, and get(null) would deserialize every image just to list names.
  const keys = await chrome.storage.local.getKeys();
  const snapKeys = keys.filter((k) => k.startsWith("snap:"));
  if (!snapKeys.length) return;
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  const liveIds = new Set(sessions.map((s) => s.id));
  const orphans = snapKeys.filter((k) => !liveIds.has(k.slice(5)));
  if (orphans.length) {
    await chrome.storage.local.remove(orphans);
    log(`swept ${orphans.length} orphaned snapshots`);
  }
}
```

Wire it into the existing `onStartup`/`onInstalled` `enqueue` blocks
([background.js:160-171](../background.js#L160-L171)) alongside `ensureSession`.
It runs at most once per browser launch and is the actual answer to "they don't
just sit there indefinitely."

> **Blips need no cleanup at all:** a *blip* session (discarded at
> [background.js:105](../background.js#L105)) can never have a snapshot — blips
> have zero heartbeats, and capture only fires on heartbeat === 1. So no
> orphaned `snap:` key is possible from that path. The "only attended pages earn
> a picture" invariant falls out for free.

---

## 4. dashboard/timeline.js — show the image in the tooltip

### Today's tooltip is a flat string

Part 1's tooltip pipeline is: each block sets `el.dataset.tip = tooltip(e)` (a
`\n`-joined string), and the delegated `pointerover` handler at
[timeline.js:769](../dashboard/timeline.js#L769) does
`tip.textContent = el.dataset.tip`. Adding an image means the tooltip can no
longer be one `textContent` assignment.

### Minimal restructure

Give `#tip` two children built once: an `<img id="tip-img">` and a
`<div id="tip-text">`. The hover handler then:

1. sets `tipText.textContent = el.dataset.tip` (unchanged text path), and
2. reads a **session id** off the element (`el.dataset.snapId`) and lazy-fetches
   `snap:<id>`.

**[review] Decode before positioning.** The naive order — position the tooltip
on its text, let the image pop in later — breaks the viewport clamp: the image
inflates the box ~270px *after* the flip-above-cursor math ran, pushing
tooltips near the bottom of the screen off-screen (plus a visible pop on every
hover). So the timer body is async: fetch the snapshot, set `src`, await
`img.decode()`, and only then unhide + measure + position, exactly once. A
hover **sequence token** (incremented by `hideTip`) guards the awaits — if the
pointer left mid-fetch, the stale continuation returns instead of resurrecting
a dismissed tooltip.

```js
// in the setTimeout body (now async), replacing `tip.textContent = ...`:
const seq = tipSeq;                        // hideTip() bumps tipSeq
tipText.textContent = el.dataset.tip;
tipImg.hidden = true;
tipImg.removeAttribute("src");             // never flash the previous snapshot
const id = el.dataset.snapId;
if (id) {
  const r = await chrome.storage.local.get("snap:" + id).catch(() => ({}));
  const src = r["snap:" + id];
  if (src && seq === tipSeq) {
    tipImg.src = src;
    try { await tipImg.decode(); tipImg.hidden = false; } catch {}
  }
}
if (seq !== tipSeq) return;                // hover ended during the awaits
tip.hidden = false;
// ...existing measure + clamp + position, unchanged, now sized correctly
```

### Which id? (merges and containers)

**Revised 2026-07-16 (field bug):** "top-scoring member or nothing" failed on
day one. A click within 1–3s of arriving fires unload's `visibilitychange`,
whose flush beat inflates the stub to 10 attended + click activity — so the
*stub* out-scored the real session that followed it, and the tooltip asked
storage for a picture the stub could never have while the real session's
screenshot sat unused. Blocks now carry **`snapIds`** — member ids in score
order — and the hover fetches all candidates in ONE `storage.local.get([...])`
and shows the **best-scoring member that HAS a picture**. Click target stays
the top-scoring member. The original single-id reasoning below stands as the
ordering rule:

- **Plain block** → `s.e.id` (the raw session id, unchanged from storage).
- **Merged visit** → the *top-scoring member*, not the synthetic `"v"+id`.
  `mergeVisits` already stores `top` as the click target (`merged.url = top.url`);
  carry `top.id` alongside so the snapshot matches the click. Add
  `snapId: top.id` to the merged object at [timeline.js:306](../dashboard/timeline.js#L306).
- **Container** → same story: the anchor's top-scoring fragment. Add
  `snapId: top.id` to the container object at [timeline.js:419](../dashboard/timeline.js#L419).
- **Contained child** → its own `s.e.id`.
- **Expanded fence member** → its own `s.e.id`, like any block. Expanded members
  render as normal blocks (`dataset.tip` set), so they get their snapshot for
  free — no special case. **(Scott, 2026-07-16: expanded fence events show
  snapshots.)**
- **Collapsed fence stick** → no tooltip today (`delete el.dataset.tip`), so no
  image, by design. The fence *plate* stays text-only too. **(Scott,
  2026-07-16: collapsed fence events do NOT show snapshots.)** So the collapse/
  expand toggle doubles as a snapshot gate: fold the fence and the pictures
  disappear with the detail; open it and each member shows its own.

So in the render loop where `dataset.tip` is set
([timeline.js:868](../dashboard/timeline.js#L868)), also set:

```js
if (s.collapsed) { delete el.dataset.tip; delete el.dataset.snapId; }
else {
  el.dataset.tip = tooltip(s.e);
  const snapId = s.e.snapId || s.e.id; // merges/containers carry snapId; else the raw id
  if (snapId) el.dataset.snapId = snapId; else delete el.dataset.snapId;
}
```

Add the same `data-snapId` cleanup to the stale-block pruning so a block reused
across renders can't keep a dead id.

---

## 5. index.html + dashboard.js

### index.html — the image slot

`#tip` currently holds text directly. Restructure to two children and style the
image to sit above the text at the tooltip's width:

```html
<!-- built in JS today; if moved to markup, mirror this: -->
<div id="tip" hidden>
  <img id="tip-img" hidden alt="">
  <div id="tip-text"></div>
</div>
```

```css
#tip-img {
  display: block;
  max-width: 100%;
  border-radius: 3px;
  margin-bottom: 6px;
}
```

`max-width: 100%` inside the existing `max-width: 480px` on `#tip` bounds the
image; the 640px capture scales down to ~468px displayed. `white-space: pre-line`
stays on `#tip-text` (moved off `#tip`).

> The current code *creates* `#tip` in JS ([timeline.js:755](../dashboard/timeline.js#L755)).
> Simplest to keep building it in JS and just `appendChild` the two children
> there, rather than moving it to markup. Either works.

### dashboard.js — Clear data must wipe snapshots

"Clear data" ([dashboard.js:272](../dashboard/dashboard.js#L272), verified)
removes `sessions` and `hostColorOrder`. It must also drop every `snap:` key,
or cleared-away pictures linger on disk (and, worse, could surface under a
*reused* UUID — vanishingly unlikely, but the invariant is "clear means
clear"). **[review]** Enumerate names with `getKeys()`, not `get(null)` — same
~20MB-deserialize trap as the sweep:

```js
const keys = await chrome.storage.local.getKeys();
const snapKeys = keys.filter((k) => k.startsWith("snap:"));
await chrome.storage.local.remove(["sessions", "hostColorOrder", ...snapKeys]);
```

---

## Build order

1. **Manifest + reason + capture + store** on the first heartbeat (§1–§3).
   Verify snapshots exist via raw `storage.local` reads (or the toolbar-icon
   console dump) *before any UI* — this de-risks the capture timing, which is
   the crux.
2. **Tooltip `<img>` slot + lazy load** (§4 + §5's index.html).
3. **Cleanup:** aligned prune at finalize + orphan sweep on startup +
   Clear-data (§3's two layers + §5's dashboard.js).
4. Tune `SNAP_QUALITY` by eye against disk cost.

## Decisions locked (Scott, 2026-07-16)

1. **Capture cadence — first heartbeat only, no refresh.** Most sessions are
   short; the ~10s frame represents them well. Removes the refresh knob and the
   active-window-vs-wall-clock ambiguity entirely.
2. **Fence snapshots — expanded members show them; collapsed sticks/plates do
   not.** The expand toggle gates snapshot visibility for free (§3).
3. **Storage — `data:` URL strings**, not Blobs. Zero object-URL lifecycle; the
   ~33% base64 overhead is within the disk budget.
4. **Cleanup — two layers** (§2): aligned prune at finalize *plus* an orphan
   sweep on service-worker startup, so no `snap:` key can outlive its session
   even across long browser-closed stretches.

## Review fixes folded in (2026-07-16, all implemented)

1. **Flush-on-hidden never captures** — the heartbeat message carries its
   reason (§2); a first-heartbeat-via-flush fires while the next tab is already
   visible and would photograph the wrong page (§3).
2. **`getKeys()`, never `get(null)`** — both the orphan sweep and Clear-data
   enumerate key names only; `get(null)` would deserialize ~15–25MB of images
   on every browser launch / every Clear (§3, §5).
3. **Decode-then-position** — the tooltip is measured and viewport-clamped once,
   after `img.decode()`, guarded by a hover sequence token (§4).
4. **Chunked base64** in `blobToDataUrl` — spread-args `fromCharCode` on a 40KB
   buffer risks the stack; encode in ~32KB chunks (§3).

Noted, not changed: double JPEG encode is deliberate (PNG intermediate is
multi-MB); a merged visit whose top member's capture soft-failed shows
text-only even if a sibling has a picture (possible later fallback).

## Field debugging (added 2026-07-16)

First real-world day surfaced a session (hb=2, post-reload) whose capture
**fired and threw** — soft-fail leaves no visible trace, and the worker
console had long been evicted (workers die ~30s idle). So a failed capture
now writes a **`snapErr:<sessionId>` breadcrumb** (`{when, message}`) to
storage — same lifecycle as `snap:` keys (finalize prune, orphan sweep,
Clear data all handle both prefixes). Diagnosis is then a storage read, no
reproduction needed. Suspected cause of the specimen: content-script ticks
align to page load, not session start, so a first beat can land <1s after a
tab switch — `captureVisibleTab` mid-activation throws transient errors.
The breadcrumb will confirm or refute before any retry logic is considered.

## Capture unified with the transit filter (2026-07-24)

**The bug that surfaced it:** an Airbnb tab, open <10s but genuinely worked
(click 2, keyboard 6, mouse 1, scroll 1), survived the transit filter — the
keystrokes exempt it — yet had no snapshot. `attended 10s` was the tell:
exactly one heartbeat, the flush-on-hidden, which is barred from capture
(wrong-page trap). The first interval heartbeat at the 10s mark never fired,
so no capture was even attempted (no `snapErr:` either). Structural gap: the
transit filter admits on *signals*, capture triggered on *time*.

**The rule (Scott):** if it survives the transit filter, it has a
screenshot — no timers, tie capture to the qualification to exist on the
dashboard. Two rejected shapes on the way there:

- *500ms suppression timer* on the first qualifying keystroke (to avoid
  capturing Cmd+W bounces, mirroring `TERMINAL_KEY_MS`) — over-complicated;
  the keep-or-delete at finalize makes it unnecessary.
- *Always capture at session start* — two hard problems: at
  activation/URL-commit the glass often still shows the *previous* page
  (the wrong-content trap at the start edge), and `captureVisibleTab` is
  rate-limited (~2/sec), which fast tab-cycling would blow through, one
  wasted encode + ~30KB write per hop.

**As built:**

- Capture fires at whichever qualification arm wins first: the first
  interval heartbeat (duration arm, unchanged) or the first
  transit-qualifying *signal* — keyboard/cut/copy/paste send a one-shot
  `snapshot-cue` from the content script (re-armed each heartbeat send so a
  fresh session on the same page — SPA nav, idle split — can cue again;
  relayed subframe input cues too); downloads capture directly in the
  background handler. All triggers fire while the tracked tab is on glass.
- Dedupe is an explicit `snapped` flag on the live session — the old
  `heartbeats === 1` guard had a latent bug: a flush beat consumed slot #1
  while being barred from capture. Flag is stripped before storage
  (`snap:<id>` existence is the record).
- **Finalize judges with full evidence** (final duration, `lastKeyGapMs`):
  a `snapped` session the transit predicate rejects gets its
  `snap:`/`snapErr:` keys removed. The session itself stays stored — the
  display-time-filter audit property is untouched.
- **Ordering, not timing:** cue/download captures are *awaited inside the
  event queue* (unlike the heartbeat path's fire-and-forget). A Cmd+W
  bounce goes keydown-cue → close → finalize; the queue serializes
  capture-and-store before finalize, so the delete always sees the store.
  Without the await, a late store would resurrect a wrong-page picture
  under a transited session's id (invisible, but exactly the class of
  stray this feature has been careful about).
- **`shared/transit.js`** (new): `isTransit` + `TRANSIT_MS` +
  `TERMINAL_KEY_MS` moved out of timeline.js to `globalThis.FS_TRANSIT`
  (workers have no `window`) — dashboard loads it via a `<script>` before
  timeline.js, the worker via `importScripts`. Scott's call: these are
  knobs we'll revisit; both sides must read one copy so they can never
  drift. Follows the `FS_SCORING` single-source precedent.

**Residual (accepted):** a session whose only qualifying signal lands in a
frame the flush never reports (tab killed before any message escapes) can
be `snapped` with empty activity and hit the blip-discard path without the
finalize delete — the startup orphan sweep collects those. And a genuine
(non-terminal) lone keystroke still cues a capture that finalize may keep
for a session the user considers noise — that's the transit rule's call,
not capture's.

## Audit fixes: the duration arm's hole + the heartbeat race (2026-07-24)

The 2026-07-24 doc↔code audit (working file, since retired) found
two ways the unification's promise — survive transit ⇒ have a picture —
was false as built. Both fixed the same day, Scott approving each.

**The missing third trigger (issue 3):** the transit filter has THREE
exemption arms (duration ≥ `TRANSIT_MS`, high-intent signal, and duration
is checked FIRST), but capture had triggers for only two — the "duration
arm" trigger was the first *interval heartbeat*, which is a proxy needing
activity. A survivor with zero heartbeats and zero signals (a cross-origin
embed playing hands-off; motionless reading) fired no trigger, ever.
Fix: a true duration trigger — a one-shot worker timer armed at session
start fires at the session's `TRANSIT_MS` birthday; if it's still the
current session and unsnapped, capture. On the original "no timers" rule
and the rejected capture-at-start shape: this is neither — it postdates
qualification instead of suppressing capture, the glass has shown the
session's own page for 10 continuous seconds (sessions finalize on hide,
so current ⇒ on-glass since start — no start-edge wrong-content trap),
and fast tab-cycling never reaches 10s (no rate-limit pressure). MV3
caveat, accepted as best-effort: the timer dies with the worker, but
workers idle-kill at ~30s and the timer is armed inside a live event, so
it virtually always fires — and any later heartbeat/cue re-triggers.
Coverage after the fix: every survivor gets an ATTEMPT by construction;
what can still be missing is a picture whose capture failed (DRM, locked
screen — `snapErr:` breadcrumb, the existing contract).

**The heartbeat-path race (issue 4):** cue/download captures were awaited
precisely so finalize couldn't outrun the store — but the heartbeat path
stayed fire-and-forget ("a slow capture must never delay a heartbeat").
A sub-10s SPA-born session can catch an interval heartbeat mid-window,
die as transit, and have the unawaited `storage.set` land AFTER finalize's
delete — and because rejected sessions stay stored for audit, the leaked
`snap:` key is never an orphan; it lives until the block's 7-day prune.
Fix: await the heartbeat path too — all event-driven triggers now
serialize through the queue ahead of finalize. Cost: ~100ms once per
session against a 10s cadence ("negligible" — Scott). The age trigger
needs no await: it can't race by construction, since a 10s-old session
has already out-aged the filter.
