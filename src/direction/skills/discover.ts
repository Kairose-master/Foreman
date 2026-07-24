/**
 * Skill discovery — the SkillProvider abstraction (docs/SKILL_CONTRACT.md).
 *
 * Orchestration (the Planner and everything downstream, later epics) must
 * never depend on *how* skills are found — only on the fact that a provider
 * can list them. This file defines that narrow contract. Implementations
 * (starting with a local-filesystem-backed one) are added below/later;
 * future providers (bundled, git, remote registry) satisfy the same
 * `SkillProvider` interface without orchestration ever changing.
 *
 * Discovery reads only a package's `SKILL.md` frontmatter. It does not parse
 * or return the procedure body — loading/running a skill is a concern of
 * whatever invokes it (the Skill Runner, a later epic), not of discovery.
 */

/** Metadata for one discovered skill package. Never includes the procedure body. */
export interface SkillDescriptor {
  /** Stable, unique id (from frontmatter). */
  id: string
  /** Short human label (from frontmatter). */
  name: string
  /** One line, used later for mechanical candidate matching (a later epic). */
  description: string
  /** Where the package lives, so a later stage can read SKILL.md's full body. */
  path: string
}

/**
 * The whole surface the orchestration layer is allowed to know about.
 * Deliberately one method — no get-by-id, no watch, no caching contract.
 * Add those only when something downstream actually needs them.
 */
export interface SkillProvider {
  list(): Promise<SkillDescriptor[]>
}
