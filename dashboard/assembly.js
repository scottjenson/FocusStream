// FocusStream session parsing + thread assembly (spec §3/§6) — split out of
// timeline.js (2026-08-15, file-size pass, 2026-08-15). Owns the
// sessions-in → threads-out pipeline: admission filtering, visit merging,
// container detection, thread assembly, and the site-name/label-key
// machinery threads are displayed under. Imported by timeline.js, which
// still owns layout/paint/interaction and calls these as a straight
// pipeline. `openerEdges` stays private here — it's write/read only between
// treeRootsOf and detectContainers, never touched outside this module.
//
// FS_TRANSIT (shared/transit.js) is loaded before this module as a plain
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
// Container chains bridge longer gaps on gap-audio testimony (revised
// 2026-07-24; was audible-dominated bookends): the resuming fragment's
// audibleSinceTs must predate the gap — the tab's own audio testifies
// the context never ended while the user was off on a whiteboard
// (spec §6 containers).
// Currently equals AWAY_PLATE_GAP_MS (timeline.js) by coincidence, not by
// reference (rules audit, 2026-08-06 — WATCHLIST.md "Time-threshold sprawl"):
// this is a fact about the TAB (its audio never stopped); the away-plate
// constant is a fact about the USER (how long a break reads as leaving
// the machine). Keep them independently tunable — retune one without
// assuming the other should follow.
const AUDIO_BOOKEND_GAP_MS = 30 * 60 * 1000;
// Adjacent-container chaining (spec §6, 2026-08-02): detectContainers only
// ever chains RAW fragments — two already-assembled same-host containers
// (or a container and a leftover merged visit) sitting a few minutes
// apart never get a second look, so a returning-to-LinkedIn pattern with
// brief step-aways reads as unrelated blocks. Looser than VISIT_GAP_MS
// (chaining assembled threads is a coarser claim than chaining raw
// fragments) but tighter than AUDIO_BOOKEND_GAP_MS (no audio evidence
// requirement at this level) — no natural cliff in a week's gap
// distribution (9s–29min, smooth), so this is a judgment call pending
// more data (story: decisions/timeline_design.md).
const CONTAINER_CHAIN_GAP_MS = 10 * 60 * 1000;

// Two-section tooltip data (spec §6, 2026-07-18): a user section (bold
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

// Day window (spec §6, 2026-07-16): the ribbon shows ONE local calendar
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
// windowStart (optional, spec §7e, 2026-08-23) widens the window backward to
// span multiple days: [windowStart, nextDayStart(viewDayStart)). Omitted, the
// window is the single day viewDayStart names — every pre-existing caller.
export function parseSessions(sessions, viewDayStart, windowStart) {
  const from = windowStart != null ? windowStart : viewDayStart;
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
        favIconUrl: top.favIconUrl, // same member as the click target (spec §6, 2026-08-07)
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
        // isOpenTab (Active Tab Manager Phase 2, 2026-08-22 unification):
        // OR of members, same convention as scrollable above — if ANY
        // member is a live open-tab record (timeline.js
        // syntheticSessionsForOpenTabs), the merged visit as a whole
        // represents a tab the user currently has open, so paint()'s
        // click handler should switch to it rather than open a duplicate.
        // Not spread from run[0]/top — this object is built field-by-field
        // on purpose, so a flag this consequential needs its own explicit
        // line rather than relying on which member happened to be picked.
        isOpenTab: run.some((m) => m.isOpenTab),
        openTabId: (run.find((m) => m.isOpenTab) || {}).tabId,
        // tabIndex (strip-ordering rework, spec §7c): same "first open-tab
        // member wins" convention as openTabId above — detectContainers'
        // final sort always reorders by startTime, so the strip's
        // Chrome-order layout (stripLayout(), timeline.js) needs this
        // preserved through merging or it silently falls back to time
        // order (the actual bug this field fixes). Only meaningful when
        // isOpenTab is true; undefined otherwise, same as openTabId.
        tabIndex: (run.find((m) => m.isOpenTab) || {}).tabIndex,
        // pinned (strip-ordering rework, spec §7c, bug fix): same
        // first-open-tab-member convention as openTabId/tabIndex above —
        // a merged/chained open tab (e.g. a pinned Gmail tab with real
        // prior history that chains with another visit) was silently
        // losing this field the same way tabIndex originally did, since
        // it was never added here when isOpenTab/openTabId first were.
        // Caught via a real screenshot: four genuinely Chrome-pinned tabs
        // still showed full labels because their merged/chained composite
        // objects had pinned === undefined.
        pinned: (run.find((m) => m.isOpenTab) || {}).pinned,
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
    // Same-tab HIGH pass-through (2026-08-06; incoming edge fixed
    // 2026-08-07): a HIGH fragment joined to its same-tab same-host
    // neighbor(s) by machinery (spa_navigation/navigated) never left the
    // tab — the boundary is page turnover, not departure, so it's exactly
    // the continuation join's territory (spec §6). Guard 1 says a HIGH
    // "owns its story against foreign frames", not against its own tab's
    // continuation run: the neighbor is already the same host by
    // construction. Either edge being machinery is enough, but the two
    // edges need different handling because `run` can already hold an
    // unrelated leftover event (often on a different tab/host) by the
    // time we reach here:
    //   - INCOMING edge (prev navigated/spa_navigated into this HIGH):
    //     prev is the run's own tail, already correctly placed — the HIGH
    //     simply joins as the run's next member (`continuation`, no
    //     flush). A HIGH reached by machinery but ending in tab_hidden
    //     (read closely, then switched tabs) used to split from its
    //     predecessor here; it no longer does.
    //   - OUTGOING edge only (this HIGH opens a fresh tab, or its
    //     predecessor isn't a same-tab/host match, then it spa_navigates
    //     onward): `run` may hold garbage, so the HIGH must FLUSH first
    //     and then lead a fresh run (`highLeadsRun`) rather than join
    //     blind. The 7:25/7:41 YouTube specimen: a HIGH video opened a
    //     fresh tab (no incoming edge) and spa_navigated into a shorts
    //     binge — outgoing edge alone lets it lead the run instead of
    //     splitting it.
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
    // Same-tree HIGH pass-through (2026-08-07; mirrors the 2026-08-06
    // machinery-join fix): succession is cross-tab machinery, same
    // category as the machinery join's page-turnover exception — closing
    // a finished tab to land on the next queued same-host tab is a
    // "binge" pattern regardless of which fragment happens to be HIGH.
    // Same incoming/outgoing split as machineryIn/machineryOut, and for
    // the same reason (`run` may hold an unrelated leftover fragment):
    //   - INCOMING edge (prev was tab_closed, e lands on the queued
    //     tab): prev is already the run's tail — e joins directly via
    //     successionIn, HIGH or not.
    //   - OUTGOING edge only (e itself is HIGH, e's OWN tab is about to
    //     tab_close, and the successor hasn't arrived yet to test): e
    //     must flush and lead a fresh run rather than join blind.
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
export function detectContainers(events, quiet, chainGapMs = VISIT_GAP_MS) {
  // Chains key on the (tree, host) PAIR (2026-07-19): a thread is a
  // same-host chain in one tab tree, so each host runs its own chain per
  // tree — a spawned foreign-host read neither joins nor breaks its
  // parent's chain (it becomes a child by falling inside the span), and
  // two hosts ping-ponging inside one tree each keep their own thread.
  // The pair key also makes relaxed guard 1 structural: a HIGH can only
  // ever extend its own host's thread; any HIGH non-member a chain's
  // span would cover is handled by the tree-blind covered-HIGH
  // rejection below (2026-07-24).
  // chainGapMs (2026-08-02): the bridging gap is a parameter, not always
  // VISIT_GAP_MS — assembleThreads calls this fn a second time at
  // CONTAINER_CHAIN_GAP_MS to chain already-assembled containers/visits
  // (adjacent-container chaining, below).
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
      // Earned-HIGH atomicity in pass two (spec §6, 2026-08-07): an
      // already-assembled container that earned HIGH from one
      // individually-HIGH member (a real, concentrated moment — not
      // summed via revisits) is a resolved, standalone event. Pass two
      // exists to credit returning to UNFINISHED business (the LinkedIn
      // out-and-back pattern); bridging two resolved events doesn't
      // complete a story, it erases the boundary between two stories
      // (two same-tree back-to-back Meet calls specimen). Applies to
      // EITHER side, not just when both are earned-HIGH — the same
      // dilution happens if a lesser neighbor absorbs an earned-HIGH one.
      // Pass-two only: raw fragments in pass one haven't been
      // individually qualified as containers yet, so hasEarnedHigh isn't
      // the right test there (existing raw-fragment Atomicity covers it).
      // Extended to pass one on URL change (spec §6, 2026-08-24): the same
      // "a resolved standalone event is not dissolved into the next thing
      // on the same host" principle, one layer down. Pass one gets it ONLY
      // across a same-host URL change — a stable URL across a return (the
      // ordinary revisit) chains exactly as before, so this is not the
      // universally-URL-keyed chaining rejected 2026-08-07. Specimen: four
      // back-to-back Meet calls in ONE reused tab, the 7:32 seam only 16s
      // wide (far too short for gap-audio) — pass two never saw them.
      const earnedHighAtomic =
        (chainGapMs === CONTAINER_CHAIN_GAP_MS || last.url !== e.url) &&
        (hasEarnedHigh(last) || hasEarnedHigh(e));
      // Weak-bridge guard (spec §6, 2026-08-14): a bridge needs real
      // intent on at least ONE side, but ONLY when something else
      // actually filled the gap — an empty pause between a weak opener
      // and a strong return is still one thread with a break in it
      // (returning is the strongest intent signal there is; a weak
      // opener shouldn't forfeit that). What the guard actually refuses
      // is a chain's LATER strength retroactively legitimizing an
      // UNRELATED excursion it never earned: a brief glance, a real
      // excursion onto other hosts/tabs, a brief glance back — the
      // excursion becomes contained children of an anchor that was never
      // strong at either edge touching it (specimen: three sub-15s Figma
      // glances framing a 6-minute speed-test/Gemini/Keep/Calendar
      // excursion). Deliberately per-bridge, not whole-chain: only one
      // endpoint needs to clear LOW, not both, and an EMPTY gap never
      // trips the guard regardless of both endpoints' bands (2026-08-14
      // same-day fix: a lone LOW glance directly preceding a genuinely
      // strong same-host return, no excursion in between, is exactly the
      // "quick check, then substantial return" pattern the guard must
      // NOT block — caught live when pass two re-attached an isolated
      // 11:31 AM glance onto the now-fixed 11:37 AM container). Tests
      // edgeBand, not last.band/e.band directly: in pass two, `e`/`last`
      // can themselves BE already-assembled containers, and a
      // container's own .band is its summed strength, not the strength
      // of the one fragment actually touching this gap.
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
            // URL continuity (spec §6, 2026-08-24): the tab's audio proves
            // THE TAB never went silent, never that the same ACTIVITY
            // continued. A same-host page change across the gap (leaving
            // one video call and joining another via the host's landing
            // page) breaks testimony — that audio is the host's UI. The
            // excursion case the rule exists for is untouched: a foreign
            // host is never a chain member, so the fragments bracketing a
            // Figma side trip are the same room at the same URL.
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
      favIconUrl: top.favIconUrl, // same member as the click target (spec §6, 2026-08-07)
      // Snapshot candidates in score order (spec §6). A fragment can
      // itself be a merged visit whose synthetic "v…" id has no snapshot —
      // flatten through ITS snapIds to the underlying raw sessions.
      snapIds: [...c.frags]
        .sort((a, b) => b.score - a.score)
        .flatMap((f) => f.snapIds || [f.id]),
      title: top.title,
      host: c.frags[0].host,
      tabId: c.frags[0].tabId,
      // treeId (2026-08-02): needed so a container can itself become a
      // fragment on assembleThreads' second, looser chaining pass
      // (adjacent-container chaining, below) — without it a container
      // silently can't ever be chained again.
      treeId: c.frags[0].treeId,
      startTime: from,
      endTime: to,
      durMs: to - from, // SPAN — the width-rule exception (spec §6)
      heartbeats,
      audibleMs,
      activity,
      scrollable: c.frags.some((f) => f.scrollable),
      // isOpenTab (Active Tab Manager Phase 2, 2026-08-22 unification):
      // same OR-of-members convention as mergeVisits' merged object above
      // — a container containing a currently-open tab (directly or via an
      // already-merged fragment) should switch to it on click, not open a
      // duplicate. children (contained excursions) checked too: an
      // excursion INTO a currently-open tab is a real, if narrower, case.
      isOpenTab: c.frags.some((f) => f.isOpenTab) || children.some((ch) => ch.isOpenTab),
      openTabId: (c.frags.find((f) => f.isOpenTab) || children.find((ch) => ch.isOpenTab) || {})
        .tabId,
      // tabIndex (strip-ordering rework, spec §7c): same convention as
      // openTabId directly above — see mergeVisits' own tabIndex comment
      // for why this field exists at all (detectContainers' final sort
      // always reorders by startTime, silently losing Chrome's real tab
      // order otherwise).
      tabIndex: (c.frags.find((f) => f.isOpenTab) || children.find((ch) => ch.isOpenTab) || {})
        .tabIndex,
      // pinned (strip-ordering rework, spec §7c, bug fix): same convention
      // as tabIndex directly above — see mergeVisits' own pinned comment
      // for why this was missing (added alongside isOpenTab/openTabId
      // originally, but pinned itself was overlooked until a real
      // specimen — four genuinely pinned tabs still showing full labels
      // — surfaced it).
      pinned: (c.frags.find((f) => f.isOpenTab) || children.find((ch) => ch.isOpenTab) || {})
        .pinned,
      score: c.score, // summed fragment scores + returns traversal term: add up, then judge
      band: bandFor(c.score),
      // The LAST fragment's exit is the container's exit (2026-08-02,
      // same principle as mergeVisits): needed so a container can
      // testify as a departure boundary if it becomes a non-final
      // fragment on the second, adjacent-container chaining pass.
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

// Thread assembly (spec §6 aggregation, restructured 2026-07-18): the
// display atom is the THREAD — merge across machinery boundaries, then
// frame departures as containers. One name for the rulebook's central
// operation; every consumer (ribbon, week strip, color anchoring) goes
// through here.
export function assembleThreads(events, quiet) {
  // Adjacent-container chaining (spec §6, 2026-08-02): the first pass
  // chains raw fragments at VISIT_GAP_MS; a second pass re-runs the exact
  // same chain-building + qualification on ITS OWN output (containers and
  // leftover merged visits alike), at the looser CONTAINER_CHAIN_GAP_MS —
  // an already-assembled same-host container/visit is a coarser claim
  // than a raw fragment, so it earns a longer bridge. Idempotent when
  // nothing chains (detectContainers returns its input unchanged).
  return detectContainers(detectContainers(mergeVisits(events), quiet), quiet, CONTAINER_CHAIN_GAP_MS);
}

// Threads for every stored day (admission-filtered, scored, assembled;
// quiet — the viewed day's loud assembly happens in render). Feeds the
// week strip and color anchoring so both judge the same objects the
// ribbon draws.
export function threadsByDay(sessions) {
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

// siteNameOf/computeHostNames/labelKeyOf moved to shared/utility.js
// (2026-08-21) — the live tab strip (background.js) needed the same
// "given raw session data, name this site" logic this module owned, so
// it's promoted to the cross-boundary tier rather than forked. Re-exported
// here so timeline.js's existing `import { computeHostNames, labelKeyOf }
// from "./assembly.js"` keeps working unchanged.
export { siteNameOf, computeHostNames, labelKeyOf } from "../shared/utility.js";

