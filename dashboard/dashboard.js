// FocusStream dashboard shell — loads sessions, hands them to the timeline
// renderer, and hosts the debug tools (Score table, Clear). The per-session
// debug list was removed 2026-07-17 (spec §6): raw inspection lives in the
// worker-console dump, tuning in the Score table, per-block detail in the
// ribbon tooltips.

const log = (...args) => console.log("[FS dash]", ...args);

// Header count only — cheap enough to run on every heartbeat.
async function renderCount() {
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  const { currentSession } = await chrome.storage.session.get("currentSession");
  document.getElementById("count").textContent =
    `${sessions.length} sessions` + (currentSession ? " + 1 live" : "");
}

// Full repaint: the ribbon pipeline (with the week strip) plus the count.
async function render() {
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  window.renderTimeline?.(sessions);
  await renderCount();
}

document.getElementById("refresh").addEventListener("click", render);

// Score table: every stored session scored with the live §6 formula
// (window.FS_SCORING — same functions the timeline renders with), sorted by
// score. Logged as console.table AND copied to the clipboard as TSV, so it
// can be pasted straight into a tuning discussion.
document.getElementById("scores").addEventListener("click", async () => {
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  const S = window.FS_SCORING;
  const rows = sessions
    .map((s) => {
      const a = s.activity || {};
      const score = S.scoreSession(s);
      return {
        host: S.hostOf(s),
        title: (s.title || "").slice(0, 30),
        secs: Math.round((s.endTime - s.startTime) / 1000),
        attended: S.attendedSeconds(s),
        hb: s.heartbeats || 0,
        aud: Math.round((s.audibleMs || 0) / 1000),
        kbd: a.keyboard || 0,
        copy: a.copy || 0,
        cut: a.cut || 0,
        paste: a.paste || 0,
        dl: a.download || 0,
        // Terminal-keystroke evidence (2026-07-24): audit column for the
        // transit filter's terminal discount — blank means no flush or no
        // keydown ever (pre-2026-07-24 data included).
        keyGap: s.lastKeyGapMs ?? "",
        // Continuous signals + scrollable (added 2026-07-15): needed to
        // evaluate scroll-weight candidates offline — scroll counts active
        // windows, and a scroll term would be gated on scrollable=y.
        click: a.click || 0,
        mouse: a.mouse || 0,
        scroll: a.scroll || 0,
        scr: s.scrollable === undefined ? "?" : s.scrollable ? "y" : "n",
        score: Math.round(score),
        band: S.bandFor(score),
        // Chain-analysis columns (added 2026-07-15): same-URL return
        // containers are detected via tabId + URL + timing + endReason, so
        // candidate rules need them replayable offline. start is epoch ms —
        // exact gaps matter more than readability here.
        tabId: s.tabId,
        // Opener edge (2026-07-19): audit column for tab-tree chaining —
        // blank means cold tab / pre-opener data (flat behavior).
        opener: s.openerTabId ?? "",
        start: s.startTime,
        reason: s.endReason,
        url: (s.url || "").slice(0, 80),
      };
    })
    .sort((x, y) => y.score - x.score);
  console.table(rows);
  const bands = ["high", "medium", "low"].map(
    (b) => `${rows.filter((r) => r.band === b).length} ${b}`
  );
  console.log("[FS dash] bands:", bands.join(" / "), `of ${rows.length}`);

  const header = ["host", "title", "secs", "attended", "hb", "aud", "kbd", "copy", "cut", "paste", "dl", "keyGap", "click", "mouse", "scroll", "scr", "score", "band", "tabId", "opener", "start", "reason", "url"];
  const tsv = [header.join("\t"), ...rows.map((r) => header.map((h) => r[h]).join("\t"))].join("\n");
  const btn = document.getElementById("scores");
  try {
    await navigator.clipboard.writeText(tsv);
    btn.textContent = "Copied!";
  } catch (e) {
    log("clipboard write failed:", e.message);
    btn.textContent = "See console";
  }
  setTimeout(() => (btn.textContent = "Score table"), 1500);
});

document.getElementById("clear").addEventListener("click", async () => {
  if (!confirm("Delete all recorded sessions?")) return;
  // hostColorOrder goes too: Clear is a full experiment reset, and stale
  // color claims would silently skew the next palette evaluation. Snapshots
  // likewise (spec §6): clear means clear — enumerate names with getKeys(),
  // never get(null), which would deserialize every stored image.
  const keys = await chrome.storage.local.getKeys();
  const snapKeys = keys.filter((k) => k.startsWith("snap:") || k.startsWith("snapErr:"));
  await chrome.storage.local.remove(["sessions", "hostColorOrder", ...snapKeys]);
  log(`cleared stored sessions, color registry, and ${snapKeys.length} snapshot keys`);
  render();
});

// Re-render on storage writes — but session-area changes (the live session's
// 10s heartbeat updates) refresh only the header count: they can't change any
// finalized block, and running the whole ribbon pipeline every 10 seconds
// made an open dashboard the extension's biggest CPU consumer. Local-area
// writes (finalize, color claims, Clear) repaint everything.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session") renderCount();
  else render();
});

render();
