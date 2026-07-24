import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validateSkillManifest } from '../src/sdk.js'

const here = dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = join(here, '../skills')

function parseFrontmatter(raw: string): Record<string, string> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) throw new Error('no frontmatter found')
  const out: Record<string, string> = {}
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) continue
    let value = kv[2]!.trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[kv[1]!] = value
  }
  return out
}

function procedureBody(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
}

/**
 * Proves bundled skills have no privileged hidden path through the Skill
 * SDK: their real, shipped SKILL.md content is parsed the exact same way an
 * external author's would be (frontmatter -> {id,name,description} +
 * procedure body) and run through the SAME public `validateSkillManifest`
 * every third-party skill is validated against. If the bundled skills
 * needed a special exemption to pass, this test would fail.
 */
describe('bundled skills conform to the public SDK contract, without special-casing', () => {
  const bundledIds = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

  it('found at least the three known bundled skills', () => {
    expect(bundledIds.sort()).toEqual(['architecture', 'research', 'security'])
  })

  for (const id of bundledIds) {
    it(`"${id}" passes validateSkillManifest with zero exemptions`, () => {
      const raw = readFileSync(join(SKILLS_DIR, id, 'SKILL.md'), 'utf8')
      const fm = parseFrontmatter(raw)
      const manifest = {
        id: fm.id,
        name: fm.name,
        description: fm.description,
        procedure: procedureBody(raw),
      }
      const result = validateSkillManifest(manifest)
      expect(result).toEqual({ ok: true })
    })
  }
})
