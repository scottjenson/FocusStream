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

const log = (...args) => console.log("[FS content]", ...args);

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

// capture:true so we still see events that page code stops from bubbling,
// and so scroll events on inner containers (which don't bubble) reach us.
const opts = { capture: true, passive: true };
window.addEventListener("keydown", () => activity.keyboard++, opts);
window.addEventListener("mousedown", () => activity.click++, opts);
window.addEventListener("cut", () => activity.cut++, opts);
window.addEventListener("copy", () => activity.copy++, opts);
window.addEventListener("paste", () => activity.paste++, opts);
window.addEventListener("mousemove", () => (activity.mouse = true), opts);
window.addEventListener("wheel", () => (activity.scroll = true), opts);
window.addEventListener("scroll", () => (activity.scroll = true), opts);

// Passive video consumption (spec Edge Case 1): sampled at each tick rather
// than event-driven. Top-frame only — cross-origin iframe players unseen.
function checkMedia() {
  if (Array.from(document.querySelectorAll("video")).some((v) => !v.paused)) {
    activity.media = true;
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
  };
  try {
    chrome.runtime.sendMessage(message).then(
      () => log(`heartbeat sent (${why})`, snapshot),
      (e) => log("heartbeat send failed:", e.message)
    );
  } catch (e) {
    // Extension was reloaded out from under this page; harmless.
    log("extension context gone:", e.message);
  }
}

setInterval(() => {
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
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") return;
  checkMedia();
  if (anyActive()) {
    sendHeartbeat("flush-on-hidden");
  }
});

log("loaded on", location.href);
