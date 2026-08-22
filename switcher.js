// FocusStream Active Tab Manager — Phase 1 live tab strip (spec §7).
//
// Scope invariant: this file is a pure display layer over tab state
// background.js already observes for session-lifecycle purposes (spec §3).
// It never touches capture (heartbeats, SessionBlocks, Score v1) and never
// calls chrome.tabs.* itself — a tile click only ever posts a message; the
// background script is the one place with the actual capability. No
// scoring, no eviction, no persistence beyond what's needed to paint the
// strip. (decisions/tabmanager.md)

(() => {
  const log = (...args) => console.log("[FS switcher]", ...args);

  // Top-frame only (spec §7) — a strip rendered inside an iframe would be a
  // bug, not a feature. Mirrors content.js's own top/subframe split, just
  // gating the opposite direction.
  if (window !== window.top) return;

  // Duplicate-injection guard, same pattern as content.js's __fsLoaded: the
  // manifest injects on load AND the background injects into existing tabs
  // on install/reload — a tab caught between the two would otherwise mount
  // two strips.
  if (window.__fsSwitcherLoaded) {
    log("duplicate injection skipped on", location.href);
    return;
  }
  window.__fsSwitcherLoaded = true;

  const STRIP_HEIGHT = "34px";

  // Fixed overlay + html margin-top compensation (spec §7 placement rule,
  // revised 2026-08-21 — see decisions/tabmanager.md, "Voice fixed-root
  // specimen"). Plain push-down (a normal in-flow first child) silently
  // fails on any site whose own app root is position:fixed/absolute over
  // the full viewport (Google Voice confirmed as a specimen) — the strip
  // is mounted correctly but invisible, painted under the site's own
  // fixed shell. A fixed strip is visible everywhere unconditionally;
  // the accompanying `html { margin-top }` override keeps every
  // static-flow site (Gmail, Calendar, most of the web) pushed down
  // exactly as before, pixel-identical to the old push-down behavior.
  // Residual case: on a fixed-root site, `margin-top` doesn't move
  // position:fixed elements, so that site's own top ~34px still sits
  // under the strip — deliberately accepted for Phase 1, not patched
  // (WATCHLIST.md "switcher-fixed-root-overlap").
  const host = document.createElement("div");
  host.id = "fs-switcher-host";
  // Only the box the host itself occupies is set on the light-DOM side —
  // everything visual lives inside the shadow root, isolated from the
  // host page's own CSS.
  host.style.cssText = `all: initial; position: fixed; top: 0; left: 0; right: 0; height: ${STRIP_HEIGHT}; z-index: 2147483647;`;

  // Compensating margin on the real page's own <html> — a separate,
  // light-DOM style element (shadow DOM CSS can't reach outside its own
  // host). !important because sites commonly set their own margin/height
  // on html/body and would otherwise win the cascade.
  const marginStyle = document.createElement("style");
  marginStyle.id = "fs-switcher-margin-style";
  marginStyle.textContent = `html { margin-top: ${STRIP_HEIGHT} !important; }`;

  function mount() {
    document.documentElement.appendChild(host);
    document.head.appendChild(marginStyle);
  }
  if (document.head) {
    mount();
  } else {
    // document_idle should always have a body, but fail safe rather than
    // throw if some site's timing is unusual.
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  }

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  // Visual target (this session): approximate Chrome's own light-theme tab
  // strip as a starting point — real Chrome-tab colors/shape, not a
  // FocusStream-branded look. Expected to change once Phase 1 is live and
  // judged against the real thing.
  style.textContent = `
    :host { all: initial; }
    .fs-strip {
      display: flex;
      align-items: flex-end;
      height: ${STRIP_HEIGHT};
      box-sizing: border-box;
      padding: 4px 4px 0 4px;
      gap: 2px;
      background: #dee1e6;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      font-size: 12px;
      overflow-x: auto;
      overflow-y: hidden;
      white-space: nowrap;
    }
    .fs-strip::-webkit-scrollbar { height: 0; }
    .fs-tab {
      display: flex;
      align-items: center;
      flex: none;
      gap: 6px;
      height: 30px;
      min-width: 72px;
      max-width: 180px;
      padding: 0 10px;
      border-radius: 8px 8px 0 0;
      background: transparent;
      color: #3c4043;
      cursor: pointer;
      overflow: hidden;
      box-sizing: border-box;
    }
    .fs-tab.active { background: #ffffff; color: #000000; }
    .fs-tab:hover:not(.active) { background: rgba(255, 255, 255, 0.55); }
    .fs-favicon { width: 16px; height: 16px; flex: none; border-radius: 2px; }
    .fs-favicon.placeholder { background: #9aa0a6; }
    .fs-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;
  const strip = document.createElement("div");
  strip.className = "fs-strip";
  shadow.append(style, strip);

  function render(tabs) {
    strip.replaceChildren();
    for (const t of tabs) {
      const tile = document.createElement("div");
      tile.className = "fs-tab" + (t.active ? " active" : "");
      tile.title = t.title || t.url || "";

      if (t.favIconUrl) {
        const icon = document.createElement("img");
        icon.className = "fs-favicon";
        icon.src = t.favIconUrl;
        // A dead favicon URL shouldn't leave a broken-image glyph in a tab
        // strip meant to look native.
        icon.addEventListener("error", () => icon.remove(), { once: true });
        tile.append(icon);
      } else {
        const placeholder = document.createElement("span");
        placeholder.className = "fs-favicon placeholder";
        tile.append(placeholder);
      }

      const title = document.createElement("span");
      title.className = "fs-title";
      title.textContent = t.title || t.url || "(untitled)";
      tile.append(title);

      tile.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "FS_SWITCH_TAB", tabId: t.id }).catch((e) => {
          log("switch request failed:", e.message);
        });
      });

      strip.append(tile);
    }
  }

  // Live updates: background.js broadcasts on every tabs.on{Created,Removed,
  // Activated,Updated} for this tab's window (event-driven, no polling —
  // spec §7 data-flow rule).
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "FS_TABS_UPDATE") return;
    render(msg.tabs);
  });

  // Initial paint: a freshly-injected strip has missed every past broadcast,
  // so it has to ask for the current state once on load rather than wait.
  chrome.runtime.sendMessage({ type: "FS_GET_TABS" }).then((res) => {
    if (res?.tabs) render(res.tabs);
  }).catch((e) => {
    log("initial tab fetch failed:", e.message);
  });

  log("mounted on", location.href);
})();
