/**
 * Skill manifest validation (Epic 2.10, moved here in Epic 2.12).
 *
 * Originally lived directly in src/sdk.ts. Moved into this internal module
 * so BOTH the public SDK (authoring-time validation, src/sdk.ts's
 * `defineSkill`/`validateSkillManifest` re-exports) and internal
 * orchestration tooling (the CLI's `skills validate`, Epic 2.12, which
 * needs to validate a raw on-disk package that discovery would otherwise
 * silently exclude) share the exact same validation logic. This avoids the
 * "core depends on the public-facing wrapper" inversion that would result
 * from an internal module importing from src/sdk.ts, and avoids a second,
 * drifting copy of the same rules (the duplication risk flagged in the
 * Epic 2.9 hardening ADR).
 */

/** A skill's identity + matching metadata + procedure — the authoring-time
 * shape. Maps 1:1 onto SKILL.md's required frontmatter fields
 * (id/name/description) plus the procedure body; see docs/SKILL_CONTRACT.md. */
export interface SkillManifest {
  /** Stable, unique id. Lowercase, hyphenated (e.g. "performance-review"). */
  id: string
  /** Short human label (e.g. "Performance Review"). */
  name: string
  /** One line. This is the ONLY field the mechanical candidate matcher uses
   * — keep it specific to the domain, not generic marketing copy. */
  description: string
  /** The procedure body: what this skill does when invoked, including its
   * own self-relevance check as the first instruction. Read verbatim by the
   * Skill Runner — never parsed, templated, or special-cased. */
  procedure: string
}

export type SkillManifestValidation =
  | { ok: true }
  | { ok: false; errors: string[] }

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Validate a manifest against the same required-field rules discovery
 * silently enforces (docs/SKILL_CONTRACT.md): non-empty id/name/description,
 * a non-empty procedure, and an id shaped like the lowercase-hyphenated
 * convention every bundled skill already follows. Returns every violation
 * found, not just the first — an author fixing a manifest by hand benefits
 * from seeing the whole list at once.
 */
export function validateSkillManifest(manifest: Partial<SkillManifest>): SkillManifestValidation {
  const errors: string[] = []
  if (!manifest.id || !manifest.id.trim()) {
    errors.push('"id" is required and must be non-empty')
  } else if (!ID_PATTERN.test(manifest.id)) {
    errors.push(`"id" must be lowercase, hyphenated (e.g. "performance-review"), got ${JSON.stringify(manifest.id)}`)
  }
  if (!manifest.name || !manifest.name.trim()) {
    errors.push('"name" is required and must be non-empty')
  }
  if (!manifest.description || !manifest.description.trim()) {
    errors.push('"description" is required and must be non-empty')
  } else if (manifest.description.includes('\n')) {
    errors.push('"description" must be a single line (used verbatim for candidate matching)')
  }
  if (!manifest.procedure || !manifest.procedure.trim()) {
    errors.push('"procedure" is required and must be non-empty')
  }
  return errors.length ? { ok: false, errors } : { ok: true }
}
