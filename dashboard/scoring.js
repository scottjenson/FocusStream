// FocusStream session scoring (spec §6) — split out of timeline.js
// (2026-08-15, file-size pass, 2026-08-15) because this is the one
// self-contained region of that file: pure functions over a session/event
// object, no shared mutable state, no DOM. Imported by assembly.js (scoring
// feeds thread assembly's merge/container math) and by timeline.js itself
// (layout/paint read band/score for tier and the "earned HIGH" rim).

// --- Score (spec §6). ⚠ Provisional weights inherited from Desktop4's
// demo-tuned values — expected to be revisited against real data.
export const W_COPY = 150; // shared by cut — same weight, one constant (copyCutWeight below)
export const W_PASTE = 80;
export const W_DOWNLOAD = 200;
export const KBD_CAP = 200; // 1 point per keystroke, capped: composition ≈ copy-tier
// Floor-attended copy/cut discount (spec §6, 2026-08-02): at ≤2 heartbeats
// attended, a copy/cut is copying-in-passing (stray selection, SMS 2FA
// code) — W_COPY/W_CUT alone was crossing MED_SCORE regardless of
// context. Drops to W_PASTE's tier, same as paste already gets. Gates on
// attended time only — kbd count has no natural noise/signal split.
export const COPY_CUT_FLOOR_ATTENDED_S = 20;
// "The read" premium (spec §6, 2026-07-15): per active scroll window, ONLY
// on scrollable pages — app-style SPAs (feeds, Maps, Gemini) scroll inner
// containers and read scrollable=false, so the gate excludes exactly the
// grazing/churn false positives. Tuned offline against a real day: W=5
// promoted one block (a read article); W=3 rescued nothing.
export const W_SCROLL = 5;
// The traversal term (spec §6 Score v1, 2026-07-24): thread assembly adds
// this per JOIN — machinery navigations and returns alike — on top of the
// summed member totals. Multiple committed page views are intent the
// per-signal totals can't see; the joins counted are exactly the
// survivors of the SPA debounce, blip, and transit filters, so
// view-state churn and redirect machinery contribute nothing. No
// user-act gate (rejected on data — plans). Single-day-validated;
// retest before tuning (watch list).
export const W_NAV = 50;
export const HIGH_SCORE = 1000;
export const MED_SCORE = 150;

// "Earned" vs. "accumulated" HIGH (2026-08-06, exploratory — see plans):
// a thread's tier is the band of the SUMMED fragments (spec §6
// Aggregation), which conflates two different shapes of intent — one
// fragment that was HIGH on its own (a real, concentrated moment) vs.
// several lesser fragments piling up via revisits/W_NAV traversal until
// the sum crosses HIGH_SCORE. A week's data showed these are NOT
// proxies for each other (only 4/35 HIGH containers that week had an
// individually-HIGH member) — earned HIGH is rare and worth marking.
export function hasEarnedHigh(e) {
  const members = e.members ? e.members.flatMap((m) => m.members || [m]) : [e];
  return members.some((m) => m.score >= HIGH_SCORE);
}

// Weak-bridge guard support (spec §6, 2026-08-14): a container's own
// .band is its SUMMED strength, which says nothing about how weak the
// ONE fragment actually touching a given gap was — a container that
// earned HIGH from members deep inside its span can still open or close
// with a near-zero fragment at its edge. Walks to the chronological edge
// fragment (first member if resuming after a gap, last if closing before
// one) recursively through nested containers, and tests THAT fragment's
// own band, not the container's.
export function edgeBand(e, side) {
  let cur = e;
  while (cur.members && cur.members.length) {
    cur = side === "start" ? cur.members[0] : cur.members[cur.members.length - 1];
  }
  return cur.band;
}

// Measured attention: active windows OR audible playback (max, not sum —
// same-frame video counts in both; audible catches cross-origin embeds).
export function attendedSeconds(s) {
  return Math.max((s.heartbeats || 0) * 10, Math.round((s.audibleMs || 0) / 1000));
}

export function scoreSession(s) {
  const a = s.activity || {};
  const attended = attendedSeconds(s);
  const copyCutWeight = attended <= COPY_CUT_FLOOR_ATTENDED_S ? W_PASTE : W_COPY;
  return (
    attended +
    copyCutWeight * (a.copy || 0) +
    copyCutWeight * (a.cut || 0) +
    W_PASTE * (a.paste || 0) +
    W_DOWNLOAD * (a.download || 0) +
    Math.min(a.keyboard || 0, KBD_CAP) +
    (s.scrollable ? W_SCROLL * (a.scroll || 0) : 0)
  );
}

export const bandFor = (score) =>
  score >= HIGH_SCORE ? "high" : score >= MED_SCORE ? "medium" : "low";

// "www." is scan noise — stripped BEFORE hashing/grouping, so www and
// naked variants share one identity (color, runs, labels).
// Moved to shared/utility.js (2026-08-21, live tab-strip label reuse) —
// re-exported here so every existing `import { hostOf } from "./scoring.js"`
// site keeps working unchanged.
export { hostOf } from "../shared/utility.js";

export function fmtDuration(ms) {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return secs + "s";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + "m" + String(secs % 60).padStart(2, "0") + "s";
  // Hour scale drops seconds: "3h49m", not "229m00s" — a multi-hour away
  // span is read at minute precision (spec §6 gap plates).
  return Math.floor(mins / 60) + "h" + String(mins % 60).padStart(2, "0") + "m";
}

export function hourNum(t) {
  const h = new Date(t).getHours();
  return h % 12 === 0 ? 12 : h % 12;
}

export function fmtHour(t) {
  return `${hourNum(t)}${new Date(t).getHours() < 12 ? "am" : "pm"}`;
}

export function fmtClock(t) {
  return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
