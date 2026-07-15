# Tooltip Roadmap: Custom Tooltip Layer + Snapshot Previews

Status: **approved 2026-07-15, all knobs decided (see below). Part 1 implemented 2026-07-15.**
Part 1 is a prerequisite for Part 2. Spec §6 gets the condensed rules when each part
is implemented; this doc carries the full reasoning.

## Why

Two forces converge on the same mechanism:

1. **Native `title` tooltips have uncontrollable timing.** Browsers show the first
   tooltip after ~1s, then enter a "warm" state where subsequent tooltips appear
   near-instantly — until any click resets it cold. Observed on the ribbon: hover
   feels random, and opening a fence (a click + a re-render) resets the warm state.
   No API exists to tune native tooltip delay.
2. **Snapshot previews can't ride native tooltips at all** (text-only).

So the custom tooltip layer isn't merely nicer — it's the prerequisite for the
preview feature Scott has wanted since Desktop4 (whose screenshot feature did NOT
port; this is its return, minus the heatmaps, which stay out of scope).

## Part 1 — Custom tooltip layer

- One `#tip` div on the dashboard page: dark panel matching the ribbon aesthetic,
  light text, multi-line (`white-space: pre-line`), real line spacing.
- Ribbon elements stop setting `title`; tooltip text stored as a JS property on the
  element. All text rendered via `textContent` — page-controlled strings (titles,
  URLs) never touch innerHTML (same rule as the debug list).
- One delegated listener pair on `#ribbon`: `pointerover` starts a fixed timer
  (`TIP_DELAY_MS = 300`), `pointerout` / `pointerdown` cancels and hides. Every
  hover pays exactly 300ms — uniform, and snappier than the native cold ~1s.
- Positioned near the cursor, clamped to the viewport.
- The debug list below the ribbon keeps native titles (debug view; variability
  doesn't matter there).

## Part 2 — Snapshot previews

### Capture

- `chrome.tabs.captureVisibleTab()` — the only MV3 screenshot API, and it fits the
  architecture: it can only photograph the *currently visible* tab, and the only
  tab that ever accrues attention is exactly that one. Existing `<all_urls>` host
  permission covers it. Chrome rate-limits to ~2 captures/sec; we're far under.
- **Timing is the crux: capture MUST happen mid-session.** Capturing at finalize is
  wrong, not just late — by the time `tab_hidden` fires, the *next* tab is visible
  and would be photographed instead.
- Hook: **on the first heartbeat** (~10s in — page painted, user demonstrably
  attending). Optional refresh on later heartbeats so SPAs show final state (last
  wins, same rule as title refresh).
- Elegant side effect: blips, bounces, and zero-attention sessions never get
  photographed — only pages that earned attention earn a picture.

### Downscale

- In the service worker, no DOM needed:
  `createImageBitmap(blob, {resizeWidth, resizeHeight})` → `OffscreenCanvas` →
  JPEG ~0.6 quality.
- Size to a **fixed target width (~480–640px)**, not screen-relative 0.25×0.25 —
  proportional sizing makes a 4K user pay 4× the disk of a laptop user for the
  same tooltip. Fixed width ≈ the intended 1/16 area on a typical screen, but
  predictable: **~20–40KB per snapshot**.

### Storage

- **Never inside SessionBlocks** — the sessions array is read in full on every
  render and Score-table click; embedded images would bloat every read. Separate
  keys: `snap:<sessionId>`, fetched lazily by the tooltip on hover.
- "Clear data" must delete snapshots too (same rule as the color registry).
- Quota: `chrome.storage.local` caps at 10MB. ~100 attended sessions/day × 30KB ≈
  3MB/day → full in ~3 days. Plan: add the `unlimitedStorage` permission (one
  manifest line) + a retention policy — prune a snapshot when its session ages out
  of the visible window (aligns with future day-paging).

### Display

- The tooltip gains an `<img>` slot above the text lines.
- Merged visit → the top-scoring member's snapshot (same page the click opens).
- No snapshot stored (never attended, capture failed) → tooltip shows text only.

### Failure modes (all soft — skip silently, tooltip just lacks an image)

- Minimized window / locked screen → `captureVisibleTab` throws.
- DRM video frames capture black.
- `file://` pages need the "allow file URLs" extension toggle.
- Incognito: extension not enabled there; nothing captured.

### Privacy note (recorded deliberately)

This puts images of everything browsed on disk. Fine for a personal experiment;
it is a real property change of the tool and is stated here and in the spec on
implementation.

## Knobs (decided by Scott, 2026-07-15)

1. **Capture cadence:** first heartbeat + refresh every ~60s, last wins. ✅
2. **Size:** fixed ~640px width. ✅
3. **`unlimitedStorage` permission:** yes, with the prune policy. ✅
4. **JPEG quality:** start 0.6, tune by eye against disk cost.

## Build order

1. Part 1 alone (uniform tooltip timing — already approved).
2. Manifest + capture + store on first heartbeat (verify snapshots exist via raw
   storage reads before any UI).
3. Tooltip `<img>` slot + lazy load.
4. Retention/pruning + Clear-data integration.
