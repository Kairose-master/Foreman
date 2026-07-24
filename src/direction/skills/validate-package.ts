/**
 * Validate an on-disk skill package (a directory containing SKILL.md)
 * against the same manifest rules `foreman/sdk`'s `validateSkillManifest`
 * enforces (Epic 2.12, `foreman skills validate`).
 *
 * Discovery (`discover.ts`) silently excludes a malformed package — correct
 * for the harness's own resilience, but useless for a command whose whole
 * job is telling an author exactly what's wrong. This module re-parses a
 * package's SKILL.md the same way discovery does (frontmatter + procedure
 * body) but reports the actual validation errors instead of silently
 * returning null.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateSkillManifest, type SkillManifestValidation } from './manifest.js'

function parseFrontmatter(raw: string): Record<string, string> | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return null
  const body = match[1]!
  const out: Record<string, string> = {}
  for (const line of body.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) continue
    const key = kv[1]!
    let value = kv[2]!.trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function procedureBody(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
}

export interface PackageValidationResult {
  /** The package directory that was validated. */
  path: string
  /** True only if SKILL.md exists, has parseable frontmatter, AND passes
   * validateSkillManifest. */
  ok: boolean
  errors: string[]
}

/**
 * Validate one skill package directory. Never throws — an unreadable or
 * absent SKILL.md is reported as a validation error, not an exception, so a
 * caller validating many packages in a loop never needs its own try/catch.
 */
export async function validateSkillPackage(dir: string): Promise<PackageValidationResult> {
  let raw: string
  try {
    raw = await readFile(join(dir, 'SKILL.md'), 'utf8')
  } catch (err) {
    return { path: dir, ok: false, errors: [`could not read SKILL.md: ${(err as Error).message}`] }
  }
  const fm = parseFrontmatter(raw)
  if (!fm) {
    return { path: dir, ok: false, errors: ['SKILL.md has no valid --- frontmatter block'] }
  }
  const manifest = { id: fm.id, name: fm.name, description: fm.description, procedure: procedureBody(raw) }
  const validation: SkillManifestValidation = validateSkillManifest(manifest)
  if (!validation.ok) {
    return { path: dir, ok: false, errors: validation.errors }
  }
  return { path: dir, ok: true, errors: [] }
}
