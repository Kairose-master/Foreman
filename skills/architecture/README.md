# Architecture (bundled skill)

The second real specialist skill in Foreman's direction layer, following the
package contract in [`docs/SKILL_CONTRACT.md`](../../docs/SKILL_CONTRACT.md).

## What it does

Given a goal and repository context, decides for itself whether the goal
carries real structural weight — and if so, reasons strictly about fit
against existing module boundaries, abstraction stability, boundary
tightening/leaking, coupling, and responsibility ownership. Surfaces a
genuine architectural fork only when a real mutually-exclusive structural
choice exists (e.g. layered vs. event-driven; local vs. shared abstraction;
in-module vs. extracted subsystem; extension point vs. direct
implementation).

## What it deliberately does not do

- Security, UX, or performance analysis — those are other specialists' jobs,
  even when a boundary under discussion happens to also be security-relevant.
- Search for external prior art or comparable systems — that's Research's
  job. Architecture reasons about *this codebase's own structure*, not what
  exists elsewhere.
- Recommend implementation steps or file layouts — it names structural
  consequences and choices, never how to type the code.
- Synthesize or reference another specialist's output.
- Assume it's needed. A contained, leaf-level, single-responsibility change
  usually has nothing architectural in it, and it should say so via the
  standard `relevant: false` result.

## Invocation

Not called directly. Discovered by a `SkillProvider`, narrowed by the
mechanical candidate filter (`src/direction/skills/match.ts`), and invoked
generically by the Skill Runner (`src/direction/skills/run-skill.ts`), which
knows nothing about this skill by name. See `examples/relevant-example.md`
for a worked, illustrative input/output pair.
