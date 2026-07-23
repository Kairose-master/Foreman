# Interaction model

Two things live here, and keeping them separate is the whole design:

- **The spine** — fixed. Never a setting.
- **The dial** — the user's preference. One knob.

## The spine (fixed)

1. **Direction is the user's; execution is Foreman's.**
   - Direction = approach, tradeoffs, which-way. The user owns it.
   - Execution = code, files, commands, tools. Foreman does it autonomously and
     does **not** ask permission per action.
2. **Two guardrails make autonomous execution safe:**
   - A **hard budget** (tokens / $). Foreman winds down cleanly at the ceiling —
     it never silently blows past it.
   - An **independent quality gate**. Work that fails the grade is not presented
     as done, full stop. Foreman can't hand you garbage and call it finished.

If either guardrail were off, "execute without asking" would be reckless. With
both on, it's safe to let it run.

## The dial (preference)

*How often does Foreman stop to align on direction?* This is taste, and it
changes per person and per task. One knob, sane default:

| Setting | Foreman stops to talk when… | Good for |
|---|---|---|
| **Light** | Only once, up front — shows the approach, then runs to the end | Well-scoped tasks, trusted areas |
| **Normal** *(default)* | Up front, **plus** whenever a real fork appears (a decision that changes the shape of the result) | Most work |
| **Hands-on** | Up front and at every meaningful branch | New codebase, high-stakes, or "I have opinions" |

The dial only ever changes **direction** check-ins. It **never** turns execution
permission-prompts back on — that noise stays off at every setting.

### What counts as a "fork" (Normal mode)

Foreman interrupts for *direction*, not for *doing*. A fork is a decision that
changes the shape of the outcome, e.g.:

- two legitimately different approaches (rewrite vs. patch; library A vs. B)
- a tradeoff the user's taste should settle (speed vs. clarity; scope creep)
- an ambiguity in the goal that would send it meaningfully the wrong way

Not a fork (just do it): which file to open, what to name a variable, whether to
run the tests, how to format.

## A session, concretely

```
you:      add rate limiting to the API

foreman:  Approach: token-bucket middleware in the request pipeline, in-memory
          for now. One fork I want your call on:
            (a) per-IP  — simple, but proxies/NAT share an IP
            (b) per-API-key — fairer, but only works on authed routes
          Default I'd pick: (b) for authed routes, (a) fallback for the rest.
          Budget for this: $0.60. Go?

you:      go, but make the limits configurable

foreman:  [runs autonomously — edits middleware, wires config, adds tests,
           runs them — no permission prompts]

foreman:  Done. Passed the independent grade (tests green + spec check).
            • 7 files changed  ·  diff below
            • cost: $0.41 of $0.60
            • proof: <signed cert id>
          Want the fallback path (a) wired too, or leave it?
```

Note where you were in the loop: **the approach and one fork** — 20 seconds. Not
the file edits, not the test runs, not "can I write to this file." And the run
couldn't have cost more than $0.60 or handed you failing code.

## Failure is honest, not hidden

If Foreman can't produce passing work inside the budget, it does **not** dress up
a near-miss as done. It surfaces the truth: *"couldn't get the tests green within
$0.60 — here's how far I got, here's where it's stuck, want me to raise the
budget or change the approach?"* A cheap, honest failure beats an expensive
plausible-looking wrong answer — that's the entire point of the token-burn fix.

## Why this specifically fixes token burn

The waste in today's agents is a *wrong direction, committed silently, then
executed at length*. Foreman removes the silent part (you approve direction
cheaply, up front) and caps the length (hard budget). The expensive mistake can't
compound, because the human is placed exactly where the expensive mistake is
made — and nowhere else.
