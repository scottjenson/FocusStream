---
name: docaudit
description: Occasional deep audit of the whole doc corpus — layered corrections, fused bullets, misfiled content, stale facts, and resolved watch items that should have been deleted. Use when the user asks to audit or clean up the documentation, check whether the docs have drifted, or asks for a docs pass. Deletes and restructures; not for recording a session's work (that is /updatedocs). Does not commit.
---

# Docaudit

Audit the whole documentation corpus for drift and fix it.

**Cadence is the difference.** `/updatedocs` runs at the end of every
session and adds today's entry. This runs occasionally — weekly at most —
reads everything, and deletes. If you are here because a session just ended,
you want `/updatedocs` instead. Do NOT commit.

## Scope: looking for trouble, on purpose

**This skill goes hunting.** `/updatedocs` reads existing docs to place one
correct addition — aware of history, but it does not act on it. This skill
is the opposite: existing text IS the subject, across every doc at once, and
finding nothing wrong is a valid result to report.

Invoked deliberately and occasionally — never as a step inside a closeout.
If a session's `/updatedocs` reported drift it left alone, that report is
the natural input here.

**This skill deletes.** That is a higher-risk operation than `/updatedocs`'s
appends, so verification is not optional — see Verifying, below. Two errors
of mine were caught only by running it.

## What drift looks like

Four diseases plus an index check. Each has its own detector, except stale
watch items, which must be read. They do not overlap, and a
detector for one is silent on the others.

### 1. Layering (spec files)

An amendment appended BESIDE the rule it replaced, so a reader reconstructs
the current rule by replaying its history. Nobody adds 190 lines; they add 8
lines eighteen times, each feeling necessary for contrast.

Detect by marker words:

    grep -c "corrected\|revised\|superseded\|retired\|Earlier version\|first cut\|rebuilt" FILE

**Only meaningful in `spec/`.** In `decisions/` these words are legitimate
content — recording what lost is that file's job. Measured density was
identical (0.9/100 lines) in a cleaned file and an untouched one.

**Low precision — treat a hit as "go read this", never as a finding.** A run
scoring `spec/display.md` at 5.1/100 (5.6x any other file) turned up markers
that were all legitimate on inspection: real "X is retired" and "supersedes
Y" rules, correctly stated once. The fusion detector is the sharper
instrument; this one only nominates a file to look at.

### 2. Fusion (spec files)

Amendments ABSORBED into an existing bullet until one carries a dozen rules
and a dozen date tags. Nastier than layering: it reads as one dense rule, so
it never looks like bloat, and no marker word appears anywhere in it.

Detect by shape, not vocabulary:

    awk '{n=gsub(/20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]/,"")} \
         n>=3 || length>1200 {printf "L%-4d %5d chars %2d dates\n", NR, length, n}' FILE

Three or more dates in one bullet means three or more rules wearing one
bullet's clothing.

A useful corpus-level check: what share of a file's characters sit in its
five longest lines. 35% means fusion; 1% is healthy. **Only meaningful above
~100 lines** — on a short index file five lines ARE the file, and SPEC.md
scored a meaningless 36% at 66 lines. Trust the per-line detector there.

### 3. Misfiling

Content in the wrong file per CLAUDE.md's documentation map — most often
found while splitting a fused bullet, because fusion hides it. A 4,000-char
"snapshot" bullet in `spec/display.md` was mostly capture-side machinery
while `spec/capture.md` had zero coverage of any of it.

No detector; it surfaces during a split. When a split produces a group that
doesn't match its file's job, MOVE it rather than reflowing it in place.

### 4. Stale watch items (`WATCHLIST.md`)

`WATCHLIST.md`'s own header says an entry is DELETED when it resolves —
"struck-through corpses don't accumulate here." Nothing enforces that, and a
resolved item rarely announces itself: someone fixes the underlying rule and
never revisits the entry. The three drift detectors are blind to this, since
a six-week-dead watch item has perfect formatting.

**No detector — this one is READ, per entry.** It is the one part of a
review that cannot be automated, which is why it must be scheduled instead.
Each entry states a concern, a trigger specimen, and a planned response. For
each, ask:

* **Did the rule it doubts still exist?** A watch item on a retired rule is
  dead. (`OPEN_TAB_MIN_W` was retired 2026-08-23; anything watching it went
  with it.)
* **Did the trigger fire and get fixed?** Check `git log` and the relevant
  `decisions/` log for the specimen it names.
* **Does it self-declare?** Grep `superseded|no longer applies|RESOLVED`.
  Rare but free — `contained-child-visibility` sat marked "superseded
  2026-08-07, no longer applies as stated" for 18 days.
* **Has it aged past usefulness?** An entry whose specimen has not appeared
  in six weeks of real use is a candidate for settled-by-silence — the file
  has struck items on exactly that basis before. Age alone is not proof;
  pair it with "the rule has been stable and nobody has hit it."

**Resolving one:** record the lesson in the relevant `decisions/` log (or
confirm it is already there), then DELETE the entry. Never strike it
through. If an entry is partly resolved, rewrite it to the narrower doubt
that remains rather than deleting — `pan-hover-suppression` was handled that
way on 2026-08-25.

**Do not delete on suspicion.** Unlike a duplicated paragraph, a watch item
is the only record of a doubt; if you cannot confirm it resolved, say so in
the report and leave it.

### 5. Index drift

`decisions/README.md` indexes the decision logs. Cheap to verify, and nobody
else checks it:

    ls decisions/*.md          # every log has an index row?
    grep '^| `' decisions/README.md   # every row points at a real file?

Also confirm it has not grown session entries — it describes FILES, not
changes, and reinventing a changelog there is the failure `HISTORY.md`'s
deletion was meant to prevent.

## Where not to look

`decisions/*.md` is large but healthy — 42 sections averaging 54 lines, no
runaways, and the longest is two rejected designs with the reason each lost.
That is exactly its job. Do not "clean" it. Its only real failure mode is a
story that was never written down at all (see Verifying).

## The four outcomes

For each site found, exactly one of:

| Outcome | When |
|---|---|
| **Delete** | The story is already in `decisions/` — spec text is a duplicate |
| **Split** | One bullet is several rules — sibling bullets, dependency order |
| **Move** | Content belongs in another file per the doc map |
| **Leave** | Genuinely dense, not layered. Long is not the same as rotten |

**Split is by far the most common.** Across eight sites worked so far: split
x5, move x1, leave x2, and delete **zero** times as a whole-site fix. An
earlier version of this skill claimed delete was most common; that was wrong.
Deletion is real but happens INSIDE a split — the narrative connective tissue
comes out while the rules stay — which is why checking `decisions/` per story
first still matters on every site.

## Verifying

**Before cutting: grep `decisions/` PER STORY, not per section.** The
"already archived" assumption held for four retrofits and then failed: a
fused snapshot bullet held two stories archived nowhere. Write the missing
ones into `decisions/` FIRST, then cut.

**After cutting: diff the identifiers.**

    git show HEAD:FILE | sed -n 'Np' | grep -o '`[A-Za-z_][A-Za-z0-9_.:<>]*`' | sort -u > /tmp/o.txt
    # same extraction over the new text (across BOTH files if content moved)
    comm -23 /tmp/o.txt /tmp/n.txt

For each identifier dropped, confirm it is still covered in the spec, still
in `decisions/`, or genuinely dead in the code (`grep` the source). Grepping
a list you wrote yourself only finds what you already thought of.

**Re-read the target line immediately before editing — RERUN the detector,
do not trust step 1's line numbers.** They shift after every earlier edit in
the same file. This is not theoretical: in the first real run, splitting one
site moved the next target from L122 to L127, and following the step-1 report
would have edited the wrong bullet.

## Steps

1. **Run the automated detectors** (1-3, plus 5) across `SPEC.md`,
   `spec/*.md`, `WATCHLIST.md`, `decisions/README.md`.
   Report the sites found, worst first, before changing anything. This report
   is a survey, not a work order — its line numbers go stale on the first
   edit.
2. **Read `WATCHLIST.md` end to end** (detector 4). It is short, nothing
   else checks it, and it is the only file whose entries are supposed to be
   deleted on resolution. Do this every pass, not just when a detector fires.
3. **Pick the worst one or two** of the drift sites. Do not attempt the whole
   corpus in a pass — each needs real reading, and a rushed deletion is the
   failure mode.
4. **For each: re-run the fusion detector to re-locate the site**, then read
   it fully and **classify** into one of the four outcomes.
5. **Check `decisions/` per story.** Write any missing reasoning first.
6. **Make the change**, then verify by identifier diff.
7. **Check for stale facts while you are in there.** Layering goes stale:
   retrofits found five spec facts silently overtaken by a later section —
   old constant values, a retired function still named as current. A reader
   following any of them would have been wrong. This is the real cost of
   drift, more than length.
8. **Report** sites fixed, sites deliberately left, and what remains.

## Feeding back into `/updatedocs`

If a pass reveals that drift is entering faster than it is being caught,
that is an `/updatedocs` guardrail problem, not a review problem. Update
`.claude/skills/updatedocs/SKILL.md` — its budgets and its "replace, don't
layer" rule exist to stop these diseases at the source.
