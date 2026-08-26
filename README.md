# FocusStream

A personal Chrome extension (Manifest V3) that tracks how much attention you
actually give each page you visit, and renders your browsing as a
chronological, activity-weighted timeline.

It's a modern take on the 1990s **Lifestreams** paper but instead of a string of documents, it's URLs. It displays a horizontal ribbon where each block's width is how long you
were there, its height and brightness are how much the page mattered, and
the gaps between blocks are the time you were away. Related visits chain
into single threads, so a morning of returning to the same document reads as
one journey rather than nine disconnected entries.

Attention is measured from real interaction: scrolling, typing, clicking,
audible playback — not from a tab merely being open. Only the visible,
focused tab accrues activity. No keystrokes or clipboard contents are ever
recorded, only counts.

This is a personal prototype, not a Web Store extension.

## Install

No build step, no dependencies — load it unpacked:

1. Clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the repo root (the folder with
   `manifest.json`).
4. Pin the extension so you can open it easily.

Click the toolbar icon to open the dashboard in a full tab. The same click
also dumps every recorded session as a `console.table` in the service worker
console (`chrome://extensions` → FocusStream → *service worker*).

Data lives entirely in `chrome.storage.local` on your machine and is pruned
after 7 days. Nothing is sent anywhere.

## Layout

| path | what it is |
|---|---|
| `background.js` | service worker — session lifecycle, storage, snapshots |
| `content.js` | per-page activity heartbeat (10s) |
| `dashboard/` | the full-tab UI; `timeline.js` is the ribbon's pipeline |
| `shared/` | pure functions used by both the worker and the dashboard |
| `testing/` | replay + screenshot harnesses (plain Node / Playwright) |

## Docs

- **`SPEC.md`** — what the system does today (rules only). Start here.
  Capture-side detail in `spec/capture.md`, display-side in `spec/display.md`.
- **`decisions/`** — why it works that way: evidence, rejected alternatives.
  `decisions/README.md` indexes them.
- **`WATCHLIST.md`** — open doubts about current rules.
- **`CLAUDE.md`** — how to work on this project.
