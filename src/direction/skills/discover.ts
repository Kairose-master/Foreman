/**
 * Skill discovery — the SkillProvider abstraction (docs/SKILL_CONTRACT.md).
 *
 * Orchestration (the Planner and everything downstream, later epics) must
 * never depend on *how* skills are found — only on the fact that a provider
 * can list them. This file defines that narrow contract and ships exactly
 * one implementation, `LocalDirectoryProvider`, backed by the filesystem
 * internally. Future providers (bundled, git, remote registry) satisfy the
 * same `SkillProvider` interface and are added as new files, never as
 * changes to this one.
 *
 * Discovery reads only a package's `SKILL.md` frontmatter. It does not parse
 * or return the procedure body — loading/running a skill is a concern of
 * whatever invokes it (the Skill Runner, a later epic), not of discovery.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

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
  /**
   * Which provider originally produced this descriptor (Epic 2.11, external
   * skill loading) — e.g. "bundled" or "external:<root-path>". Optional and
   * additive: every provider written before Epic 2.11 (including this
   * file's own `LocalDirectoryProvider`) still returns descriptors without
   * it, and every existing consumer keys off `id` alone, unaffected. Set
   * only by providers that participate in composition (`composeProviders`,
   * in provider-compose.ts) so a merged result can still show which
   * provider a given skill came from, without requiring every standalone
   * provider to know about attribution.
   */
  source?: string
}

/**
 * The whole surface the orchestration layer is allowed to know about.
 * Deliberately one method — no get-by-id, no watch, no caching contract.
 * Add those only when something downstream actually needs them.
 */
export interface SkillProvider {
  list(): Promise<SkillDescriptor[]>
}

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/**
 * Read one skill package directory and return its descriptor, or null if
 * SKILL.md is missing or its frontmatter doesn't have the required fields.
 * Never throws — a malformed package is excluded, not fatal to discovery.
 */
async function readPackage(dir: string): Promise<SkillDescriptor | null> {
  let raw: string
  try {
    raw = await readFile(join(dir, 'SKILL.md'), 'utf8')
  } catch {
    return null
  }
  const fm = parseFrontmatter(raw)
  if (!fm) return null
  const { id, name, description } = fm
  if (!id || !name || !description) return null
  return { id, name, description, path: dir }
}

/**
 * The first SkillProvider implementation. Backed by the local filesystem
 * internally, but that detail is not part of the contract — it satisfies
 * `SkillProvider` like any future (bundled/git/remote-registry) provider
 * would. Walks one level of subdirectories under `root`; each one is a
 * candidate skill package.
 */
export class LocalDirectoryProvider implements SkillProvider {
  constructor(private readonly root: string) {}

  async list(): Promise<SkillDescriptor[]> {
    let entries
    try {
      entries = await readdir(this.root, { withFileTypes: true })
    } catch {
      return []
    }
    const dirs = entries.filter((e) => e.isDirectory())
    const results = await Promise.all(dirs.map((e) => readPackage(join(this.root, e.name))))
    return results.filter((d): d is SkillDescriptor => d !== null)
  }
}
