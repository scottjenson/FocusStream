// FocusStream Active Tab Manager — Phase 1 live tab strip (spec §7) +
// Phase 2 ribbon overlay (spec §7b).
//
// Scope invariant: this file is a pure display layer over tab state
// background.js already observes for session-lifecycle purposes (spec §3).
// It never touches capture (heartbeats, SessionBlocks, Score v1) and never
// calls chrome.tabs.* itself — a click only ever posts a message; the
// background script is the one place with the actual capability. No
// scoring, no eviction, no persistence beyond what's needed to paint.
// (decisions/tabmanager.md)
//
// UNIFIED 2026-08-22 (decisions/tabmanager.md "Open-tabs/history
// unification"): this file renders nothing of its own and no longer calls
// a separate open-tabs pipeline either — every paint (collapsed or
// expanded) goes through dashboard/timeline.js's ONE real ribbon pipeline
// (render/assembleThreads/parseSessions/layout/paint), right-anchored to
// "now" so today's open tabs sit at the ribbon's right edge like any
// other recent activity, with real history to their left. Expanding/
// collapsing is a HEIGHT-ONLY change (timeline.js's heightMode: "uniform"
// vs "tiered") on the identical .blk elements — horizontal geometry
// (zoom/PX_PER_SEC) is untouched by expand/collapse, only by the ribbon's
// own wheel-zoom handler once expanded (Scott, 2026-08-22: "expand does
// not change the zoom level... does not change zoom, only vertical
// reveal"). Plain content script (no "type": "module" support for
// content_scripts in MV3), so the ES-module ribbon files are loaded via
// dynamic import() on demand, not a static <script type="module">.

(() => {
  const log = (...args) => console.log("[FS switcher]", ...args);

  // Top-frame only (spec §7) — a strip rendered inside an iframe would be a
  // bug, not a feature. Mirrors content.js's own top/subframe split, just
  // gating the opposite direction.
  if (window !== window.top) return;

  // Duplicate-injection guard, same pattern as content.js's __fsLoaded: the
  // manifest injects on load AND the background injects into existing tabs
  // on install/reload — a tab caught between the two would otherwise mount
  // two hosts.
  if (window.__fsSwitcherLoaded) {
    log("duplicate injection skipped on", location.href);
    return;
  }
  window.__fsSwitcherLoaded = true;

  const STRIP_HEIGHT_PX = 34;

  // Fixed overlay + html margin-top compensation (spec §7 placement rule,
  // 2026-08-21 — see decisions/tabmanager.md, "Voice fixed-root
  // specimen"). Plain push-down (a normal in-flow first child) silently
  // fails on any site whose own app root is position:fixed/absolute over
  // the full viewport (Google Voice confirmed as a specimen). A fixed host
  // is visible everywhere unconditionally; the accompanying
  // `html { margin-top }` override keeps every static-flow site (Gmail,
  // Calendar, most of the web) pushed down exactly as before. Residual
  // case: on a fixed-root site, `margin-top` doesn't move position:fixed
  // elements, so that site's own top ~34px still sits under the host —
  // deliberately accepted, not patched (WATCHLIST.md
  // "switcher-fixed-root-overlap").
  //
  // ONE host now (2026-08-22 rework), not two — collapsed and expanded are
  // the same shadow tree at two different heights (STRIP_HEIGHT_PX vs the
  // ribbon's real content height), not two separate surfaces. Height
  // itself is part of what animates (2026-08-21 discussion: "the bar
  // itself will animate as well... the bar will open").
  const host = document.createElement("div");
  host.id = "fs-switcher-host";
  host.style.cssText = `all: initial; position: fixed; top: 0; left: 0; right: 0; height: ${STRIP_HEIGHT_PX}px; overflow: hidden; z-index: 2147483647; transition: height 0.3s;`;

  const marginStyle = document.createElement("style");
  marginStyle.id = "fs-switcher-margin-style";
  marginStyle.textContent = `html { margin-top: ${STRIP_HEIGHT_PX}px !important; }`;

  function mount() {
    document.documentElement.appendChild(host);
    document.head.appendChild(marginStyle);
  }
  if (document.head) {
    mount();
  } else {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  }

  const shadow = host.attachShadow({ mode: "open" });

  // Real <body> wrapper (2026-08-21 first-run bug, carried into this
  // rework): timeline.css's base rule is `body { font-family/background/
  // color/color-scheme }` — nearly every other rule in that file only sets
  // ITS OWN specific properties and relies on inheriting font-family/color
  // from body. A shadow root has no implicit <body>; without one, that
  // whole rule matches nothing and every element falls back to the
  // browser's default (serif) UI font. A real <body>-tagged element as the
  // shadow root's one child makes timeline.css behave identically to how
  // it behaves on the real dashboard page.
  const body = document.createElement("body");
  // height: 100% (2026-08-22 fix): timeline.css's #ribbon-wrap sets its own
  // height: 100% to fill whatever contains it — true on the real dashboard
  // page (normal document flow, height driven by content) but this <body>
  // is a plain static shadow-root child with no height of its own, so with
  // nothing here that percentage resolved against nothing and collapsed
  // the whole ribbon to invisible. `host` (this file, syncHostHeight) is
  // the one place that already tracks real content height, so body just
  // needs to fill it.
  body.style.cssText = "margin: 0; height: 100%; overflow: hidden;";
  shadow.appendChild(body);

  // dashboard/index.html's own layout (header, week-strip, search) is NOT
  // reproduced here — spec §7b scope is just the ribbon itself
  // (#ribbon-wrap/#ribbon/#ribbon-empty), the only IDs timeline.js's qs()
  // calls actually need. day-paging's week-strip element still needs to
  // exist (renderWeekStrip() unconditionally calls qs("week-strip")) even
  // though it's never shown — hidden, not omitted.
  const ribbonWrap = document.createElement("div");
  ribbonWrap.id = "ribbon-wrap";
  // padding: 0 (2026-08-22 fix): timeline.css's #ribbon-wrap rule carries
  // `padding: 8px 16px`, sized for the full dashboard page — inside the
  // 30-34px collapsed strip that ate most of the box, clipping/pushing the
  // .blk tiles so only a sliver (or the label alone) showed. Inline style
  // here wins over the stylesheet rule for the properties it sets; the
  // real dashboard page's own #ribbon-wrap is untouched (separate element,
  // this padding: 0 only applies to this shadow-root copy).
  ribbonWrap.style.cssText =
    "position: relative; width: 100%; height: 100%; overflow-x: auto; overflow-y: hidden; padding: 0;";
  const ribbonEl = document.createElement("div");
  ribbonEl.id = "ribbon";
  const emptyEl = document.createElement("div");
  emptyEl.id = "ribbon-empty";
  emptyEl.hidden = true;
  const weekStripEl = document.createElement("div");
  weekStripEl.id = "week-strip";
  weekStripEl.hidden = true;
  // Explicit inline display:none, not just the `hidden` attribute
  // (2026-08-22 fix): timeline.css's `#week-strip { display: flex; ... }`
  // is an ID selector, which beats the `hidden` attribute's own (very low
  // specificity) UA-stylesheet rule — so despite `hidden` being set,
  // week-strip was still rendering at its flex height (~22px) as the
  // first child of `body`, pushing #ribbon-wrap down by that much inside
  // body's fixed 34px box and clipping it. Inline style wins over any
  // stylesheet rule regardless of selector specificity.
  weekStripEl.style.display = "none";
  ribbonWrap.append(ribbonEl, emptyEl);
  body.append(weekStripEl, ribbonWrap);

  // Collapse control — hover-revealed, top-right, matches the existing
  // "many ways to close" convention (dashboard/index.html's .card-close).
  // Escape is the other way.
  const collapseBtn = document.createElement("div");
  collapseBtn.id = "fs-collapse";
  collapseBtn.textContent = "×";
  collapseBtn.title = "Collapse";
  collapseBtn.style.cssText =
    "all: initial; position: absolute; top: 6px; right: 12px; width: 24px; height: 24px; border-radius: 50%; background: rgba(0,0,0,0.5); color: #fff; font: 16px/24px -apple-system, sans-serif; text-align: center; cursor: pointer; z-index: 10; display: none;";
  collapseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    collapse();
  });
  body.appendChild(collapseBtn);

  // Dedicated expand affordance (2026-08-22 fix — real bug, not a design
  // choice: the strip's own empty background used to BE the click target,
  // which meant almost any click anywhere in the 34px bar outside a narrow
  // ~96px tile — the vast majority of a full-viewport-width bar — expanded
  // it. A small, deliberate caret is a much smaller, much harder-to-hit-
  // by-accident target, same shape as Phase 1's original expand button.
  const expandBtn = document.createElement("div");
  expandBtn.id = "fs-expand";
  expandBtn.textContent = "▾";
  expandBtn.title = "Open zoomed ribbon view";
  expandBtn.style.cssText =
    "all: initial; position: absolute; top: 6px; right: 12px; width: 24px; height: 24px; border-radius: 4px; background: rgba(255,255,255,0.12); color: #d8dce2; font: 12px/24px -apple-system, sans-serif; text-align: center; cursor: pointer; z-index: 10;";
  expandBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    expand().catch((err) => log("expand failed:", err.message));
  });
  body.appendChild(expandBtn);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && expanded) collapse();
  });

  // --- Module loading (spec §7b) ---------------------------------------
  //
  // ES modules can't be statically imported by a content script (MV3 has
  // no "type": "module" for content_scripts) — loaded once, lazily, via
  // dynamic import(), on first expand. shared/transit.js MUST load first:
  // assembly.js/timeline.js both read the bare global window.FS_TRANSIT (a
  // side effect that file sets on import), not a named import —
  // dashboard/index.html gets this ordering for free from a separate
  // <script> tag loaded before the module scripts; a dynamically-imported
  // module graph has no such tag, so it's imported explicitly, first,
  // here. Declared in manifest.json's web_accessible_resources.
  const RIBBON_CSS_URL = chrome.runtime.getURL("dashboard/timeline.css");
  const RIBBON_JS_URL = chrome.runtime.getURL("dashboard/timeline.js");
  const TRANSIT_JS_URL = chrome.runtime.getURL("shared/transit.js");
  let moduleLoaded = false;

  async function ensureModuleLoaded() {
    if (moduleLoaded) return;
    const cssText = await fetch(RIBBON_CSS_URL).then((r) => r.text());
    const styleEl = document.createElement("style");
    styleEl.textContent = cssText;
    shadow.prepend(styleEl);

    // window.__fsTimelineRoot/__fsTimelineMode/__fsTimelineAnchor/
    // __fsHeightMode are read by timeline.js at MODULE-INIT time — must be
    // set synchronously before import() starts executing the module body.
    // __fsTimelineMode forces "blocks" (Classic view/.blk) — the target is
    // the genuinely zoom-reactive ribbon, not paintCards()/.card
    // (confirmed zoom-inert, fixed tier width — decisions/tabmanager.md
    // "Retargeted mid-build"). __fsTimelineAnchor "right" (2026-08-22
    // unification): today's open tabs sit at the ribbon's RIGHT edge,
    // pinned to "now" — the same right-anchor scaffolding render() already
    // had, unused until this overlay started calling the real pipeline.
    // __fsHeightMode starts "uniform" — this view mounts collapsed.
    window.__fsTimelineRoot = shadow;
    window.__fsTimelineMode = "blocks";
    window.__fsTimelineAnchor = "right";
    window.__fsHeightMode = "uniform";
    await import(TRANSIT_JS_URL);
    await import(RIBBON_JS_URL);
    moduleLoaded = true;
  }

  // --- Live tab list + open-tabs render -----------------------------------
  //
  // One source of truth for "what's currently drawn." paintRibbon() is the
  // ONLY paint path now (2026-08-22 unification) — collapsed vs. expanded
  // is a heightMode toggle inside timeline.js's own paint(), not a
  // different function to call here.
  let latestTabs = [];

  async function paintRibbon() {
    if (!moduleLoaded) return;
    const { sessions = [] } = await chrome.storage.local.get("sessions");
    window.FS_renderOpenTabs?.(latestTabs, sessions);
  }

  // --- Expand / collapse -------------------------------------------------
  //
  // HEIGHT ONLY (2026-08-22 unification, Scott: "expand does not change
  // the zoom level... only vertical reveal"). The animation IS the height
  // change on `host` (CSS transition, above) plus each .blk's own
  // left/top/width/height transition (timeline.css) firing because
  // heightMode flips inside the SAME paint() call on the SAME keyed
  // elements — horizontal geometry (zoom/PX_PER_SEC) is never touched
  // here; only the ribbon's own wheel-zoom handler (timeline.js) changes
  // it, and only once expanded (see the wheel listener gate there).
  let expanded = false;

  async function expand() {
    if (expanded) return;
    expanded = true;
    try {
      await ensureModuleLoaded();
    } catch (e) {
      log("ribbon module load failed:", e.message);
      expanded = false;
      return;
    }
    expandBtn.style.display = "none";
    collapseBtn.style.display = "flex";
    window.setHeightMode?.("tiered");
    // Height follows content: the ribbon's real bottom-flush geometry
    // determines how tall #ribbon actually painted itself to —
    // #ribbon-wrap and `host` both track it via ResizeObserver rather than
    // a hardcoded "full viewport" height, so the host is exactly as tall
    // as its content, never more (2026-08-22: "the animation should just
    // be that the tab view gets taller, more or less").
    syncHostHeight();
  }

  function collapse() {
    if (!expanded) return;
    expanded = false;
    collapseBtn.style.display = "none";
    expandBtn.style.display = "block";
    window.setHeightMode?.("uniform");
    syncHostHeight();
  }

  function syncHostHeight() {
    const h = Math.max(STRIP_HEIGHT_PX, ribbonEl.offsetHeight);
    host.style.height = h + "px";
  }
  // #ribbon's own height changes as a direct style write inside paint()
  // (timeline.js) — observe it rather than re-deriving the same geometry
  // math here a second time.
  new ResizeObserver(syncHostHeight).observe(ribbonEl);

  // --- Live tab-list updates ---------------------------------------------
  //
  // background.js broadcasts on every tabs.on{Created,Removed,Activated,
  // Updated} for this tab's window (event-driven, no polling — spec §7
  // data-flow rule). One paint path now regardless of expand state
  // (2026-08-22 unification) — heightMode (already set) decides how it
  // looks, paintRibbon() itself is the same call either way.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "FS_TABS_UPDATE") return;
    latestTabs = msg.tabs;
    paintRibbon().then(syncHostHeight);
  });

  // Initial paint: a freshly-injected host has missed every past
  // broadcast, so it has to ask for the current state once on load. Mounts
  // collapsed (__fsHeightMode "uniform", set in ensureModuleLoaded above).
  chrome.runtime.sendMessage({ type: "FS_GET_TABS" }).then(async (res) => {
    latestTabs = res?.tabs || [];
    await ensureModuleLoaded();
    await paintRibbon();
    syncHostHeight();
  }).catch((e) => {
    log("initial tab fetch failed:", e.message);
  });

  log("mounted on", location.href);
})();
