# Research (bundled skill)

The first real specialist skill in Foreman's direction layer, following the
package contract in [`docs/SKILL_CONTRACT.md`](../../docs/SKILL_CONTRACT.md).

## What it does

Given a goal and repository context, decides for itself whether the goal
carries genuine external uncertainty — and if so, surfaces prior art already
in the repo, comparable approaches worth knowing about, and (usually most
valuably) assumptions the goal is implicitly making that haven't been
verified yet.

## What it deliberately does not do

- Make the final call between approaches (that's the user's, via a fork if
  one genuinely exists — see docs/INTERACTION.md).
- Touch files or run anything (Research never executes; it only informs
  direction).
- Review the whole repository (it answers one scoped goal).
- Produce security/architecture/UX/performance analysis — those are other
  specialists' jobs, and blurring that boundary makes every specialist's
  output harder to trust individually.
- Assume it's needed. Most goals — a rename, a formatting pass, an
  already-established local pattern — have nothing for it to research, and
  it should say so via the standard `relevant: false` result rather than
  manufacture a finding.

## Invocation

Not called directly. Discovered by a `SkillProvider`, narrowed by the
mechanical candidate filter (`src/direction/skills/match.ts`), and invoked
generically by the Skill Runner (`src/direction/skills/run-skill.ts`), which
knows nothing about this skill by name. See `examples/relevant-example.md`
for a worked, illustrative input/output pair.
