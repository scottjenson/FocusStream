// FocusStream session scoring (spec §6). Pure functions over a session/event
// object — no shared mutable state, no DOM. Imported by assembly.js (merge/
// container math) and timeline.js (tier, earned-HIGH rim).

// --- Score (spec §6). ⚠ Provisional weights (Desktop4 demo-tuned) —
// turn one knob at a time.
export const W_COPY = 150; // shared by cut — same weight, one constant (copyCutWeight below)
export const W_PASTE = 80;
export const W_DOWNLOAD = 200;
export const KBD_CAP = 200; // 1 point per keystroke, capped: composition ≈ copy-tier
// Floor-attended copy/cut discount (spec §6): at or below this attended
// time a copy/cut is copying-in-passing, and scores at W_PASTE's tier
// instead. Gates on attended time only — see spec/display.md.
export const COPY_CUT_FLOOR_ATTENDED_S = 20;
// "The read" premium (spec §6): per active scroll window, ONLY on
// scrollable pages. The gate is load-bearing — app-style SPAs scroll inner
// containers and read scrollable=false, which is exactly what excludes the
// grazing/churn false positives. Do not ungate it.
export const W_SCROLL = 5;
// The traversal term (spec §6): thread assembly adds this per JOIN —
// machinery navigations and returns alike — on top of the summed member
// totals. The joins counted are exactly the survivors of the SPA debounce,
// blip, and transit filters, so churn contributes nothing by construction.
// ⚠ Tuned on ONE day — retest before touching (WATCHLIST.md).
export const W_NAV = 50;
export const HIGH_SCORE = 1000;
export const MED_SCORE = 150;

// "Earned" vs. "accumulated" HIGH (spec §6): a thread's tier is the band of
// the SUMMED fragments, which conflates one individually-HIGH fragment (a
// concentrated moment) with several lesser ones piling up via revisits.
// These are not proxies for each other — earned HIGH is rare.
export function hasEarnedHigh(e) {
  const members = e.members ? e.members.flatMap((m) => m.members || [m]) : [e];
  return members.some((m) => m.score >= HIGH_SCORE);
}

// Weak-bridge guard support (spec §6). NOT e.band: a container's own band is
// its SUMMED strength, which says nothing about how weak the ONE fragment
// touching a given gap was — a container that earned HIGH from members deep
// inside its span can still open or close with a near-zero fragment. Walks
// recursively to the chronological edge fragment and tests THAT band.
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

// Lives in shared/utility.js (the worker needs it too); re-exported here so
// existing `import { hostOf } from "./scoring.js"` sites keep working.
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
