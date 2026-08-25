# testing/ — verification harnesses

Two independent tools, different questions, no shared dependencies:

| tool | question | needs |
|---|---|---|
| `screenshot-real-data.js` | did this RENDER correctly? | Playwright |
| `replay-rules.mjs` | how many containers did this RULE change? | plain Node |

Neither answers "does this feel more browsable," which stays Scott's call.
Background/rationale: `../plans/stack-ribbon.md` Stage 0.

## replay-rules.mjs — assembly rule changes

Runs the REAL pipeline (`dashboard/assembly.js` + `scoring.js` are pure ES
modules with no DOM dependency) over a real `chrome.storage.local` export,
and reports block/container counts per day plus exactly which containers
changed. Imports the shipping modules directly, so it can never drift from
what the dashboard renders.

**The acceptance test it exists to serve:** a chaining-rule change must
split the specimen while leaving the total block/container count nearly
unmoved. A large increase means the rule is shattering containers
elsewhere — the warning sign.

```sh
# 1. In the DASHBOARD console (not the ribbon — that's a content script
#    with no chrome.storage.local access):
#      var d = await chrome.storage.local.get(["sessions","lockIntervals"]);
#      var slim = d.sessions.map(({pageText, ...s}) => s);
#      copy(JSON.stringify({sessions: slim, lockIntervals: d.lockIntervals || []}));
pbpaste > sessions.json

# 2. Baseline BEFORE editing a rule, then again after:
node replay-rules.mjs sessions.json
node replay-rules.mjs sessions.json meet.google.com   # + per-block detail for one host
```

Record the baseline numbers before you edit — the harness reports whatever
the current code does, so the comparison is yours to hold. For a true A/B
in one run, gate the candidate on a `globalThis` flag inside `assembly.js`
and add it to `VARIANTS` at the top of the script.

Data only reaches back as far as the 7-day retention window (spec §2), so
specimens older than a week cannot be replayed.

**Known-good reference** (2026-08-24, 1888 sessions / 8 days): 389 blocks /
185 containers before the back-to-back-Meet rules, 394/187 after — see
`../decisions/timeline_design.md`, "Back-to-back same-host events", for the
full blast-radius table this harness produced.

## screenshot-real-data.js — Playwright render check

Introduces this project's only `npm`/Node dependency (Playwright), scoped
entirely to this directory — the extension itself stays a no-build-step
vanilla JS extension (CLAUDE.md). Nothing here ships in the extension.

## What it does

FocusStream stores everything (`sessions`, `lockIntervals`, `snap:*`
screenshots) in `chrome.storage.local`, which on disk lives under the real
Chrome profile as a leveldb folder:
`~/Library/Application Support/Google/Chrome/Default/Local Extension Settings/<extension-id>/`.

Rather than cloning the whole (12GB+) Chrome profile, `screenshot-real-data.js`:

1. Copies **only** that one leveldb folder (read-only source access, never
   written to) into a disposable scratch Chrome profile, under a **fixed**
   extension ID.
2. Launches that scratch profile with `test-manifest/` (a copy of the real
   extension with a fixed `"key"` added, so it always resolves to the same
   extension ID — needed because the real install is unpacked and would
   otherwise get a fresh, unpredictable ID every load). This manifest is
   separate from and never modifies the real `manifest.json` at the repo
   root.
3. Opens the dashboard against that copied real data and takes a
   screenshot.

The real Chrome profile is **only ever read**, never written to. Each run
uses a fresh OS-temp scratch profile that's independent of your real one.

## Known-good values (proven 2026-08-11)

- Real extension ID in Scott's Chrome (unpacked, path-derived):
  `hggaojjflbdigpmnpnjcojhccehnmjga`
- Real storage source path:
  `~/Library/Application Support/Google/Chrome/Default/Local Extension Settings/hggaojjflbdigpmnpnjcojhccehnmjga`
  (~54MB, all leveldb — sessions + snapshot images)
- Fixed test extension ID (derived from the key in `test-manifest/manifest.json`):
  `ciolidkleekeofbmhldgaldhpmflnmkl`
- Confirmed: loading `test-manifest/` in a scratch profile with that real
  storage folder copied under the fixed ID renders the real dashboard data
  (1903 sessions, real week strip, real containers) — not a fixtures/empty
  state.

If the real extension ID above ever changes (e.g. FocusStream gets
reinstalled from a different path), re-derive it: load the unpacked
extension normally in Chrome, check `chrome://extensions` with Developer
mode for its ID, and update `REAL_STORAGE_DIR` in
`screenshot-real-data.js`.

## Usage

```sh
cd testing
npm install                      # first time only
npx playwright install chromium  # first time only
node screenshot-real-data.js
```

Output: `testing/dashboard-real-data.png`, plus a console line confirming
the loaded extension ID matched the fixed ID (if it doesn't match, the
copied storage folder won't be found by the extension — something changed
upstream, stop and investigate rather than trusting the screenshot).

## Non-goals

- Not a fixtures/simulated-data harness — deliberately rejected (see
  `../plans/stack-ribbon.md`); only real captured data is used.
- Not a judgment tool. It can tell you a layout broke; it cannot tell you
  whether the new design is more browsable than the old one.
