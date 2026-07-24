# Skill SDK

This document is for anyone authoring a new Foreman skill who does not want
to (and should not need to) read `src/direction/skills/*` internals. It
covers the public surface exported from `src/sdk.ts` (published as the
package's `foreman/sdk` entry point).

If you haven't read it yet, `docs/SKILL_CONTRACT.md` is the underlying
packaging contract this SDK sits on top of — a skill is still a directory
with a `SKILL.md` file (frontmatter + procedure body), and this SDK does not
change that. What it adds is: public types, one authoring helper, and one
offline validator, so you never need to import the Planner, the Skill
Runner, or any discovery internals to write a correct skill.

## What you get from `foreman/sdk`

```ts
import {
  defineSkill,
  validateSkillManifest,
  validateSkillResponse,
  type SkillManifest,
  type SkillInput,
  type SkillFinding,
  type SkillResult,
  type Fork,
  type ForkOption,
} from 'foreman/sdk'
```

Nothing else. In particular, this module deliberately does **not** export
`runSkill`, `runPlanner`, `filterCandidates`, `synthesize`, or
`LocalDirectoryProvider` — those are the harness's job. Authoring a skill
package never requires touching them.

## 1. The minimal skill

A skill is a manifest with four fields:

```ts
import { defineSkill, type SkillManifest } from 'foreman/sdk'

const manifest: SkillManifest = {
  id: 'performance-review',       // stable, lowercase-hyphenated
  name: 'Performance Review',      // short human label
  description: 'Hot-path latency, N+1 queries, and unbounded allocation concerns.',
  procedure: `You are the Performance specialist... (see below)`,
}

const skillMd = defineSkill(manifest)
// write skillMd to <your-skills-dir>/performance-review/SKILL.md
```

`defineSkill` validates the manifest and returns the exact `SKILL.md` string
(frontmatter + procedure body) discovery expects. It does not write to disk
— you decide where the file goes.

## 2. Metadata: id, name, description

- `id` — stable, unique, lowercase, hyphenated (e.g. `performance-review`).
  Used to attribute findings back to this skill everywhere downstream
  (Synthesizer output, relationship classification, CLI output).
- `name` — a short human label, shown in listings.
- `description` — **exactly one line**. This is the *only* field the
  mechanical candidate matcher (`filterCandidates`) uses to decide whether
  your skill is even asked about a given goal. Write it specific to your
  domain's real vocabulary, not generic marketing copy — a vague
  description is the single most common reason a skill never gets invoked.

`validateSkillManifest(manifest)` checks these rules (plus that `procedure`
is non-empty) and returns every violation at once, not just the first:

```ts
import { validateSkillManifest } from 'foreman/sdk'

const result = validateSkillManifest({ id: '', name: 'X', description: 'y', procedure: 'z' })
// { ok: false, errors: ['"id" is required and must be non-empty'] }
```

A malformed `SKILL.md` is silently excluded by real discovery with no error
surfaced anywhere (see `docs/SKILL_CONTRACT.md`) — that's fine for the
harness's own resilience, but it's a bad experience while you're authoring.
Run `validateSkillManifest` (or just call `defineSkill`, which throws with
the full error list) before you ever touch discovery.

## 3. Execution: what your procedure receives

Your skill is never customized per-invocation beyond one shared packet
(`SkillInput`, from `foreman/sdk`):

```ts
interface SkillInput {
  goal: string
  repoContext: string
  reputationHints: string[]
}
```

Every skill gets the identical packet — there is no per-skill briefing.
Your procedure's own text is the only place your domain-specific behavior
lives. Your first instruction should always be a self-relevance check: most
goals will not need every skill, and an honest "not relevant" is a correct,
complete answer (see the three bundled skills under `skills/` for the
convention every one of them follows).

Your procedure must produce **only** a JSON object, matching:

```json
{
  "relevant": true,
  "summary": "one line",
  "concerns": ["short concern 1", "..."],
  "forks": [
    { "id": "...", "question": "...", "options": [{"id":"a","label":"...","tradeoff":"..."}], "recommended": "a" }
  ]
}
```

If `relevant` is `false`, `concerns` and `forks` should be empty arrays.

## 4. The expected `SkillResult`

Once your skill runs (for real, through the harness), the result is one of
four kinds (`SkillResult`, from `foreman/sdk`) — not a boolean:

- `relevant` — your skill said it applies; `finding` (summary, concerns,
  forks) is attached.
- `not-relevant` — your skill said it doesn't apply. Not a failure.
- `invocation-failed` — the model call itself couldn't complete (network,
  credentials, your `SKILL.md` couldn't be read).
- `unparseable` — the call completed, but your response didn't match the
  required shape above. The raw response is preserved for debugging.

You never need to construct a `SkillResult` yourself — the Skill Runner
does that from your procedure's raw response. This type exists so you can
write your own tests against it (see §6).

## 5. Validation failure — testing your procedure's output offline

You will not always want to make a real model call while iterating on your
procedure's wording. `validateSkillResponse(raw)` runs your candidate output
through the exact same shape check the real Skill Runner applies — same
code, not a second copy that could silently drift:

```ts
import { validateSkillResponse } from 'foreman/sdk'

const result = validateSkillResponse(`{"relevant": true, "summary": "...", "concerns": [], "forks": []}`)
if (!result.ok) {
  console.error(result.error) // e.g. 'response is missing a boolean "relevant" field'
}
```

A pass here means the real pipeline will accept your response's shape too.
It does not (and cannot) judge whether your response's *content* is any
good — that's between you and the model reading your procedure.

## 6. Testing your skill

Two levels, cheapest first:

1. **Offline shape testing** — feed candidate/golden responses (hand-written
   or captured from a real call you made once) through
   `validateSkillResponse`. Zero network, zero orchestration dependency.
2. **Real pipeline testing** — put your package directory under a
   `SkillProvider` root (e.g. `LocalDirectoryProvider`, or per Epic 2.11,
   an external-loading provider) and run it through the actual Planner. See
   `examples/sdk-authored-skill/` for a complete worked example: a manifest
   built with only `foreman/sdk` types, a `generate.ts` script that calls
   `defineSkill` and writes the result, and `test/sdk-example.test.ts`,
   which proves the generated `SKILL.md` is discovered by the real
   `LocalDirectoryProvider` and produces a real `relevant` finding when run
   through the real, unmodified `runPlanner` (with the model call mocked).

## Non-goals of this SDK (Epic 2.10)

- A remote registry or package-publishing flow.
- Dynamic network installation of skills.
- Version negotiation between skill and harness versions.
- A permissions/marketplace model.
- Dependency sandboxing for a skill's own tooling.

These may become real questions once skills are distributed outside this
repository (see Epic 2.11 for the first step: loading skills from a local
external path). This SDK only solves "author a correct skill package,"
nothing about how it's distributed.
