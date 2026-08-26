// FocusStream shared utilities — cross-boundary pure functions callable from
// BOTH the background service worker (capture) and the dashboard (display).
// Real ES exports; background.js is a module worker, so it imports directly.
//
// One file on purpose. Split into focused files once this holds 3+ genuinely
// unrelated concerns — a topic-count trigger, not a line-count one. Today it
// holds one: site naming.

export function hostOf(s) {
  try {
    return new URL(s.url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// google.com label split (spec §6): the one multi-app host — Search and Maps
// share a hostname, namespaced by first path segment. For LABELS ONLY the
// grouping key appends that segment; identity (color, merging, chains) stays
// hostname-keyed. Add hosts here per specimen, never speculatively —
// the rejected general mechanism is in decisions/timeline_design.md.
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

// Label = the site's own name, one per LABEL KEY per render (spec §6).
// Derived from ALL admitted titles across the stored week, never per-run —
// two runs of one site answering to two names breaks self-legending.
//
// Two rules, tried in order, as two separate passes over one loop:
//   1. HOSTNAME MATCH — a segment that IS the domain name (exact equality
//      after normalization, never containment: "googledocs" must not match
//      "docs") is the site declaring its own name, corroborated by the URL,
//      so it skips the contest below. Recurrence required (≥2 titles,
//      waived for a lone title) so a one-off doc named "Docs" can't claim
//      docs.google.com.
//   2. INVARIANCE — the segment present in the most titles, majority of
//      separator-bearing titles required. Ties prefer FIRST position: the
//      "App - page" house style is invariant-first, while "page - Site"
//      never ties because leading segments vary.
// Hostname is the fallback; identity (color/grouping) stays hostname-keyed
// regardless. The two passes deliberately scan different title sets — see
// the loop below. Story: decisions/timeline_design.md.
export function siteNameOf(titles, host) {
  const SEP = /\s+[-–—|·/]\s+/;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Hostname labels AND the full hostname: a title may carry the TLD
  // ("RuTracker.org", "Amazon.com", "social.coop"), which label-only
  // matching missed or truncated.
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
    // title is a one-segment title, not an excluded one. Do not narrow this
    // to the first/last candidates; that is pass 2's rule, not this one.
    for (const s of new Set(segs)) {
      if (s.length > 30) continue;
      if (labels.has(norm(s))) {
        declared.set(s, (declared.get(s) || 0) + 1);
        continue;
      }
      // Word-boundary containment fallback: the brand is embedded in the
      // segment ("Car Rentals from Avis"), not the whole of it. Weaker than
      // equality, so it tallies separately and is consulted only when
      // equality finds nothing.
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
  // Weaker fallback: the brand embedded mid-segment.
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

// Names for every label key with admitted sessions this week. Recomputed per
// render (cheap); walks RAW sessions pre-assembly, so merged-visit member
// titles are covered. `isTransit` is passed in, not imported, to stay
// independent of transit.js's loading style (globalThis in classic-script
// contexts, named export in modules).
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
