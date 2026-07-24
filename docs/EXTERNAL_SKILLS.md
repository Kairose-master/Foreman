# External Skill Loading

This document covers loading skills from a local filesystem path that lives
outside Foreman's own repository, and how the results are composed together
with Foreman's bundled skills. It builds directly on
`docs/SKILL_CONTRACT.md` (what a skill package is) and `docs/SKILL_SDK.md`
(how to author one) — read those first if you haven't.

## What "external" means here (and what it deliberately doesn't)

External, in this Epic, means exactly one thing: **a local directory path,
supplied by the user, containing skill packages in the same directory-with-
SKILL.md shape every bundled skill already uses.** Nothing more.

Explicitly out of scope (non-goals of this mechanism):

- A remote registry or catalog.
- Automatic package installation (npm, git clone, or otherwise).
- Version negotiation between a skill and the harness.
- A permissions/marketplace model.
- Dependency sandboxing for a skill's own tooling.
- Any arbitrary shell execution introduced by the loader itself.
- Any credential access introduced by the loader itself.

Loading an external directory uses the exact same `LocalDirectoryProvider`
that already backs Foreman's bundled skills (`src/direction/skills/
discover.ts`) — pointed at a different root path. There is no second,
separately-coded "external loader." The only genuinely new code this Epic
adds is the **composition** of multiple providers together
(`src/direction/skills/compose.ts`).

## Composing bundled + external: `CompositeSkillProvider`

```ts
import { LocalDirectoryProvider } from './direction/skills/discover.js'
import { CompositeSkillProvider } from './direction/skills/compose.js'

const provider = new CompositeSkillProvider([
  { provider: new LocalDirectoryProvider('/path/to/foreman/skills'), source: 'bundled' },
  { provider: new LocalDirectoryProvider('/path/to/my/external/skills'), source: 'external:/path/to/my/external/skills' },
])
```

`CompositeSkillProvider` itself implements `SkillProvider` — the same
single-method interface every other provider satisfies. This means the
Planner (`runPlanner`) takes it exactly like it would take any single
provider, with **zero code changes and zero provider-specific branching**
added to `planner.ts`. Composition is fully transparent to orchestration;
proven by `test/compose.test.ts`'s own source-grep test asserting
`planner.ts` never mentions `CompositeSkillProvider`, `duplicatePolicy`, or
`listDetailed`.

### Deterministic merge order

Skills are merged in the order the `ProviderEntry[]` array was given to the
constructor. Each provider's own skills keep whatever order that provider's
own `list()` returned them in (unchanged). There is no re-sorting, scoring,
or reordering by any property of the skill itself — order here is purely a
function of caller-supplied provider order, and (as with every other
ordering convention in this codebase — Promise.all results, Planner
candidates) it must never be read as rank, priority, or confidence.

### Attribution

Every merged `SkillDescriptor` carries an optional `source` field set to the
`ProviderEntry.source` label the caller supplied (e.g. `"bundled"` or
`"external:/path/to/my/external/skills"`). This lets a consumer (the CLI's
`skills list`, Epic 2.12) show which provider a given skill came from,
without requiring every standalone provider (like `LocalDirectoryProvider`
used on its own, outside composition) to know about attribution — `source`
is set only by `CompositeSkillProvider`, additively, never breaking any
existing provider or consumer that doesn't care about it.

### A broken external package doesn't block valid ones

Consistent with `LocalDirectoryProvider`'s own existing behavior (a
malformed `SKILL.md` is silently excluded, not fatal — see
`docs/SKILL_CONTRACT.md`), a malformed external skill package is simply
absent from the merged result. `CompositeSkillProvider` doesn't change this
per-package behavior; it only adds one more failure mode above the
per-package level:

**A provider's `list()` call itself failing** (the directory path doesn't
exist and the OS rejects the read, a permissions error, etc — distinct from
one bad package inside an otherwise-readable directory) is, by default,
disclosed as a diagnostic rather than thrown: the other providers' skills
are still returned. Passing `{ strict: true }` changes this — any provider
failure then throws immediately, surfacing the problem loudly instead of
silently returning a partial list. Non-strict is the default because a
mis-typed or temporarily-unavailable external path shouldn't take down
Foreman's own bundled skills; `strict: true` exists for callers (e.g. CI, or
`foreman skills validate`, Epic 2.12) that specifically want to fail loudly
on a misconfigured external path.

## Duplicate skill id policy — decision

When two providers each define a skill with the same `id`, exactly one of
three policies applies, chosen via the `duplicatePolicy` option (never
guessed per-call, per-id, or silently):

| Policy | Behavior |
|---|---|
| `'reject'` (default) | Both/all definitions of the colliding id are excluded from the merged result entirely. A diagnostic explains which providers collided and that the id was rejected. |
| `'first-wins'` | The first-listed provider's definition is kept; later ones are discarded. A diagnostic still records the collision. |
| `'last-wins'` | The last-listed provider's definition is kept; earlier ones are discarded. A diagnostic still records the collision. |

**`'reject'` is the default**, and the recommended choice for most setups.
Rationale: silently picking a winner between two skill packages that happen
to share an id — but might have materially different procedures, from
different authors, possibly written years apart — risks running the *wrong*
skill under a *familiar* id without anyone noticing. This project's standing
position elsewhere (see the Synthesizer's contract) is that conflicts are
disclosed, not silently resolved on the caller's behalf; the same principle
applies here. A missing skill (with a clear diagnostic explaining exactly
why) is loud and immediately debuggable. A silently shadowed one is not, and
the failure mode is much harder to notice: everything *looks* like it's
working, using the wrong procedure.

`'first-wins'`/`'last-wins'` exist for callers who deliberately want
override semantics — e.g. always trusting bundled skills over any
externally-supplied one with the same id (`'first-wins'` with bundled listed
first), or deliberately letting a local override directory supersede a
bundled skill of the same name (`'last-wins'` with the override directory
listed last). Choosing either is an explicit, informed opt-in — never the
silent default.

## Fixtures

`test/fixtures/external-skills/` covers every required scenario:

- `valid/external-widget/` — a well-formed external skill package.
- `malformed/broken-skill/` — missing required frontmatter fields.
- `duplicate/security/` — deliberately collides with the `security` id (used
  against a bundled-style fixture root in tests) to exercise all three
  duplicate-id policies.
- `empty/` — an external root with no skill packages at all.

`test/compose.test.ts` exercises bundled + external together, each fixture
individually, all three duplicate-id policies, both strict and non-strict
provider-failure handling, and confirms `CompositeSkillProvider` is accepted
by the real, unmodified `runPlanner` with no provider-specific code anywhere
in `planner.ts`.
