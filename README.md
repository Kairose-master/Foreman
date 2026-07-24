# Foreman

> **Codename — rename freely.** "Foreman" = the one who takes your goal, drives
> the crew, and checks the *direction* with you before charging off. Swap it
> anywhere in these docs with one find-and-replace.

**An autonomous coder that argues about direction and shuts up about execution.**

You set the heading. It does the rowing. It will not nag you for permission to
edit a file or run a command — but it *will* stop and talk to you before it
commits to an approach, because that's the expensive decision. It can't blow
your budget and it can't ship work that fails an independent check.

---

## The one line

> Say what you want. Agree on the *approach*, not the keystrokes. Then it writes
> the code on your real repo, on its own, inside a budget, and only hands back
> work that passes an independent grade.

## Why this exists (short)

Powerful coding agents already exist. The gap isn't capability — it's that
getting a good result out of one means becoming a prompt/workflow/routing
expert, or watching it thrash and burn tokens down the wrong path. Most people
won't do that work. That's not laziness to fix; it's the market. Foreman does
the agent-wrangling so you don't have to. Full argument: [`docs/VISION.md`](docs/VISION.md).

## The split (this is the whole idea)

| | Who decides | Why |
|---|---|---|
| **Direction** — approach, tradeoffs, "which way" | **You** (adjustable) | Judgment is scarce, mistakes here are expensive and hard to undo |
| **Execution** — code, files, commands, tools | **Foreman, fully autonomous** | Mechanical, reversible; asking permission here is just noise |

Today's tools get this backwards: they interrupt you on every file edit (cheap,
reversible) and silently pick a direction (expensive, wrong 20 tool-calls
later). Foreman inverts it. Details: [`docs/INTERACTION.md`](docs/INTERACTION.md).

## How it works

```
you: a goal ("add rate limiting to the API")
        ↓
Foreman proposes a DIRECTION (approach + forks + tradeoffs) — not a keystroke
        ↓
you: approve / adjust        ← the only place you're in the loop (dial-able)
        ↓
Foreman executes on your real repo, autonomously, no permission prompts
   • bounded by a hard budget (tokens / $)
   • every deliverable passes an independent grade or it doesn't count
        ↓
you get back: passing work + a diff + what it cost + a signed proof
```

## Quick start

### Install the CLI globally

```bash
npm install -g @kairose-master/foreman
export ANTHROPIC_API_KEY=sk-ant-...      # or `ant auth login`
foreman "add rate limiting to the API" --dir /path/to/your/repo
```

### Or run it without installing (npx)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx @kairose-master/foreman "add rate limiting to the API" --dir /path/to/your/repo
npx @kairose-master/foreman --help
```

### Or use it as a library (SDK)

To author a skill or import Foreman's public types programmatically instead
of using the CLI, add it as a dependency and import from the `/sdk` entry
point — see [`docs/SKILL_SDK.md`](docs/SKILL_SDK.md):

```bash
npm install @kairose-master/foreman
```

```ts
import { defineSkill } from '@kairose-master/foreman/sdk'
```

### Or run from source (contributing to Foreman itself)

```bash
git clone https://github.com/Kairose-master/Foreman.git
cd Foreman
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm run foreman -- "add rate limiting to the API" --dir /path/to/your/repo
```

Foreman prints an **approach proposal**, waits for your `go` / adjustment, then
runs the Claude Agent SDK on your repo with execution permission-prompts off —
capped by a hard budget and gated by an independent grade. See
[`docs/INTERACTION.md`](docs/INTERACTION.md) for the session shape.

Common flags:

| Flag | Meaning | Default |
|---|---|---|
| `--dir <path>` | The repo Foreman acts on | current directory |
| `--budget <usd>` | Hard cost ceiling for the run | `$0.60` (`FOREMAN_BUDGET_USD`) |
| `--dial <light\|normal\|hands-on>` | How often it checks direction | `normal` (`FOREMAN_DIAL`) |
| `--yes` | Non-interactive: accept the recommended direction and run | off |
| `--dry-run` | Produce the proposal only; don't execute | off |

`foreman --help` lists them all.

## Skills pipeline CLI

Alongside the full `foreman "<goal>"` run above, four subcommands let you
inspect and run the **direction-only skills pipeline** (Planner → matched
specialist Skills → Synthesizer) on its own, without executing anything —
see [`docs/SKILL_CONTRACT.md`](docs/SKILL_CONTRACT.md),
[`docs/SKILL_SDK.md`](docs/SKILL_SDK.md), and
[`docs/EXTERNAL_SKILLS.md`](docs/EXTERNAL_SKILLS.md) for the underlying
concepts.

```bash
# See every discovered skill (bundled + any external ones you've configured)
foreman skills list

# Same, machine-readable
foreman skills list --json

# Add a local external skill directory alongside the bundled ones
foreman skills list --skills-path ./my-skills

# Validate every skill package's manifest; non-zero exit on any invalid one
foreman skills validate
foreman skills validate --strict   # also fail loudly if a provider path can't be read

# See which skills WOULD be asked about a goal, and why — no model call
foreman inspect "add rate limiting to the API"

# Run the real pipeline: match candidates, invoke each, synthesize the result
foreman plan "add rate limiting to the API"
foreman plan "add rate limiting to the API" --json
```

Shared flags: `--dir/-C <path>`, `--skills-path <path>` (repeatable),
`--no-bundled`, `--duplicate-policy <reject|first-wins|last-wins>`,
`--strict`, `--model <id>`, `--json`. `foreman --help` prints the full list.

`plan`'s output always shows the real verdict, decision groups,
relationships (agreement/complementary/tension/contradiction), specialist
attribution, and any disclosed failures — never hidden or filtered for
cleaner output.

## Architecture at a glance

Foreman is two layers:

- **Foreman (this repo)** — the harness. Wraps the **Claude Agent SDK** to act
  on your actual codebase, and adds the one thing the SDK doesn't: a
  *direction-first* interaction layer with an involvement dial.
- **Ledgermind (git submodule at `engine/ledgermind`)** — the trust engine.
  Provides the safety net that makes "execute without asking" acceptable:
  independent grading (grader ≠ solver), budget/cost caps, signed proof of
  work, and a reputation record. This is the existing
  [ai-agent-credit-dashboard](https://github.com/Kairose-master/ai-agent-credit-dashboard)
  repo, brought in as a submodule. Full picture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

The harness talks to the engine through a **narrow four-call seam**
(`src/engine/contract.ts`): `checkBudget`, `grade`, `proof`, `recordOutcome`.
Two implementations satisfy it — a self-contained `LocalEngine` (the default,
so Foreman runs standalone) and a `LedgermindEngine` that delegates to a running
Ledgermind instance. Everything behind the seam — how grading actually runs,
escrow, on-chain, the marketplace — stays invisible to the harness.

```
foreman/
├── engine/ledgermind/     ← git submodule: grading · budget · proof · reputation
├── src/                   ← the harness (Agent SDK wrapper + direction layer)
│   ├── cli.ts             ← entry point: parse args, run, report, subcommand dispatch
│   ├── cli/               ← skills-pipeline subcommands (list/validate/plan/inspect)
│   ├── sdk.ts             ← public Skill SDK (foreman/sdk) — author a skill without internals
│   ├── foreman.ts         ← the run loop (propose → approve → execute → grade → prove)
│   ├── config.ts          ← env + defaults (model, budget, dial, engine)
│   ├── types.ts           ← shared types
│   ├── direction/         ← goal → approach proposal; the involvement dial
│   │   └── skills/        ← Planner, Skill Runner, matcher, Synthesizer, providers
│   ├── execution/         ← drive the Agent SDK, track budget, collect the diff
│   ├── engine/            ← the four-call seam + LocalEngine + LedgermindEngine
│   └── interaction/       ← CLI prompts + the final report
├── skills/                ← bundled specialist skills (research, architecture, security)
├── examples/              ← worked examples (e.g. an SDK-authored external-style skill)
├── test/                  ← vitest unit tests for the pure logic
├── docs/
│   ├── VISION.md          ← why: the convenience/expertise-gap bet
│   ├── ARCHITECTURE.md    ← the two layers + the submodule contract
│   └── INTERACTION.md     ← the spine (fixed) + the dial (preference)
└── README.md
```

## Status

**Working first slice.** The harness in `src/` runs end to end: it builds a
direction proposal, takes your call, drives the Claude Agent SDK against a real
repo with execution permission-prompts off, enforces a hard budget, grades the
diff independently, and issues a signed proof on a pass. The default
`LocalEngine` makes it self-contained; the `LedgermindEngine` seam is where the
existing Ledgermind product plugs in as the trust engine.

## Set up the submodule

The engine is vendored as a pinned submodule. After cloning Foreman:

```bash
git submodule update --init engine/ledgermind
```

To update the engine later: `git submodule update --remote engine/ledgermind`.
