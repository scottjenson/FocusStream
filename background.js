// FocusStream background service worker — session lifecycle manager.
//
// MV3 workers are killed after ~30s idle, so NO session state lives in
// module-level variables. The current (unfinalized) session lives in
// chrome.storage.session; finalized SessionBlocks append to
// chrome.storage.local under the "sessions" key.

const log = (...args) => console.log("[FS bg]", ...args);

// SPA URL changes arriving faster than this are view-state churn (map pans,
// filter tweaks), not navigation — absorbed into the current session.
const SPA_DEBOUNCE_MS = 15_000;

// Sessions shorter than this with nothing measured are transition machinery
// (redirect hops, instant bounces), not user activity — discarded at finalize.
const BLIP_MS = 2_000;

// Finalized blocks older than this are pruned at finalize: the sessions
// array is rewritten in full on every finalize, so unbounded growth makes
// every tab switch serialize the entire history (and walks toward the
// storage.local quota). The dashboard shows 24h; 7 days leaves headroom
// for future day-paging.
const RETENTION_MS = 7 * 24 * 3600 * 1000;

// Idle split (spec §3, 2026-07-24): a focused-but-idle tab must render as
// absence, not presence — width IS duration, so no display rule can fix it.
// A heartbeat arriving more than this after lastActiveTs splits the session
// retroactively (no polling, no alarms, no chrome.idle permission — the
// worker wakes on the heartbeat anyway). Provisional per the one-knob rule.
const IDLE_SPLIT_MS = 5 * 60_000;
// One heartbeat window: the idle clamp honors the last window's trailing edge.
const HB_WINDOW_MS = 10_000;

// Snapshot previews (spec §6): one screenshot per attended session, taken on
// the first interval heartbeat, downscaled here in the worker, stored as a
// data: URL under snap:<sessionId> (never inside SessionBlocks — those are
// read in full on every render).
const SNAP_WIDTH = 640; // fixed target width: predictable disk (~20-40KB), not screen-relative
const SNAP_QUALITY = 0.6; // JPEG quality; tune by eye against disk cost

log("service worker starting up");

// All event handlers run through this queue so async storage reads/writes
// from overlapping Chrome events can't interleave and corrupt state.
let chain = Promise.resolve();
function enqueue(label, fn) {
  chain = chain.then(fn).catch((e) => console.error("[FS bg] error in", label, e));
}

// ---------------------------------------------------------------------------
// Current-session state (chrome.storage.session)
// ---------------------------------------------------------------------------

async function getCurrent() {
  const { currentSession } = await chrome.storage.session.get("currentSession");
  return currentSession ?? null;
}

async function setCurrent(session) {
  await chrome.storage.session.set({ currentSession: session });
}

async function startSession(tab) {
  if (!tab) {
    log("startSession: no tab, staying idle");
    return;
  }
  const url = tab.url || tab.pendingUrl || "";
  // Only web documents produce journeys (spec §3): content scripts can't run
  // in browser-internal pages (chrome://newtab, settings, extension pages —
  // including our own dashboard), so they could only ever be zero-attention
  // noise. Time spent there renders as a timeline gap, by design.
  const scheme = url.split(":")[0];
  if (!["http", "https", "file"].includes(scheme)) {
    log("startSession: skipping non-web page", url || "(no url)");
    return;
  }
  // Opener edge (spec §3, 2026-07-19): the onCreated map is authoritative;
  // tab.openerTabId is the fallback for tabs created before this listener
  // shipped (or an extension reload wiping storage.session mid-run).
  const { openerEdges = {} } = await chrome.storage.session.get("openerEdges");
  const openerTabId = openerEdges[tab.id] ?? tab.openerTabId;
  const session = {
    id: crypto.randomUUID(),
    url,
    title: tab.title || "",
    favIconUrl: tab.favIconUrl || "",
    tabId: tab.id,
    ...(openerTabId != null ? { openerTabId } : {}),
    startTime: Date.now(),
    endTime: null,
    // Per-signal counts of active 10s heartbeats. Kept separate (not summed)
    // so the dashboard can weight signals independently. Keys arrive from the
    // content script's snapshot, so phase-2 signals (media) need no change here.
    activity: {},
    // Total active windows — NOT derivable from per-signal counts (those
    // overcount windows where several signals fired). ×10 = attended seconds,
    // the dwell term of the timeline score (spec §6).
    heartbeats: 0,
    // Audible time (ms): catches cross-origin embedded players the content
    // script can't see (spec Edge Case 1). audibleSince is transient
    // bookkeeping for an open interval, folded in at finalize.
    audibleMs: 0,
    ...(tab.audible ? { audibleSince: Date.now() } : {}),
    // Last proof of attention (spec §3 idle split): heartbeats refresh it,
    // audible pins it to now (open audibleSince interval), finalize clamps
    // a trailing gap against it. Live-session bookkeeping, never stored.
    lastActiveTs: Date.now(),
    endReason: null,
  };
  await setCurrent(session);
  log("session START tab", tab.id, session.url);
}

async function finalizeCurrent(endReason) {
  const session = await getCurrent();
  if (!session) {
    log("finalize (" + endReason + "): no current session, nothing to do");
    return;
  }
  await chrome.storage.session.remove("currentSession");
  session.endTime = Date.now();
  session.endReason = endReason;
  if (session.audibleSince) {
    session.audibleMs = (session.audibleMs || 0) + session.endTime - session.audibleSince;
  }
  // Trailing-gap clamp (spec §3 idle split): if the tab sat focused but
  // untouched past the threshold — and wasn't audible to the end — the idle
  // tail is absence, not presence. Clamp end to the last attended window.
  if (!session.audibleSince && session.lastActiveTs != null) {
    const idleTail = session.endTime - session.lastActiveTs;
    if (idleTail > IDLE_SPLIT_MS) {
      session.endTime = session.lastActiveTs + HB_WINDOW_MS;
      log(`idle tail clamped: dropped ${Math.round(idleTail / 1000)}s of focused-but-idle time`, session.url);
    }
  }
  delete session.audibleSince; // live-session bookkeeping, not part of the stored schema
  delete session.lastUrlChange;
  delete session.lastActiveTs;
  // Blip filter (spec §3): transition machinery — nothing measured, too
  // short to be user activity. Log it, never store it.
  if (
    session.endTime - session.startTime < BLIP_MS &&
    !session.heartbeats &&
    !session.audibleMs &&
    Object.keys(session.activity || {}).length === 0
  ) {
    log(`discarded blip [${endReason}]`, session.url);
    return;
  }
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  const cutoff = Date.now() - RETENTION_MS;
  const kept = sessions.filter((s) => s.endTime >= cutoff);
  if (kept.length < sessions.length) {
    // Snapshots (and capture-error breadcrumbs) die with their sessions
    // (spec §6): drop the matching keys in the same pass. Removing keys
    // that never existed is a no-op.
    const dropped = sessions.filter((s) => s.endTime < cutoff);
    await chrome.storage.local.remove(
      dropped.flatMap((s) => ["snap:" + s.id, "snapErr:" + s.id])
    );
    log(`pruned ${dropped.length} sessions older than 7 days (+ their snapshots)`);
  }
  kept.push(session);
  await chrome.storage.local.set({ sessions: kept });
  const secs = ((session.endTime - session.startTime) / 1000).toFixed(1);
  log(
    `session END [${endReason}] activity=${JSON.stringify(session.activity)} ${secs}s`,
    session.url,
    `(${kept.length} total stored)`
  );
}

// On browser launch or extension reload storage.session is empty; adopt the
// currently active tab so we don't silently record nothing.
async function ensureSession() {
  if (await getCurrent()) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  log("ensureSession: adopting active tab", tab?.id, tab?.url);
  await startSession(tab);
}

// ---------------------------------------------------------------------------
// Snapshots (spec §6 snapshot previews). Everything here is best-effort —
// every failure path logs and returns, and the tooltip just shows text.
// ---------------------------------------------------------------------------

// Base64 in chunks: String.fromCharCode(...40KB of args) can blow the
// argument-count limit — works in testing, dies on a taller screenshot.
// (FileReader doesn't exist in workers, hence the manual encode.)
async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${blob.type};base64,` + btoa(bin);
}

async function captureSnapshot(sessionId, windowId) {
  try {
    // captureVisibleTab photographs the currently visible tab — exactly the
    // tracked tab, since only visible tabs send interval heartbeats (flush
    // beats are excluded by the caller). Double JPEG encode (q90 → 0.6) is
    // deliberate: generational loss is invisible at 640px, and a PNG
    // intermediate of a large screen is a multi-MB string.
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 90 });
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const w = Math.min(SNAP_WIDTH, bmp.width);
    const h = Math.round(bmp.height * (w / bmp.width));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const small = await canvas.convertToBlob({ type: "image/jpeg", quality: SNAP_QUALITY });
    const stored = await blobToDataUrl(small);
    await chrome.storage.local.set({ ["snap:" + sessionId]: stored });
    log(`snapshot stored snap:${sessionId} (${Math.round(stored.length / 1024)}KB)`);
  } catch (e) {
    // Minimized window, locked screen, DRM-black frames, file:// without the
    // toggle — all soft-fail: the tooltip just lacks an image (spec §6).
    // Breadcrumb to storage (2026-07-16): the worker console rarely survives
    // long enough to be read (workers die ~30s idle), so missing-screenshot
    // diagnosis needs the reason on disk. Same lifecycle as snap: keys.
    log("snapshot skipped:", e.message);
    chrome.storage.local.set({
      ["snapErr:" + sessionId]: { when: Date.now(), message: e.message },
    });
  }
}

// Orphan sweep (spec §2 retention): finalize-time pruning only fires on tab
// switches, so snapshots whose sessions aged out while the browser was closed
// — or that lost their session any other way — would otherwise be immortal.
// getKeys(), never get(null): listing names must not deserialize ~20MB of
// stored images.
async function sweepOrphanSnapshots() {
  const keys = await chrome.storage.local.getKeys();
  const snapKeys = keys.filter((k) => k.startsWith("snap:") || k.startsWith("snapErr:"));
  if (!snapKeys.length) return;
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  const liveIds = new Set(sessions.map((s) => s.id));
  // The unfinalized session isn't in "sessions" yet but may already have a
  // snapshot — it is not an orphan.
  const current = await getCurrent();
  if (current) liveIds.add(current.id);
  const orphans = snapKeys.filter((k) => !liveIds.has(k.slice(k.indexOf(":") + 1)));
  if (orphans.length) {
    await chrome.storage.local.remove(orphans);
    log(`swept ${orphans.length} orphaned snapshots`);
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle events
// ---------------------------------------------------------------------------

// Content scripts only load into pages opened after the extension is
// (re)loaded — inject into existing tabs so tracking doesn't silently stop
// every time the extension reloads during development (spec "Dev Workflow").
async function injectIntoExistingTabs() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  let injected = 0;
  for (const tab of tabs) {
    try {
      // allFrames mirrors the manifest's all_frames (spec §3 iframe relay):
      // subframes self-gate on origin, so blanket injection is safe.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["content.js"],
      });
      injected++;
    } catch (e) {
      log("inject failed for tab", tab.id, tab.url, "-", e.message);
    }
  }
  log(`injected content.js into ${injected}/${tabs.length} existing tabs`);
}

chrome.runtime.onInstalled.addListener(() => {
  log("onInstalled");
  enqueue("onInstalled", async () => {
    await injectIntoExistingTabs();
    await ensureSession();
    await sweepOrphanSnapshots();
  });
});

chrome.runtime.onStartup.addListener(() => {
  log("onStartup");
  enqueue("onStartup", async () => {
    await ensureSession();
    await sweepOrphanSnapshots();
  });
});

// Opener edges (spec §3, 2026-07-19): record which tab SPAWNED which, at
// creation — Chrome drops openerTabId from the Tab object once the opener
// closes, so onCreated is the one reliable capture point. The map lives in
// chrome.storage.session (worker-death-proof, and it empties on browser
// restart, which is exactly right — tabIds don't survive restarts). Capture
// stores the raw edge only; tree assembly is display-time (spec §6).
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id == null || tab.openerTabId == null) return;
  log("event: onCreated tab", tab.id, "opener", tab.openerTabId);
  enqueue("onCreated", async () => {
    const { openerEdges = {} } = await chrome.storage.session.get("openerEdges");
    openerEdges[tab.id] = tab.openerTabId;
    await chrome.storage.session.set({ openerEdges });
  });
});

// Tab switch: finalize the old session, start one for the newly active tab.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  log("event: onActivated tab", tabId);
  enqueue("onActivated", async () => {
    await finalizeCurrent("tab_hidden");
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    await startSession(tab);
  });
});

// Window focus change: Chrome losing focus ends the session; focusing a
// window starts one for that window's active tab.
chrome.windows.onFocusChanged.addListener((windowId) => {
  log("event: onFocusChanged window", windowId);
  enqueue("onFocusChanged", async () => {
    await finalizeCurrent("tab_hidden");
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      log("chrome lost focus, idle until refocused");
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    await startSession(tab);
  });
});

// Real navigation in the tracked tab (main frame only). Navigations in
// background tabs are ignored — only the active tab accrues sessions.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  log("event: onCommitted tab", details.tabId, details.url);
  enqueue("onCommitted", async () => {
    const current = await getCurrent();
    // Adoption (spec §3, 2026-07-18): a commit while NOTHING is tracked, in
    // the active tab of the focused window, starts a session. A fresh tab is
    // born chrome://newtab (filtered, so no session exists), and without
    // adoption its first real navigation fell into the non-tracked guard —
    // the whole new-tab → type-URL → browse → close flow went unrecorded.
    if (!current) {
      const tab = await chrome.tabs.get(details.tabId).catch(() => null);
      if (!tab || !tab.active) {
        log("ignoring nav in non-tracked tab", details.tabId, "(no session, tab not active)");
        return;
      }
      const win = await chrome.windows.get(tab.windowId).catch(() => null);
      if (!win || !win.focused) {
        log("ignoring nav in non-tracked tab", details.tabId, "(no session, window unfocused)");
        return;
      }
      log("adopting active tab", details.tabId);
      await startSession(tab);
      return;
    }
    if (current.tabId !== details.tabId) {
      log("ignoring nav in non-tracked tab", details.tabId);
      return;
    }
    await finalizeCurrent("navigated");
    const tab = await chrome.tabs.get(details.tabId).catch(() => null);
    await startSession(tab);
  });
});

// SPA navigation (spec Edge Case 3): History API pushes and hash changes.
// No real page load happens, so the content script keeps running; only the
// session block turns over.
function onSpaNavigation(eventName, details) {
  if (details.frameId !== 0) return;
  log("event:", eventName, "tab", details.tabId, details.url);
  enqueue(eventName, async () => {
    const current = await getCurrent();
    if (!current || current.tabId !== details.tabId) {
      log("ignoring SPA nav in non-tracked tab", details.tabId);
      return;
    }
    // Noise filter: some SPAs push state repeatedly for one logical
    // navigation, sometimes with the same URL — without this, YouTube
    // produces dozens of zero-duration fragments.
    if (details.url === current.url) {
      log("spa no-op (same URL), ignoring");
      return;
    }
    // Debounce (spec Edge Case 3): URL changes in quick succession are
    // view-state churn (Maps pans) — update the session's URL in place.
    const lastChange = current.lastUrlChange ?? current.startTime;
    if (Date.now() - lastChange < SPA_DEBOUNCE_MS) {
      current.url = details.url;
      current.lastUrlChange = Date.now();
      await setCurrent(current);
      log("spa absorb (within debounce), url now", details.url);
      return;
    }
    await finalizeCurrent("spa_navigation");
    const tab = await chrome.tabs.get(details.tabId).catch(() => null);
    await startSession(tab);
  });
}

chrome.webNavigation.onHistoryStateUpdated.addListener((details) =>
  onSpaNavigation("onHistoryStateUpdated", details)
);
chrome.webNavigation.onReferenceFragmentUpdated.addListener((details) =>
  onSpaNavigation("onReferenceFragmentUpdated", details)
);

// Audible transitions (spec Edge Case 1): event-driven — no polling, the
// worker wakes for the event. Only the tracked tab's sound counts.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.audible === undefined) return;
  log("event: audible", changeInfo.audible, "tab", tabId);
  enqueue("audible", async () => {
    const current = await getCurrent();
    if (!current || current.tabId !== tabId) return;
    if (changeInfo.audible) {
      current.audibleSince = current.audibleSince || Date.now();
    } else if (current.audibleSince) {
      current.audibleMs = (current.audibleMs || 0) + Date.now() - current.audibleSince;
      delete current.audibleSince;
      // Audible pinned attention to now; the idle-split clock starts here.
      current.lastActiveTs = Date.now();
      log("audible interval closed, total", Math.round(current.audibleMs / 1000) + "s", current.url);
    }
    await setCurrent(current);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  log("event: onRemoved tab", tabId);
  enqueue("onRemoved", async () => {
    const current = await getCurrent();
    if (current && current.tabId === tabId) {
      await finalizeCurrent("tab_closed");
    }
    // The closed tab can never start another session; drop its opener edge.
    // Edges pointing AT it stay — they remain valid tree keys (spec §3).
    const { openerEdges = {} } = await chrome.storage.session.get("openerEdges");
    if (openerEdges[tabId] != null) {
      delete openerEdges[tabId];
      await chrome.storage.session.set({ openerEdges });
    }
  });
});

// ---------------------------------------------------------------------------
// Heartbeats from the content script
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "heartbeat") return;
  enqueue("heartbeat", async () => {
    let current = await getCurrent();
    if (!current || sender.tab?.id !== current.tabId) {
      // Can happen benignly when a flush-on-hidden message loses the race
      // against onActivated during a tab switch.
      log("heartbeat DROPPED from tab", sender.tab?.id, "(tracking:", current?.tabId + ")");
      return;
    }
    // Idle split (spec §3): activity resuming after a long focused-but-idle
    // stretch belongs to a NEW session — finalize the old one (the clamp in
    // finalizeCurrent trims its idle tail) and restart for the same tab.
    // An open audibleSince interval pins attention to now: media never splits.
    const lastActive = current.audibleSince
      ? Date.now()
      : current.lastActiveTs ?? current.startTime;
    if (Date.now() - lastActive > IDLE_SPLIT_MS) {
      log(`idle split: ${Math.round((Date.now() - lastActive) / 1000)}s since last activity`, current.url);
      await finalizeCurrent("idle_split");
      await startSession(sender.tab);
      current = await getCurrent();
      if (!current || current.tabId !== sender.tab.id) return;
    }
    current.lastActiveTs = Date.now();
    // Hybrid folding rule (see spec): discrete signals arrive as raw event
    // counts and add; continuous signals arrive as booleans and count the
    // window (+1). Unknown keys flow through, so new signals need no change.
    current.heartbeats = (current.heartbeats || 0) + 1;
    // Snapshot on the FIRST heartbeat only (spec §6): ~10s in, page painted,
    // user demonstrably attending — and never on flush-on-hidden, which fires
    // exactly while the NEXT tab becomes visible (captureVisibleTab would
    // photograph the wrong page). Fire-and-forget: a failed or slow capture
    // must never delay a heartbeat.
    if (current.heartbeats === 1 && msg.reason !== "flush-on-hidden") {
      captureSnapshot(current.id, sender.tab.windowId);
    }
    const signals = msg.signals || {};
    for (const [key, value] of Object.entries(signals)) {
      const inc = typeof value === "number" ? value : value ? 1 : 0;
      if (inc) current.activity[key] = (current.activity[key] || 0) + inc;
    }
    if (typeof msg.scrollable === "boolean") current.scrollable = msg.scrollable;
    // Terminal-keystroke evidence (spec §3): only flush-on-hidden carries it,
    // and the flush is the session's last word — stamp, don't judge.
    if (typeof msg.lastKeyGapMs === "number") current.lastKeyGapMs = msg.lastKeyGapMs;
    // Titles/favicons arrive late on many pages (see spec Edge Case 5) —
    // refresh them on every heartbeat, keeping the last non-empty value.
    if (sender.tab.title) current.title = sender.tab.title;
    if (sender.tab.favIconUrl) current.favIconUrl = sender.tab.favIconUrl;
    await setCurrent(current);
    log("heartbeat ✓ activity=" + JSON.stringify(current.activity), current.url);
  });
});

// ---------------------------------------------------------------------------
// Downloads (spec §5 roadmap): "Save image as…" fires no DOM event, so this
// is background-observed and attributed to the current session. Likely the
// strongest single intent signal we have.
// ---------------------------------------------------------------------------

chrome.downloads.onCreated.addListener((item) => {
  log("event: download created", (item.url || "").slice(0, 60));
  enqueue("download", async () => {
    const current = await getCurrent();
    if (!current) {
      log("download with no current session, dropped");
      return;
    }
    current.activity.download = (current.activity.download || 0) + 1;
    await setCurrent(current);
    log("download ✓ count=" + current.activity.download, current.url);
  });
});

// ---------------------------------------------------------------------------
// Toolbar icon: open the dashboard, and also dump everything to this console
// ---------------------------------------------------------------------------

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/index.html") });
  enqueue("dump", async () => {
    const { sessions = [] } = await chrome.storage.local.get("sessions");
    const current = await getCurrent();
    console.log(`[FS bg] ===== ${sessions.length} finalized sessions =====`);
    console.table(
      sessions.map((s) => {
        const a = s.activity || {};
        return {
          when: new Date(s.startTime).toLocaleTimeString(),
          secs: ((s.endTime - s.startTime) / 1000).toFixed(0),
          hb: s.heartbeats || 0,
          aud: Math.round((s.audibleMs || 0) / 1000),
          kbd: a.keyboard || 0,
          click: a.click || 0,
          cut: a.cut || 0,
          copy: a.copy || 0,
          paste: a.paste || 0,
          dl: a.download || 0,
          mouse: a.mouse || 0,
          scroll: a.scroll || 0,
          media: a.media || 0,
          scr: s.scrollable === undefined ? "?" : s.scrollable ? "y" : "n",
          reason: s.endReason,
          title: (s.title || "").slice(0, 40),
          url: (s.url || "").slice(0, 60),
        };
      })
    );
    console.log("[FS bg] raw SessionBlocks:", sessions);
    console.log("[FS bg] current (unfinalized):", current);
  });
});
