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

  const HOUR = 3600 * 1000;
  const HOURS_BACK = 24; // single backward look; paging between days is later
  // Visit-merge gap limit: a brief tab-away stays the same visit; coming
  // back after minutes of absence is a NEW visit (interruption-by-absence).
  const VISIT_GAP_MS = 5 * 60 * 1000;
  // Container chains bridge longer gaps when both bookend fragments are
  // audible-dominated — a meeting's own audio testifies the context never
  // ended while the user was off on a whiteboard (spec §6 containers).
  const AUDIO_BOOKEND_GAP_MS = 30 * 60 * 1000;

  // --- Layout (px). The timeline is the PRIMARY view (spec §6) — sized
  // generously; the debug list below is secondary. 1 hour ≈ 540px.
  const PX_PER_SEC = 0.15;
  const MIN_W = 8; // floor: smallest visible/hoverable block
  const GAP = 2;
  const BAND_H = 144;
  const TIER_H = { high: 144, medium: 115, low: 86 }; // bottom-flush; top edge = importance contour
  const STICK_W = 3; // fence stick: deliberately narrower than any real block
  const STICK_GAP = 1;
  // Two time scales (spec §6): presence renders at PX_PER_SEC; absence
  // renders at GAP_HOUR_PX per absent hour (~1/12 speed). Proportional
  // everywhere — hour boundaries have no effect on width; ticks just
  // interpolate through gaps like they do through blocks.
  const GAP_HOUR_PX = 44;
  const MIN_RUN = 2; // even a pair of lows fences
  const TITLE_AREA = 170; // space above the band for rotated run titles
  // Axis strip below the band, in two lanes so nothing overlaps (spec §6):
  // expand bars snug under the band, then a clear gap, then ticks + labels.
  const TICK_TOP = 16; // band bottom → tick/label lane (expand-bar hit zone fills the gap)
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
  // can't: revisit structure. Self-legending via labels.
  //
  // Assignment is a persisted FIRST-SEEN REGISTRY, not a hash: the first
  // time a host ever earns MEDIUM+, it claims the next palette slot,
  // round-robin, forever (chrome.storage.local "hostColorOrder"). Hashing
  // clumped on real data (google/linkedin/bsky drew three adjacent greens —
  // no exact collision needed for a clash); window-relative rotation would
  // reshuffle identities as the window slides. First-seen order gives
  // locality (first 16 colored hosts ever are mutually distinct) AND
  // cross-day permanence. Wrap collisions start at colored-host #17 —
  // oldest assignments, temporally distant in practice; revisit with data.
  //
  // Kelly's 22 colors of maximum contrast, in Kelly's ORDER (the sequence
  // is the point: the first N entries are always maximally contrasting, a
  // perfect match for slot claiming). White/black/gray removed, plus the
  // three darkest (reddish/yellowish brown, dark olive) — low-saturation
  // darks converge on the noise-gray and read as unimportant. 16 remain.
  // Buff is on watch: grayish by design but light; cut to 15 if it muddies.
  const PALETTE = [
    "#F3C300", // vivid yellow
    "#875692", // strong purple
    "#F38400", // vivid orange
    "#A1CAF1", // light blue
    "#BE0032", // vivid red
    "#C2B280", // buff
    "#008856", // vivid green
    "#E68FAC", // purplish pink
    "#0067A5", // strong blue
    "#F99379", // yellowish pink
    "#604E97", // strong violet
    "#F6A600", // orange yellow
    "#B3446C", // purplish red
    "#DCD300", // greenish yellow
    "#8DB600", // yellow green
    "#E25822", // reddish orange
  ];
  const GRAY_FILL = "#3e434c";
  const GRAY_RIM = "#5b616c";

  // Claim order of every host that ever earned a color; index % 12 = slot.
  // null until loaded from storage (render defers until then). The dashboard
  // page is the only writer, so an in-memory copy + fire-and-forget set is
  // race-free.
  let hostOrder = null;

  function claimColors(events) {
    let changed = false;
    for (const e of events) {
      if (e.band !== "low" && !hostOrder.includes(e.host)) {
        log(`color slot ${hostOrder.length % PALETTE.length} claimed by ${e.host}`);
        hostOrder.push(e.host);
        changed = true;
      }
    }
    if (changed) chrome.storage.local.set({ hostColorOrder: hostOrder });
  }

  // Unregistered hosts (open-fence members of LOW-only hosts, spec §6
  // fence-open relaxation) CONTINUE the Kelly sequence past the registry:
  // first-appearance order, rebuilt every render, never persisted. So
  // everything visible is a Kelly PREFIX — registered + transient are
  // mutually max-contrast by construction. Hashing is gone: Kelly's
  // guarantee is prefix-only, and hashed fallbacks sampled LATE entries,
  // which sit intentionally close to early ones (orange-yellow drew next
  // to a claimed orange) — three collision bugs in two days, all hashing.
  let transientSlots = new Map();

  function colorOf(host) {
    const idx = hostOrder ? hostOrder.indexOf(host) : -1;
    if (idx !== -1) return PALETTE[idx % PALETTE.length];
    // Lazy claim: colorOf is only reached for hosts being drawn in color,
    // and blocks draw chronologically, so first call = first appearance.
    if (!transientSlots.has(host)) {
      transientSlots.set(host, (hostOrder || []).length + transientSlots.size);
    }
    return PALETTE[transientSlots.get(host) % PALETTE.length];
  }
  const rimOf = (color) => `color-mix(in srgb, ${color} 65%, white)`;

  // Keep the in-memory registry in sync with storage — covers "Clear data"
  // (dashboard.js removes the key) without a page reload. Our own writes
  // land here too; reassigning identical content is harmless.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && "hostColorOrder" in changes) {
      hostOrder = changes.hostColorOrder.newValue || [];
    }
  });

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
      e.children
        ? `container: ${e.members.length} visits + ${e.children.length} excursions inside`
        : e.members
          ? `${e.members.length} pages merged`
          : "",
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
          // Containers chain by tabId; a merged visit keeps it only if
          // unambiguous across members.
          tabId: run.every((m) => m.tabId === run[0].tabId) ? run[0].tabId : undefined,
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

  // Container events (spec §6): a tab the user keeps RETURNING to is a
  // journey context — returning is the strongest intent signal we have.
  // Same-tabId fragments chain when the excursion returns within
  // VISIT_GAP_MS, or within AUDIO_BOOKEND_GAP_MS when both bookends are
  // audible-dominated. A chain whose SUMMED score reaches HIGH becomes a
  // container: fragments merge into the anchor (width = wall-clock span),
  // foreign events inside the span become contained children. Guards so
  // the big-email case can never trigger this: foreign interruptions are
  // REQUIRED (≥1 child), individually-HIGH events never chain, and a
  // chain whose span holds a same-tab HIGH event is rejected (that event
  // owns the story).
  function detectContainers(events) {
    const audibleDominated = (e) => (e.audibleMs || 0) >= 0.5 * e.durMs;
    const open = new Map(); // tabId -> fragments of the currently open chain
    const chains = [];
    const close = (frags) => {
      if (frags.length >= 2) chains.push(frags);
    };
    for (const e of events) {
      if (e.tabId == null || e.band === "high") continue;
      const frags = open.get(e.tabId);
      if (frags) {
        const last = frags[frags.length - 1];
        const gap = e.startTime - last.endTime;
        const bridged =
          gap < VISIT_GAP_MS ||
          (gap < AUDIO_BOOKEND_GAP_MS && audibleDominated(e) && audibleDominated(last));
        if (bridged) {
          frags.push(e);
          continue;
        }
        close(frags);
        open.delete(e.tabId);
      }
      open.set(e.tabId, [e]);
    }
    for (const frags of open.values()) close(frags);

    const qualifying = chains
      .map((frags) => ({ frags, score: frags.reduce((t, f) => t + f.score, 0) }))
      .filter((c) => c.score >= HIGH_SCORE)
      .sort((a, b) => b.score - a.score);

    const containers = [];
    const absorbed = new Set();
    for (const c of qualifying) {
      const from = c.frags[0].startTime;
      const to = c.frags[c.frags.length - 1].endTime;
      // Overlapping qualifying chains: higher sum already won (sort order).
      if (containers.some((k) => from < k.endTime && to > k.startTime)) continue;
      const fragSet = new Set(c.frags);
      const children = events.filter(
        (e) => !fragSet.has(e) && e.startTime >= from && e.endTime <= to
      );
      if (!children.length) continue; // no foreign interruptions
      if (children.some((e) => e.tabId === c.frags[0].tabId && e.band === "high")) continue;
      const activity = {};
      let heartbeats = 0;
      let audibleMs = 0;
      for (const f of c.frags) {
        heartbeats += f.heartbeats || 0;
        audibleMs += f.audibleMs || 0;
        for (const [k, v] of Object.entries(f.activity || {})) {
          if (v) activity[k] = (activity[k] || 0) + v;
        }
      }
      const top = c.frags.reduce((a, b) => (b.score > a.score ? b : a));
      containers.push({
        id: "k" + c.frags[0].id,
        url: top.url, // click target: the anchor's top-scoring fragment
        title: top.title,
        host: c.frags[0].host,
        tabId: c.frags[0].tabId,
        startTime: from,
        endTime: to,
        durMs: to - from, // SPAN — the width-rule exception (spec §6)
        heartbeats,
        audibleMs,
        activity,
        score: c.score, // summed fragment scores: add up, then judge
        band: "high",
        members: c.frags,
        children,
      });
      for (const f of c.frags) absorbed.add(f);
      for (const ch of children) absorbed.add(ch);
      log(
        `container: ${c.frags[0].host} ${fmtClock(from)}–${fmtClock(to)} · ` +
          `${c.frags.length} visits + ${children.length} excursions · score ${Math.round(c.score)}`
      );
    }
    if (!containers.length) return events;
    const out = events.filter((e) => !absorbed.has(e));
    out.push(...containers);
    out.sort((a, b) => a.startTime - b.startTime);
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
        // Absence splits fences (spec §5 generalized, same constant as
        // visit merging): events separated by a real gap aren't "rapid",
        // and a fence spanning an away-hole hid the gap's hover plate.
        const prev = run[run.length - 1];
        if (prev && event.startTime - prev.endTime >= VISIT_GAP_MS) flush();
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
    // Leading pad from the floor hour at GAP scale — absence is absence,
    // including the absence before the first block (spec §6: hour labels
    // stay clean whole hours; the pad does the honesty).
    const first = items[0] && (items[0].kind === "cluster" ? items[0].members[0] : items[0].event);
    let cursor = first ? (msPastHour(first.startTime) / HOUR) * GAP_HOUR_PX : 0;
    const segs = [];
    const plates = [];
    const bars = [];
    const gaps = [];
    let prevEnd = null; // wall-clock end of the previously laid element
    // Absence at gap scale (spec §6 two time scales): every gap between
    // drawn elements — fence sticks included — gets width proportional to
    // its true duration, ticks interpolated linearly inside. No hour-
    // boundary special case; a 30s tab-hop allocates a fraction of a px.
    const allocGap = (nextStart) => {
      if (prevEnd === null) return;
      const w = ((nextStart - prevEnd) / HOUR) * GAP_HOUR_PX;
      const marks = [];
      for (let t = prevEnd - msPastHour(prevEnd) + HOUR; t < nextStart; t += HOUR) {
        marks.push({ t, x: cursor + ((t - prevEnd) / HOUR) * GAP_HOUR_PX });
      }
      if (w > 0 || marks.length) {
        gaps.push({ x: cursor, w, from: prevEnd, to: nextStart, marks });
        cursor += w;
      }
    };
    const widthOf = (e) => Math.max(MIN_W, (e.durMs / 1000) * PX_PER_SEC);
    for (const item of items) {
      if (item.kind === "cluster" && !expanded.has(item.key)) {
        let left = null;
        for (const e of item.members) {
          allocGap(e.startTime);
          if (left === null) left = cursor;
          segs.push({
            e,
            key: e.id,
            clusterKey: item.key,
            collapsed: true,
            band: "low",
            w: STICK_W,
            x: cursor,
          });
          cursor += STICK_W + STICK_GAP;
          prevEnd = e.endTime;
        }
        cursor -= STICK_GAP;
        plates.push({ key: item.key, members: item.members, x: left, w: cursor - left });
        cursor += GAP;
      } else {
        const members = item.kind === "cluster" ? item.members : [item.event];
        let start = null;
        for (const e of members) {
          allocGap(e.startTime);
          if (start === null) start = cursor;
          let w = widthOf(e);
          // Contained children sit at their time-proportional offsets
          // inside the span-scaled container, pushed right — and the
          // container stretched — when min-width floors would collide
          // (spec §6 containers, rule 6).
          const kids = [];
          if (e.children) {
            const span = e.endTime - e.startTime;
            let prevRight = -Infinity;
            for (const k of e.children) {
              const kw = Math.max(MIN_W, (k.durMs / 1000) * PX_PER_SEC);
              let kx = span > 0 ? ((k.startTime - e.startTime) / span) * w : 0;
              if (kx < prevRight + GAP) kx = prevRight + GAP;
              prevRight = kx + kw;
              kids.push({ k, kx, kw });
            }
            w = Math.max(w, prevRight + GAP);
          }
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
          for (const kid of kids) {
            segs.push({
              e: kid.k,
              key: kid.k.id,
              clusterKey: null,
              collapsed: false,
              contained: true,
              // Capped at MEDIUM: containment frames — never confers,
              // never destroys. A HIGH excursion keeps width + hover
              // truth but not the container's silhouette.
              band: kid.k.band === "high" ? "medium" : kid.k.band,
              w: kid.kw,
              x: cursor + kid.kx,
            });
          }
          cursor += w + GAP;
          prevEnd = e.endTime;
        }
        if (item.kind === "cluster") {
          bars.push({ key: item.key, x: start, w: cursor - GAP - start });
        }
      }
    }
    return { segs, plates, bars, gaps, total: Math.max(cursor - GAP, 0) };
  }

  // Ribbon X is NOT linear time (widths are floored), so each whole hour is
  // placed at the time-interpolated X within whichever block was active
  // then. Hours that fell between blocks already own uniform gap slots from
  // layout — the old clamp-to-edge case (which shingled labels when a
  // multi-hour absence stacked its hours on one x) no longer exists.
  function hourMarks(segs, gaps) {
    if (!segs.length) return [];
    const first = segs[0];
    const gapX = new Map();
    for (const g of gaps) for (const m of g.marks) gapX.set(m.t, m.x);
    // First tick: the floor hour, sitting at the left edge of the pad (the
    // pad is absence, so it's gap-scaled) — a clean whole-hour label with
    // the first block proportionally inset.
    const floorT = first.e.startTime - msPastHour(first.e.startTime);
    const marks = [{ t: floorT, x: first.x - (msPastHour(first.e.startTime) / HOUR) * GAP_HOUR_PX }];
    const lastEnd = segs[segs.length - 1].e.endTime;
    for (let t = floorT + HOUR; t <= lastEnd; t += HOUR) {
      if (gapX.has(t)) {
        marks.push({ t, x: gapX.get(t) });
        continue;
      }
      for (const s of segs) {
        if (t >= s.e.startTime && t <= s.e.endTime) {
          const span = s.e.endTime - s.e.startTime;
          marks.push({ t, x: s.x + (span > 0 ? ((t - s.e.startTime) / span) * s.w : 0) });
          break;
        }
      }
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

  // --- Custom tooltip (spec §6, plans/tooltip_snapshot_plan.md Part 1).
  // Native title tooltips have uncontrollable warm-up timing (~1s cold,
  // near-instant warm, any click resets it) — so ribbon elements carry
  // data-tip instead, shown by one delegated timer at a uniform delay.
  // Text lands via textContent only: titles/URLs are page-controlled.
  const TIP_DELAY_MS = 300;
  const tip = document.createElement("div");
  tip.id = "tip";
  tip.hidden = true;
  document.body.appendChild(tip);
  let tipTimer = null;

  function hideTip() {
    clearTimeout(tipTimer);
    tipTimer = null;
    tip.hidden = true;
  }

  {
    const ribbonEl = document.getElementById("ribbon");
    ribbonEl.addEventListener("pointerover", (ev) => {
      hideTip();
      const el = ev.target.closest("[data-tip]");
      if (!el) return;
      const px = ev.clientX;
      const py = ev.clientY;
      tipTimer = setTimeout(() => {
        tip.textContent = el.dataset.tip;
        tip.hidden = false;
        // Measure after content is set; clamp to the viewport (flip above
        // the cursor rather than run off the bottom).
        const r = tip.getBoundingClientRect();
        let left = px + 12;
        let top = py + 12;
        if (left + r.width > innerWidth - 4) left = Math.max(4, innerWidth - r.width - 4);
        if (top + r.height > innerHeight - 4) top = Math.max(4, py - r.height - 12);
        tip.style.left = left + "px";
        tip.style.top = top + "px";
      }, TIP_DELAY_MS);
    });
    ribbonEl.addEventListener("pointerout", hideTip);
    ribbonEl.addEventListener("pointerdown", hideTip);
  }

  function render(sessions) {
    lastSessions = sessions;
    // First render races the registry load: defer until it's in memory,
    // then re-enter (idempotent; extra calls just repaint).
    if (!hostOrder) {
      chrome.storage.local.get("hostColorOrder").then(({ hostColorOrder = [] }) => {
        hostOrder = hostColorOrder;
        render(lastSessions);
      });
      return;
    }
    // Claim registry colors BEFORE containment: a host whose MEDIUM block
    // ends up contained still earned its permanent identity slot.
    const merged = mergeVisits(parseSessions(sessions));
    claimColors(merged);
    const events = detectContainers(merged);
    transientSlots = new Map(); // transient colors never outlive a render
    const items = clusterEvents(events);
    const { segs, plates, bars, gaps, total } = layout(items, expanded);

    // Hosts that earned an identity hue: any MEDIUM+ event qualifies the
    // whole host, so its LOW visits share the color (revisit structure).
    // Judged pre-containment: a contained MEDIUM still qualifies its host.
    const coloredHosts = new Set(merged.filter((e) => e.band !== "low").map((e) => e.host));

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
      // Identity hue for qualifying hosts; members of an OPEN fence and
      // contained children are always colored (relaxation rules).
      // Collapsed sticks and LOW-only hosts stay gray.
      const colored =
        s.contained || (!s.collapsed && (coloredHosts.has(s.e.host) || s.clusterKey != null));
      const fill = colored ? colorOf(s.e.host) : GRAY_FILL;
      // Children draw on top of their container; persistent els can be in
      // any DOM order, so z-index does it (cleared when not contained).
      el.style.zIndex = s.contained ? 2 : "";
      // Snap to the pixel grid at paint time (layout stays fractional):
      // sub-pixel edges anti-alias, which reads as fuzz on narrow blocks.
      // Rounding the right edge (not the width) keeps snapped neighbors
      // adjacent.
      el.style.left = Math.round(s.x) + "px";
      el.style.width = Math.round(s.x + s.w) - Math.round(s.x) + "px";
      el.style.top = bandBottom - h + "px";
      el.style.height = h + "px";
      // Containers: 25% wash + 2px full-strength border (.cont CSS), the
      // border carrying identity; everything else keeps the solid fill.
      const isCont = !!s.e.children;
      el.classList.toggle("cont", isCont);
      if (isCont) {
        el.style.setProperty("--host", fill);
        el.style.background = "";
        el.style.borderColor = fill;
      } else {
        el.style.removeProperty("--host");
        el.style.background = fill;
        el.style.borderColor = colored ? rimOf(fill) : GRAY_RIM;
      }
      if (s.collapsed) delete el.dataset.tip;
      else el.dataset.tip = tooltip(s.e);
      // Collapsed sticks are inert; their cluster's plate is the one target.
      // Every visible block navigates — expanded fence members included
      // (spec §6: click means "open this page" everywhere; collapse is the
      // expand bar or Escape).
      el.style.pointerEvents = s.collapsed ? "none" : "auto";
      el.onclick = s.collapsed ? null : () => chrome.tabs.create({ url: s.e.url });
    }
    for (const [key, el] of blockEls) {
      if (!seen.has(key)) {
        el.remove();
        blockEls.delete(key);
      }
    }

    // Invisible hover plate over each gap region: the exact away-span, same
    // tooltip-as-ground-truth convention as blocks. Not clickable — and
    // appended BEFORE fence plates so a hole inside a collapsed fence still
    // expands on click (the fence plate wins the overlap). Sliver gaps
    // (<6px) skip the plate: untargetable, and they'd shadow neighbors.
    for (const g of gaps) {
      if (g.w < 6) continue;
      const el = document.createElement("div");
      el.className = "gap transient";
      el.style.left = g.x + "px";
      el.style.width = g.w + "px";
      el.style.top = TITLE_AREA + "px";
      el.style.height = BAND_H + "px";
      el.dataset.tip = `away ${fmtClock(g.from)} – ${fmtClock(g.to)} · ${fmtDuration(g.to - g.from)}`;
      ribbon.appendChild(el);
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
      el.dataset.tip = `${p.members.length} rapid events · ${fmtDuration(active)} — click to expand`;
      el.addEventListener("click", () => toggle(p.key));
      ribbon.appendChild(el);
    }

    // Underline bar grouping each expanded run; click re-collapses.
    for (const b of bars) {
      const el = document.createElement("div");
      el.className = "xbar transient";
      el.style.left = b.x + "px";
      el.style.width = b.w + "px";
      // Hit zone starts at the band edge and fills the lane down to the
      // ticks; the 4px visual bar is the ::after in .xbar (index.html).
      el.style.top = bandBottom + "px";
      el.dataset.tip = "click to collapse";
      el.addEventListener("click", () => toggle(b.key));
      ribbon.appendChild(el);
    }

    for (const m of hourMarks(segs, gaps)) {
      const tick = document.createElement("div");
      tick.className = "tick transient";
      // Snap: a 1px line on a fractional x anti-aliases into a 2px smear.
      tick.style.left = Math.round(m.x) + "px";
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

    // Contained children never label (spec §6: hover only) and must not
    // fragment their container's title run.
    for (const run of titleRuns(groupRuns(segs.filter((s) => !s.contained)))) {
      const el = document.createElement("div");
      el.className = "rtitle transient";
      // rotate(-90deg) about the bottom-LEFT corner sweeps the glyph column
      // into the ~17px to the LEFT of the anchor (verified 2026-07-15 after
      // getting the direction wrong once) — so anchor half a line-height
      // RIGHT of center to center the column on the run. Obvious on 3px
      // fence slivers, invisible on wide runs.
      el.style.left = run.center + 9 + "px";
      // The rotated text column's BOTTOM lands at top + line-height (16px,
      // fixed in CSS). Anchor so it clears the band ceiling by 4px — HIGH
      // blocks fill the full band, and the old -8 anchor dipped labels
      // ~10px into them (invisible until containers made HIGH common).
      el.style.top = TITLE_AREA - 20 + "px";
      // Rim mix, not the raw fill: dark palette entries (vivid red, strong
      // blue/violet) are illegible as text on the dark ribbon.
      el.style.color = rimOf(colorOf(run.host));
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
