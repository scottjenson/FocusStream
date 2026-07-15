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
  const session = {
    id: crypto.randomUUID(),
    url,
    title: tab.title || "",
    favIconUrl: tab.favIconUrl || "",
    tabId: tab.id,
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
  delete session.audibleSince; // live-session bookkeeping, not part of the stored schema
  delete session.lastUrlChange;
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
  sessions.push(session);
  await chrome.storage.local.set({ sessions });
  const secs = ((session.endTime - session.startTime) / 1000).toFixed(1);
  log(
    `session END [${endReason}] activity=${JSON.stringify(session.activity)} ${secs}s`,
    session.url,
    `(${sessions.length} total stored)`
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
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
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
  });
});

chrome.runtime.onStartup.addListener(() => {
  log("onStartup");
  enqueue("onStartup", ensureSession);
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
    if (!current || current.tabId !== details.tabId) {
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
  });
});

// ---------------------------------------------------------------------------
// Heartbeats from the content script
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "heartbeat") return;
  enqueue("heartbeat", async () => {
    const current = await getCurrent();
    if (!current || sender.tab?.id !== current.tabId) {
      // Can happen benignly when a flush-on-hidden message loses the race
      // against onActivated during a tab switch.
      log("heartbeat DROPPED from tab", sender.tab?.id, "(tracking:", current?.tabId + ")");
      return;
    }
    // Hybrid folding rule (see spec): discrete signals arrive as raw event
    // counts and add; continuous signals arrive as booleans and count the
    // window (+1). Unknown keys flow through, so new signals need no change.
    current.heartbeats = (current.heartbeats || 0) + 1;
    const signals = msg.signals || {};
    for (const [key, value] of Object.entries(signals)) {
      const inc = typeof value === "number" ? value : value ? 1 : 0;
      if (inc) current.activity[key] = (current.activity[key] || 0) + inc;
    }
    if (typeof msg.scrollable === "boolean") current.scrollable = msg.scrollable;
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
