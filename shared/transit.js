// FocusStream shared transit predicate — the single source of truth for
// "does this session qualify to exist on the dashboard?" (spec §3 rung 2,
// §6 snapshot unification). Loaded by BOTH contexts, which is why it hangs
// off globalThis (service workers have no window):
//   - dashboard/index.html <script>s it before timeline.js (display filter)
//   - background.js importScripts() it (finalize-time snapshot deletion)
//
// Admission filter, display rung (spec §3): below one heartbeat window
// (our attention quantum) with no high-intent discrete signals = machinery
// (OAuth hops, SSO choosers, consent bounces, autoplay bounces).
// Clicks/mouse/scroll don't save it — a click is how you LEAVE a page —
// and neither do audible time (autoplay is the page's action, not the
// user's) or a flush-artifact heartbeat. Filtering is display-time on
// purpose: sessions stay in storage + Score table so the rule can be
// audited (only the snapshot is deleted for rejected sessions).
const TRANSIT_MS = 10_000;
// Terminal-keystroke discount (spec §3, 2026-07-24): the keystroke that
// killed the session — a close chord landing within TERMINAL_KEY_MS of
// the hide — is how you LEAVE a page, the keyboard form of the click
// rule. Discounts exactly ONE keystroke, so typing before a close chord
// still exempts. Provisional per the one-knob rule.
const TERMINAL_KEY_MS = 500;
function isTransit(s) {
  if (s.endTime - s.startTime >= TRANSIT_MS) return false;
  const a = s.activity || {};
  let kb = a.keyboard || 0;
  if (kb && typeof s.lastKeyGapMs === "number" && s.lastKeyGapMs <= TERMINAL_KEY_MS) kb--;
  return !(kb || a.cut || a.copy || a.paste || a.download);
}

globalThis.FS_TRANSIT = { TRANSIT_MS, TERMINAL_KEY_MS, isTransit };
