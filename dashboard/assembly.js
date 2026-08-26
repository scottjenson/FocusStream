// FocusStream session parsing + thread assembly (spec §3/§6). Owns the
// sessions-in → threads-out pipeline: admission filtering, visit merging,
// container detection, thread assembly, and the site-name/label-key
// machinery. timeline.js owns layout/paint/interaction and calls these as a
// straight pipeline. `openerEdges` stays private here — write/read only
// between treeRootsOf and detectContainers.
//
// FS_TRANSIT (shared/transit.js) loads before this module as a plain
// <script> and hangs off globalThis by design (service workers have no
// window) — referenced directly, not re-imported.

import {
  scoreSession,
  attendedSeconds,
  bandFor,
  hostOf,
  hasEarnedHigh,
  edgeBand,
  fmtDuration,
  fmtClock,
  W_NAV,
  HIGH_SCORE,
  MED_SCORE,
} from "./scoring.js";

const log = (...args) => console.log("[FS timeline]", ...args);

const { isTransit } = FS_TRANSIT;

// Visit-merge gap limit: a brief tab-away stays the same visit; coming
// back after minutes of absence is a NEW visit (interruption-by-absence).
export const VISIT_GAP_MS = 5 * 60 * 1000;
// Container chains bridge longer gaps on gap-audio testimony (spec §6): the
// resuming fragment's audibleSinceTs must predate the gap — the tab's own
// audio testifies the context never ended.
// Equals AWAY_PLATE_GAP_MS (timeline.js) by coincidence, NOT by reference:
// this is a fact about the TAB (its audio never stopped), that one about the
// USER (how long a break reads as leaving). Keep them independently
// tunable — do not collapse them into one constant.
const AUDIO_BOOKEND_GAP_MS = 30 * 60 * 1000;
// Adjacent-container chaining (spec §6): the gap for the SECOND pass, which
// chains already-assembled containers/visits. Deliberately between
// VISIT_GAP_MS (chaining assembled threads is a coarser claim than chaining
// raw fragments) and AUDIO_BOOKEND_GAP_MS (no audio evidence required at
// this level). A judgment call, not a measured cliff — the week's gap
// distribution is smooth. Story: decisions/timeline_design.md.
const CONTAINER_CHAIN_GAP_MS = 10 * 60 * 1000;

// Two-section tooltip data (spec §6): a user section (bold
// site name, start + duration, member pages sorted by score) and a debug
// section gated by TIP_DEBUG (timeline.js's fillTip — the gating and the
// TIP_TITLES_MAX display cap live there, since both are display concerns;
// this module always builds the full debug array).
// Untitled pages fall back to the URL, which can be a 2000-char OAuth
// monster — cap every listed string (display truncation is CSS ellipsis;
// this bounds what we store on the element). Module-level: both the page
// dedupe below and tipDataOf's debug section need it.
const cap = (t) => (t.length > 80 ? t.slice(0, 80) + "…" : t);
// Flatten a thread (container/merged-visit/lone session) to its member
// pages, cleaned and deduped by title (best score wins) — used by the
// tooltip's page list.
export function dedupedPagesOf(e, siteName) {
  // A container's fragments can themselves be merged visits — flatten to
  // the underlying pages so callers see what was actually read.
  const members = e.members ? e.members.flatMap((m) => m.members || [m]) : [e];
  // Page titles carry noise callers shouldn't see: leading unread
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
  const byTitle = new Map(); // dedupe: one entry per title, best score wins
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
  return pages;
}

export function tipDataOf(e, siteName, ctx) {
  const pages = dedupedPagesOf(e, siteName);
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

// Day window (spec §6): the ribbon shows ONE local calendar
// day. A session belongs to the day it ENDS in — midnight-straddlers are
// rare and short, since tab switches finalize. setHours (not epoch math)
// keeps midnights honest across DST.
export function dayStartOf(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
export function nextDayStart(t) {
  const d = new Date(t);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}
export function prevDayStart(t) {
  const d = new Date(t);
  d.setHours(-24, 0, 0, 0);
  return d.getTime();
}

// Tab trees (spec §3/§6): capture stores the raw opener edge
// (session.openerTabId); display resolves each tab to its tree ROOT and
// threads chain per tree — "one tab and its spawn". Edges are read from ALL
// stored sessions, not just the day's: an edge is a fact about the tab, and
// transit-filtered sessions still testify (a filtered hop can be the only
// link between a grandchild and the root). An edgeless tab is a tree of one.
// Raw edges are kept because the spawn-edge dominance discount walks the
// opener PATH, not the resolved root — same-tree via a common ancestor is
// not spawn testimony.
let openerEdges = new Map();
export function treeRootsOf(sessions) {
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

// viewDayStart is timeline.js's (the day-navigation UI lives there) — passed
// in rather than closed over here, so this module has no mutable state of
// its own beyond openerEdges above.
//
// windowStart (optional, spec §7e) widens the window backward to span
// multiple days: [windowStart, nextDayStart(viewDayStart)). Omitted, the
// window is the single day viewDayStart names.
export function parseSessions(sessions, viewDayStart, windowStart) {
  const from = windowStart != null ? windowStart : viewDayStart;
  const to = nextDayStart(viewDayStart);
  const rootOf = treeRootsOf(sessions);
  const inDay = sessions.filter((s) => s.endTime >= from && s.endTime < to && s.url);
  const transits = inDay.filter(isTransit);
  if (transits.length) log(`transit filter dropped ${transits.length} sessions`);
  // Exit inheritance (spec §6): dropping a transit stub must not drop its
  // boundary testimony. A stub that would have machinery-joined its same-tab
  // SAME-HOST predecessor is that run's true TAIL — and a visit's exit is
  // its last member's exit — so the predecessor inherits the stub's
  // endReason (overlay only; stored sessions stay untouched). The host test
  // is load-bearing: a foreign-host stub (a link-out bounce) was never a
  // would-be member and must not manufacture succession licenses or
  // departure testimony.
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
//   1. LOW rule: consecutive same-host LOW events with gaps < VISIT_GAP_MS
//      merge — a fragmented-but-engaged session (Maps pans, Gmail
//      puttering) earns its combined stature.
//   2. Continuation rule: same-tab same-host fragments whose boundary is
//      navigation machinery (spa_navigation/navigated — attention never
//      left the tab) merge REGARDLESS of band.
//   3. Succession rule: same-TREE same-host fragments whose boundary is
//      tab_closed merge REGARDLESS of band — closing a finished tab to land
//      on the next queued same-host tab is cross-tab machinery, not
//      departure. The tree key is the intent test.
// Individually-HIGH events never merge — they split the run and stand
// alone (a block that's HIGH by itself owns its story). tab_hidden
// boundaries never merge under rules 2/3: the user actually left, which
// is container territory. Scored and banded on the MERGED totals.
const CONTINUATION_GAP_MS = 30_000; // sanity bound; machinery gaps are ~0
const MACHINERY_BOUNDARY = new Set(["spa_navigation", "navigated"]);
export function mergeVisits(events) {
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
        favIconUrl: top.favIconUrl, // same member as the click target (spec §6)
        // Snapshot candidates in score order (spec §6): the tooltip shows
        // the best member that HAS a picture — sub-10s stubs can win the top
        // score (flush-inflated attended) yet are never photographed.
        snapIds: [...run].sort((a, b) => b.score - a.score).map((m) => m.id),
        title: top.title,
        host: run[0].host,
        // Containers chain by tab TREE; a merged visit keeps an identity
        // only if unambiguous across members, so a cross-tab LOW merge
        // within one tree stays chain-eligible.
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
      // Merged totals + the traversal term: every join is a committed page
      // view the per-signal totals can't see (spec §6).
      merged.score = scoreSession(merged) + W_NAV * (run.length - 1);
      merged.band = bandFor(merged.score);
      out.push(merged);
    }
    run = [];
  };
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const prev = run[run.length - 1];
    const lowMerge =
      e.band === "low" &&
      prev &&
      prev.band === "low" &&
      prev.host === e.host &&
      e.startTime - prev.endTime < VISIT_GAP_MS;
    const machineryIn =
      prev &&
      prev.host === e.host &&
      prev.tabId != null &&
      prev.tabId === e.tabId &&
      MACHINERY_BOUNDARY.has(prev.endReason) &&
      e.startTime - prev.endTime < CONTINUATION_GAP_MS;
    // Same-tab HIGH pass-through (spec §6): a HIGH fragment joined to its
    // same-tab same-host neighbor(s) by machinery never left the tab — the
    // boundary is page turnover, not departure, so it is the continuation
    // join's territory. Guard 1 says a HIGH owns its story against FOREIGN
    // frames, not against its own tab's continuation run.
    //
    // Either edge is enough, but the two edges need DIFFERENT handling —
    // do not collapse these branches. By the time we get here `run` may
    // already hold an unrelated leftover event on another tab/host:
    //   - INCOMING (prev machinery-joined into this HIGH): prev is the
    //     run's own tail, already correctly placed, so the HIGH just joins
    //     as the next member — no flush.
    //   - OUTGOING only (this HIGH opens a fresh tab, then navigates
    //     onward): `run` may hold garbage, so the HIGH must FLUSH first and
    //     lead a fresh run rather than join blind.
    // A HIGH with no machinery edge at all still stands alone.
    const next = events[i + 1];
    const machineryOut =
      next &&
      next.host === e.host &&
      next.tabId != null &&
      next.tabId === e.tabId &&
      MACHINERY_BOUNDARY.has(e.endReason) &&
      next.startTime - e.endTime < CONTINUATION_GAP_MS;
    // NOTE: highLeadsRun gates on !machineryIn, not !prev — run[] almost
    // always holds SOME leftover event (often on an unrelated tab/host)
    // by the time we reach here, so !prev was true so rarely it never
    // fired on real data.
    const highLeadsRun = e.band === "high" && !machineryIn && machineryOut;
    // A HIGH with an incoming machinery edge joins on that edge alone —
    // machineryIn already implies "same tab, same host, page turnover, no
    // departure", so no further test is needed even when band === "high".
    const continuation = machineryIn;
    const successionIn =
      prev &&
      prev.host === e.host &&
      prev.treeId != null &&
      prev.treeId === e.treeId &&
      prev.endReason === "tab_closed" &&
      e.startTime - prev.endTime < CONTINUATION_GAP_MS;
    // Same-tree HIGH pass-through: succession is cross-tab machinery, the
    // same category as the machinery join above — closing a finished tab to
    // land on the next queued same-host tab is a binge, regardless of which
    // fragment happens to be HIGH. Same incoming/outgoing split as
    // machineryIn/machineryOut, and for the same reason.
    const successionOut =
      next &&
      next.host === e.host &&
      next.treeId != null &&
      next.treeId === e.treeId &&
      e.endReason === "tab_closed" &&
      next.startTime - e.endTime < CONTINUATION_GAP_MS;
    const highLeadsSuccessionRun = e.band === "high" && !successionIn && successionOut;
    if (lowMerge || continuation || successionIn) {
      run.push(e);
    } else if (e.band !== "high" || highLeadsRun || highLeadsSuccessionRun) {
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

// Container events (spec §6): a tab the user keeps RETURNING to is a journey
// context — returning is the strongest intent signal we have. Same-TREE
// fragments chain when the excursion returns within VISIT_GAP_MS, or within
// AUDIO_BOOKEND_GAP_MS on gap-audio testimony. A chain whose SUMMED score
// reaches MEDIUM becomes a container: fragments merge into the anchor
// (width = wall-clock span), foreign events inside the span become contained
// children.
//
// Four guards, each blocking a different false container:
//   - Foreign interruptions REQUIRED (≥1 child) — otherwise the big-email
//     case containerizes itself.
//   - A HIGH never joins a FOREIGN-host chain (it owns its story), but it
//     MAY seed or join its OWN host's chain in its own tab — excluding the
//     anchor's own HIGHs decapitates the true anchor in territory contests.
//   - No chain whose span would cover a HIGH non-member survives
//     qualification (tree-blind).
//   - Sub-HIGH chains additionally require ANCHOR DOMINANCE (anchor sum >
//     children sum, with the spawn-edge discount below) — a weak anchor
//     framing stronger children is a launcher, and the children are the
//     story. Deliberately NOT applied to the HIGH path.
export function detectContainers(events, quiet, chainGapMs = VISIT_GAP_MS) {
  // Chains key on the (tree, host) PAIR: a thread is a same-host chain in
  // one tab tree, so each host runs its own chain per tree — a spawned
  // foreign-host read neither joins nor breaks its parent's chain, and two
  // hosts ping-ponging inside one tree each keep their own thread. The pair
  // key also makes the HIGH guard structural: a HIGH can only ever extend
  // its own host's thread.
  // chainGapMs is a parameter, not always VISIT_GAP_MS — assembleThreads
  // calls this a second time at CONTAINER_CHAIN_GAP_MS to chain
  // already-assembled containers/visits.
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
      // Gap-audio testimony (spec §6): a long gap bridges only when the
      // resuming fragment's unbroken audible stretch began BEFORE the
      // previous fragment ended — the tab demonstrably kept playing the
      // whole time the user was away (a meeting talks through its
      // whiteboard gap; a paused video cannot testify). Old sessions lack
      // the stamp and never long-bridge, so this fails closed.
      //
      // Earned-HIGH atomicity (spec §6): an event that earned HIGH from one
      // individually-HIGH member is a resolved, standalone event. Chaining
      // exists to credit returning to UNFINISHED business; bridging two
      // resolved events erases the boundary between two stories. Applies to
      // EITHER side — a lesser neighbor absorbing an earned-HIGH one
      // dilutes just the same.
      //
      // The two-part condition is deliberate, not redundant. Pass two
      // (chainGapMs === CONTAINER_CHAIN_GAP_MS) applies it always; pass one
      // ONLY across a same-host URL CHANGE, because a stable URL across a
      // return is the ordinary revisit and must chain as before. Widening
      // pass one to all URLs is universally-URL-keyed chaining, which was
      // rejected — see decisions/timeline_design.md.
      const earnedHighAtomic =
        (chainGapMs === CONTAINER_CHAIN_GAP_MS || last.url !== e.url) &&
        (hasEarnedHigh(last) || hasEarnedHigh(e));
      // Weak-bridge guard (spec §6): a bridge needs real intent on at least
      // ONE side, but ONLY when something else actually filled the gap.
      // What it refuses is a chain's LATER strength retroactively
      // legitimizing an UNRELATED excursion it never earned: a brief
      // glance, a real excursion onto other hosts, a brief glance back —
      // and the excursion becomes contained children of an anchor that was
      // never strong at either edge touching it.
      //
      // Three parts of this condition are each load-bearing:
      //   - excursionFilledGap: an EMPTY pause never trips the guard, no
      //     matter how weak both endpoints are. A weak glance then a strong
      //     same-host return is "quick check, then real work" — one thread
      //     with a break in it, which must still chain.
      //   - AND, not OR: only ONE endpoint needs to clear LOW.
      //   - edgeBand, not .band: in pass two these can BE containers, whose
      //     own band is summed strength, not the strength of the one
      //     fragment actually touching this gap.
      const excursionFilledGap = events.some(
        (o) =>
          o !== last &&
          o !== e &&
          o.startTime >= last.endTime &&
          o.endTime <= e.startTime &&
          (o.treeId !== e.treeId || o.host !== e.host)
      );
      const weakBridge =
        excursionFilledGap && edgeBand(last, "end") === "low" && edgeBand(e, "start") === "low";
      const bridged =
        !earnedHighAtomic &&
        !weakBridge &&
        (gap < chainGapMs ||
          (gap < AUDIO_BOOKEND_GAP_MS &&
            e.audibleSinceTs != null &&
            e.audibleSinceTs <= last.endTime &&
            // URL continuity (spec §6): the tab's audio proves THE TAB
            // never went silent, never that the same ACTIVITY continued. A
            // same-host page change across the gap (leaving one video call
            // and joining another via the host's landing page) breaks
            // testimony — that audio is the host's UI. The excursion case
            // is untouched: a foreign host is never a chain member, so the
            // fragments bracketing a side trip share one URL.
            last.url === e.url));
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

  // Summed fragment scores + the traversal term for returns (spec §6):
  // fragment scores already carry their internal join bonuses, so the chain
  // adds only its own returns. Flows into qualification (sum ≥ MEDIUM) and
  // anchor dominance — returning strengthens the anchor's claim.
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
    // Overlap contest (trim-and-retest, spec §6): the higher sum wins the
    // contested span, but the loser is TRIMMED, not discarded — a handoff
    // between two interleaved threads must not shatter the loser's
    // uncontested run. Fragments overlapping an accepted container drop out
    // (span-covered ones become its children); the rest re-enter the
    // contest as runs, split wherever an accepted container sits between
    // consecutive fragments, re-summed and re-inserted in score order.
    // Termination: every trimmed piece is strictly smaller than its chain.
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
    // Guard 1 (spec §6): interruptions are required,
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
    // Covered-HIGH guard, tree-blind (spec §6 atomicity):
    // containment is a demotion and must be earned by evidence, never
    // inferred from time-overlap — ANY individually-HIGH non-member
    // inside the span rejects the chain. Members are exempt by
    // construction: a HIGH in its own host's chain is a fragment, not a
    // child, so a thread can never break its own container.
    if (children.some((e) => e.band === "high")) continue;
    // Anchor dominance (sub-HIGH only): the anchor must outscore its
    // children, or it's a launcher and the children are the story.
    // Spawn-edge discount (spec §6): a child whose tab's
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
      favIconUrl: top.favIconUrl, // same member as the click target (spec §6)
      // Snapshot candidates in score order (spec §6). A fragment can
      // itself be a merged visit whose synthetic "v…" id has no snapshot —
      // flatten through ITS snapIds to the underlying raw sessions.
      snapIds: [...c.frags]
        .sort((a, b) => b.score - a.score)
        .flatMap((f) => f.snapIds || [f.id]),
      title: top.title,
      host: c.frags[0].host,
      tabId: c.frags[0].tabId,
      // Needed so a container can itself become a fragment on
      // assembleThreads' second, looser chaining pass — without it a
      // container silently can't ever be chained again.
      treeId: c.frags[0].treeId,
      startTime: from,
      endTime: to,
      durMs: to - from, // SPAN — the width-rule exception (spec §6)
      heartbeats,
      audibleMs,
      activity,
      scrollable: c.frags.some((f) => f.scrollable),
      score: c.score, // summed fragment scores + returns traversal term: add up, then judge
      band: bandFor(c.score),
      // The LAST fragment's exit is the container's exit (same principle
      // as mergeVisits): needed so a container can testify as a departure
      // boundary if it becomes a non-final fragment on the second pass.
      endReason: c.frags[c.frags.length - 1].endReason,
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

// Thread assembly (spec §6 aggregation): the display atom is the THREAD —
// merge across machinery boundaries, then frame departures as containers.
// Every consumer (ribbon, week strip, color anchoring) goes through here.
export function assembleThreads(events, quiet) {
  // Adjacent-container chaining (spec §6): the first pass chains raw
  // fragments at VISIT_GAP_MS; the second re-runs the same chain-building +
  // qualification on ITS OWN output at the looser CONTAINER_CHAIN_GAP_MS —
  // an already-assembled container/visit is a coarser claim than a raw
  // fragment, so it earns a longer bridge. Idempotent when nothing chains.
  return detectContainers(detectContainers(mergeVisits(events), quiet), quiet, CONTAINER_CHAIN_GAP_MS);
}

// siteNameOf/computeHostNames/labelKeyOf live in shared/utility.js — the
// live tab strip (background.js) needs the same "given raw session data,
// name this site" logic, so it sits in the cross-boundary tier rather than
// being forked. Re-exported here so timeline.js's existing
// `import { computeHostNames, labelKeyOf }
// from "./assembly.js"` keeps working unchanged.
export { siteNameOf, computeHostNames, labelKeyOf } from "../shared/utility.js";

