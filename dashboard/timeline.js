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
  // "The read" premium (spec §6, 2026-07-15): per active scroll window, ONLY
  // on scrollable pages — app-style SPAs (feeds, Maps, Gemini) scroll inner
  // containers and read scrollable=false, so the gate excludes exactly the
  // grazing/churn false positives. Tuned offline against a real day: W=5
  // promoted one block (a read article); W=3 rescued nothing.
  const W_SCROLL = 5;
  // The traversal term (spec §6 Score v1, 2026-07-24): thread assembly adds
  // this per JOIN — machinery navigations and returns alike — on top of the
  // summed member totals. Multiple committed page views are intent the
  // per-signal totals can't see; the joins counted are exactly the
  // survivors of the SPA debounce, blip, and transit filters, so
  // view-state churn and redirect machinery contribute nothing. No
  // user-act gate (rejected on data — plans). Single-day-validated;
  // retest before tuning (watch list).
  const W_NAV = 50;
  const HIGH_SCORE = 1000;
  const MED_SCORE = 150;

  const HOUR = 3600 * 1000;
  // Visit-merge gap limit: a brief tab-away stays the same visit; coming
  // back after minutes of absence is a NEW visit (interruption-by-absence).
  const VISIT_GAP_MS = 5 * 60 * 1000;
  // Container chains bridge longer gaps on gap-audio testimony (revised
  // 2026-07-24; was audible-dominated bookends): the resuming fragment's
  // audibleSinceTs must predate the gap — the tab's own audio testifies
  // the context never ended while the user was off on a whiteboard
  // (spec §6 containers).
  const AUDIO_BOOKEND_GAP_MS = 30 * 60 * 1000;

  // --- Layout (px). The timeline is the PRIMARY view (spec §6) — sized
  // for a NORMAL day (spec §6, halved again 2026-07-17 on real data):
  // 1 hour ≈ 135px, so a full day reads as a one-glance overview and a
  // light day reads light instead of inflating its small events.
  const PX_PER_SEC = 0.0375;
  const MIN_W = 8; // floor: smallest visible/hoverable block
  const GAP = 2;
  const BAND_H = 144;
  // Bottom-flush; top edge = importance contour. One height per tier —
  // three tiers, three heights (spec §6, 2026-07-24): LOW lowered 86 → 40
  // to calm the container comb globally, not via a fourth contained-only
  // stature; MEDIUM re-seated at the LOW/HIGH midpoint (115 read too close
  // to HIGH after the drop).
  const TIER_H = { high: 144, medium: 92, low: 40 };
  const STICK_W = 3; // fence stick: deliberately narrower than any real block
  const STICK_GAP = 1;
  const CUT_SEAM = 2; // .blk.cut border-width (index.html): the page-background seam around contained children
  // Two time scales (spec §6): presence renders at PX_PER_SEC; absence
  // renders at GAP_HOUR_PX per absent hour (~1/6 speed — halved together
  // with PX_PER_SEC 2026-07-17 to preserve the ratio; watch gap loudness).
  // Proportional everywhere — hour boundaries have no effect on width;
  // ticks just interpolate through gaps like they do through blocks.
  const GAP_HOUR_PX = 22;
  // Sliver threshold, two surfaces (spec §6, 2026-07-24): gaps rendering
  // narrower than this are untargetable (no hover plate) — and fences may
  // span exactly those gaps, so a fence can never cover a plate. The
  // fence-split test is this width converted back to time (~16 min at the
  // current absence scale; self-adjusts if GAP_HOUR_PX is tuned).
  const GAP_PLATE_MIN_PX = 6;
  const FENCE_SPLIT_GAP_MS = (GAP_PLATE_MIN_PX / GAP_HOUR_PX) * HOUR;
  const MIN_RUN = 1; // even a lone low fences (2026-07-16: opinionated demoting)
  const TITLE_AREA = 170; // space above the band for rotated run titles
  // Axis strip below the band, in two lanes so nothing overlaps (spec §6):
  // expand bars snug under the band, then a clear gap, then ticks + labels.
  const TICK_TOP = 16; // band bottom → tick/label lane (expand-bar hit zone fills the gap)
  const TICK_H = 12;
  const AXIS_AREA = 46;
  const TITLE_CLEARANCE = 20; // min horizontal px between rotated title anchors
  const LABEL_CLEARANCE = 6; // min px between hour labels; colliders drop, never nudge (spec §6)
  const TITLE_MAX_CHARS = 20;
  // Week strip (spec §6, 2026-07-17): a cell is the ribbon's TOP EDGE — the
  // importance contour — on LINEAR time. Height is the only encoding, in the
  // ribbon's tier proportions (1 / 0.8 / 0.6 of the strip height).
  const STRIP_TIER_H = { high: 30, medium: 24, low: 18 };
  const STRIP_H = STRIP_TIER_H.high;
  const STRIP_BIN_MS = 15 * 60 * 1000;
  const STRIP_BIN_PX = 3;
  const STRIP_RANK = { low: 1, medium: 2, high: 3 };
  const STRIP_BAND = [null, "low", "medium", "high"];

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
      Math.min(a.keyboard || 0, KBD_CAP) +
      (s.scrollable ? W_SCROLL * (a.scroll || 0) : 0)
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

  // Color = identity, rationed by HIGH anchoring (spec §6, 2026-07-18):
  // only hosts with a HIGH *display event* (merged visit or container —
  // chain-level, not raw session) somewhere in the stored week get an
  // identity hue. Everything they touch that week shares it — their
  // MEDIUMs and LOWs show the revisit structure of the threads that
  // mattered — while every other host renders neutral gray, MEDIUMs
  // included. Rationing by MEDIUM proved unbounded: the registry hit 20
  // hosts in four days and wrap collisions landed on hosts in daily use
  // (youtube/notebooklm both light blue). HIGH-anchored hosts run ~6/week
  // — under half the palette, near-max mutual contrast.
  //
  // Assignment is a persisted FIRST-SEEN REGISTRY, not a hash: the first
  // time a host anchors, it claims the earliest free palette slot, forever
  // (chrome.storage.local "hostColorOrder"). Hashing clumped on real data
  // (google/linkedin/bsky drew three adjacent greens — no exact collision
  // needed for a clash); window-relative rotation would reshuffle
  // identities as the window slides. TOMBSTONES (2026-07-18): a registered
  // host with no stored HIGH left has aged out of the 7-day window — its
  // entry is nulled IN PLACE (indices are identities; living hosts never
  // reshuffle) and the slot is reused by the next new anchor. Any subset
  // of the 16-slot Kelly prefix stays mutually max-contrast, so sparse
  // occupancy is safe.
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
  const PAGE_BG = "#14161a"; // ribbon ground; also the cut-out seam color
  // Collapsed fence sticks: solid, borderless, darker than GRAY_FILL — a
  // 3px stick is nearly all rim if it keeps the 1px outline, and the fence
  // should whisper (visible but very subtle).
  const STICK_FILL = "#2f333b";
  // Tier brightness (spec §6, 2026-07-17): HIGH paints the full host color;
  // colored blocks below HIGH paint a solid mix toward the page background —
  // opaque paint, never alpha, so the look is ground-independent (a contained
  // MEDIUM matches its standalone twin). Knob: raise toward 65 if dark
  // palette entries start impersonating each other (watch list).
  const MEDIUM_MIX_PCT = 50;

  // Claim/tombstone array of anchored hosts; index % 16 = slot, null = a
  // released slot awaiting reuse. null (the whole array) until loaded from
  // storage (render defers until then). The dashboard page is the only
  // writer, so an in-memory copy + fire-and-forget set is race-free.
  let hostOrder = null;

  function claimColors(anchoredHosts) {
    let changed = false;
    // Tombstone sweep: release slots of hosts that no longer anchor.
    for (let i = 0; i < hostOrder.length; i++) {
      if (hostOrder[i] && !anchoredHosts.has(hostOrder[i])) {
        log(`color slot ${i % PALETTE.length} released by ${hostOrder[i]}`);
        hostOrder[i] = null;
        changed = true;
      }
    }
    for (const host of anchoredHosts) {
      if (hostOrder.includes(host)) continue;
      const free = hostOrder.indexOf(null);
      const slot = free !== -1 ? free : hostOrder.length;
      hostOrder[slot] = host;
      log(`color slot ${slot % PALETTE.length} claimed by ${host}`);
      changed = true;
    }
    if (changed) chrome.storage.local.set({ hostColorOrder: hostOrder });
  }

  // Transient (unregistered) colors retired 2026-07-18: colorOf is only
  // reached for anchored hosts, which claimColors registers before every
  // paint. Gray is the defensive fallback, never a lazy claim.
  function colorOf(host) {
    const idx = hostOrder ? hostOrder.indexOf(host) : -1;
    return idx !== -1 ? PALETTE[idx % PALETTE.length] : GRAY_FILL;
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
    const mins = Math.floor(secs / 60);
    if (mins < 60) return mins + "m" + String(secs % 60).padStart(2, "0") + "s";
    // Hour scale drops seconds: "3h49m", not "229m00s" — a multi-hour away
    // span is read at minute precision (spec §6 gap plates).
    return Math.floor(mins / 60) + "h" + String(mins % 60).padStart(2, "0") + "m";
  }

  function hourNum(t) {
    const h = new Date(t).getHours();
    return h % 12 === 0 ? 12 : h % 12;
  }

  function fmtHour(t) {
    return `${hourNum(t)}${new Date(t).getHours() < 12 ? "am" : "pm"}`;
  }

  function fmtClock(t) {
    return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  // Two-section tooltip data (spec §6, 2026-07-18): a user section (bold
  // site name, start + duration, member pages sorted by score) and a debug
  // section gated by TIP_DEBUG. Every string here is page-controlled — the
  // renderer (fillTip) lands them via textContent only, never innerHTML.
  const TIP_DEBUG = true; // demo period: scores + signals visible; flip off for normal use
  const TIP_TITLES_MAX = 8;
  function tipDataOf(e, siteName, ctx) {
    // A container's fragments can themselves be merged visits — flatten to
    // the underlying pages so the list shows what was actually read.
    const members = e.members ? e.members.flatMap((m) => m.members || [m]) : [e];
    // Untitled pages fall back to the URL, which can be a 2000-char OAuth
    // monster — cap every listed string (display truncation is CSS ellipsis;
    // this bounds what we store on the element).
    const cap = (t) => (t.length > 80 ? t.slice(0, 80) + "…" : t);
    // Page titles carry noise the tooltip shouldn't: leading unread
    // counters ("(379) …" — they also churn, defeating dedupe) and the
    // boilerplate site-name segment ("… - YouTube") that the bold headline
    // already states. Both stripped generically, front or back position
    // (same separator alphabet as siteNameOf).
    const esc = siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const clean = (t) =>
      t
        .replace(/^\(\d+\)\s*/, "")
        .replace(new RegExp(`\\s+[-–—|·/]\\s+${esc}\\s*$`), "")
        .replace(new RegExp(`^${esc}\\s+[-–—|·/]\\s+`), "");
    const byTitle = new Map(); // dedupe: one line per title, best score wins
    for (const m of members) {
      const t = cap(clean(m.title || m.url || ""));
      if (!t) continue;
      const prev = byTitle.get(t);
      if (!prev || m.score > prev.score) byTitle.set(t, m);
    }
    let pages = [...byTitle.entries()]
      .map(([title, m]) => ({ title, score: m.score, band: m.band }))
      .sort((a, b) => b.score - a.score);
    // A lone page repeating the site name says nothing — drop it.
    if (pages.length === 1 && pages[0].title === siteName) pages = [];
    const debug = [
      e.children
        ? `container: ${e.members.length} visits` +
          (e.children.length
            ? ` + ${e.children.length} excursions inside`
            : " (interruptions outside the browser)")
        : e.members
          ? `${e.members.length} pages merged`
          : "",
      Object.entries(e.activity || {})
        .filter(([, v]) => v)
        .map(([k, v]) => `${k} ${v}`)
        .join(" · "),
      // Exact wall-clock span stays here as ground truth (spec §6 hour axis).
      `score ${Math.round(e.score)} (${e.band}) · attended ${attendedSeconds(e)}s · ` +
        `${fmtClock(e.startTime)} – ${fmtClock(e.endTime)}`,
      cap(e.url || ""),
    ].filter(Boolean);
    return {
      siteName,
      meta: `${fmtClock(e.startTime)} · ${fmtDuration(e.durMs)}`,
      pages,
      ctx: ctx || "",
      debug,
    };
  }

  // Admission filter, display rung (spec §3). The predicate and its knobs
  // moved to shared/transit.js (2026-07-24): the service worker applies the
  // SAME rule at finalize to delete snapshots of rejected sessions, so the
  // two sides can never drift.
  const { isTransit } = FS_TRANSIT;

  // Day window (spec §6, 2026-07-16): the ribbon shows ONE local calendar
  // day. A session belongs to the day it ENDS in — midnight-straddlers are
  // rare and short, since tab switches finalize. setHours (not epoch math)
  // keeps midnights honest across DST.
  function dayStartOf(t) {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  function nextDayStart(t) {
    const d = new Date(t);
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }
  let viewDayStart = dayStartOf(Date.now());

  // Tab trees (spec §3/§6, 2026-07-19): capture stores the raw opener edge
  // (session.openerTabId); display resolves each tab to its tree ROOT and
  // threads chain per tree — "one tab and its spawn" (the feed pattern:
  // videos middle-clicked into their own tabs are one journey). Edges are
  // read from ALL stored sessions — an edge is a fact about the tab, not
  // the day, and transit-filtered sessions still testify (a filtered hop
  // can be the link between a grandchild and the root). An edgeless tab is
  // a tree of one, so cold tabs and pre-opener data stay flat.
  // Raw edges kept for the spawn-edge dominance discount (spec §6,
  // 2026-07-25): the discount walks the opener PATH, not the resolved
  // root — same-tree via a common ancestor is not spawn testimony.
  let openerEdges = new Map();
  function treeRootsOf(sessions) {
    const opener = new Map();
    for (const s of sessions) {
      if (s.tabId != null && s.openerTabId != null) opener.set(s.tabId, s.openerTabId);
    }
    openerEdges = opener;
    const roots = new Map();
    return function rootOf(id) {
      if (roots.has(id)) return roots.get(id);
      const seen = new Set();
      let t = id;
      while (opener.has(t) && !seen.has(t)) {
        seen.add(t);
        t = opener.get(t);
      }
      seen.add(id);
      for (const v of seen) roots.set(v, t);
      return t;
    };
  }

  function parseSessions(sessions) {
    const from = viewDayStart;
    const to = nextDayStart(viewDayStart);
    const rootOf = treeRootsOf(sessions);
    const inDay = sessions.filter((s) => s.endTime >= from && s.endTime < to && s.url);
    const transits = inDay.filter(isTransit);
    if (transits.length) log(`transit filter dropped ${transits.length} sessions`);
    // Exit inheritance (spec §6, 2026-07-24): dropping a transit stub must
    // not drop its boundary testimony. A stub that would have machinery-
    // joined its same-tab SAME-HOST predecessor is that run's true TAIL —
    // and a visit's exit is its last member's exit — so the predecessor
    // inherits the stub's endReason (overlay only; stored sessions stay
    // untouched). The host test carries the full join conditions: a
    // foreign-host stub (a link-out bounce) was never a would-be member
    // and must not manufacture succession licenses or departure testimony.
    // Without this a 3s next-video stub carries the run's tab_closed away
    // with it and the next queued tab can't succession-join (the Castella
    // specimen, plans); a stub ending tab_hidden likewise bequeaths honest
    // departure testimony for container guard 1.
    const inheritedExit = new Map(); // kept session id -> exit from dropped tail stubs
    const runTail = new Map(); // tabId -> { keeperId, end, reason, host } of the tab's live run
    for (const s of [...inDay].sort((a, b) => a.startTime - b.startTime)) {
      if (s.tabId == null) continue;
      const t = runTail.get(s.tabId);
      if (!isTransit(s)) {
        runTail.set(s.tabId, { keeperId: s.id, end: s.endTime, reason: s.endReason, host: hostOf(s) });
      } else if (
        t &&
        t.keeperId != null &&
        t.host === hostOf(s) &&
        MACHINERY_BOUNDARY.has(t.reason) &&
        s.startTime - t.end < CONTINUATION_GAP_MS
      ) {
        inheritedExit.set(t.keeperId, s.endReason);
        runTail.set(s.tabId, { keeperId: t.keeperId, end: s.endTime, reason: s.endReason, host: t.host });
      } else {
        // A stub that DIDN'T continue the run starts no run of its own —
        // it still occupies the tab slot so a later session can't inherit
        // across it.
        runTail.set(s.tabId, { keeperId: null, end: s.endTime, reason: s.endReason });
      }
    }
    return inDay
      .filter((s) => !isTransit(s))
      .map((s) => {
        const score = scoreSession(s);
        return {
          ...s,
          endReason: inheritedExit.get(s.id) ?? s.endReason,
          host: hostOf(s),
          score,
          band: bandFor(score),
          durMs: s.endTime - s.startTime,
          treeId: s.tabId != null ? rootOf(s.tabId) : undefined,
        };
      })
      .sort((a, b) => a.startTime - b.startTime);
  }

  // Same-host visit merging (spec §6): three merge licenses, all strict-
  // adjacency (nothing between members to hide):
  //   1. LOW rule (2026-07-15): consecutive same-host LOW events with gaps
  //      < VISIT_GAP_MS merge — a fragmented-but-engaged session (Maps
  //      pans, Gmail puttering) earns its combined stature.
  //   2. Continuation rule (2026-07-18): same-tab same-host fragments whose
  //      boundary is navigation machinery (spa_navigation/navigated —
  //      attention never left the tab) merge REGARDLESS of band. Three
  //      back-to-back YouTube videos are one watch, not three slivers.
  //   3. Succession rule (2026-07-24): same-TREE same-host fragments whose
  //      boundary is tab_closed merge REGARDLESS of band — closing a
  //      finished tab to land on the next queued same-host tab is
  //      cross-tab machinery, not departure (the middle-click batch
  //      pattern: one session across the tabs it spawned; the tree key is
  //      the intent test).
  // Individually-HIGH events never merge — they split the run and stand
  // alone (a block that's HIGH by itself owns its story). tab_hidden
  // boundaries never merge under rules 2/3: the user actually left, which
  // is container territory. Scored and banded on the MERGED totals.
  const CONTINUATION_GAP_MS = 30_000; // sanity bound; machinery gaps are ~0
  const MACHINERY_BOUNDARY = new Set(["spa_navigation", "navigated"]);
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
          // Snapshot candidates in score order (spec §6): the tooltip shows
          // the best member that HAS a picture — sub-10s stubs can win the
          // top score (flush-inflated attended) yet are never photographed.
          snapIds: [...run].sort((a, b) => b.score - a.score).map((m) => m.id),
          title: top.title,
          host: run[0].host,
          // Containers chain by tab TREE (2026-07-19; was tabId); a merged
          // visit keeps an identity only if unambiguous across members —
          // notably a cross-tab LOW merge within one tree stays
          // chain-eligible now (the feed pattern's glue used to strip it).
          tabId: run.every((m) => m.tabId === run[0].tabId) ? run[0].tabId : undefined,
          treeId: run.every((m) => m.treeId === run[0].treeId) ? run[0].treeId : undefined,
          // The LAST member's exit is the visit's exit — container guard 1
          // reads it to recognize departure-boundaries (spec §6).
          endReason: run[run.length - 1].endReason,
          startTime: run[0].startTime,
          endTime: run[run.length - 1].endTime,
          durMs, // sum of member durations (attention-honest width)
          heartbeats,
          audibleMs,
          activity,
          // OR of members: the merged score must keep the scroll premium a
          // member earned (the gate would otherwise silently drop it).
          scrollable: run.some((m) => m.scrollable),
          // The FIRST member is the one that resumed after any preceding
          // gap — its gap-audio testimony is the visit's (spec §6).
          ...(run[0].audibleSinceTs != null ? { audibleSinceTs: run[0].audibleSinceTs } : {}),
          members: run,
        };
        // Merged totals + the traversal term: every join — machinery
        // navigation or absence-bridge return — is a committed page view
        // the per-signal totals can't see (spec §6 Score v1, 2026-07-24).
        merged.score = scoreSession(merged) + W_NAV * (run.length - 1);
        merged.band = bandFor(merged.score);
        out.push(merged);
      }
      run = [];
    };
    for (const e of events) {
      const prev = run[run.length - 1];
      const lowMerge =
        e.band === "low" &&
        prev &&
        prev.band === "low" &&
        prev.host === e.host &&
        e.startTime - prev.endTime < VISIT_GAP_MS;
      const continuation =
        e.band !== "high" &&
        prev &&
        prev.host === e.host &&
        prev.tabId != null &&
        prev.tabId === e.tabId &&
        MACHINERY_BOUNDARY.has(prev.endReason) &&
        e.startTime - prev.endTime < CONTINUATION_GAP_MS;
      const succession =
        e.band !== "high" &&
        prev &&
        prev.host === e.host &&
        prev.treeId != null &&
        prev.treeId === e.treeId &&
        prev.endReason === "tab_closed" &&
        e.startTime - prev.endTime < CONTINUATION_GAP_MS;
      if (lowMerge || continuation || succession) {
        run.push(e);
      } else if (e.band !== "high") {
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
  // Same-TREE fragments chain (2026-07-19; was same-tabId — treeId is the
  // opener-resolved root, a tab tree being "one tab and its spawn") when
  // the excursion returns within
  // VISIT_GAP_MS, or within AUDIO_BOOKEND_GAP_MS on gap-audio testimony
  // (the tab stayed audible through the gap — 2026-07-24, see the bridge
  // test below). A chain whose SUMMED score reaches MEDIUM (lowered
  // from HIGH, 2026-07-18 — containers map the journey's shape, tier maps
  // importance) becomes a container: fragments merge into the anchor
  // (width = wall-clock span), foreign events inside the span become
  // contained children. Guards so the big-email case can never trigger
  // this: foreign interruptions are REQUIRED (≥1 child), and a HIGH event
  // never joins a FOREIGN-host chain — and no chain whose span would cover
  // a HIGH non-member survives qualification (tree-blind, 2026-07-24).
  // Since 2026-07-19 a HIGH MAY seed or join its own
  // host's chain in its own tab: excluding the anchor's HIGHs decapitated
  // the true anchor in territory contests (the bsky/gemini ping-pong —
  // the rump bsky chain summed 455 against gemini's 924 while the bsky
  // thread's two HIGHs held 2315 inadmissible points, so the tool framed
  // the work; replay evidence in plans). Sub-HIGH chains additionally
  // require ANCHOR DOMINANCE (anchor sum > children sum; spawn-edge
  // discount 2026-07-25 — see the guard below) — a weak anchor
  // framing stronger children is a launcher, and the children are the
  // story (validated 2026-07-18: dominance rejected all five launcher
  // patterns in a week's replay, e.g. interleaved shop/pay ping-pong
  // where two sites each tried to containerize the other). The HIGH path
  // keeps its original guards; dominance is deliberately not applied there.
  function detectContainers(events, quiet) {
    // Chains key on the (tree, host) PAIR (2026-07-19): a thread is a
    // same-host chain in one tab tree, so each host runs its own chain per
    // tree — a spawned foreign-host read neither joins nor breaks its
    // parent's chain (it becomes a child by falling inside the span), and
    // two hosts ping-ponging inside one tree each keep their own thread.
    // The pair key also makes relaxed guard 1 structural: a HIGH can only
    // ever extend its own host's thread; any HIGH non-member a chain's
    // span would cover is handled by the tree-blind covered-HIGH
    // rejection below (2026-07-24).
    const open = new Map(); // treeId|host -> fragments of the open chain
    const chains = [];
    const close = (frags) => {
      if (frags.length >= 2) chains.push(frags);
    };
    for (const e of events) {
      if (e.treeId == null) continue;
      const key = e.treeId + "|" + e.host;
      const frags = open.get(key);
      if (frags) {
        const last = frags[frags.length - 1];
        const gap = e.startTime - last.endTime;
        // Gap-audio testimony (spec §6, 2026-07-24): a long gap bridges
        // only when the resuming fragment's unbroken audible stretch began
        // BEFORE the previous fragment ended — the tab demonstrably kept
        // playing the whole time the user was away (a meeting talks
        // through its whiteboard gap; a paused video cannot testify).
        // Replaces the audible-dominated bookend proxy, which the fused
        // YouTube binge defeated (plans). Old sessions lack the stamp and
        // never long-bridge — fails closed.
        const bridged =
          gap < VISIT_GAP_MS ||
          (gap < AUDIO_BOOKEND_GAP_MS &&
            e.audibleSinceTs != null &&
            e.audibleSinceTs <= last.endTime);
        if (bridged) {
          frags.push(e);
          continue;
        }
        close(frags);
        open.delete(key);
      }
      open.set(key, [e]);
    }
    for (const frags of open.values()) close(frags);

    // Summed fragment scores + the traversal term for returns (spec §6
    // Score v1, 2026-07-24): fragment scores already carry their internal
    // join bonuses, so the chain adds only its own returns. Flows into
    // qualification (sum ≥ MEDIUM) and anchor dominance — returning
    // strengthens the anchor's claim, which is the point.
    const chainScore = (frags) =>
      frags.reduce((t, f) => t + f.score, 0) + W_NAV * (frags.length - 1);
    const queue = chains
      .map((frags) => ({ frags, score: chainScore(frags) }))
      .filter((c) => c.score >= MED_SCORE)
      .sort((a, b) => b.score - a.score);

    const containers = [];
    const absorbed = new Set();
    while (queue.length) {
      const c = queue.shift();
      const from = c.frags[0].startTime;
      const to = c.frags[c.frags.length - 1].endTime;
      // Overlap contest (trim-and-retest, 2026-07-19): the higher sum wins
      // the contested span, but the loser is trimmed, not discarded — a
      // handoff between two interleaved threads must not shatter the
      // loser's uncontested run (the 07-18 specimen: bsky's 13-minute
      // chain lost wholesale over a 4-minute seam). Fragments overlapping
      // an accepted container drop out (span-covered ones become its
      // children); the rest re-enter the contest as runs, split wherever
      // an accepted container sits between consecutive fragments,
      // re-summed and re-inserted in score order. Every trimmed piece is
      // strictly smaller than its chain, so the worklist terminates.
      if (containers.some((k) => from < k.endTime && to > k.startTime)) {
        const kept = c.frags.filter(
          (f) => !containers.some((k) => f.startTime < k.endTime && f.endTime > k.startTime)
        );
        const runs = [];
        let run = [];
        for (const f of kept) {
          const prev = run[run.length - 1];
          if (
            prev &&
            containers.some((k) => k.startTime < f.startTime && k.endTime > prev.endTime)
          ) {
            runs.push(run);
            run = [];
          }
          run.push(f);
        }
        if (run.length) runs.push(run);
        for (const r of runs) {
          if (r.length < 2) continue;
          const score = chainScore(r);
          if (score < MED_SCORE) continue;
          const i = queue.findIndex((q) => q.score < score);
          queue.splice(i < 0 ? queue.length : i, 0, { frags: r, score });
        }
        continue;
      }
      const fragSet = new Set(c.frags);
      const children = events.filter(
        (e) => !fragSet.has(e) && e.startTime >= from && e.endTime <= to
      );
      // Guard 1 (spec §6, revised 2026-07-16): interruptions are required,
      // but a departure-boundary counts — a non-final fragment that ended
      // tab_hidden means the user left and RETURNED, even when the
      // destination is invisible by design (another app, a browser-internal
      // page — both finalize as tab_hidden and render as gaps, not events).
      // spa_navigation/navigated boundaries never count: attention stayed,
      // the page turned over — continuous same-tab reading can't
      // self-containerize.
      const departures = c.frags.filter(
        (f, i) => i < c.frags.length - 1 && f.endReason === "tab_hidden"
      ).length;
      if (!children.length && !departures) continue; // no interruptions at all
      // Covered-HIGH guard, tree-blind (spec §6 atomicity, 2026-07-24):
      // containment is a demotion and must be earned by evidence, never
      // inferred from time-overlap — ANY individually-HIGH non-member
      // inside the span rejects the chain. Members are exempt by
      // construction: a HIGH in its own host's chain is a fragment, not a
      // child, so a thread can never break its own container.
      if (children.some((e) => e.band === "high")) continue;
      // Anchor dominance (sub-HIGH only): the anchor must outscore its
      // children, or it's a launcher and the children are the story.
      // Spawn-edge discount (spec §6, 2026-07-25): a child whose tab's
      // stored opener path reaches a member tab (≥1 edge — the anchor's
      // own tab never counts, so same-tab redirect interleaves keep full
      // weight) is the anchor's own dispatch and leaves the denominator;
      // the anchor must still INDIVIDUALLY outscore every discounted
      // spawn — a chain never frames a single event bigger than itself.
      if (c.score < HIGH_SCORE) {
        const memberTabs = new Set(
          c.frags.flatMap((f) => (f.members ? f.members.map((m) => m.tabId) : [f.tabId]))
        );
        const spawned = (e) =>
          (e.members ? e.members.map((m) => m.tabId) : [e.tabId]).every((t) => {
            if (t == null || memberTabs.has(t)) return false;
            const seen = new Set();
            while (openerEdges.has(t) && !seen.has(t)) {
              seen.add(t);
              t = openerEdges.get(t);
              if (memberTabs.has(t)) return true;
            }
            return false;
          });
        let denom = 0;
        let spawnTooBig = false;
        for (const e of children) {
          if (spawned(e)) spawnTooBig ||= e.score >= c.score;
          else denom += e.score;
        }
        if (spawnTooBig || c.score <= denom) continue;
      }
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
        // Snapshot candidates in score order (spec §6). A fragment can
        // itself be a merged visit whose synthetic "v…" id has no snapshot —
        // flatten through ITS snapIds to the underlying raw sessions.
        snapIds: [...c.frags]
          .sort((a, b) => b.score - a.score)
          .flatMap((f) => f.snapIds || [f.id]),
        title: top.title,
        host: c.frags[0].host,
        tabId: c.frags[0].tabId,
        startTime: from,
        endTime: to,
        durMs: to - from, // SPAN — the width-rule exception (spec §6)
        heartbeats,
        audibleMs,
        activity,
        scrollable: c.frags.some((f) => f.scrollable),
        score: c.score, // summed fragment scores + returns traversal term: add up, then judge
        band: bandFor(c.score),
        members: c.frags,
        children,
      });
      for (const f of c.frags) absorbed.add(f);
      for (const ch of children) absorbed.add(ch);
      if (!quiet)
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

  // Thread assembly (spec §6 aggregation, restructured 2026-07-18): the
  // display atom is the THREAD — merge across machinery boundaries, then
  // frame departures as containers. One name for the rulebook's central
  // operation; every consumer (ribbon, week strip, color anchoring) goes
  // through here.
  function assembleThreads(events, quiet) {
    return detectContainers(mergeVisits(events), quiet);
  }

  // Threads for every stored day (admission-filtered, scored, assembled;
  // quiet — the viewed day's loud assembly happens in render). Feeds the
  // week strip and color anchoring so both judge the same objects the
  // ribbon draws.
  function threadsByDay(sessions) {
    const rootOf = treeRootsOf(sessions);
    const byDay = new Map();
    for (const s of sessions) {
      if (!s.url || isTransit(s)) continue;
      const score = scoreSession(s);
      const e = {
        ...s,
        host: hostOf(s),
        score,
        band: bandFor(score),
        durMs: s.endTime - s.startTime,
        treeId: s.tabId != null ? rootOf(s.tabId) : undefined,
      };
      const day = dayStartOf(e.endTime);
      let arr = byDay.get(day);
      if (!arr) byDay.set(day, (arr = []));
      arr.push(e);
    }
    const out = new Map();
    for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
      const events = byDay.get(day).sort((a, b) => a.startTime - b.startTime);
      out.set(day, assembleThreads(events, true));
    }
    return out;
  }

  // Color anchoring (spec §6, 2026-07-18): a host is anchored if any
  // stored day holds a HIGH thread for it (thread-level, where meetings
  // and watch-runs actually reach HIGH). Week-scoped on purpose:
  // day-scoped anchoring would render every morning monochrome until
  // something accrued ~17 attended minutes, and hosts would flicker
  // colored/gray across day pages. Iteration is chronological, so
  // first-anchor claim order is deterministic.
  function anchoredHostsFrom(dayThreads) {
    const anchored = new Set();
    for (const threads of dayThreads.values()) {
      for (const t of threads) {
        if (t.band === "high") anchored.add(t.host);
      }
    }
    return anchored;
  }

  // Runs of MIN_RUN+ consecutive LOW events fence; everything else lays out
  // as a plain block. MIN_RUN=1: even a singleton LOW collapses to a stick
  // (spec §6, 2026-07-16 — opinionated demoting; hover + expand keep it
  // findable). The run machinery is kept as-is so the revert is one constant.
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
        // Plate-worthy absence splits fences (spec §6, 2026-07-24; was
        // VISIT_GAP_MS): a fence may span any gap too small to earn a
        // hover plate — merging adjacent runs into one big expand target —
        // but never covers a targetable away-hole.
        const prev = run[run.length - 1];
        if (prev && event.startTime - prev.endTime >= FENCE_SPLIT_GAP_MS) flush();
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
              // LOW children collapse to fence sticks (spec §6, 2026-07-24):
              // STICK_W interior plus the seam each side — the width floor
              // must not confer block stature on a graze. MEDIUM+ children
              // (side-quests) keep proportional block width.
              const kw =
                k.band === "low"
                  ? STICK_W + 2 * CUT_SEAM
                  : Math.max(MIN_W, (k.durMs / 1000) * PX_PER_SEC);
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
              // The container event, so the tooltip can narrate the framing
              // ("interruption inside Phanpy · visit 2 of 2").
              parent: e,
              // Capped at MEDIUM: containment frames — never confers,
              // never destroys. Structurally unreachable since the
              // tree-blind covered-HIGH guard (2026-07-24) — kept as a
              // defensive invariant.
              band: kid.k.band === "high" ? "medium" : kid.k.band,
              // A LOW child is a contained stick: stick paint, but — unlike
              // collapsed fence sticks — a live block (tooltip, snapshot,
              // click), because hover is the recovery path.
              stick: kid.k.band === "low",
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
  // Absence splits runs (2026-07-18, same constant as fences): morning and
  // evening Gmail clusters with nothing rendered between them are ADJACENT
  // in seg order, and an unsplit run centered its label over the 8-hour
  // away gap between them.
  function groupRuns(segs) {
    const runs = [];
    for (const seg of segs) {
      const labelWorthy = seg.band !== "low" || (seg.clusterKey != null && !seg.collapsed);
      const memberScore = labelWorthy ? Math.max(seg.e.score, 1) : 0;
      // Runs join on the LABEL key, not the host (spec §6, 2026-07-25):
      // on a label-split host a Search run and a Maps run must answer to
      // their own names. Everywhere else labelKey === host.
      const labelKey = labelKeyOf(seg.e.host, seg.e.url);
      const last = runs[runs.length - 1];
      if (last && last.labelKey === labelKey && seg.e.startTime - last.lastEnd < VISIT_GAP_MS) {
        last.end = seg.x + seg.w;
        last.lastEnd = seg.e.endTime;
        last.bestScore = Math.max(last.bestScore, memberScore);
      } else {
        runs.push({
          // Stable identity across expand/collapse (the first member's seg
          // key survives the toggle) so the title element can persist and
          // animate rather than being rebuilt.
          key: seg.e.host + ":" + seg.key,
          host: seg.e.host,
          labelKey,
          start: seg.x,
          end: seg.x + seg.w,
          lastEnd: seg.e.endTime,
          bestScore: memberScore,
        });
      }
    }
    return runs.map((r) => ({ ...r, center: (r.start + r.end) / 2 }));
  }

  // Label = the site's own name, one per LABEL KEY per render (spec §6,
  // 2026-07-18; key = host, except label-split hosts — see labelKeyOf):
  // the label names the site's identity, so it derives from ALL admitted
  // titles across the stored week — never per-run (two runs of one hue
  // answering to two names broke self-legending on NotebookLM).
  // The site name is the INVARIANT segment: split each title on
  // separators, candidates = first + last segments, winner = the
  // candidate present in the most titles (majority of separator-bearing
  // titles required). Ties prefer the FIRST-position candidate — the
  // "App - page" house style (Voice, Meet) is invariant-first, while the
  // classic "page - Site" shape never ties because leading segments vary.
  // A lone separator-bearing title keeps the old trailing rule (no
  // invariance evidence). Hostname is the fallback — and identity
  // (color/grouping) stays hostname-keyed regardless.
  // Hostname match wins outright (spec §6, 2026-07-19): a candidate that IS
  // the domain name — exact equality after normalization, never containment
  // ("googledocs" must not match "docs") — is the site declaring its own
  // name, corroborated by the URL, so it skips the count contest and the
  // majority guard. Recurrence required (≥2 titles, waived for a lone parted
  // title) so a one-off doc literally named "Docs" can't claim
  // docs.google.com. Born of WorkFlowy's invariant "Organize your brain. -
  // WorkFlowy": both segments tied every week and the first-position
  // tie-break crowned the tagline.
  function siteNameOf(titles, host) {
    const parted = titles
      .map((t) => (t || "").split(/\s+[-–—|·/]\s+/))
      .filter((p) => p.length > 1);
    if (!parted.length) return null;
    const counts = new Map(); // candidate -> { n, first }
    const midCounts = new Map(); // middle segments — hostname-match candidates ONLY
    for (const p of parted) {
      const cands = new Map(); // per-title dedupe: count once per title
      const first = p[0].trim();
      const last = p[p.length - 1].trim();
      if (first && first.length <= 30) cands.set(first, true);
      if (last && last.length <= 30 && !cands.has(last)) cands.set(last, false);
      for (const [name, isFirst] of cands) {
        const c = counts.get(name) || { n: 0, first: false };
        c.n++;
        c.first = c.first || isFirst;
        counts.set(name, c);
      }
      for (const name of new Set(
        p.slice(1, -1).map((s) => s.trim()).filter((s) => s && s.length <= 30 && !cands.has(s))
      ))
        midCounts.set(name, (midCounts.get(name) || 0) + 1);
    }
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const labels = new Set(host.split(".").slice(0, -1).map(norm).filter(Boolean));
    // Middle segments participate HERE only (spec §6, 2026-07-25): the
    // Workspace "domain - App - page" house style hides the URL-
    // corroborated segment in the middle ("Jenson.org - Calendar - Week
    // of …"). The invariance contest below stays first/last, where
    // recurring middle noise can't win on popularity.
    const matchable = new Map(counts);
    for (const [name, n] of midCounts) {
      const c = matchable.get(name);
      matchable.set(name, { n: (c ? c.n : 0) + n, first: c ? c.first : false });
    }
    let match = null;
    for (const [name, c] of matchable) {
      if (!labels.has(norm(name))) continue;
      if (c.n < 2 && parted.length > 1) continue;
      if (!match || c.n > match.c.n) match = { name, c };
    }
    if (match) return match.name;
    if (parted.length === 1) {
      const tail = parted[0][parted[0].length - 1].trim();
      return tail && tail.length <= 24 ? tail : null;
    }
    let best = null;
    for (const [name, c] of counts) {
      if (!best || c.n > best.c.n || (c.n === best.c.n && c.first && !best.c.first)) {
        best = { name, c };
      }
    }
    return best && best.c.n * 2 >= parted.length ? best.name : null;
  }

  // google.com label split (spec §6, 2026-07-25): the one recorded
  // multi-app host — Search and Maps share the hostname, namespaced by
  // first path segment. For LABELS ONLY, the grouping key appends that
  // segment (google.com/maps, google.com/search) and the invariance
  // machinery names each group from its own titles. Identity — color,
  // merging, chains — stays hostname-keyed. Extended per specimen, never
  // speculatively; the rejected general mechanism is in plans.
  const LABEL_SPLIT_HOSTS = new Set(["google.com"]);
  function labelKeyOf(host, url) {
    if (!LABEL_SPLIT_HOSTS.has(host)) return host;
    try {
      const seg = new URL(url).pathname.split("/")[1];
      return seg ? host + "/" + seg : host;
    } catch {
      return host;
    }
  }

  // Names for every label key with admitted sessions this week. Recomputed
  // per render (cheap); merged-visit member titles are covered because this
  // walks RAW sessions, pre-assembly.
  function computeHostNames(sessions) {
    const titlesByKey = new Map();
    for (const s of sessions) {
      if (!s.url || isTransit(s) || !s.title) continue;
      const host = hostOf(s);
      const key = labelKeyOf(host, s.url);
      let g = titlesByKey.get(key);
      if (!g) titlesByKey.set(key, (g = { host, titles: [] }));
      g.titles.push(s.title);
    }
    const names = new Map();
    for (const [key, g] of titlesByKey) {
      const name = siteNameOf(g.titles, g.host); // hostname matching stays host-level
      if (name) names.set(key, name);
    }
    return names;
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
  // place. Run titles persist too (2026-07-17), keyed by host + first
  // member, so they glide with their blocks instead of jumping; everything
  // else (plates, bars, ticks) is rebuilt.
  const blockEls = new Map();
  const titleEls = new Map();
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

  // --- Day paging (spec §6; ‹/› header nav removed 2026-07-17): the week
  // strip is the only day picker — with 7-day retention every reachable day
  // always has a cell. Paging resets fences (expansion is a per-look act,
  // not per-day state).
  const oldestDayStart = () =>
    lastSessions.length
      ? dayStartOf(Math.min(...lastSessions.map((s) => s.startTime)))
      : dayStartOf(Date.now());

  // --- Week strip (spec §6, 2026-07-17; thread bands 2026-07-18): one
  // skyline cell per day, oldest → today, above the ribbon; click a cell
  // to jump the viewed day there. Per 15-min bin, a bottom-flush bar at
  // the MAX band of any THREAD overlapping the bin — max, not
  // time-dominant: that is what the ribbon's top edge is at any x. Bands
  // come from the same assembled threads the ribbon draws (shared
  // threadsByDay step), so container/meeting days skyline like their
  // ribbon instead of lower (the old raw-band divergence, resolved).
  // All cells share one hour-aligned window, so hours align VERTICALLY
  // across days — the cross-day comparison the two-scale ribbon can't give.
  function renderWeekStrip(dayThreads) {
    const strip = document.getElementById("week-strip");
    strip.replaceChildren();
    const all = [...dayThreads.values()].flat();
    strip.hidden = !all.length;
    if (!all.length) return;

    let minOff = Infinity;
    let maxOff = 0;
    for (const [day, threads] of dayThreads) {
      for (const t of threads) {
        // Offsets are time-of-day within the thread's own day; midnight
        // straddlers clamp to 0 rather than leaking into the previous day.
        minOff = Math.min(minOff, Math.max(0, t.startTime - day));
        maxOff = Math.max(maxOff, t.endTime - day);
      }
    }
    minOff = Math.floor(minOff / HOUR) * HOUR;
    maxOff = Math.min(24 * HOUR, Math.ceil(maxOff / HOUR) * HOUR);
    const bins = Math.ceil((maxOff - minOff) / STRIP_BIN_MS);

    const today = dayStartOf(Date.now());
    for (let day = oldestDayStart(); day <= today; day = nextDayStart(day)) {
      const cell = document.createElement("div");
      cell.className = "wday" + (day === viewDayStart ? " selected" : "");
      const label = document.createElement("div");
      label.className = "wday-label";
      // Day-first "Wed 15 Jul": unambiguous across US/European readers
      // (7/15 is not), month/weekday names still follow the user's locale.
      const d = new Date(day);
      label.textContent =
        d.toLocaleDateString([], { weekday: "short" }) +
        " " +
        d.getDate() +
        " " +
        d.toLocaleDateString([], { month: "short" });
      const sky = document.createElement("div");
      sky.className = "wday-sky";
      sky.style.width = bins * STRIP_BIN_PX + "px";
      sky.style.height = STRIP_H + "px";

      const tiers = new Array(bins).fill(0);
      for (const t of dayThreads.get(day) || []) {
        const rank = STRIP_RANK[t.band];
        const from = Math.max(
          0,
          Math.floor((Math.max(t.startTime - day, 0) - minOff) / STRIP_BIN_MS)
        );
        const to = Math.min(
          bins - 1,
          Math.floor((t.endTime - day - minOff - 1) / STRIP_BIN_MS)
        );
        for (let i = from; i <= to; i++) tiers[i] = Math.max(tiers[i], rank);
      }
      // Run-length bars, edges snapped like blocks (round the right edge,
      // not the width, so snapped neighbors stay adjacent).
      for (let i = 0; i < bins; ) {
        let j = i + 1;
        while (j < bins && tiers[j] === tiers[i]) j++;
        if (tiers[i]) {
          const bar = document.createElement("div");
          bar.className = "wbar";
          const x = Math.round(i * STRIP_BIN_PX);
          bar.style.left = x + "px";
          bar.style.width = Math.round(j * STRIP_BIN_PX) - x + "px";
          bar.style.height = STRIP_TIER_H[STRIP_BAND[tiers[i]]] + "px";
          sky.appendChild(bar);
        }
        i = j;
      }

      cell.addEventListener("click", () => {
        if (day === viewDayStart) return;
        viewDayStart = day;
        expanded.clear(); // paging resets fences, same as ‹/›
        log(`week strip → ${new Date(day).toDateString()}`);
        render(lastSessions);
      });
      cell.append(label, sky);
      strip.appendChild(cell);
    }
  }

  // --- Custom tooltip (spec §6, plans/snapshot_implementation.md Part 1).
  // Native title tooltips have uncontrollable warm-up timing (~1s cold,
  // near-instant warm, any click resets it) — so ribbon elements carry
  // data-tip instead, shown by one delegated timer at a uniform delay.
  // Text lands via textContent only: titles/URLs are page-controlled.
  const TIP_DELAY_MS = 300;
  const tip = document.createElement("div");
  tip.id = "tip";
  tip.hidden = true;
  // Snapshot slot above the text lines (spec §6 snapshot previews). Fixed
  // children — only their content changes, so page-controlled strings still
  // land via textContent only.
  const tipImg = document.createElement("img");
  tipImg.id = "tip-img";
  tipImg.alt = "";
  tipImg.hidden = true;
  const tipText = document.createElement("div");
  tipText.id = "tip-text";
  tip.appendChild(tipImg);
  tip.appendChild(tipText);
  document.body.appendChild(tip);
  let tipTimer = null;
  // Bumped on every hide: async continuations below (storage fetch, image
  // decode) compare against it, so a stale hover can never resurrect a
  // dismissed tooltip or paint into a newer one.
  let tipSeq = 0;

  function hideTip() {
    clearTimeout(tipTimer);
    tipTimer = null;
    tipSeq++;
    tip.hidden = true;
  }

  // Build the tooltip text area. Structured blocks carry _tipData (two
  // sections, spec §6); gaps/plates/bars carry a plain data-tip string.
  // One div per line, all content via textContent (injection rule).
  function fillTip(el) {
    tipText.textContent = "";
    const d = el._tipData;
    if (!d) {
      tipText.textContent = el.dataset.tip;
      return;
    }
    const line = (cls, text) => {
      const div = document.createElement("div");
      div.className = cls;
      div.textContent = text;
      tipText.appendChild(div);
    };
    line("tip-title", d.siteName);
    line("tip-meta", d.meta);
    for (const p of d.pages.slice(0, TIP_TITLES_MAX)) {
      // Title span ellipsizes; the debug score is its own span so a long
      // title can never truncate it away.
      const div = document.createElement("div");
      div.className = p.band === "low" ? "tip-page dim" : "tip-page";
      const t = document.createElement("span");
      t.className = "t";
      t.textContent = p.title;
      div.appendChild(t);
      if (TIP_DEBUG) {
        const sc = document.createElement("span");
        sc.textContent = Math.round(p.score);
        div.appendChild(sc);
      }
      tipText.appendChild(div);
    }
    if (d.pages.length > TIP_TITLES_MAX)
      line("tip-page dim", `+ ${d.pages.length - TIP_TITLES_MAX} more`);
    if (d.ctx) line("tip-meta", d.ctx);
    if (TIP_DEBUG) line("tip-debug", d.debug.join("\n"));
  }

  {
    const ribbonEl = document.getElementById("ribbon");
    ribbonEl.addEventListener("pointerover", (ev) => {
      hideTip();
      const el = ev.target.closest("[data-tip]");
      if (!el) return;
      const px = ev.clientX;
      const py = ev.clientY;
      const seq = tipSeq;
      tipTimer = setTimeout(async () => {
        fillTip(el);
        tipImg.hidden = true;
        tipImg.removeAttribute("src"); // never flash the previous page's snapshot
        // Lazy snapshot fetch, decoded BEFORE showing (spec §6): the tooltip
        // is measured and viewport-clamped exactly once, at its final size —
        // an image popping in later would grow it past the clamp. One get()
        // for every candidate; the best-scoring member that HAS a picture
        // wins (top members can be unphotographed pre-navigation stubs).
        const ids = (el.dataset.snapIds || "").split(",").filter(Boolean);
        if (ids.length) {
          const keys = ids.map((id) => "snap:" + id);
          const r = await chrome.storage.local.get(keys).catch(() => ({}));
          const stored = keys.map((k) => r[k]).find(Boolean);
          if (stored && seq === tipSeq) {
            tipImg.src = stored;
            try {
              await tipImg.decode();
              tipImg.hidden = false;
            } catch {} // undecodable stored data: text-only
          }
        }
        if (seq !== tipSeq) return; // hover ended during the awaits
        // Measure at the origin: a fixed-position box shrink-to-fits against
        // the viewport edge, so measuring at the previous hover's leftover
        // `left` squeezes the tooltip (and its snapshot) near the right edge.
        tip.style.left = "0px";
        tip.style.top = "0px";
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
    // One quiet assembly of every stored day feeds the strip and color
    // anchoring; the viewed day re-assembles loud below (identical
    // functions, identical inputs — kept separate so the worker-console
    // transit/container logs stay tied to the day on screen).
    const dayThreads = threadsByDay(sessions);
    const hostNames = computeHostNames(sessions);
    renderWeekStrip(dayThreads);
    // Anchored hosts are judged over the WHOLE stored week (thread-level
    // HIGH — spec §6, 2026-07-18), then claim/release registry slots
    // before painting.
    const coloredHosts = anchoredHostsFrom(dayThreads);
    claimColors(coloredHosts);
    const events = assembleThreads(parseSessions(sessions));
    const items = clusterEvents(events);
    const { segs, plates, bars, gaps, total } = layout(items, expanded);

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
      // Identity hue for anchored hosts ONLY — everywhere they appear
      // (LOW visits, fence members, contained children all share the
      // thread's color). Non-anchored hosts are gray on every surface;
      // the old fence-open and contained-child color relaxations are
      // retired with transient colors (2026-07-18). Collapsed sticks
      // stay stick-gray regardless — contained LOW sticks too (spec §6,
      // 2026-07-24): stick paint everywhere sticks appear.
      const colored = !s.collapsed && !s.stick && coloredHosts.has(s.e.host);
      const fill = !colored
        ? s.collapsed || s.stick
          ? STICK_FILL
          : GRAY_FILL
        : s.band === "high"
          ? colorOf(s.e.host)
          : `color-mix(in srgb, ${colorOf(s.e.host)} ${MEDIUM_MIX_PCT}%, ${PAGE_BG})`;
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
      // Containers paint like any other solid block (spec §6, 2026-07-17 —
      // wash retired); contained children are cut out of the interior by a
      // 2px page-background seam (.cut CSS carries the width).
      el.classList.toggle("cut", !!s.contained);
      el.style.background = fill;
      // Sticks paint the border in their own fill — at 3px wide a 1px
      // outline IS the stick, so "borderless" means border = fill.
      // Colored rims come from the FULL host color, not the (possibly
      // dimmed) fill: the border carries identity at full strength on
      // every tier, so HIGH and MEDIUM read as one family (spec §6,
      // 2026-07-17).
      // Contained sticks: transparent seam, fill clipped to the interior
      // (spec §6, 2026-07-24) — the container's color shows through the
      // 2px border, so the visible slit is STICK_W while the hover box
      // keeps the full .cut footprint. background-clip is required:
      // by default the background paints under the border.
      el.style.backgroundClip = s.stick ? "padding-box" : "";
      el.style.borderColor = s.stick
        ? "transparent"
        : s.contained
          ? PAGE_BG
          : s.collapsed
            ? STICK_FILL
            : colored
              ? rimOf(colorOf(s.e.host))
              : GRAY_RIM;
      if (s.collapsed) {
        // Collapsed sticks carry neither text nor snapshot (spec §6: the
        // expand toggle doubles as the snapshot gate).
        delete el.dataset.tip;
        delete el.dataset.snapIds;
        delete el._tipData;
      } else {
        // Blocks get the structured two-section tooltip as a JS property;
        // data-tip stays (empty) as the hover marker. Gaps/plates/bars keep
        // plain data-tip strings — fillTip falls back for those.
        el.dataset.tip = "";
        // Contained children narrate their framing: whose session they
        // interrupted, and — when the same site interrupted more than once —
        // which round trip this one was (the ribbon can't show a sub-pixel
        // anchor-return between floored children; the hover explains it).
        let ctx = null;
        if (s.contained && s.parent) {
          const sibs = s.parent.children.filter((c) => c.host === s.e.host);
          const pname = hostNames.get(labelKeyOf(s.parent.host, s.parent.url)) || s.parent.host;
          ctx =
            `↩ interruption inside ${pname}` +
            (sibs.length > 1 ? ` · visit ${sibs.indexOf(s.e) + 1} of ${sibs.length}` : "");
        }
        el._tipData = tipDataOf(s.e, hostNames.get(labelKeyOf(s.e.host, s.e.url)) || s.e.host, ctx);
        // Snapshot candidates, best first: merges/containers carry snapIds
        // (members in score order); raw blocks, contained children, and
        // expanded fence members are their own only candidate. Ids are
        // UUIDs — comma-join is unambiguous.
        el.dataset.snapIds = (s.e.snapIds || [s.e.id]).join(",");
      }
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
    // (< GAP_PLATE_MIN_PX) skip the plate: untargetable, and they'd shadow
    // neighbors — the same threshold fences may span (clusterEvents).
    for (const g of gaps) {
      if (g.w < GAP_PLATE_MIN_PX) continue;
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
      // A singleton stick isn't a run of "brief visits" — name the page.
      el.dataset.tip =
        p.members.length === 1
          ? `${p.members[0].host} · ${fmtDuration(active)} — click to expand`
          : `${p.members.length} brief visits · ${fmtDuration(active)} — click to expand`;
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

    const marks = hourMarks(segs, gaps);
    let lastLabelRight = -Infinity;
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      const tick = document.createElement("div");
      tick.className = "tick transient";
      // Snap: a 1px line on a fractional x anti-aliases into a 2px smear.
      tick.style.left = Math.round(m.x) + "px";
      tick.style.top = bandBottom + TICK_TOP + "px";
      tick.style.height = TICK_H + "px";
      ribbon.appendChild(tick);
      const label = document.createElement("div");
      label.className = "hlabel transient";
      // Centered under the tick (2026-07-17): tick row on top, label row
      // below — each label owns its full inter-mark column instead of
      // racing the next tick in the same lane.
      label.style.top = bandBottom + TICK_TOP + TICK_H + 2 + "px";
      // Room-keyed format (spec §6): try the full "9am" form; drop to the
      // bare number only when its MEASURED half-width + clearance spills
      // past the midpoint to the NEXT mark (which runs the same symmetric
      // test). Room is geometry, not gap membership — an hour in a 10-min
      // gap with no neighbor for a presence-hour keeps its meridiem. Only
      // next is tested: a run's LAST label is where its meridiem lives
      // ("… 3 4 5pm"), and demoting it against prev would strip the whole
      // run of its anchor.
      label.textContent = fmtHour(m.t);
      ribbon.appendChild(label);
      const next = marks[i + 1];
      let w = label.getBoundingClientRect().width;
      if (next && w / 2 + LABEL_CLEARANCE > (next.x - m.x) / 2) {
        label.textContent = String(hourNum(m.t));
        w = label.getBoundingClientRect().width;
      }
      label.style.left = Math.max(0, m.x - w / 2) + "px";
      // Thinning backstop (spec §6): a label overlapping the last survivor
      // drops, never nudges. Ticks are never thinned — the countable-hours
      // property is tick-borne. The backstop guards against literal
      // overlap only (2px), NOT the format test's LABEL_CLEARANCE: a
      // run-ending "5pm" legitimately reaches back toward its bare
      // neighbor, and full clearance here deleted it.
      if (m.x - w / 2 < lastLabelRight + 2) label.remove();
      else lastLabelRight = m.x + w / 2;
    }

    // Contained children never label (spec §6: hover only) and must not
    // fragment their container's title run.
    // Persistent titles (2026-07-17): an existing title GLIDES to its new
    // left in sync with the blocks; a brand-new one (fence members on
    // expand) fades in at its final position; a departed one fades out.
    const liveTitles = new Set();
    for (const run of titleRuns(groupRuns(segs.filter((s) => !s.contained)))) {
      liveTitles.add(run.key);
      let el = titleEls.get(run.key);
      const fresh = !el;
      if (fresh) {
        el = document.createElement("div");
        el.className = "rtitle";
        el.style.opacity = "0";
        // The rotated text column's BOTTOM lands at top + line-height
        // (16px, fixed in CSS). Anchor so it clears the band ceiling by
        // 4px — HIGH blocks fill the full band, and the old -8 anchor
        // dipped labels ~10px into them.
        el.style.top = TITLE_AREA - 20 + "px";
        ribbon.appendChild(el);
        titleEls.set(run.key, el);
      }
      // rotate(-90deg) about the bottom-LEFT corner sweeps the glyph column
      // into the ~17px to the LEFT of the anchor (verified 2026-07-15 after
      // getting the direction wrong once) — so anchor half a line-height
      // RIGHT of center to center the column on the run. Obvious on 3px
      // fence slivers, invisible on wide runs.
      el.style.left = run.center + 9 + "px";
      // Rim mix, not the raw fill: dark palette entries (vivid red, strong
      // blue/violet) are illegible as text on the dark ribbon. Labels of
      // non-anchored runs (gray MEDIUMs still label) use the gray rim —
      // label color must never leak an identity hue the blocks don't have.
      el.style.color = coloredHosts.has(run.host) ? rimOf(colorOf(run.host)) : GRAY_RIM;
      const name = hostNames.get(run.labelKey) || run.host;
      el.textContent =
        name.length > TITLE_MAX_CHARS ? name.slice(0, TITLE_MAX_CHARS) + "…" : name;
      if (fresh) {
        // Commit the opacity-0 state before flipping it, so the fade
        // transition actually runs instead of the style batching to 1.
        el.getBoundingClientRect();
        el.style.opacity = "1";
      }
    }
    for (const [key, el] of titleEls) {
      if (liveTitles.has(key)) continue;
      titleEls.delete(key);
      el.style.opacity = "0";
      el.addEventListener("transitionend", () => el.remove(), { once: true });
      // Backstop removal in case the transition never fires (hidden tab).
      setTimeout(() => el.remove(), 500);
    }

    log(`rendered ${segs.length} blocks in ${plates.length} fences + ${bars.length} expanded, ${total}px wide`);
  }

  window.renderTimeline = render;
  // Single source of truth for scoring — the Score-table button in
  // dashboard.js uses these so diagnostics can never drift from the render.
  window.FS_SCORING = { scoreSession, attendedSeconds, bandFor, hostOf };
})();
