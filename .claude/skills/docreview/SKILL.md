---
name: docreview
description: Periodic audit of the project's md files for drift — layered corrections, fused bullets, misfiled content, stale facts. Use when the user asks to review or clean up the documentation, check whether the docs have drifted, or asks for a docs pass. Deletes and restructures; does not commit.
---

# Docreview

Audit the documentation corpus for drift and fix it. This is the periodic
counterpart to `/updatedocs`: that skill ADDS today's entry, this one fixes what
accumulated entries have become. Do NOT commit.

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

Three diseases, each with its own detector. They do not overlap, and a
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

1. **Run all three detectors** across `SPEC.md`, `spec/*.md`, `WATCHLIST.md`.
   Report the sites found, worst first, before changing anything. This report
   is a survey, not a work order — its line numbers go stale on the first
   edit.
2. **Pick the worst one or two.** Do not attempt the whole corpus in a pass —
   each site needs real reading, and a rushed deletion is the failure mode.
3. **For each: re-run the fusion detector to re-locate the site**, then read
   it fully and **classify** into one of the four outcomes.
4. **Check `decisions/` per story.** Write any missing reasoning first.
5. **Make the change**, then verify by identifier diff.
6. **Check for stale facts while you are in there.** Layering goes stale:
   retrofits found five spec facts silently overtaken by a later section —
   old constant values, a retired function still named as current. A reader
   following any of them would have been wrong. This is the real cost of
   drift, more than length.
7. **Report** sites fixed, sites deliberately left, and what remains.

## Feeding back into `/updatedocs`

If a pass reveals that drift is entering faster than it is being caught,
that is an `/updatedocs` guardrail problem, not a review problem. Update
`.claude/skills/updatedocs/SKILL.md` — its budgets and its "replace, don't
layer" rule exist to stop these diseases at the source.
