# Ribbon view toggle: cards ⇄ blocks

**Status: proposal, not yet approved.** Written after confirming
(2026-08-12, live against real data) that the dormant block-ribbon path
(`paint()`/`layout()`/fence-stick/hour-axis/zoom, all in `timeline.js`)
still renders correctly — containers, hover tooltip (`#tip`), and zoom all
worked when `render()`/`relayout()` were temporarily forced onto it. That
derisks the biggest unknown; this plan covers only the switch mechanism.

## Goal

A header control in the dashboard that lets Scott flip between the two
ribbon renderers at will — the new Stack ribbon (`paintCards`/`cardLayout`,
live since Stage 1) and the old block ribbon (`paint`/`layout`, dormant
since 2026-08-11 but structurally untouched). Both consume the identical
`events`/`hostNames` from one thread assembly (`assembleThreads`/
`computeHostNames` in `render()`) — this is a rendering-layer fork, not a
data-model change. Nothing about capture, scoring, or thread/container
assembly is touched.

## Why a toggle, not a decision

Scott has found the Stack ribbon experiment worth keeping, but wants the
option to fall back to the old view rather than treat this as a one-way
migration. Framed as a standing feature, not a temporary A/B: no removal
date, no plan to delete either path.

## What's confirmed vs. what's still risk

**Confirmed low-risk (2026-08-12 test):** the old renderer itself works
end-to-end against current data — blocks, containers, fence/stick
collapsing, hour axis, `#tip` hover tooltip, and zoom all rendered
correctly when forced live for a manual pass.

**Real integration risk, identified by reading the code (not yet built
around):**

1. **DOM leakage.** `blockEls` and `cardEls` (`timeline.js:1608`,
   `timeline.js:2584`) are separate `Map`s; neither renderer's paint
   function removes the other's elements — only `.transient` nodes (gap
   plates, hour ticks) get swept by both. `paintCards`'s own comment
   (`timeline.js:3009`) flags this exact gap: *"the .transient sweep
   still clears any leftover nodes from the old paint() path in case both
   ever ran against the same #ribbon (they don't, but this keeps the DOM
   honest if that ever changes)."* A mode switch must explicitly tear
   down the outgoing mode's persistent elements before the incoming mode
   paints.
2. **Two incompatible `#ribbon` height-setters.** `paint()` sets
   `TITLE_AREA + BAND_H + AXIS_AREA`; `paintCards()` sets
   `maxH + CARD_HOVER_TEXT_H` (skipped while a card is expanded). A mode
   switch needs a full repaint, not a visibility toggle.
3. **Two independent expand-state variables.** `expandedKey` (old fence
   expand, `timeline.js:1614`) and `cardExpandedKey` (new card expand,
   `timeline.js:2591`) don't collide structurally, but neither resets on
   a mode switch today. Switching modes while one is non-null needs an
   explicit reset (and DOM close) or stale state bleeds into the next
   paint.
4. **`relayout()` (zoom) hardcodes `paintCards`.** Needs the same branch
   as `render()`. Old-mode zoom is a real feature (`PX_PER_SEC`/
   `GAP_HOUR_PX` scaling per spec §6) — confirmed working in the manual
   test, but worth a repeat smoke-test once wired through the toggle
   rather than the temporary hardcode.
5. **Hover/tooltip system is genuinely two parallel systems**, as
   suspected going in: `#tip` + `quickLabel` (old) vs. `cardHoverText`
   (new), routed by one shared `pointerover` handler on `#ribbon`
   (`timeline.js:2006`) that class-sniffs `isCard`/`isChildThumb` to pick
   a target. This already coexists safely in the file today because only
   one mode's elements exist in the DOM at a time (item 1's fix). Once
   DOM separation is correct, the existing routing should Just Work — old
   non-card elements fall through to `#tip`/`quickLabel` exactly as
   pre-Stack-ribbon. No new CSS/parallel styling needed *if* item 1 is
   done right; this was the main thing worth verifying rather than
   assuming, and reading the handler confirms it's classed on element
   type, not on some card-only global flag.

## Proposed mechanism

**State:** one module-level variable in `timeline.js`, e.g. `let
ribbonMode = "cards"` (or `"blocks"`), initialized from
`localStorage.getItem("fs_ribbon_mode")` (viewing preference, same
category as `zoom` — persists across reload but isn't part of a day's
data, so `localStorage` rather than `chrome.storage.local`).

**Branch points** (two, matching the two hardcoded calls found above):

```js
// render()
if (ribbonMode === "cards") paintCards(events, hostNames);
else paint(events, hostNames);

// relayout()
if (ribbonMode === "cards") paintCards(lastAssembly.events, lastAssembly.hostNames);
else paint(lastAssembly.events, lastAssembly.hostNames);
```

**Mode-switch function** (new), called by the header control's click
handler — NOT just a re-render:

```js
function setRibbonMode(mode) {
  if (mode === ribbonMode) return;
  // Close any open expand state in the outgoing mode.
  if (expandedKey !== null) collapseFence();       // old-mode fence
  if (cardExpandedKey !== null) closeExpandedCard(); // new-mode card
  // Tear down the outgoing mode's persistent DOM — the leak in risk #1.
  const outgoing = mode === "cards" ? blockEls : cardEls;
  for (const el of outgoing.values()) el.remove();
  outgoing.clear();
  ribbonMode = mode;
  localStorage.setItem("fs_ribbon_mode", mode);
  if (lastAssembly) render(lastAssembly.sessions); // full repaint, not relayout
}
```

Using `render()` (full repaint) rather than `relayout()` on switch is
deliberate — `relayout()` is the cheap zoom-only path that skips
thread/container reassembly and expects `lastAssembly` to already be
correct for the target mode's layout math; a mode switch should behave
like fresh data, not a zoom tick.

**Header control:** a button pair or single toggle button next to
`#scores`/`#clear` in `dashboard/index.html`'s `<header>`, e.g.:

```html
<button id="ribbon-mode-toggle">Classic view</button>
```

wired in `dashboard.js` next to the existing `#scores`/`#clear` handlers,
toggling label text ("Classic view" ⇄ "Card view") to always name the
mode you'd switch *to*, matching the existing button-label convention in
that header.

## Explicitly out of scope

- No change to thread/container/score assembly.
- No attempt to unify or share CSS between the two hover systems — they
  stay genuinely parallel, coexisting via DOM separation as they already
  do today.
- No deletion of either code path — both stay permanently live, not a
  migration.
- Week strip, search, Score table, Clear data — untouched.

## Default

Confirmed with Scott (2026-08-12): defaults to `"cards"` on any missing or
invalid stored value — fresh install, cleared `localStorage`, or a
corrupted value all fall back to the currently-shipped experience.

## When this ships

Per CLAUDE.md's doc map: this plan is not spec content. If approved and
built, `spec/display.md` §6 gets a short new rule describing the toggle
as a standing feature (not "Stack ribbon replaces block ribbon" framing,
since both now permanently coexist), and `HISTORY.md` gets a one-line
pointer. This file (`plans/ribbon-toggle.md`) can then be trimmed/struck,
matching how `plans/stack-ribbon.md` is being handled per-stage.
