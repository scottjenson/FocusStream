// FocusStream shared utilities — cross-boundary pure functions callable from
// BOTH the background service worker (capture) and the dashboard (display).
// Promoted here (2026-08-21) when the live tab strip (spec §7) needed
// siteNameOf/computeHostNames/labelKeyOf, previously dashboard-only code in
// dashboard/assembly.js — the strip runs in background.js and has the same
// legitimate claim on "given raw session data, name this site" as the
// dashboard does. Real ES exports; background.js is a module worker
// (2026-08-21) so it can import directly, same as any dashboard file.
//
// Deliberately a single file for now rather than one-file-per-function —
// the traffic across the capture/display boundary is new and its shape
// isn't known yet. Revisit (split into focused files) once this file holds
// 3+ genuinely unrelated concerns — not a line-count trigger, a topic-count
// one. Today it holds exactly one concern: site naming.

export function hostOf(s) {
  try {
    return new URL(s.url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// google.com label split (spec §6, 2026-07-25): the one recorded
// multi-app host — Search and Maps share the hostname, namespaced by
// first path segment. For LABELS ONLY, the grouping key appends that
// segment (google.com/maps, google.com/search) and the invariance
// machinery names each group from its own titles. Identity — color,
// merging, chains — stays hostname-keyed. Extended per specimen, never
// speculatively; the rejected general mechanism is in plans.
const LABEL_SPLIT_HOSTS = new Set(["google.com"]);
export function labelKeyOf(host, url) {
  if (!LABEL_SPLIT_HOSTS.has(host)) return host;
  try {
    const seg = new URL(url).pathname.split("/")[1];
    return seg ? host + "/" + seg : host;
  } catch {
    return host;
  }
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
// Hostname match wins outright (spec §6, 2026-07-19; widened 2026-07-28):
// a segment that IS the domain name — exact equality after normalization
// against a hostname label OR the full hostname, never containment
// ("googledocs" must not match "docs") — is the site declaring its own
// name, corroborated by the URL, so it skips the count contest and the
// majority guard. Recurrence required (≥2 titles, waived for a lone
// title) so a one-off doc literally named "Docs" can't claim
// docs.google.com. Born of WorkFlowy's invariant "Organize your brain. -
// WorkFlowy": both segments tied every week and the first-position
// tie-break crowned the tagline.
//
// The two rules are separate passes over one loop (2026-07-28): the
// hostname match reads every segment of every title (separator-free
// titles included — they are one-segment titles), while invariance keeps
// its first/last candidates over separator-bearing titles only. That
// split subsumed the 2026-07-25 middles carve-out and fixed rutracker,
// where ten "RuTracker.org" titles were filtered out before the match
// could see them and two "Smart girl" torrent listings won by majority.
export function siteNameOf(titles, host) {
  const SEP = /\s+[-–—|·/]\s+/;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Hostname labels AND the full hostname (spec §6, 2026-07-28): a title
  // may carry the TLD ("RuTracker.org", "Amazon.com", "social.coop"),
  // where label-only matching missed or truncated the name.
  const labels = new Set(host.split(".").slice(0, -1).map(norm).filter(Boolean));
  labels.add(norm(host));
  const declared = new Map(); // exact spelling -> n  (hostname match, equality)
  const contained = new Map(); // exact spelling -> n  (hostname match, word-boundary)
  const counts = new Map(); // first/last -> { n, first }  (invariance)
  let parted = 0; // titles with a separator — invariance evidence
  let lastTail = null;
  for (const t of titles) {
    const segs = (t || "").split(SEP).map((s) => s.trim()).filter(Boolean);
    if (!segs.length) continue;
    // Hostname match sees EVERY segment of EVERY title — a separator-free
    // title is a one-segment title, not an excluded one. Subsumes the
    // 2026-07-25 middles carve-out (all positions participate now).
    for (const s of new Set(segs)) {
      if (s.length > 30) continue;
      if (labels.has(norm(s))) {
        declared.set(s, (declared.get(s) || 0) + 1);
        continue;
      }
      // Word-boundary containment fallback (2026-08-02): the brand is
      // embedded in the segment ("Car Rentals from Avis"), not the whole
      // segment. Weaker than equality, so it's a separate tally consulted
      // only when equality finds nothing.
      const words = s.split(/[^a-zA-Z0-9]+/).filter(Boolean);
      for (const w of words) {
        if (labels.has(norm(w))) contained.set(w, (contained.get(w) || 0) + 1);
      }
    }
    // Invariance needs an App/page structure, so it alone filters to
    // separator-bearing titles and to first/last candidates, where
    // recurring middle noise can never win on popularity.
    if (segs.length < 2) continue;
    parted++;
    lastTail = segs[segs.length - 1];
    const cands = new Map(); // per-title dedupe: count once per title
    if (segs[0].length <= 30) cands.set(segs[0], true);
    if (segs[segs.length - 1].length <= 30 && !cands.has(segs[segs.length - 1]))
      cands.set(segs[segs.length - 1], false);
    for (const [name, isFirst] of cands) {
      const c = counts.get(name) || { n: 0, first: false };
      c.n++;
      c.first = c.first || isFirst;
      counts.set(name, c);
    }
  }
  // The site declaring its own name, corroborated by the URL: most
  // frequent spelling, returned verbatim (shortening would invent a name).
  let match = null;
  for (const [name, n] of declared) {
    if (n < 2 && titles.length > 1) continue;
    if (!match || n > match.n) match = { name, n };
  }
  if (match) return match.name;
  // Weaker fallback: the brand embedded mid-segment (2026-08-02).
  let containMatch = null;
  for (const [name, n] of contained) {
    if (n < 2 && titles.length > 1) continue;
    if (!containMatch || n > containMatch.n) containMatch = { name, n };
  }
  if (containMatch) return containMatch.name;
  if (!parted) return null;
  if (parted === 1) return lastTail && lastTail.length <= 24 ? lastTail : null;
  let best = null;
  for (const [name, c] of counts) {
    if (!best || c.n > best.c.n || (c.n === best.c.n && c.first && !best.c.first)) {
      best = { name, c };
    }
  }
  return best && best.c.n * 2 >= parted ? best.name : null;
}

// Names for every label key with admitted sessions this week. Recomputed
// per render (cheap); merged-visit member titles are covered because this
// walks RAW sessions, pre-assembly. `isTransit` is passed in rather than
// imported, so this stays independent of shared/transit.js's own loading
// style (globalThis in classic-script contexts, named export in modules).
export function computeHostNames(sessions, isTransit) {
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
