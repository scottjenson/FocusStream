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
