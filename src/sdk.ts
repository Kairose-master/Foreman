/**
 * The public Foreman Skill SDK (Epic 2.10).
 *
 * This is the ONLY module a skill author needs to import to author, define,
 * and offline-validate a Foreman skill. It re-exports the minimal set of
 * types every skill package cares about, plus one authoring helper
 * (`defineSkill`) and one validation entry point
 * (`validateSkillResponse`) — nothing else.
 *
 * What this deliberately does NOT export: `runSkill`, `runPlanner`,
 * `filterCandidates`, `synthesize`, `LocalDirectoryProvider`'s internals, or
 * any orchestration/runner-internal type. Authoring a skill package (a
 * directory with SKILL.md + optional siblings, per docs/SKILL_CONTRACT.md)
 * never requires importing the planner or runner modules directly — those
 * are the harness's job, not the author's.
 *
 * A skill package still IS just a directory with a SKILL.md file (frontmatter
 * + procedure body) — this SDK does not change that packaging contract, and
 * does not introduce a second way to define a skill that bypasses it. What
 * it adds is:
 *   1. Public types (`SkillManifest`, `SkillInput`, `SkillFinding`,
 *      `SkillResult`, `Fork`, `ForkOption`) so an author's own tooling (a
 *      test file, a linter, an editor) can type-check against the real
 *      contract instead of guessing at shapes from prose docs.
 *   2. `defineSkill(manifest)` — a thin authoring helper that validates a
 *      manifest object (id/name/description + procedure) at definition time
 *      and returns a `SKILL.md`-shaped string ready to write to disk. This
 *      exists only because hand-writing frontmatter is a common, easy way to
 *      typo a required field or forget a dash — `defineSkill` catches that
 *      at author-time instead of at silent-discovery-time (a malformed
 *      SKILL.md is otherwise excluded from discovery with NO error surfaced
 *      anywhere, per docs/SKILL_CONTRACT.md — a real, sharp footgun for a new
 *      author). It is optional: an author can still hand-write SKILL.md
 *      directly and never touch this function.
 *   3. `validateSkillResponse(raw)` — lets an author test what their skill's
 *      procedure produces (e.g. a canned or golden model response) against
 *      the exact same shape check the real Skill Runner applies, offline,
 *      with no model call and no orchestration dependency.
 */
import type { Fork, ForkOption } from './types.js'
import type { SkillFinding, SkillInput, SkillResult } from './direction/skills/contract.js'
import { validateSkillResponseShape, type ParsedSkillResponse } from './direction/skills/response-shape.js'
import {
  validateSkillManifest,
  type SkillManifest,
  type SkillManifestValidation,
} from './direction/skills/manifest.js'

export type { Fork, ForkOption, SkillFinding, SkillInput, SkillResult, ParsedSkillResponse }
export { validateSkillManifest, type SkillManifest, type SkillManifestValidation }

function yamlEscape(value: string): string {
  // Only quote when the value contains a character that would otherwise
  // break simple YAML scalar parsing; keep plain values unquoted (matches
  // every bundled SKILL.md's existing style).
  if (/[:#'"\n]/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`
  }
  return value
}

/**
 * Define a skill: validate its manifest, then render the exact SKILL.md
 * content (frontmatter + procedure body) discovery expects. Throws with a
 * combined message listing every validation error — this is an authoring-
 * time helper, meant to fail loudly and immediately, not to be caught and
 * silently swallowed like discovery's own malformed-package handling.
 *
 * Does not write to disk. The caller decides where a SKILL.md belongs
 * (typically `<skills-dir>/<id>/SKILL.md`) — this SDK has no opinion about
 * filesystem layout beyond what docs/SKILL_CONTRACT.md already specifies.
 */
export function defineSkill(manifest: SkillManifest): string {
  const validation = validateSkillManifest(manifest)
  if (!validation.ok) {
    throw new Error(`invalid skill manifest for ${JSON.stringify(manifest.id ?? '(no id)')}:\n- ${validation.errors.join('\n- ')}`)
  }
  const frontmatter = [
    '---',
    `id: ${yamlEscape(manifest.id)}`,
    `name: ${yamlEscape(manifest.name)}`,
    `description: ${yamlEscape(manifest.description)}`,
    '---',
    '',
    '',
  ].join('\n')
  return frontmatter + manifest.procedure.trim() + '\n'
}

export type SkillResponseValidation =
  | { ok: true; value: ParsedSkillResponse }
  | { ok: false; error: string }

/**
 * Validate a candidate model response against the exact shape the real
 * Skill Runner requires: `{ relevant: boolean, summary?, concerns?, forks? }`
 * (optionally fenced in ```json). This is the SAME check `run-skill.ts`
 * applies internally (shared via `response-shape.ts`, not a second,
 * drifting copy) — so a skill author can test their own procedure's output
 * (a golden fixture, a canned response, or a real model call they made
 * themselves) offline, with zero orchestration or network dependency, and
 * trust that a pass here means the real pipeline will accept it too.
 */
export function validateSkillResponse(raw: string): SkillResponseValidation {
  return validateSkillResponseShape(raw)
}
