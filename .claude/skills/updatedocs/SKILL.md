---
name: updatedocs
description: Record what this session learned into the project's md files — the correct, minimal addition. Use when the user asks to update the docs, save what we learned, or wrap up a work session. Adds only; does not restructure existing docs and does not commit.
---

# Updatedocs

Record what this session established, in the project's md files, at the
shortest length that stays true. Runs at the end of every session; the
occasional deep pass over everything is `/docaudit`. Do NOT commit — that's
`/skill commit`, invoked separately.

## Scope: aware of history, does not act on it

**This skill ADDS. It does not restructure.**

Reading the surrounding docs is required — you cannot write a correct
minimal addition without knowing what is already stated, which rule yours
amends, and where the reasoning already lives. That reading will surface
problems in text you did not write: a bloated neighbouring bullet, an old
rule never cleaned up, content sitting in the wrong file.

**Note those; do not fix them.** They belong to `/docaudit`, which exists
to go looking for exactly that and has the verification discipline for it.
Acting on them here turns a five-minute closeout into an unrequested audit,
and does it without the safety checks that work needs.

The one thing you DO fix: rot your own edit just introduced. If your
addition layered a correction beside the rule it replaces, or pushed a
bullet past its budget, that is this session's work and yours to clean up.

The line: **read history, write today, leave the rest.**

## The bar

**Write what a future reader needs and cannot recover from the code.**
Everything else is cut. Length is not the target; it's the symptom. The
usual failure is narrating how the answer was found instead of stating what
turned out to be true — it feels like substance while writing and is dead
weight a month later.

Cut on sight:
- The debugging path. What you tried, what you ruled out, what surprised you.
- Re-teaching general knowledge (how CSS specificity works, what rAF is).
- Restating what the diff already shows.
- Hedges and self-assessment ("worth noting", "interestingly", "I chose").

Keep:
- The rule as it now stands, and its date.
- A wrong model that was corrected — the *correction*, not the hunt.
- An alternative that lost, and the one-line reason.
- A specimen that forced a decision.
- A knob's value and what would move it next.

## Budgets

Hard caps. If it doesn't fit, it isn't compressed enough — don't reflow into
denser prose to sneak past.

| File | Cap per entry |
|---|---|
| `decisions/README.md` | one line per LOG, and only when a log is added/retired |
| `SPEC.md`, `spec/*.md` | 2-4 sentences + date tag |
| `decisions/*.md` | **15 lines**, hard |
| `WATCHLIST.md` | entry shape in that file's header |
| Code comments | 1-2 lines + a pointer to the md file |

15 lines for `decisions/` is deliberately aggressive: that directory is
~16:1 against the spec it explains and recent entries ran 60-200 lines. If a
change genuinely needs more, say so and ask — don't just take it.

## Amending a rule: replace, don't layer

**The spec states what is true NOW. When a rule changes, delete the text it
replaced** — don't append a correction beside it. The superseded version's
story belongs in `decisions/`, if anywhere. A rule needs a date tag, not a
changelog: `(revised 2026-08-25)` is enough.

This is the main way these files rot, and it hides well — nobody adds 190
lines, they add 8 lines eighteen times, each feeling necessary for contrast.
The same applies WITHIN a bullet: absorbing an amendment into an existing
sentence, rather than beside it, is how one bullet ends up carrying a dozen
rules. If your edit pushes a bullet past 2-4 sentences or gives it a second
date tag, split it instead.

Keep out of the spec: anything not built. Proposals, deferred phases, and
designed-but-unshipped rules go to `decisions/` with a pointer.

Cleaning up drift that is ALREADY there — layered sections, fused bullets,
misfiled content — is `/docaudit`, not this skill. Don't start a retrofit
during a closeout; note it and move on.

Starting a NEW feature or exploration is `/newfeature`, which creates its
spec stub and decision log from a framing conversation. If this session began
one without those files existing, say so — writing today's entry into a
subsystem with no home is how drift starts.

## Steps

1. **Ask what actually changed** — re-read the session's diff (`git diff`),
   not your memory of it.
2. **Apply the "did this earn an entry" test.** Real reasoning — evidence, a
   rejected alternative, a specimen, a corrected model — earns a
   `decisions/` entry. A small fix does not: code, and nothing else.
   **Writing nothing is a valid and common outcome.** Say so and stop.
3. **Write the rule, then the reasoning:** `SPEC.md`/`spec/` for anything
   whose truth-value changed, the relevant `decisions/` log for the why.
   There is no changelog to update — `git log` is the change history. Touch
   `decisions/README.md` ONLY if you created or retired a decision log.
4. **Trim the code comments you wrote this session** to the budget above.
   The comment says what; the md file says why; the comment names which file.
5. **Check tense.** An amended rule must not leave older text reading as
   current. Fix the old passage or date-stamp it.
6. **Check your OWN edit for rot** — did it layer, fuse, or overrun a
   budget? Fix that. Pre-existing problems in text you did not write get
   NOTED in the report for `/docaudit`, never fixed here (Scope, above).
7. **Report** what you wrote, what you deliberately left out, and any
   pre-existing drift you noticed and left alone.

## Notes

- Never write the same content in two files (CLAUDE.md's documentation map).
- Prefer amending an existing entry over appending a near-duplicate one.
- A rule whose truth-value changed MUST be updated in `SPEC.md`/`spec/` —
  brevity is not a licence to leave the spec stale.
