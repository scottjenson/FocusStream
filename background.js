// FocusStream background service worker — session lifecycle manager.
//
// MV3 workers are killed after ~30s idle, so NO session state lives in
// module-level variables. The current (unfinalized) session lives in
// chrome.storage.session; finalized SessionBlocks append to
// chrome.storage.local under the "sessions" key.

const log = (...args) => console.log("[FS bg]", ...args);

// Loaded early: shared/transit.js is the single source of truth for the
// admission predicate (spec §3 rung 2) AND for TRANSIT_MS, the "one
// heartbeat window" constant reused below instead of a second local copy
// (rules audit, 2026-08-06 — WATCHLIST.md "Time-threshold sprawl").
importScripts("shared/transit.js");

// SPA URL changes arriving faster than this are view-state churn (map pans,
// filter tweaks), not navigation — absorbed into the current session.
const SPA_DEBOUNCE_MS = 15_000;

// Sessions shorter than this with nothing measured are transition machinery
// (redirect hops, instant bounces), not user activity — discarded at finalize.
const BLIP_MS = 2_000;

// chrome.tabs.audible can blip false for ~1s during a live WebRTC call
// (Meet, observed 2026-08-14 investigating a 90-minute meeting that
// fractured into 3 containers) with no real interruption — the call kept
// running, Chrome's own detector just misfired momentarily. A false that
// self-corrects within this window is noise, not a real drop; only a false
// that persists past it (or the tab closes first) counts as audio actually
// stopping. 3x the ~1s observed blip width — see decisions/capture_design.md.
const AUDIBLE_FLICKER_MS = 3_000;

// Finalized blocks older than this are pruned at finalize: the sessions
// array is rewritten in full on every finalize, so unbounded growth makes
// every tab switch serialize the entire history (and walks toward the
// storage.local quota). Day paging (live 2026-07-16) reaches exactly this
// window — the week strip always has a cell for every retained day.
const RETENTION_MS = 7 * 24 * 3600 * 1000;

// Idle split (spec §3, 2026-07-24): a focused-but-idle tab must render as
// absence, not presence — width IS duration, so no display rule can fix it.
// A heartbeat arriving more than this after lastActiveTs splits the session
// retroactively (no polling, no alarms, no chrome.idle permission — the
// worker wakes on the heartbeat anyway). Provisional per the one-knob rule.
const IDLE_SPLIT_MS = 5 * 60_000;
// One heartbeat window: the idle clamp honors the last window's trailing
// edge. Reuses FS_TRANSIT.TRANSIT_MS (shared/transit.js) rather than a
// second local 10s constant (rules audit, 2026-08-06) — same concept, one
// definition. (content.js's own HEARTBEAT_MS stays separate: it runs in an
// isolated content-script world with no access to shared/transit.js.)
const HB_WINDOW_MS = FS_TRANSIT.TRANSIT_MS;

// Lock intervals (spec §3, 2026-08-08): the one signal outside browser
// activity this extension captures — deliberately narrow to chrome.idle's
// "locked" state alone (an OS screen lock is machine-state ground truth,
// unlike "idle"/"active", which are just the same ambiguous no-activity
// inference this extension already makes from a different angle). Consumed
// only by display-time gap classification (fence merge gap, SPEC §6) — never
// rendered, never a presence log. Event-driven (onStateChanged), no polling.
const lockState = { since: null }; // in-worker only; a mid-lock worker restart just loses that one interval's start, fails closed

// Snapshot previews (spec §6, unified with the transit filter 2026-07-24):
// one screenshot per session, taken the moment it first QUALIFIES to display
// — first interval heartbeat or first transit-qualifying signal cue,
// whichever wins — downscaled here in the worker, stored as a data: URL
// under snap:<sessionId> (never inside SessionBlocks — those are read in
// full on every render). Finalize deletes the picture of any session the
// shared transit predicate rejects.
// 640 -> 1280 (2026-08-11, stack-ribbon Stage 1 — plans/stack-ribbon.md):
// the old value was tuned for a ~480px-wide tooltip preview, but Stage 1's
// cards display the snapshot as the ENTIRE card face, up to ~487px CSS-wide
// at HIGH tier — on a 2x-DPI (Retina/HiDPI) display that's ~970 physical
// px, so a 640px source was being visibly upscaled/blurred (confirmed:
// layout-box-physical-px vs. naturalWidth measurement, not a CSS/rendering
// bug — Scott's catch). 1280 covers the common 2x case; a 3x display (e.g.
// this 4K/300ppi one) still slightly upscales the HIGH tier, accepted as a
// middle ground against the ~4x disk-cost increase. Existing already-
// stored snapshots are NOT retroactively affected — only captures from now
// on use the new width.
const SNAP_WIDTH = 1280; // fixed target width: was 640 (~20-40KB); now ~80-160KB, sized for 2x-DPI HIGH-tier cards
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
  const { openerEdges = {}, audibleContinuity = {} } = await chrome.storage.session.get([
    "openerEdges",
    "audibleContinuity",
  ]);
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
    // Gap-audio testimony (spec §3, 2026-07-24): when this tab's unbroken
    // audible stretch began. Stored (survives finalize) — display bridges
    // a long container gap only if it predates the previous fragment's
    // end (§6). Fallback to now covers a missed transition: continuity
    // from now can never falsely testify across a gap.
    ...(audibleContinuity[tab.id] != null
      ? { audibleSinceTs: audibleContinuity[tab.id] }
      : tab.audible
        ? { audibleSinceTs: Date.now() }
        : {}),
    // Last proof of attention (spec §3 idle split): heartbeats refresh it,
    // audible pins it to now (open audibleSince interval), finalize clamps
    // a trailing gap against it. Live-session bookkeeping, never stored.
    lastActiveTs: Date.now(),
    endReason: null,
  };
  await setCurrent(session);
  log("session START tab", tab.id, session.url);
  // Age trigger (spec §6 snapshot unification, third arm — 2026-07-24):
  // the transit filter's DURATION rung qualifies a session with zero
  // signals (hands-off cross-origin embeds, motionless reading), so no
  // heartbeat, cue, or download may ever fire — capture at the session's
  // TRANSIT_MS birthday if nothing beat us to it. Not the rejected
  // capture-at-start shape: by then the glass has shown this session's own
  // page for 10 continuous seconds (current ⇒ on-glass since start), and
  // fast tab-cycling never reaches the timer. Armed inside a live event
  // and workers idle-kill at ~30s, so the timer virtually always fires;
  // if the worker dies anyway, any later trigger still captures
  // (best-effort, like all of capture). No await needed at the fire site:
  // a 10s-old session has out-aged the filter, so finalize's transit
  // deletion can never race this store.
  const agedId = session.id;
  setTimeout(() => {
    enqueue("snapshot-age", async () => {
      const current = await getCurrent();
      if (!current || current.id !== agedId || current.snapped) return;
      current.snapped = true;
      await setCurrent(current);
      const agedTab = await chrome.tabs.get(current.tabId).catch(() => null);
      if (agedTab) await captureSnapshot(current.id, agedTab.windowId);
    });
  }, FS_TRANSIT.TRANSIT_MS);
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
  // Snapshot unification (spec §6, 2026-07-24): capture fires eagerly on the
  // first qualifying signal, so judge NOW with full evidence (final duration,
  // lastKeyGapMs) — a session the dashboard will reject keeps no picture.
  // The session itself stays stored for audit; only its snapshot artifacts go.
  if (session.snapped && FS_TRANSIT.isTransit(session)) {
    await chrome.storage.local.remove(["snap:" + session.id, "snapErr:" + session.id]);
    log("transit session, snapshot deleted", session.url);
  }
  delete session.snapped; // live-session bookkeeping; snap:<id> existence is the record
  // Page text (stage 1, 2026-08-07): stored inline on the session (unlike
  // snapshots, no separate key/tooltip-avoidance reason to segregate it), so
  // a transit-rejected session just drops the field before it's ever stored.
  if (session.pageText && FS_TRANSIT.isTransit(session)) {
    delete session.pageText;
    log("transit session, page text discarded", session.url);
  }
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
  // Lock intervals (spec §3, 2026-08-08): pruned in the same pass, same
  // cutoff — no reason for lock evidence to outlive the sessions it informs.
  const { lockIntervals = [] } = await chrome.storage.local.get("lockIntervals");
  const keptLocks = lockIntervals.filter((iv) => iv.end >= cutoff);
  if (keptLocks.length < lockIntervals.length) {
    await chrome.storage.local.set({ lockIntervals: keptLocks });
    log(`pruned ${lockIntervals.length - keptLocks.length} lock intervals older than 7 days`);
  }
  kept.push(session);
  await chrome.storage.local.set({ sessions: kept });
  const secs = ((session.endTime - session.startTime) / 1000).toFixed(1);
  log(
    `session END [${endReason}] activity=${JSON.stringify(session.activity)} ${secs}s`,
    session.url,
    `(${kept.length} total stored)`
  );
  // Debug dual-write to the native app's SQLite store (2026-08-13,
  // temporary — see decisions/capture_design.md, "Native Messaging debug
  // bridge"). chrome.storage.local above is still the real, load-bearing
  // write; this is best-effort and never blocks or reshapes it.
  relayToNativeHost(session);
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
    // tracked tab, since every trigger (interval heartbeat, signal cue,
    // download) fires only while it is on glass (flush beats are excluded
    // by the caller). Double JPEG encode (q90 → 0.6) is
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

// ---------------------------------------------------------------------------
// Native Messaging debug bridge (2026-08-13, temporary — Phase 2 of the
// native-capture project's PHASES.md; see decisions/capture_design.md,
// "Native Messaging debug bridge" for why this skipped the usual
// spec-first rule). Dual-write only:
// chrome.storage.local above stays the extension's real, load-bearing
// store — this just also relays the same finalized session to the native
// app's SQLite store so its Swift side has real data to validate against.
// Entirely best-effort/soft-fail, same contract as snapshot capture: any
// failure here must never affect the extension's own behavior.
// ---------------------------------------------------------------------------

const NATIVE_HOST_NAME = "com.jenson.focusstream2.nativemessaging";

// One-shot connection per session, not a held-open port: MV3 workers are
// killed after ~30s idle (see file-top comment) and take no module-level
// state with them, so there's nothing to keep a long-lived port alive
// across finalizes anyway — session boundaries are already the natural
// message boundary. The native host's read loop (main.swift) handles a
// connect/one-message/disconnect cycle the same as a long-held one; it
// just reads until EOF either way.
async function relayToNativeHost(session) {
  let snapshotDataUrl = null;
  try {
    const { ["snap:" + session.id]: snap } = await chrome.storage.local.get("snap:" + session.id);
    snapshotDataUrl = snap ?? null;
  } catch (e) {
    log("native bridge: snapshot lookup failed, relaying without image:", e.message);
  }

  const message = {
    id: session.id,
    url: session.url,
    title: session.title,
    favIconUrl: session.favIconUrl,
    tabId: session.tabId,
    openerTabId: session.openerTabId ?? null,
    startTime: session.startTime,
    endTime: session.endTime,
    endReason: session.endReason,
    activity: session.activity,
    heartbeats: session.heartbeats,
    audibleMs: session.audibleMs,
    audibleSinceTs: session.audibleSinceTs ?? null,
    snapshotDataUrl,
  };

  // Ack-driven disconnect, not a guessed timeout (2026-08-13, replaces an
  // earlier setTimeout(500) version — see decisions/capture_design.md).
  // chrome.runtime.Port.postMessage() has no delivery callback of its own
  // (confirmed against Chrome's own API docs: it's fire-and-forget by
  // design, returning only means "enqueued," not "delivered"), so a fixed
  // delay was a guess that could race a slow host launch. The host
  // (NativeMessagingHost/main.swift) now sends a small framed JSON ack
  // back over the same port after it finishes handling each message —
  // onMessage below is what actually tells us it's safe to disconnect, no
  // guessing involved. A safety-net timeout still guards against an ack
  // that never arrives (host hung, or an old host build predating acks),
  // so a stuck port can't accumulate forever.
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    let settled = false;
    const disconnectOnce = () => {
      if (settled) return;
      settled = true;
      port.disconnect();
    };
    port.onMessage.addListener((ack) => {
      log(`native bridge: ack for session ${session.id}:`, ack);
      disconnectOnce();
    });
    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        // A REAL Chrome-reported failure (bad host name, no manifest
        // registered, host process failed to launch, etc.) — as opposed to
        // disconnectOnce()'s own disconnect() call, which never sets
        // lastError since it's self-initiated, not an error Chrome is
        // reporting.
        log("native bridge: disconnected with error:", chrome.runtime.lastError.message);
      }
      settled = true;
    });
    port.postMessage(message);
    // Safety net only — the expected path is the onMessage ack above.
    setTimeout(() => {
      if (!settled) log(`native bridge: no ack for session ${session.id} after 5s, disconnecting anyway`);
      disconnectOnce();
    }, 5000);
    log(`native bridge: relay sent for session ${session.id}`, session.url);
  } catch (e) {
    log("native bridge: relay failed (host likely not installed):", e.message);
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
        files: ["vendor/Readability.js", "content.js"],
      });
      injected++;
    } catch (e) {
      log("inject failed for tab", tab.id, tab.url, "-", e.message);
    }
  }
  log(`injected content.js into ${injected}/${tabs.length} existing tabs`);
}

// Seed audible continuity for tabs already making sound when the extension
// (re)starts — storage.session is empty then, and their audible-on
// transition is long past. Continuity from NOW, not their true start
// (unknowable), which fails closed: a bridge needs audio since before the
// user left, and "now" can never predate an existing gap (spec §3).
async function seedAudibleContinuity() {
  const tabs = await chrome.tabs.query({ audible: true });
  if (!tabs.length) return;
  const { audibleContinuity = {} } = await chrome.storage.session.get("audibleContinuity");
  for (const t of tabs) {
    if (audibleContinuity[t.id] == null) audibleContinuity[t.id] = Date.now();
  }
  await chrome.storage.session.set({ audibleContinuity });
  log(`seeded audible continuity for ${tabs.length} audible tabs`);
}

chrome.runtime.onInstalled.addListener(() => {
  log("onInstalled");
  enqueue("onInstalled", async () => {
    await injectIntoExistingTabs();
    await seedAudibleContinuity();
    await ensureSession();
    await sweepOrphanSnapshots();
  });
});

chrome.runtime.onStartup.addListener(() => {
  log("onStartup");
  enqueue("onStartup", async () => {
    await seedAudibleContinuity();
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

// Lock intervals (spec §3, 2026-08-08): only "locked" transitions are
// captured. On lock, stamp the start; on the matching unlock, close the
// interval and append it to storage.local (survives restarts, unlike
// openerEdges/audibleContinuity — this is historical fact for display-time
// reads days later, not in-flight session bookkeeping). A worker restart
// mid-lock just loses that one interval's start (lockState is module-level,
// not persisted) — fails closed, no phantom interval spanning the restart.
chrome.idle.onStateChanged.addListener((state) => {
  log("event: idle.onStateChanged", state);
  enqueue("idle.onStateChanged", async () => {
    if (state === "locked") {
      lockState.since = Date.now();
      return;
    }
    if (lockState.since == null) return; // unlock with no matching lock (e.g. worker restarted mid-lock)
    const interval = { start: lockState.since, end: Date.now() };
    lockState.since = null;
    const { lockIntervals = [] } = await chrome.storage.local.get("lockIntervals");
    lockIntervals.push(interval);
    await chrome.storage.local.set({ lockIntervals });
    log(`lock interval recorded: ${Math.round((interval.end - interval.start) / 60000)}min`);
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
// worker wakes for the event. Only the tracked tab's sound accrues
// audibleMs, but EVERY tab's transitions feed the continuity map (below).
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.audible === undefined) return;
  log("event: audible", changeInfo.audible, "tab", tabId);
  enqueue("audible", async () => {
    // Audible continuity, all tabs (spec §3, 2026-07-24): one timestamp
    // per tab — when its current unbroken audible stretch began. Written
    // only on transitions, so a meeting talking through a 20-minute gap
    // costs zero writes. startSession stamps it as audibleSinceTs; display
    // bridges a long container gap only when the audio predates the gap
    // (§6 gap-audio testimony).
    //
    // Flicker tolerance (2026-08-14): chrome.tabs.audible can blip false
    // for ~1s mid-call with no real interruption (specimen: a live Meet
    // call, tab never switched, flipped false then true again inside a
    // second). A bare false must not be trusted immediately — it's held as
    // "pending" (audiblePending) and only committed once it's proven
    // itself real, either by outlasting AUDIBLE_FLICKER_MS before the next
    // true arrives, or by the tab closing outright (onRemoved) with
    // nothing left to wait for. A true that arrives while a pending false
    // is still within the window is the flicker resolving itself: the
    // pending false is simply discarded, and — since audibleContinuity/
    // current.audibleSince were never touched while pending — the original
    // interval is already exactly as if the blip never happened.
    const { audibleContinuity = {}, audiblePending = {} } = await chrome.storage.session.get([
      "audibleContinuity",
      "audiblePending",
    ]);
    const pendingFalseAt = audiblePending[tabId];
    let commitFalse = false;
    if (changeInfo.audible) {
      if (pendingFalseAt != null) {
        delete audiblePending[tabId];
        if (Date.now() - pendingFalseAt >= AUDIBLE_FLICKER_MS) {
          // Outlasted the flicker window before this true arrived — the
          // drop was real. Commit the close (backdated to when it actually
          // dropped, not now) before treating this true as a fresh start.
          commitFalse = true;
        } else {
          log("audible flicker absorbed, tab", tabId);
        }
      }
      if (!commitFalse && audibleContinuity[tabId] == null) {
        audibleContinuity[tabId] = Date.now();
      }
    } else if (pendingFalseAt == null) {
      audiblePending[tabId] = Date.now();
    }
    if (commitFalse) {
      delete audibleContinuity[tabId];
      audibleContinuity[tabId] = Date.now(); // this true starts a fresh stretch
    }
    await chrome.storage.session.set({ audibleContinuity, audiblePending });

    const current = await getCurrent();
    if (!current || current.tabId !== tabId) return;
    if (changeInfo.audible) {
      if (commitFalse && current.audibleSince) {
        current.audibleMs = (current.audibleMs || 0) + pendingFalseAt - current.audibleSince;
        current.lastActiveTs = pendingFalseAt;
        log("audible interval closed, total", Math.round(current.audibleMs / 1000) + "s", current.url);
        current.audibleSince = Date.now();
      } else {
        current.audibleSince = current.audibleSince || Date.now();
      }
    }
    // The false branch intentionally does nothing to current.audibleSince —
    // resolution happens above, on the next true, or in onRemoved for a
    // pending false that never gets one.
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
    // Its audible-continuity entry dies with it too — including any
    // still-pending false (2026-08-14): the tab's gone, so there's no
    // future true left to corroborate or refute it either way.
    const {
      openerEdges = {},
      audibleContinuity = {},
      audiblePending = {},
    } = await chrome.storage.session.get(["openerEdges", "audibleContinuity", "audiblePending"]);
    if (openerEdges[tabId] != null) {
      delete openerEdges[tabId];
      await chrome.storage.session.set({ openerEdges });
    }
    if (audibleContinuity[tabId] != null || audiblePending[tabId] != null) {
      delete audibleContinuity[tabId];
      delete audiblePending[tabId];
      await chrome.storage.session.set({ audibleContinuity, audiblePending });
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
    // Snapshot on the first qualifying heartbeat (spec §6 unification):
    // guarded by the explicit `snapped` flag, never the heartbeat count —
    // a flush beat would consume slot #1 while being barred from capture
    // (it fires exactly while the NEXT tab becomes visible, and
    // captureVisibleTab would photograph the wrong page). AWAITED like the
    // cue/download paths (2026-07-24; was fire-and-forget): a sub-10s
    // SPA-born session can heartbeat mid-window then die as transit, and
    // an unawaited store could land AFTER finalize's snapshot deletion —
    // and a rejected session stays stored for audit, so the leaked snap:
    // key would never read as an orphan. ~100ms once per session against
    // a 10s cadence.
    if (!current.snapped && msg.reason !== "flush-on-hidden") {
      current.snapped = true;
      await captureSnapshot(current.id, sender.tab.windowId);
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
    // Page text (stage 1, 2026-08-07): content.js extracts at most once per
    // page life, so first-write-wins is enough — no separate one-shot flag
    // needed here (contrast `snapped`, which gates an action, not a value).
    if (typeof msg.pageText === "string" && !current.pageText) current.pageText = msg.pageText;
    // Titles/favicons arrive late on many pages (see spec Edge Case 5) —
    // refresh them on every heartbeat, keeping the last non-empty value.
    if (sender.tab.title) current.title = sender.tab.title;
    if (sender.tab.favIconUrl) current.favIconUrl = sender.tab.favIconUrl;
    await setCurrent(current);
    log("heartbeat ✓ activity=" + JSON.stringify(current.activity), current.url);
  });
});

// Snapshot cue (spec §6 snapshot unification, 2026-07-24): the content
// script saw the first transit-qualifying signal — capture NOW, while the
// tab is still on glass, because a sub-10s engaged session dies before its
// first interval heartbeat. AWAITED, unlike the heartbeat path: a close
// chord fires cue → close within ~100ms, and the queue must order
// capture-and-store before finalize so finalize's transit check can delete
// a picture the session didn't earn (instead of racing a late store).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "snapshot-cue") return;
  enqueue("snapshot-cue", async () => {
    const current = await getCurrent();
    if (!current || sender.tab?.id !== current.tabId) return;
    if (typeof msg.pageText === "string" && !current.pageText) current.pageText = msg.pageText;
    if (current.snapped) {
      await setCurrent(current);
      return;
    }
    current.snapped = true;
    await setCurrent(current);
    await captureSnapshot(current.id, sender.tab.windowId);
  });
});

// Click cue (spec §3 download presence gate, 2026-07-26): a real-time
// proof-of-presence signal, separate from the batched heartbeat activity
// counts, so it's visible in storage the instant a click happens — needed
// because a click-triggered download can fire within the same 10s window,
// before content.js's next batched send. Deliberately not folded into
// cueSnapshot(), which excludes clicks as too noisy for screenshot timing;
// this is a different consumer with a different bar (Rung 1's "one click OR
// one heartbeat"), applied in real time instead of only at finalize.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "click-cue") return;
  enqueue("click-cue", async () => {
    const current = await getCurrent();
    if (!current || sender.tab?.id !== current.tabId || current.hadClick) return;
    current.hadClick = true;
    await setCurrent(current);
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
    // Presence gate (spec §3, 2026-07-26): a download only counts as intent
    // if the session already has proof the user was there — a heartbeat or
    // a click (Rung 1's bar, checked in real time). Without this, apps that
    // programmatically replay download history on tab load/reconnect (seen:
    // a torrent client's web UI firing 1500+ onCreated events on restore,
    // zero attended time) inflate the score with events nobody caused.
    if (!current.heartbeats && !current.hadClick) {
      log("download with no presence signal yet, dropped", current.url);
      return;
    }
    current.activity.download = (current.activity.download || 0) + 1;
    // Downloads qualify a session to display (shared/transit.js) but are
    // background-observed — no content-script cue arrives. Capture here,
    // awaited like the cue path so finalize can't outrun the store. The
    // session's tab IS the visible tab (capture invariant), so its window
    // photographs the right page.
    const needsSnap = !current.snapped;
    if (needsSnap) current.snapped = true;
    await setCurrent(current);
    log("download ✓ count=" + current.activity.download, current.url);
    if (needsSnap) {
      const tab = await chrome.tabs.get(current.tabId).catch(() => null);
      if (tab) await captureSnapshot(current.id, tab.windowId);
    }
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
