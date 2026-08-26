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

  // Same "one heartbeat window" concept as shared/transit.js's TRANSIT_MS
  // and background.js's HB_WINDOW_MS — kept as its own constant because
  // this isolated content-script world has no access to shared/transit.js
  // (rules audit). If it ever needs to change, change it there
  // too — the three currently agree by convention, not by reference.
  const HEARTBEAT_MS = 10_000;
  const RELAY_MS = 1_000;

  // Pure-modifier keydowns don't count (spec §3): a lone
  // modifier press is half a chord, not typing — the chord's action key
  // still counts, so Cmd+W is exactly one keystroke, not two.
  const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift"]);

  // Iframe relay (spec §3): input events never cross frame
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
    let relayLastKeyTs = 0;
    window.addEventListener(
      "keydown",
      (e) => {
        if (MODIFIER_KEYS.has(e.key)) return;
        batch.keyboard++;
        relayLastKeyTs = Date.now();
      },
      relayOpts
    );
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
      window.top.postMessage(
        { __fsRelay: true, signals, lastKeyTs: relayLastKeyTs || undefined },
        topOrigin === "null" ? "*" : topOrigin
      );
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
  // Terminal-keystroke evidence (spec §3): remember WHEN the
  // last counted keydown landed, so flush-on-hidden can report how close
  // it sat to the session's death. Evidence only — the judgment (transit
  // filter's terminal discount) is display-side.
  let lastKeyTs = 0;

  // Snapshot cue (spec §6 snapshot unification): the moment a
  // transit-qualifying signal lands (keyboard/cut/copy/paste — the
  // shared/transit.js list; downloads are background-observed), tell the
  // background to capture NOW, while this tab is still on glass — sub-10s
  // engaged sessions die before their first interval heartbeat. One cue
  // per heartbeat window (re-armed on each send, so a fresh session on
  // this same page — SPA nav, idle split — can cue again); the background
  // dedupes with the session's `snapped` flag.
  // Page text (stage 1 — search prototype, plain text, no privacy hardening
  // yet; see decisions/capture_design.md). Extracted at most once per
  // session, on the same trigger as the snapshot, so it rides a message we
  // are already sending. Runs Readability against a CLONE of the document
  // (the library mutates whatever it is given) so the live page is never
  // touched. Top frame only: no cross-frame stitching yet.
  //
  // Re-armed per navigation by tracking last-seen location.href, NOT by a
  // closure flag alone: this content-script instance survives SPA
  // navigations, but each nav is its own session (background.js's
  // SPA-debounce split), so a bare flag stays true forever and silently
  // skips every page after the first.
  const PAGE_TEXT_CAP = 5000;
  let textExtracted = false;
  let lastTextUrl = location.href;
  function extractPageText() {
    if (location.href !== lastTextUrl) {
      lastTextUrl = location.href;
      textExtracted = false;
    }
    if (textExtracted) return undefined;
    textExtracted = true;
    try {
      const clone = document.cloneNode(true);
      const article = new Readability(clone).parse();
      const text = article?.textContent?.trim();
      if (!text) {
        log("readability found no article content on", location.href);
        return undefined;
      }
      return text.slice(0, PAGE_TEXT_CAP);
    } catch (e) {
      log("readability extraction failed:", e.message);
      return undefined;
    }
  }

  let snapshotCued = false;
  function cueSnapshot() {
    if (snapshotCued || document.visibilityState !== "visible") return;
    snapshotCued = true;
    try {
      const pageText = extractPageText();
      const message = { type: "snapshot-cue" };
      if (pageText) message.pageText = pageText;
      chrome.runtime.sendMessage(message).then(
        () => log("snapshot cue sent"),
        (e) => log("snapshot cue failed:", e.message)
      );
    } catch (e) {
      teardown("extension context gone: " + e.message);
    }
  }

  // Click cue (spec §3 download presence gate): a real-time
  // proof-of-presence signal for the background's download gate. Separate
  // from cueSnapshot — clicks are deliberately excluded there as too noisy
  // for screenshot timing, but here a click IS the bar (Rung 1: one click OR
  // one heartbeat). One cue per heartbeat window (re-armed on each send,
  // same as snapshotCued) so it reaches background storage before or
  // alongside a fast click-then-download (e.g. an email link's "Download"
  // button), instead of waiting for the next batched heartbeat send. The
  // background dedupes with the session's `hadClick` flag.
  let clickCued = false;
  function cueClick() {
    if (clickCued) return;
    clickCued = true;
    try {
      chrome.runtime.sendMessage({ type: "click-cue" }).then(
        () => log("click cue sent"),
        (e) => log("click cue failed:", e.message)
      );
    } catch (e) {
      teardown("extension context gone: " + e.message);
    }
  }

  window.addEventListener(
    "keydown",
    (e) => {
      if (MODIFIER_KEYS.has(e.key)) return;
      activity.keyboard++;
      lastKeyTs = Date.now();
      cueSnapshot();
    },
    opts
  );
  window.addEventListener("mousedown", () => { activity.click++; cueClick(); }, opts);
  window.addEventListener("cut", () => { activity.cut++; cueSnapshot(); }, opts);
  window.addEventListener("copy", () => { activity.copy++; cueSnapshot(); }, opts);
  window.addEventListener("paste", () => { activity.paste++; cueSnapshot(); }, opts);
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
      if (typeof e.data.lastKeyTs === "number" && e.data.lastKeyTs > lastKeyTs) {
        lastKeyTs = e.data.lastKeyTs;
      }
      for (const k of ["mouse", "scroll"]) {
        if (s[k]) activity[k] = true;
      }
      // Relayed subframe input qualifies too (Google Docs types into an
      // iframe — spec §3 iframe relay).
      if (s.keyboard || s.cut || s.copy || s.paste) cueSnapshot();
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
    snapshotCued = false;
    clickCued = false;
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
    if (why === "flush-on-hidden" && lastKeyTs) {
      message.lastKeyGapMs = Date.now() - lastKeyTs;
    }
    // Same exclusion as the snapshot (spec §6): flush-on-hidden fires after
    // the tab is already backgrounded, so it's not "on glass" — extract only
    // on the interval beat, mirroring background.js's snapshot condition.
    if (why === "interval") {
      const pageText = extractPageText();
      if (pageText) message.pageText = pageText;
    }
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
