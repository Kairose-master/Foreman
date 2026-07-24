# Security (bundled skill)

The third real specialist skill in Foreman's direction layer, following the
package contract in [`docs/SKILL_CONTRACT.md`](../../docs/SKILL_CONTRACT.md).

## What it does

Given a goal and repository context, decides for itself whether the goal
carries real trust/abuse weight — and if so, reasons strictly about new
trust boundaries, authority movement, authentication/authorization changes,
concrete abuse scenarios, new integrity assumptions, auditability, and
replay/spoofing/escalation/denial-of-service risk (only when a real
mechanism for one exists). Surfaces a genuine security fork only when a real
security-shaped design decision exists (e.g. shared secret vs. mutual
authentication; stateless vs. session token; optimistic vs. strict
validation; capability model vs. ACL; zero trust vs. trusted internal
network).

## What it deliberately does not do

- Redesign architecture — it names the trust boundary and the risk; the
  structural fix is Architecture's job.
- Research prior art or comparable systems — that's Research's job.
- Discuss performance or UX.
- Recommend specific implementation code or configuration.
- Synthesize or reference another specialist's output.
- Assume it's needed. A goal with no new trust boundary, no authority
  movement, and no attacker-reachable surface usually has nothing for it to
  say, and it should say so via the standard `relevant: false` result.

## Invocation

Not called directly. Discovered by a `SkillProvider`, narrowed by the
mechanical candidate filter (`src/direction/skills/match.ts`), and invoked
generically by the Skill Runner (`src/direction/skills/run-skill.ts`), which
knows nothing about this skill by name. See `examples/relevant-example.md`
for a worked, illustrative input/output pair.
