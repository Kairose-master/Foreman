import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { bundledSkillsDir } from '../src/direction/skills/bundled.js'

describe('bundledSkillsDir', () => {
  it('resolves to the real repo-root skills/ directory', () => {
    const dir = bundledSkillsDir()
    expect(existsSync(join(dir, 'research', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(dir, 'architecture', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(dir, 'security', 'SKILL.md'))).toBe(true)
  })
})
