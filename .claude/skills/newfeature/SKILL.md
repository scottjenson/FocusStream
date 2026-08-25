---
name: newfeature
description: Start a new feature or exploration — run the framing conversation, then create its spec stub and decision log. Use when the user wants to begin a new feature, explore a new direction, or says they have an idea to work through before building. Creates files; does not write code and does not commit.
---

# Newfeature

Start an exploration so a future agent can pick it up cold. Run the framing
questions FIRST, then write two files from the answers. Do not write feature
code in this skill.

## Why this exists

Two explorations in this project started differently, and it decided how
they aged.

**Tab manager (2026-08-21)** — first commit created four things at once:
`spec/tabmanager.md` (43-line stub, before Phase 1 was built),
`decisions/tabmanager.md` with an Origin section, and a SPEC.md pointer. Ten
weeks on it is resumable, and §7 work has been picked up cold repeatedly.

**Card deck (2026-08-11)** — first commit created ONE file,
`plans/stack-ribbon.md`, framed "experiment, prototype-stage (may be
reverted)." No spec file, ever. Rules had nowhere to land, so they piled
into the plan doc, which became the sole source of truth for the dashboard's
DEFAULT view while `spec/display.md` described something else. It was
dissolved 2026-08-25.

**The load-bearing difference is the spec stub.** "May be reverted" feels
like appropriate humility and is the trap: it licenses skipping the spec
file, and a rule with nowhere to go ends up in the conversation doc. A stub
costs ~40 lines and is cheap to delete if the idea dies. Not writing one is
what makes an exploration hard to unwind later.

## Ask these before writing anything

The point of this skill is the conversation, not the scaffolding. A stub
that says "TBD" is no better than what the card deck had. If an answer isn't
known yet, that is fine — **record it as explicitly undecided**, which is
itself useful. What is not fine is leaving it unasked.

1. **What prompted this?** A complaint, a lost capability, an outside
   proposal, a specimen. The trigger dates the idea and explains it later.
2. **What was considered and rejected?** Including "build the whole thing in
   one pass" if that was on the table. One line of reasoning each.
3. **What are the phases, and what does the FIRST one validate?** Phases are
   separate go/no-go decisions, not a delivery schedule. Phase 1 should test
   the riskiest assumption cheaply — the tab manager's Phase 1 was a pure
   display layer specifically to validate injection and data flow *before*
   anything destructive was built on it.
4. **What is explicitly undecided?** Name it. "Exact expansion mechanism
   undecided, to be designed when Phase 1 is stable" is a real answer and
   ages well.
5. **What could make this fail or be abandoned?** If there is a blocking
   condition, it belongs in `WATCHLIST.md` from the start.

Ask them conversationally, not as a form. Two or three exchanges beats one
interrogation. Use AskUserQuestion when options are genuinely alternatives.

## Then create

**1. `decisions/<feature>.md`** — the conversation, structured:

    # <Feature> — Decision Log

    Reasoning/story behind `spec/<feature>.md` (§N). One accumulating file
    across all phases — new phases append dated entries here.

    ## Origin (<date>)
    <what prompted it; what was rejected and why>

    ## Phase breakdown (adopted <date>)
    <numbered phases, each a go/no-go; what phase 1 validates;
     what is explicitly undecided>

**2. `spec/<feature>.md`** — a stub, even if short. Only what is decided
and true today. State plainly which phases are built and which are not.
Rules only, no story — the story is in `decisions/`.

**3. `SPEC.md`** — a few lines pointing at both, so it is discoverable.

**4. `decisions/README.md`** — one row in the index table naming the new log
and what it covers. This skill is the main reason that file changes at all.

**5. `WATCHLIST.md`** — only if question 5 produced a blocking condition.

## Notes

- Section-number the spec file (§7, §8...) so existing `§N` references
  elsewhere keep resolving.
- Phases live in `decisions/`, never in their own file. The tab manager's
  roadmap has never needed one.
- If the exploration replaces or competes with something existing, say so in
  SPEC.md — divergence between what ships and what is specced is the failure
  this skill exists to prevent.
- Feature code is a separate step. This skill ends when the files exist.
- `decisions/README.md` indexes FILES, not changes — one line describing the
  new log's scope. Never append session entries to it: that is what
  `HISTORY.md` did (470 lines duplicating 116 commits) and why it was
  deleted 2026-08-25.
