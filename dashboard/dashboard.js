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
  const { sessions = [], lockIntervals = [] } = await chrome.storage.local.get([
    "sessions",
    "lockIntervals",
  ]);
  window.renderTimeline?.(sessions, lockIntervals);
  await renderCount();
}

// Search (2026-08-06): plain case-insensitive substring match over title +
// url/host, across every stored session regardless of day — a "find and go"
// tool, independent of the ribbon's single-day view and thread-assembly
// (results are raw sessions, not display atoms; see decisions/ for the
// ribbon-highlight alternatives this rejected). Multi-word queries require
// every word present (AND), each word matched against title OR url OR
// pageText (stage-1 Readability extraction, 2026-08-07 — plain text, search
// only, never shown in the results row; see decisions/).
{
  const input = document.getElementById("search");
  const resultsEl = document.getElementById("search-results");

  function matches(session, words) {
    const hay = `${session.title || ""} ${session.url || ""} ${session.pageText || ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  }

  // Groups by exact URL. Within a group, sessions sharing one title collapse
  // to their most recent visit (same page, revisited — the count doesn't
  // matter for "find that doc"); sessions with distinct titles at the same
  // URL (e.g. different Gmail threads under one base URL) each surface as
  // their own row, since the title is the only disambiguator we have today.
  // Everything sorted newest-first.
  function groupResults(sessionList) {
    const byUrl = new Map();
    for (const s of sessionList) {
      if (!byUrl.has(s.url)) byUrl.set(s.url, new Map());
      const byTitle = byUrl.get(s.url);
      const t = s.title || s.url;
      const prev = byTitle.get(t);
      if (!prev || s.endTime > prev.endTime) byTitle.set(t, s);
    }
    const rows = [];
    for (const byTitle of byUrl.values()) rows.push(...byTitle.values());
    rows.sort((a, b) => b.endTime - a.endTime);
    return rows;
  }

  function relTime(ms) {
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return `${days}d ago`;
  }

  function renderResults(rows) {
    resultsEl.innerHTML = "";
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sr-empty";
      empty.textContent = "No matches";
      resultsEl.appendChild(empty);
    } else {
      const S = window.FS_SCORING;
      for (const s of rows.slice(0, 20)) {
        const a = document.createElement("a");
        a.className = "sr-row";
        a.href = s.url;
        a.target = "_blank";
        a.rel = "noopener";
        const title = document.createElement("div");
        title.className = "sr-title";
        title.textContent = s.title || s.url;
        const meta = document.createElement("div");
        meta.className = "sr-meta";
        meta.textContent = `${S.hostOf(s)} — ${relTime(s.endTime)}`;
        a.appendChild(title);
        a.appendChild(meta);
        resultsEl.appendChild(a);
      }
    }
    resultsEl.hidden = false;
  }

  async function runSearch() {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      resultsEl.hidden = true;
      return;
    }
    const words = q.split(/\s+/);
    const { sessions = [] } = await chrome.storage.local.get("sessions");
    const matched = sessions.filter((s) => matches(s, words));
    renderResults(groupResults(matched));
  }

  input.addEventListener("input", runSearch);
  input.addEventListener("focus", () => {
    if (input.value.trim()) runSearch();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      resultsEl.hidden = true;
      input.blur();
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#search-wrap")) resultsEl.hidden = true;
  });
}

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
  // hostColorOrder is a leftover key from the retired hue-identity registry
  // (spec §6, 2026-08-07) — removing it is a harmless no-op now that
  // nothing writes it, kept so a pre-redesign install's stale key doesn't
  // linger after a Clear. Snapshots (spec §6): clear means clear —
  // enumerate names with getKeys(), never get(null), which would
  // deserialize every stored image.
  const keys = await chrome.storage.local.getKeys();
  const snapKeys = keys.filter((k) => k.startsWith("snap:") || k.startsWith("snapErr:"));
  await chrome.storage.local.remove(["sessions", "hostColorOrder", ...snapKeys]);
  log(`cleared stored sessions and ${snapKeys.length} snapshot keys`);
  render();
});

// Ribbon view toggle (decisions/card_deck.md, 2026-08-12): flips between
// the card deck and the classic block ribbon — a standing preference, not
// a migration; both stay permanently available. Label always names the
// mode a click would switch TO, matching the existing button-label
// convention (e.g. Score table's "Copied!"/"See console" transients).
{
  const toggleBtn = document.getElementById("ribbon-mode-toggle");
  const labelFor = (mode) => (mode === "cards" ? "Classic view" : "Card view");
  toggleBtn.textContent = labelFor(window.FS_getRibbonMode?.() ?? "cards");
  toggleBtn.addEventListener("click", () => {
    const current = window.FS_getRibbonMode?.() ?? "cards";
    const next = current === "cards" ? "blocks" : "cards";
    window.setRibbonMode?.(next);
    toggleBtn.textContent = labelFor(next);
  });
}

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
