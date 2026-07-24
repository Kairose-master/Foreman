import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validateSkillPackage } from '../src/direction/skills/validate-package.js'

const here = dirname(fileURLToPath(import.meta.url))

describe('validateSkillPackage', () => {
  it('passes for a well-formed bundled skill', async () => {
    const result = await validateSkillPackage(join(here, '../skills/security'))
    expect(result).toEqual({ path: join(here, '../skills/security'), ok: true, errors: [] })
  })

  it('fails with a descriptive error for a package with missing frontmatter fields', async () => {
    const result = await validateSkillPackage(join(here, 'fixtures/skills/malformed'))
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('fails with a descriptive error when SKILL.md is missing entirely', async () => {
    const result = await validateSkillPackage(join(here, 'fixtures/skills/no-manifest'))
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('could not read SKILL.md')
  })

  it('fails for a directory that does not exist at all', async () => {
    const result = await validateSkillPackage(join(here, 'fixtures/does-not-exist'))
    expect(result.ok).toBe(false)
  })

  it('never throws, even for a completely bogus path', async () => {
    await expect(validateSkillPackage('/definitely/not/a/real/path')).resolves.toMatchObject({ ok: false })
  })
})
