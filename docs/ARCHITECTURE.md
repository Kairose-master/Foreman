# Architecture

Foreman is deliberately two layers with a clean seam: a **harness** that acts on
your code, standing on a **trust engine** that keeps it safe. The harness is new;
the engine already exists (Ledgermind) and is brought in as a submodule.

```
┌─────────────────────────────────────────────────────────────┐
│  FOREMAN (this repo) — the harness                           │
│                                                              │
│  • Direction layer:  goal → approach proposal → your OK      │
│  • Involvement dial:  how often it checks direction with you │
│  • Executor:  Claude Agent SDK acting on YOUR real repo      │
│               (Read/Write/Edit/Bash/Grep) — no permission    │
│               prompts on execution                           │
└───────────────┬──────────────────────────────────────────────┘
                │  calls into, per run:
                │   • budget/cost cap   (may I keep spending?)
                │   • grade(deliverable, spec) → pass/fail
                │   • proof(passing work) → signed certificate
                ▼
┌─────────────────────────────────────────────────────────────┐
│  engine/ledgermind (git submodule) — the trust engine        │
│                                                              │
│  • Independent grading (grader ≠ solver): pytest / LLM       │
│    review / vision / whisper                                 │
│  • Budget & cost caps (hard ceiling per run)                 │
│  • Signed proof of authorship & grade (EIP-712 + hash)       │
│  • Reputation record (which approaches actually pass)        │
└─────────────────────────────────────────────────────────────┘
```

## Why two repos, not one

- **Different jobs, different change-rate.** The engine (grading, budget, proof)
  is stable trust machinery. The harness (how it talks to you, how it drives the
  Agent SDK) will churn fast. Keeping them separate lets each move at its own
  pace and keeps the engine reusable.
- **The engine already exists and runs.** Ledgermind is a live product. Vendoring
  it as a submodule means Foreman consumes a *pinned, versioned* engine instead
  of forking or copy-pasting it.
- **The engine stays independent.** Grading must not be entangled with the thing
  being graded — literally the grader ≠ solver rule. A hard repo boundary
  enforces that at the structural level.

## The harness (Foreman, `src/` — TODO)

Two responsibilities the raw Agent SDK doesn't cover:

1. **Direction-first interaction.** Before execution, produce a short *approach
   proposal* — the plan, the forks, the tradeoffs — and get the user's call.
   This is the one in-the-loop moment. Frequency is the user's dial
   (see [`INTERACTION.md`](INTERACTION.md)).
2. **Guard-railed execution.** Drive the Claude Agent SDK (`query()` with its
   built-in Read/Write/Edit/Bash/Grep tools) against the user's real repo, with
   execution-level permission prompts **off** — but wrapped so that:
   - spend is checked against the engine's budget cap continuously, and
   - the final diff is submitted to the engine's grader before it's presented as
     "done."

The harness owns *no* trust logic. It asks the engine.

## The engine (Ledgermind, `engine/ledgermind`)

Consumed for four things. These already exist in the Ledgermind codebase; the
integration work is exposing them as a clean local API the harness calls:

| Need | Ledgermind provides | Where (in the submodule) |
|---|---|---|
| "Is this output actually good?" | Independent grading, grader ≠ solver | `lib/` grading + verified-task path |
| "Don't blow the budget" | Hard per-run cost cap | delegation budget cap (`MAX_BUDGET`) |
| "Prove it passed" | Signed proof of authorship & grade | `lib/attestation.ts`, `lib/work-proof-store.ts` |
| "What approaches actually work" | Reputation from real graded history | `lib/credit-rules.ts` + credit engine |

## The contract (harness → engine)

Keep the seam narrow. The harness should need only a handful of calls:

- `checkBudget(runId) → { remaining, stop }`
- `grade({ deliverable, spec }) → { passed, reason }`
- `proof({ deliverable, grade }) → { id, hash, signature, url }`
- `recordOutcome({ approach, passed, costUsd })` (feeds reputation: which
  directions tend to pass, so proposals get better over time)

Everything else — how grading actually runs, escrow, on-chain, the marketplace —
stays behind that seam, invisible to the harness.

## Execution flow (one run)

```
1. user goal ─▶ harness: build approach proposal
2. harness ─▶ user: "here's the direction / forks / tradeoffs"   [DIAL]
3. user: approve / adjust
4. harness: start Agent SDK on the repo, execution-permits OFF
     loop each step:
       ├─ engine.checkBudget() → if stop: wind down cleanly, report
       └─ Agent SDK edits/writes/runs autonomously
5. harness: engine.grade(diff, spec)
     ├─ fail → don't present as done; either retry within budget or
     │         surface honestly ("couldn't pass X within $Y")
     └─ pass → engine.proof(...) 
6. user gets: diff + cost + pass + signed proof
```

## What is explicitly NOT here yet

`src/` is empty. This is a spec. The engine it depends on is real and running;
the harness — the Agent SDK wrapper and the direction layer — is the thing to
build, and these docs exist so it's built deliberately.
