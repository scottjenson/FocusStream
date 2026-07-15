// FocusStream horizontal timeline (spec §6 Phase 3b).
//
// Vanilla-DOM port of the Desktop4 TimelineView pipeline:
//   score → tier (three bottom-flush heights) → picket fence → cursor layout
//   → interpolated hour marks → collision-tested run titles.
// Width is time (floored at MIN_W); height is salience; hue is hostname
// identity — score never changes width or color. Only LOW blocks may fence;
// MEDIUM+ is structurally incapable of being hidden (§5 side-quest rule).
//
// Wrapped in an IIFE so nothing leaks into dashboard.js's global scope;
// dashboard.js hands us the session list via window.renderTimeline().

(() => {
  const log = (...args) => console.log("[FS timeline]", ...args);

  // --- Score (spec §6). ⚠ Provisional weights inherited from Desktop4's
  // demo-tuned values — expected to be revisited against real data.
  const W_COPY = 150;
  const W_CUT = 150;
  const W_PASTE = 80;
  const W_DOWNLOAD = 200;
  const KBD_CAP = 200; // 1 point per keystroke, capped: composition ≈ copy-tier
  const HIGH_SCORE = 1000;
  const MED_SCORE = 150;

  const HOURS_BACK = 24; // single backward look; paging between days is later
  // Visit-merge gap limit: a brief tab-away stays the same visit; coming
  // back after minutes of absence is a NEW visit (interruption-by-absence).
  const VISIT_GAP_MS = 5 * 60 * 1000;

  // --- Layout (px). The timeline is the PRIMARY view (spec §6) — sized
  // generously; the debug list below is secondary. 1 hour ≈ 540px.
  const PX_PER_SEC = 0.15;
  const MIN_W = 8; // floor: smallest visible/hoverable block
  const GAP = 2;
  const BAND_H = 144;
  const TIER_H = { high: 144, medium: 115, low: 86 }; // bottom-flush; top edge = importance contour
  const STICK_W = 3; // fence stick: deliberately narrower than any real block
  const STICK_GAP = 1;
  const MIN_RUN = 2; // even a pair of lows fences
  const TITLE_AREA = 170; // space above the band for rotated run titles
  // Axis strip below the band, in two lanes so nothing overlaps (spec §6):
  // expand bars snug under the band, then a clear gap, then ticks + labels.
  const BAR_GAP = 4; // band bottom → expand bar
  const TICK_TOP = 16; // band bottom → tick/label lane
  const TICK_H = 12;
  const AXIS_AREA = 46;
  const TITLE_CLEARANCE = 20; // min horizontal px between rotated title anchors
  const TITLE_MAX_CHARS = 20;

  // Measured attention: active windows OR audible playback (max, not sum —
  // same-frame video counts in both; audible catches cross-origin embeds).
  function attendedSeconds(s) {
    return Math.max((s.heartbeats || 0) * 10, Math.round((s.audibleMs || 0) / 1000));
  }

  function scoreSession(s) {
    const a = s.activity || {};
    return (
      attendedSeconds(s) +
      W_COPY * (a.copy || 0) +
      W_CUT * (a.cut || 0) +
      W_PASTE * (a.paste || 0) +
      W_DOWNLOAD * (a.download || 0) +
      Math.min(a.keyboard || 0, KBD_CAP)
    );
  }

  const bandFor = (score) =>
    score >= HIGH_SCORE ? "high" : score >= MED_SCORE ? "medium" : "low";

  // "www." is scan noise — stripped BEFORE hashing/grouping, so www and
  // naked variants share one identity (color, runs, labels).
  function hostOf(s) {
    try {
      return new URL(s.url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  // Color = identity, rationed by importance (spec §6): only hosts that
  // earned a MEDIUM+ block get an identity hue — LOW-only hosts render
  // neutral gray so the day's noise is quiet texture. Hue shows what height
  // can't: revisit structure. A small curated palette beats raw HSL hashing
  // at this cardinality (better contrast, no muddy accidents); hash-assigned
  // so a host keeps its color across days. Self-legending via labels.
  // ~20 hues around the wheel: collisions still possible, but visiting
  // behavior is temporally local (a handful of sites at a time), so only
  // NEARBY colored blocks need distinct hues — 20 slots keeps that rare.
  const PALETTE = [
    "#e05252", // red
    "#e0704d", // burnt orange
    "#f28c33", // orange
    "#e3b341", // gold
    "#c9cf3a", // yellow-green
    "#8ed14b", // lime
    "#43c463", // green
    "#3dc98a", // spring green
    "#2ec4b6", // teal
    "#4fd0e0", // cyan
    "#4db3f0", // sky
    "#4f9cf0", // blue
    "#6f83f2", // indigo
    "#9d6ff2", // purple
    "#b45ef0", // violet
    "#d84fd0", // magenta
    "#e353b0", // pink-magenta
    "#f26d9a", // pink
    "#eb5f78", // rose
    "#c98a5e", // tan
  ];
  const GRAY_FILL = "#3e434c";
  const GRAY_RIM = "#5b616c";

  function hashOf(host) {
    let h = 0;
    for (const ch of host) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
  }
  const colorOf = (host) => PALETTE[hashOf(host) % PALETTE.length];
  const rimOf = (color) => `color-mix(in srgb, ${color} 65%, white)`;

  function fmtDuration(ms) {
    const secs = Math.round(ms / 1000);
    if (secs < 60) return secs + "s";
    return Math.floor(secs / 60) + "m" + String(secs % 60).padStart(2, "0") + "s";
  }

  function fmtHour(t) {
    const h = new Date(t).getHours();
    return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;
  }

  function fmtClock(t) {
    return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function tooltip(e) {
    const parts = Object.entries(e.activity || {})
      .filter(([, v]) => v)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ");
    return [
      e.title || e.url,
      `${e.host} · ${fmtClock(e.startTime)} – ${fmtClock(e.endTime)} · ${fmtDuration(e.durMs)} · attended ${attendedSeconds(e)}s`,
      e.members ? `${e.members.length} pages merged` : "",
      parts,
      `score ${Math.round(e.score)} (${e.band})`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  function parseSessions(sessions) {
    const cutoff = Date.now() - HOURS_BACK * 3600 * 1000;
    return sessions
      .filter((s) => s.endTime >= cutoff && s.url)
      .map((s) => {
        const score = scoreSession(s);
        return {
          ...s,
          host: hostOf(s),
          score,
          band: bandFor(score),
          durMs: s.endTime - s.startTime,
        };
      })
      .sort((a, b) => a.startTime - b.startTime);
  }

  // Same-host visit merging (spec §6): consecutive same-host LOW events
  // merge into one visit block, scored and banded on the MERGED totals — a
  // fragmented-but-engaged session (Maps pans, Gmail puttering) earns its
  // combined stature. MEDIUM+ events never merge: the visit splits around
  // them, so a big email inside an hour of Gmail stands alone (§5 side-quest
  // rule). A merged visit that is still LOW remains fence-eligible.
  function mergeVisits(events) {
    const out = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      if (run.length === 1) {
        out.push(run[0]);
      } else {
        const activity = {};
        let heartbeats = 0;
        let audibleMs = 0;
        let durMs = 0;
        for (const e of run) {
          heartbeats += e.heartbeats || 0;
          audibleMs += e.audibleMs || 0;
          durMs += e.durMs;
          for (const [k, v] of Object.entries(e.activity || {})) {
            if (v) activity[k] = (activity[k] || 0) + v;
          }
        }
        const top = run.reduce((a, b) => (b.score > a.score ? b : a));
        const merged = {
          id: "v" + run[0].id,
          url: top.url, // click target: the visit's top-scoring page
          title: top.title,
          host: run[0].host,
          startTime: run[0].startTime,
          endTime: run[run.length - 1].endTime,
          durMs, // sum of member durations (attention-honest width)
          heartbeats,
          audibleMs,
          activity,
          members: run,
        };
        merged.score = scoreSession(merged);
        merged.band = bandFor(merged.score);
        out.push(merged);
      }
      run = [];
    };
    for (const e of events) {
      const prev = run[run.length - 1];
      if (
        e.band === "low" &&
        prev &&
        prev.host === e.host &&
        e.startTime - prev.endTime < VISIT_GAP_MS
      ) {
        run.push(e);
      } else if (e.band === "low") {
        flush();
        run.push(e);
      } else {
        flush();
        out.push(e);
      }
    }
    flush();
    return out;
  }

  // Runs of MIN_RUN+ consecutive LOW events fence; everything else lays out
  // as a plain block. A fragment shorter than MIN_RUN falls back to ordinary
  // blocks — a singleton low is visible without a click.
  function clusterEvents(events) {
    const items = [];
    let run = [];
    const flush = () => {
      if (run.length >= MIN_RUN) items.push({ kind: "cluster", key: "c" + run[0].id, members: run });
      else run.forEach((event) => items.push({ kind: "event", event }));
      run = [];
    };
    for (const event of events) {
      if (event.band === "low") {
        run.push(event);
      } else {
        flush();
        items.push({ kind: "event", event });
      }
    }
    flush();
    return items;
  }

  // Ms past the local whole hour (timezone-correct, unlike epoch % hour).
  function msPastHour(t) {
    const d = new Date(t);
    return d.getMinutes() * 60000 + d.getSeconds() * 1000 + d.getMilliseconds();
  }

  function layout(items, expanded) {
    // Left-pad from the floor hour at the normal time scale, so a session
    // starting at 8:47 sits ~78% of the way from the "8am" tick (spec §6:
    // hour labels stay clean whole hours; the pad does the honesty).
    const first = items[0] && (items[0].kind === "cluster" ? items[0].members[0] : items[0].event);
    let cursor = first ? (msPastHour(first.startTime) / 1000) * PX_PER_SEC : 0;
    const segs = [];
    const plates = [];
    const bars = [];
    const widthOf = (e) => Math.max(MIN_W, (e.durMs / 1000) * PX_PER_SEC);
    for (const item of items) {
      if (item.kind === "cluster" && !expanded.has(item.key)) {
        const n = item.members.length;
        const width = n * STICK_W + (n - 1) * STICK_GAP;
        const left = cursor;
        item.members.forEach((e, j) => {
          segs.push({
            e,
            key: e.id,
            clusterKey: item.key,
            collapsed: true,
            band: "low",
            w: STICK_W,
            x: left + j * (STICK_W + STICK_GAP),
          });
        });
        plates.push({ key: item.key, members: item.members, x: left, w: width });
        cursor += width + GAP;
      } else {
        const members = item.kind === "cluster" ? item.members : [item.event];
        const start = cursor;
        for (const e of members) {
          const w = widthOf(e);
          segs.push({
            e,
            key: e.id,
            clusterKey: item.kind === "cluster" ? item.key : null,
            collapsed: false,
            // Expanded members keep low stature: expansion reveals width,
            // never confers importance.
            band: item.kind === "cluster" ? "low" : e.band,
            w,
            x: cursor,
          });
          cursor += w + GAP;
        }
        if (item.kind === "cluster") {
          bars.push({ key: item.key, x: start, w: cursor - GAP - start });
        }
      }
    }
    return { segs, plates, bars, total: Math.max(cursor - GAP, 0) };
  }

  // Ribbon X is NOT linear time (widths are floored), so each whole hour is
  // placed at the time-interpolated X within whichever block was active then,
  // clamping to the nearest edge in gaps.
  function hourMarks(segs) {
    if (!segs.length) return [];
    const HOUR = 3600 * 1000;
    const first = segs[0];
    const last = segs[segs.length - 1];
    // First tick: the floor hour, sitting at the left edge of the pad — a
    // clean whole-hour label with the first block proportionally inset.
    const floorT = first.e.startTime - msPastHour(first.e.startTime);
    const marks = [{ t: floorT, x: first.x - (msPastHour(first.e.startTime) / 1000) * PX_PER_SEC }];
    for (let t = floorT + HOUR; t <= last.e.endTime; t += HOUR) {
      let x = null;
      for (const s of segs) {
        if (t < s.e.startTime) {
          x = s.x;
          break;
        }
        if (t <= s.e.endTime) {
          const span = s.e.endTime - s.e.startTime;
          x = s.x + (span > 0 ? ((t - s.e.startTime) / span) * s.w : 0);
          break;
        }
      }
      if (x === null) x = last.x + last.w;
      marks.push({ t, x });
    }
    return marks;
  }

  // Consecutive same-host segments, for titling only. bestScore tracks the
  // strongest label-worthy member: MEDIUM+ blocks, plus members of an OPEN
  // fence (spec §6 fence-open relaxation — collapsed sticks stay ineligible,
  // so a closed fence can never make its run label-worthy).
  function groupRuns(segs) {
    // Merged visit blocks contribute every member page's title to the run.
    const titlesOf = (seg) =>
      seg.e.members ? seg.e.members.map((m) => m.title) : [seg.e.title];
    const runs = [];
    for (const seg of segs) {
      const labelWorthy = seg.band !== "low" || (seg.clusterKey != null && !seg.collapsed);
      const memberScore = labelWorthy ? Math.max(seg.e.score, 1) : 0;
      const last = runs[runs.length - 1];
      if (last && last.host === seg.e.host) {
        last.end = seg.x + seg.w;
        last.bestScore = Math.max(last.bestScore, memberScore);
        last.titles.push(...titlesOf(seg));
      } else {
        runs.push({
          host: seg.e.host,
          start: seg.x,
          end: seg.x + seg.w,
          bestScore: memberScore,
          titles: titlesOf(seg),
        });
      }
    }
    return runs.map((r) => ({ ...r, center: (r.start + r.end) / 2 }));
  }

  // Label = the site's own name, derived from titles (spec §6): pages suffix
  // titles with the site name ("Coffee - Google Maps", "Post by X — Bluesky"),
  // so take the most common trailing segment across the run's pages. Majority
  // required for multi-page runs; single pages accept a short suffix.
  // Hostname is the fallback — and identity (color/grouping) stays
  // hostname-keyed regardless.
  function siteNameOf(titles) {
    const names = titles
      .map((t) => {
        const parts = (t || "").split(/\s+[-–—|·/]\s+/);
        return parts.length > 1 ? parts[parts.length - 1].trim() : "";
      })
      .filter((n) => n && n.length <= 30);
    if (!names.length) return null;
    const counts = new Map();
    for (const n of names) counts.set(n, (counts.get(n) || 0) + 1);
    const [best, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (titles.length >= 2) return count * 2 >= names.length ? best : null;
    return best.length <= 24 ? best : null;
  }

  // Labels are importance-gated (spec §6): only runs holding a MEDIUM+ block
  // earn a title — LOW never labels; tooltips carry the rest. (Desktop4's
  // "first occurrence always titles" is deleted: it assumed ~6 apps, not the
  // web's 20+ hostnames per session, and firsts bypassed collision checks.)
  // Remaining collisions resolve by score: higher wins, loser is dropped —
  // never nudged, since a nudged label misaligns with its block.
  function titleRuns(runs) {
    const candidates = runs
      .filter((r) => r.bestScore > 0)
      .sort((a, b) => b.bestScore - a.bestScore);
    const placed = [];
    for (const run of candidates) {
      if (placed.some((p) => Math.abs(p.center - run.center) < TITLE_CLEARANCE)) continue;
      placed.push(run);
    }
    return placed;
  }

  // --- Rendering. Block elements persist across expand/collapse keyed by
  // session id, so CSS transitions animate the fence stretching open in
  // place; everything else (plates, bars, ticks, titles) is rebuilt.
  const blockEls = new Map();
  let expanded = new Set();
  let lastSessions = [];

  function toggle(key) {
    expanded.has(key) ? expanded.delete(key) : expanded.add(key);
    render(lastSessions);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && expanded.size) {
      expanded.clear();
      render(lastSessions);
    }
  });

  function render(sessions) {
    lastSessions = sessions;
    const events = mergeVisits(parseSessions(sessions));
    const items = clusterEvents(events);
    const { segs, plates, bars, total } = layout(items, expanded);

    // Hosts that earned an identity hue: any MEDIUM+ event qualifies the
    // whole host, so its LOW visits share the color (revisit structure).
    const coloredHosts = new Set(events.filter((e) => e.band !== "low").map((e) => e.host));

    const ribbon = document.getElementById("ribbon");
    const bandBottom = TITLE_AREA + BAND_H;
    ribbon.style.width = total + "px";
    ribbon.style.height = TITLE_AREA + BAND_H + AXIS_AREA + "px";
    document.getElementById("ribbon-empty").hidden = segs.length > 0;

    ribbon.querySelectorAll(".transient").forEach((el) => el.remove());

    const seen = new Set();
    for (const s of segs) {
      seen.add(s.key);
      let el = blockEls.get(s.key);
      if (!el) {
        el = document.createElement("div");
        el.className = "blk";
        ribbon.appendChild(el);
        blockEls.set(s.key, el);
      }
      const h = TIER_H[s.band];
      // Identity hue for qualifying hosts; members of an OPEN fence are
      // always colored (fence-open relaxation). Collapsed sticks and
      // LOW-only hosts stay gray.
      const colored = !s.collapsed && (coloredHosts.has(s.e.host) || s.clusterKey != null);
      const fill = colored ? colorOf(s.e.host) : GRAY_FILL;
      el.style.left = s.x + "px";
      el.style.width = s.w + "px";
      el.style.top = bandBottom - h + "px";
      el.style.height = h + "px";
      el.style.background = fill;
      el.style.borderColor = colored ? rimOf(fill) : GRAY_RIM;
      el.title = s.collapsed ? "" : tooltip(s.e);
      // Collapsed sticks are inert; their cluster's plate is the one target.
      el.style.pointerEvents = s.collapsed ? "none" : "auto";
      el.onclick = s.collapsed
        ? null
        : s.clusterKey
          ? () => toggle(s.clusterKey) // expanded member: click re-collapses
          : () => chrome.tabs.create({ url: s.e.url });
    }
    for (const [key, el] of blockEls) {
      if (!seen.has(key)) {
        el.remove();
        blockEls.delete(key);
      }
    }

    // Invisible hit plate spanning each collapsed fence: hover + click target.
    for (const p of plates) {
      const el = document.createElement("div");
      el.className = "plate transient";
      el.style.left = p.x + "px";
      el.style.width = Math.max(p.w, MIN_W) + "px";
      el.style.top = TITLE_AREA + "px";
      el.style.height = BAND_H + "px";
      const active = p.members.reduce((t, m) => t + m.durMs, 0);
      el.title = `${p.members.length} rapid events · ${fmtDuration(active)} — click to expand`;
      el.addEventListener("click", () => toggle(p.key));
      ribbon.appendChild(el);
    }

    // Underline bar grouping each expanded run; click re-collapses.
    for (const b of bars) {
      const el = document.createElement("div");
      el.className = "xbar transient";
      el.style.left = b.x + "px";
      el.style.width = b.w + "px";
      el.style.top = bandBottom + BAR_GAP + "px";
      el.title = "click to collapse";
      el.addEventListener("click", () => toggle(b.key));
      ribbon.appendChild(el);
    }

    for (const m of hourMarks(segs)) {
      const tick = document.createElement("div");
      tick.className = "tick transient";
      tick.style.left = m.x + "px";
      tick.style.top = bandBottom + TICK_TOP + "px";
      tick.style.height = TICK_H + "px";
      ribbon.appendChild(tick);
      const label = document.createElement("div");
      label.className = "hlabel transient";
      label.style.left = m.x + 5 + "px";
      label.style.top = bandBottom + TICK_TOP + "px";
      label.textContent = fmtHour(m.t);
      ribbon.appendChild(label);
    }

    for (const run of titleRuns(groupRuns(segs))) {
      const el = document.createElement("div");
      el.className = "rtitle transient";
      // rotate(-90deg) about the bottom-LEFT corner sweeps the glyph column
      // into the ~17px to the LEFT of the anchor (verified 2026-07-15 after
      // getting the direction wrong once) — so anchor half a line-height
      // RIGHT of center to center the column on the run. Obvious on 3px
      // fence slivers, invisible on wide runs.
      el.style.left = run.center + 9 + "px";
      el.style.top = TITLE_AREA - 8 + "px";
      el.style.color = colorOf(run.host);
      const name = siteNameOf(run.titles) || run.host;
      el.textContent =
        name.length > TITLE_MAX_CHARS ? name.slice(0, TITLE_MAX_CHARS) + "…" : name;
      ribbon.appendChild(el);
    }

    log(`rendered ${segs.length} blocks in ${plates.length} fences + ${bars.length} expanded, ${total}px wide`);
  }

  window.renderTimeline = render;
  // Single source of truth for scoring — the Score-table button in
  // dashboard.js uses these so diagnostics can never drift from the render.
  window.FS_SCORING = { scoreSession, attendedSeconds, bandFor, hostOf };
})();
