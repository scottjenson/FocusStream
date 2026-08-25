// Rule-change replay harness (spec §6 chaining/merging rules).
//
// Answers ONE question: "if I change an assembly rule, how many containers
// across the real database change, and which ones?" Scott's standing
// acceptance test for a chaining rule is that the specimen splits while the
// total block/container count barely moves — a large increase means the rule
// is shattering containers elsewhere.
//
// Why this works: dashboard/assembly.js and dashboard/scoring.js are pure ES
// modules with no DOM dependency, so the REAL pipeline runs under Node. The
// harness imports the shipping modules directly — it can never drift from
// what the dashboard renders. No new dependencies (plain Node, unlike the
// Playwright harness next door).
//
// Usage:
//   1. Export real sessions from the DASHBOARD console (not the ribbon —
//      that's a content script with no chrome.storage.local access):
//
//        var d = await chrome.storage.local.get(["sessions","lockIntervals"]);
//        var slim = d.sessions.map(({pageText, ...s}) => s);
//        copy(JSON.stringify({sessions: slim, lockIntervals: d.lockIntervals || []}));
//
//      Paste into a file (pbpaste > sessions.json). pageText is stripped
//      because it is search-only bulk this harness never reads.
//
//   2. node replay-rules.mjs sessions.json
//
// Baseline only, by default. To test a candidate rule, edit assembly.js
// directly and re-run: the harness reports current-code numbers, so diff
// them against the baseline you recorded before the edit. For A/B in ONE
// run, gate the candidate on a globalThis flag inside assembly.js and add
// it to VARIANTS below.
//
// Known-good reference (2026-08-24, 1888 sessions / 8 days):
//   before the back-to-back-Meet rules: 389 blocks / 185 containers
//   after  (spec §6, gap-audio URL continuity + earned-HIGH pass one):
//                                       394 blocks / 187 containers

import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const DATA = process.argv[2];
if (!DATA) {
  console.error("usage: node replay-rules.mjs <sessions.json>   (see header)");
  process.exit(1);
}

// assembly.js reads FS_TRANSIT off globalThis — shared/transit.js sets it as
// an import side effect, exactly as dashboard/index.html does via its own
// <script type="module"> tag. Must load first.
await import(path.join(REPO, "shared/transit.js"));
const { parseSessions, assembleThreads } = await import(path.join(REPO, "dashboard/assembly.js"));

const raw = JSON.parse(fs.readFileSync(DATA, "utf8"));
const sessions = raw.sessions || raw;

// A session belongs to the day it ENDS in (spec §6).
const dayStart = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return +d;
};
const days = [...new Set(sessions.map((s) => dayStart(s.endTime)))].sort();

// A container/merged visit is any assembled event with >1 member; a
// single unmerged session is a thread of length 1 (spec §6).
const isContainer = (e) => Array.isArray(e.members) && e.members.length > 1;

// Add entries here to A/B candidate rules in one run, e.g.
//   { name: "ruleX", setup: () => { globalThis.__FS_RULE_X = true; } }
// paired with a globalThis check inside assembly.js.
const VARIANTS = [{ name: "current", setup: () => {} }];

function run(variant) {
  variant.setup();
  const perDay = new Map();
  let blocks = 0;
  let containers = 0;
  for (const day of days) {
    const events = assembleThreads(parseSessions(sessions, day), true);
    const c = events.filter(isContainer).length;
    perDay.set(day, { blocks: events.length, containers: c, events });
    blocks += events.length;
    containers += c;
  }
  return { name: variant.name, perDay, blocks, containers };
}

const results = VARIANTS.map(run);
const base = results[0];

console.log(`\n${sessions.length} sessions over ${days.length} days\n`);
console.log("variant\tblocks\tcontainers\tΔblocks\tΔcontainers");
for (const r of results) {
  const sign = (n) => (n >= 0 ? "+" : "") + n;
  console.log(
    `${r.name}\t${r.blocks}\t${r.containers}\t\t${sign(r.blocks - base.blocks)}\t${sign(r.containers - base.containers)}`
  );
}

console.log("\nPER DAY (blocks/containers)");
console.log(["day", ...results.map((r) => r.name)].join("\t"));
for (const day of days) {
  const cells = results.map((r) => {
    const d = r.perDay.get(day);
    return `${d.blocks}/${d.containers}`;
  });
  const changed = cells.some((c) => c !== cells[0]) ? "  <-- CHANGED" : "";
  console.log([new Date(day).toISOString().slice(0, 10), ...cells].join("\t") + changed);
}

// Container identity = host + exact span. A container that changed membership
// necessarily changed span, so this catches splits, merges, and re-chaining.
const sigs = (r) => {
  const m = new Map();
  for (const day of days)
    for (const e of r.perDay.get(day).events.filter(isContainer))
      m.set(`${e.host}|${e.startTime}|${e.endTime}`, e);
  return m;
};
for (const r of results.slice(1)) {
  const a = sigs(base);
  const b = sigs(r);
  const gone = [...a.keys()].filter((k) => !b.has(k));
  console.log(`\n${r.name}: ${gone.length} baseline container(s) changed`);
  for (const k of gone) {
    const e = a.get(k);
    console.log(
      `   ${e.host}  ${new Date(e.startTime).toLocaleString()} → ` +
        `${new Date(e.endTime).toLocaleTimeString()}  members=${e.members.length} band=${e.band}`
    );
  }
}

// Per-host container census for the newest day — the quickest way to eyeball
// a specimen ("did today's four meetings actually separate?").
const today = days[days.length - 1];
if (today != null) {
  const host = process.argv[3];
  if (host) {
    console.log(`\n${new Date(today).toISOString().slice(0, 10)} — ${host} blocks`);
    for (const r of results) {
      const evs = r.perDay.get(today).events.filter((e) => e.host === host);
      console.log(`-- ${r.name}: ${evs.length} block(s)`);
      for (const e of evs) {
        const urls = [...new Set((e.members || [e]).map((m) => m.url))];
        console.log(
          `   ${new Date(e.startTime).toLocaleTimeString()} → ` +
            `${new Date(e.endTime).toLocaleTimeString()}  band=${e.band}  ${urls.length} distinct URL(s)`
        );
      }
    }
  }
}
