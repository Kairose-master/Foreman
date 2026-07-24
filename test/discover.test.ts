import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { LocalDirectoryProvider } from '../src/direction/skills/discover.js'

const here = dirname(fileURLToPath(import.meta.url))
const SKILLS_ROOT = join(here, 'fixtures/skills')
const EMPTY_ROOT = join(here, 'fixtures/empty-skills')
const MISSING_ROOT = join(here, 'fixtures/does-not-exist')

describe('LocalDirectoryProvider', () => {
  it('discovers a valid package', async () => {
    const provider = new LocalDirectoryProvider(SKILLS_ROOT)
    const skills = await provider.list()
    const security = skills.find((s) => s.id === 'security')
    expect(security).toBeDefined()
    expect(security).toMatchObject({
      id: 'security',
      name: 'Security Review',
      description: 'Auth, input validation, secrets, and trust-boundary concerns.',
    })
    expect(security!.path.endsWith('security')).toBe(true)
  })

  it('silently excludes a package with no SKILL.md', async () => {
    const provider = new LocalDirectoryProvider(SKILLS_ROOT)
    const skills = await provider.list()
    expect(skills.find((s) => s.path.endsWith('no-manifest'))).toBeUndefined()
  })

  it('silently excludes a package with malformed/incomplete frontmatter', async () => {
    const provider = new LocalDirectoryProvider(SKILLS_ROOT)
    const skills = await provider.list()
    expect(skills.find((s) => s.path.endsWith('malformed'))).toBeUndefined()
  })

  it('ignores non-directory entries at the root', async () => {
    const provider = new LocalDirectoryProvider(SKILLS_ROOT)
    const skills = await provider.list()
    // stray-file.txt sits alongside the package directories; must not appear.
    expect(skills.every((s) => !s.path.endsWith('stray-file.txt'))).toBe(true)
  })

  it('returns exactly the valid packages, nothing more', async () => {
    const provider = new LocalDirectoryProvider(SKILLS_ROOT)
    const skills = await provider.list()
    expect(skills.map((s) => s.id).sort()).toEqual(['security'])
  })

  it('returns an empty list for a root with no skill packages', async () => {
    const provider = new LocalDirectoryProvider(EMPTY_ROOT)
    expect(await provider.list()).toEqual([])
  })

  it('returns an empty list (not an error) for a missing root', async () => {
    const provider = new LocalDirectoryProvider(MISSING_ROOT)
    expect(await provider.list()).toEqual([])
  })
})
