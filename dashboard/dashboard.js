// FocusStream debug dashboard — one line per session, newest first.
// A data-validation tool, not the final Lifestreams UI.

const log = (...args) => console.log("[FS dash]", ...args);

const SIGNAL_LABELS = {
  keyboard: "kbd",
  click: "click",
  cut: "cut",
  copy: "copy",
  paste: "paste",
  download: "dl",
  mouse: "mouse",
  scroll: "scroll",
  media: "media",
};

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString();
}

function fmtDuration(ms) {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return secs + "s";
  return Math.floor(secs / 60) + "m" + String(secs % 60).padStart(2, "0") + "s";
}

function fmtSignals(activity) {
  const parts = [];
  for (const [key, label] of Object.entries(SIGNAL_LABELS)) {
    if (activity?.[key]) parts.push(`${label} ${activity[key]}`);
  }
  // Unknown/future signal keys still show up rather than vanish.
  for (const key of Object.keys(activity || {})) {
    if (!(key in SIGNAL_LABELS) && activity[key]) parts.push(`${key} ${activity[key]}`);
  }
  return parts.join(" · ");
}

// All DOM is built with createElement/textContent — titles and URLs are
// page-controlled strings and must never reach innerHTML.
function renderRow(s, live) {
  const li = document.createElement("li");
  const signals = fmtSignals(s.activity);
  if (live) li.classList.add("live");
  else if (!signals) li.classList.add("dim");

  const time = document.createElement("span");
  time.className = "time";
  time.textContent = fmtTime(s.startTime);
  li.appendChild(time);

  const dur = document.createElement("span");
  dur.className = "dur";
  dur.textContent = fmtDuration((live ? Date.now() : s.endTime) - s.startTime);
  li.appendChild(dur);

  const icon = document.createElement("img");
  icon.className = "favicon";
  icon.src = s.favIconUrl || "";
  icon.addEventListener("error", () => (icon.style.visibility = "hidden"));
  li.appendChild(icon);

  const title = document.createElement("a");
  title.className = "title";
  title.href = s.url;
  title.target = "_blank";
  title.textContent = s.title || s.url || "(no title)";
  title.title = s.url;
  li.appendChild(title);

  const sig = document.createElement("span");
  sig.className = "signals";
  sig.textContent = signals;
  li.appendChild(sig);

  const meta = document.createElement("span");
  meta.className = "meta";
  const tags = [live ? "LIVE" : s.endReason];
  if (s.scrollable === false) tags.push("no-scroll");
  meta.textContent = tags.join(" · ");
  li.appendChild(meta);

  return li;
}

// --- Visit grouping (spec §5): STRICT adjacency only ------------------------
// Merge only consecutive same-hostname blocks. Gap-tolerant merging is
// forbidden — interruptions (side-quests) must survive as their own rows.

function hostnameOf(s) {
  try {
    // "www." is scan noise; stripping it also merges www/naked variants
    // into one visit run.
    return new URL(s.url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function buildRuns(chronologicalSessions) {
  const runs = [];
  for (const s of chronologicalSessions) {
    const host = hostnameOf(s);
    const last = runs[runs.length - 1];
    if (last && host && last.host === host) {
      last.members.push(s);
    } else {
      runs.push({ host, members: [s] });
    }
  }
  return runs;
}

function mergedActivity(members) {
  const total = {};
  for (const m of members) {
    for (const [key, value] of Object.entries(m.activity || {})) {
      if (value) total[key] = (total[key] || 0) + value;
    }
  }
  return total;
}

function renderVisit(run) {
  const first = run.members[0];
  const li = document.createElement("li");
  li.className = "visit";
  const details = document.createElement("details");
  const summary = document.createElement("summary");

  const arrow = document.createElement("span");
  arrow.className = "arrow";
  arrow.textContent = "▸";
  summary.appendChild(arrow);

  const time = document.createElement("span");
  time.className = "time";
  time.textContent = fmtTime(first.startTime);
  summary.appendChild(time);

  const dur = document.createElement("span");
  dur.className = "dur";
  dur.textContent = fmtDuration(
    run.members.reduce((total, m) => total + (m.endTime - m.startTime), 0)
  );
  summary.appendChild(dur);

  const icon = document.createElement("img");
  icon.className = "favicon";
  icon.src = run.members.find((m) => m.favIconUrl)?.favIconUrl || "";
  icon.addEventListener("error", () => (icon.style.visibility = "hidden"));
  summary.appendChild(icon);

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = `${run.host} — ${run.members.length} pages`;
  summary.appendChild(label);

  const sig = document.createElement("span");
  sig.className = "signals";
  sig.textContent = fmtSignals(mergedActivity(run.members));
  summary.appendChild(sig);

  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = "visit";
  summary.appendChild(meta);

  const members = document.createElement("ol");
  for (const m of [...run.members].reverse()) {
    members.appendChild(renderRow(m, false));
  }

  details.append(summary, members);
  li.appendChild(details);
  return li;
}

// Debug list + header count only — cheap enough to run on every heartbeat.
async function renderList() {
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  const { currentSession } = await chrome.storage.session.get("currentSession");

  const timeline = document.getElementById("timeline");
  timeline.replaceChildren();
  if (currentSession) timeline.appendChild(renderRow(currentSession, true));
  const runs = buildRuns(sessions);
  for (const run of [...runs].reverse()) {
    timeline.appendChild(
      run.members.length === 1 ? renderRow(run.members[0], false) : renderVisit(run)
    );
  }

  document.getElementById("empty").hidden = sessions.length > 0 || !!currentSession;
  document.getElementById("count").textContent =
    `${sessions.length} sessions in ${runs.length} rows (newest first)` +
    (currentSession ? " + 1 live" : "");
}

// Full repaint: the ribbon pipeline plus the debug list.
async function render() {
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  window.renderTimeline?.(sessions);
  await renderList();
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
        score: Math.round(score),
        band: S.bandFor(score),
      };
    })
    .sort((x, y) => y.score - x.score);
  console.table(rows);
  const bands = ["high", "medium", "low"].map(
    (b) => `${rows.filter((r) => r.band === b).length} ${b}`
  );
  console.log("[FS dash] bands:", bands.join(" / "), `of ${rows.length}`);

  const header = ["host", "title", "secs", "attended", "hb", "aud", "kbd", "copy", "cut", "paste", "dl", "score", "band"];
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
  // color claims would silently skew the next palette evaluation.
  await chrome.storage.local.remove(["sessions", "hostColorOrder"]);
  log("cleared stored sessions and color registry");
  render();
});

// Re-render on storage writes — but session-area changes (the live session's
// 10s heartbeat updates) refresh only the debug list: they can't change any
// finalized block, and running the whole ribbon pipeline every 10 seconds
// just to move the live row made an open dashboard the extension's biggest
// CPU consumer. Local-area writes (finalize, color claims, Clear) repaint
// everything.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session") renderList();
  else render();
});

render();
