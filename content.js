// FocusStream content script — 10-second activity heartbeat.
//
// Signals come in two kinds (see spec "The 10-Second Heartbeat"):
//   - Discrete (numbers): raw event counts per window — intensity matters,
//     so 12 copies records as 12. Counts only; never keystroke identity or
//     clipboard contents.
//   - Continuous (booleans): active/inactive per window — mousemove fires
//     ~60+ events/sec and a wheel flick emits dozens, so raw counts would
//     measure hardware sampling, not attention.
//
// Active windows send one heartbeat carrying the snapshot; quiet windows
// send nothing (the background derives duration from timestamps, so silence
// carries no information and would only wake the service worker).

(() => {
  const log = (...args) => console.log("[FS content]", ...args);

  // Duplicate-injection guard (spec "Dev Workflow"): the manifest injects on
  // page load AND the background injects into existing tabs on install/
  // reload — a tab that finishes loading between the two gets both, and two
  // live instances double-count every signal. Same-lifetime copies share
  // this isolated world; an extension reload creates a fresh world, so the
  // guard never blocks re-injection (the orphan tears itself down below).
  if (window.__fsLoaded) {
    log("duplicate injection skipped on", location.href);
    return;
  }
  window.__fsLoaded = true;

  const HEARTBEAT_MS = 10_000;
  const RELAY_MS = 1_000;

  // Iframe relay (spec §3, 2026-07-18): input events never cross frame
  // boundaries, and app plumbing lives in same-origin subframes (Google
  // Docs types into a hidden about:blank iframe; Slides presents in one).
  // A subframe instance counts its own input and forwards batched totals
  // to the top frame — which stays the SOLE heartbeat sender. Cross-origin
  // frames (ads) self-destruct at birth: no listeners, no messages, and no
  // log line (a 12-ad blog would otherwise announce 12 stillbirths).
  if (window !== window.top) {
    let topOrigin;
    try {
      topOrigin = window.top.location.origin; // throws for cross-origin frames
    } catch {
      return;
    }
    const batch = { keyboard: 0, click: 0, cut: 0, copy: 0, paste: 0, mouse: false, scroll: false };
    const relayCtrl = new AbortController();
    const relayOpts = { capture: true, passive: true, signal: relayCtrl.signal };
    window.addEventListener("keydown", () => batch.keyboard++, relayOpts);
    window.addEventListener("mousedown", () => batch.click++, relayOpts);
    window.addEventListener("cut", () => batch.cut++, relayOpts);
    window.addEventListener("copy", () => batch.copy++, relayOpts);
    window.addEventListener("paste", () => batch.paste++, relayOpts);
    window.addEventListener("mousemove", () => (batch.mouse = true), relayOpts);
    window.addEventListener("wheel", () => (batch.scroll = true), relayOpts);
    window.addEventListener("scroll", () => (batch.scroll = true), relayOpts);
    const flush = () => {
      if (!Object.values(batch).some((v) => v === true || v > 0)) return;
      const signals = { ...batch };
      for (const k in batch) batch[k] = typeof batch[k] === "number" ? 0 : false;
      // file:// pages serialize origin as "null", which postMessage rejects
      // as a targetOrigin — fall back to "*" (payload is bare counts).
      window.top.postMessage({ __fsRelay: true, signals }, topOrigin === "null" ? "*" : topOrigin);
    };
    const relayId = setInterval(() => {
      if (!chrome.runtime?.id) {
        // Orphaned by an extension reload: same self-destruct as the top
        // instance, minus the log (no chrome context left to matter).
        clearInterval(relayId);
        relayCtrl.abort();
        return;
      }
      flush();
    }, RELAY_MS);
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "hidden") flush();
      },
      { signal: relayCtrl.signal }
    );
    log("relay frame loaded on", location.href);
    return;
  }

  const activity = {
    // discrete — raw event counts
    keyboard: 0,
    click: 0,
    cut: 0,
    copy: 0,
    paste: 0,
    // continuous — active-this-window flags
    mouse: false,
    scroll: false,
    media: false,
  };

  // Every listener registers through this controller so teardown() can
  // remove them all at once. Without it, an instance orphaned by an
  // extension reload kept its timer + eight listeners running forever —
  // a dev day of reloads left one zombie per reload in every open tab.
  const ctrl = new AbortController();
  // capture:true so we still see events that page code stops from bubbling,
  // and so scroll events on inner containers (which don't bubble) reach us.
  const opts = { capture: true, passive: true, signal: ctrl.signal };
  window.addEventListener("keydown", () => activity.keyboard++, opts);
  window.addEventListener("mousedown", () => activity.click++, opts);
  window.addEventListener("cut", () => activity.cut++, opts);
  window.addEventListener("copy", () => activity.copy++, opts);
  window.addEventListener("paste", () => activity.paste++, opts);
  window.addEventListener("mousemove", () => (activity.mouse = true), opts);
  window.addEventListener("wheel", () => (activity.scroll = true), opts);
  window.addEventListener("scroll", () => (activity.scroll = true), opts);

  // Fold relayed subframe counts in as if they were local events (spec §3
  // iframe relay). Origin gate only: the page could already spoof our local
  // listeners with synthetic events, so heavier auth on the relay would
  // guard a door standing next to an open one.
  window.addEventListener(
    "message",
    (e) => {
      if (!e.data || e.data.__fsRelay !== true || e.origin !== location.origin) return;
      const s = e.data.signals || {};
      for (const k of ["keyboard", "click", "cut", "copy", "paste"]) {
        if (s[k]) activity[k] += s[k];
      }
      for (const k of ["mouse", "scroll"]) {
        if (s[k]) activity[k] = true;
      }
    },
    { signal: ctrl.signal }
  );

  function teardown(why) {
    clearInterval(intervalId);
    ctrl.abort();
    log(`torn down (${why}) on`, location.href);
  }

  // Passive video consumption (spec Edge Case 1): sampled at each tick rather
  // than event-driven. Top-frame only — cross-origin iframe players unseen.
  function checkMedia() {
    for (const v of document.querySelectorAll("video")) {
      if (!v.paused) {
        activity.media = true;
        return;
      }
    }
  }

  function anyActive() {
    return Object.values(activity).some((v) => v === true || v > 0);
  }

  function resetActivity() {
    for (const key in activity) {
      activity[key] = typeof activity[key] === "number" ? 0 : false;
    }
  }

  function sendHeartbeat(why) {
    const snapshot = { ...activity };
    resetActivity();
    const message = {
      type: "heartbeat",
      signals: snapshot,
      // Recomputed each heartbeat: SPAs change page height (spec Edge Case 2).
      scrollable: document.documentElement.scrollHeight > window.innerHeight,
      // "interval" | "flush-on-hidden" — the background must NOT snapshot on
      // flush: it fires exactly while the next tab becomes visible, and
      // captureVisibleTab would photograph the wrong page (spec §6 snapshots).
      reason: why,
    };
    try {
      chrome.runtime.sendMessage(message).then(
        () => log(`heartbeat sent (${why})`, snapshot),
        (e) => log("heartbeat send failed:", e.message)
      );
    } catch (e) {
      // Extension reloaded out from under this page: this instance is an
      // orphan. Self-destruct — the new extension instance injects a fresh
      // copy on its own.
      teardown("extension context gone: " + e.message);
    }
  }

  const intervalId = setInterval(() => {
    // chrome.runtime.id vanishes when the extension is reloaded/removed —
    // catches orphaning even during quiet stretches that never send.
    if (!chrome.runtime?.id) return teardown("extension context gone");
    if (document.visibilityState !== "visible") return;
    checkMedia();
    if (anyActive()) {
      sendHeartbeat("interval");
    } else {
      log("quiet window, nothing sent");
    }
  }, HEARTBEAT_MS);

  // Flush a partial window the moment the tab is hidden (switch/close), so
  // the last few seconds of activity aren't lost. sendMessage wakes the
  // service worker if it's asleep.
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState !== "hidden") return;
      checkMedia();
      if (anyActive()) {
        sendHeartbeat("flush-on-hidden");
      }
    },
    { signal: ctrl.signal }
  );

  log("loaded on", location.href);
})();
