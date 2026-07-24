import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { LocalDirectoryProvider } from '../src/direction/skills/discover.js'
import type { SkillProvider, SkillDescriptor } from '../src/direction/skills/discover.js'
import { CompositeSkillProvider } from '../src/direction/skills/compose.js'

const here = dirname(fileURLToPath(import.meta.url))
const BUNDLED_DIR = join(here, '../skills') // real bundled skills: research, architecture, security
const VALID_EXTERNAL = join(here, 'fixtures/external-skills/valid')
const MALFORMED_EXTERNAL = join(here, 'fixtures/external-skills/malformed')
const DUPLICATE_EXTERNAL = join(here, 'fixtures/external-skills/duplicate')
const EMPTY_EXTERNAL = join(here, 'fixtures/external-skills/empty')
const BUNDLED_STYLE_FIXTURE = join(here, 'fixtures/skills') // has a 'security' id fixture too

describe('CompositeSkillProvider — mixed bundled + valid external', () => {
  it('discovers both bundled and external skills together', async () => {
    const composite = new CompositeSkillProvider([
      { provider: new LocalDirectoryProvider(BUNDLED_DIR), source: 'bundled' },
      { provider: new LocalDirectoryProvider(VALID_EXTERNAL), source: 'external:valid' },
    ])
    const skills = await composite.list()
    const ids = skills.map((s) => s.id).sort()
    expect(ids).toEqual(['architecture', 'external-widget', 'research', 'security'])
  })

  it('preserves attribution to the originating provider', async () => {
    const composite = new CompositeSkillProvider([
      { provider: new LocalDirectoryProvider(BUNDLED_DIR), source: 'bundled' },
      { provider: new LocalDirectoryProvider(VALID_EXTERNAL), source: 'external:valid' },
    ])
    const skills = await composite.list()
    const bundledOne = skills.find((s) => s.id === 'research')
    const externalOne = skills.find((s) => s.id === 'external-widget')
    expect(bundledOne?.source).toBe('bundled')
    expect(externalOne?.source).toBe('external:valid')
  })
})

describe('CompositeSkillProvider — malformed external skill', () => {
  it('excludes the malformed package but still returns valid ones (non-strict, default)', async () => {
    const composite = new CompositeSkillProvider([
      { provider: new LocalDirectoryProvider(BUNDLED_DIR), source: 'bundled' },
      { provider: new LocalDirectoryProvider(MALFORMED_EXTERNAL), source: 'external:malformed' },
    ])
    const skills = await composite.list()
    expect(skills.find((s) => s.path.includes('broken-skill'))).toBeUndefined()
    expect(skills.map((s) => s.id)).toContain('security') // bundled skills unaffected
  })
})

describe('CompositeSkillProvider — empty external directory', () => {
  it('contributes zero skills without error', async () => {
    const composite = new CompositeSkillProvider([
      { provider: new LocalDirectoryProvider(BUNDLED_DIR), source: 'bundled' },
      { provider: new LocalDirectoryProvider(EMPTY_EXTERNAL), source: 'external:empty' },
    ])
    const skills = await composite.list()
    expect(skills.map((s) => s.id).sort()).toEqual(['architecture', 'research', 'security'])
  })
})

describe('CompositeSkillProvider — duplicate skill id', () => {
  it('defaults to "reject": both definitions are excluded, and a diagnostic explains why', async () => {
    const composite = new CompositeSkillProvider([
      { provider: new LocalDirectoryProvider(BUNDLED_STYLE_FIXTURE), source: 'bundled-fixture' }, // has 'security'
      { provider: new LocalDirectoryProvider(DUPLICATE_EXTERNAL), source: 'external:duplicate' }, // also has 'security'
    ])
    const { skills, diagnostics } = await composite.listDetailed()
    expect(skills.find((s) => s.id === 'security')).toBeUndefined()
    const dup = diagnostics.find((d) => d.kind === 'duplicate-id')
    expect(dup).toBeDefined()
    expect(dup!.message).toContain('security')
    expect(dup!.message).toContain('reject')
  })

  it('"first-wins" keeps the first-listed provider\'s definition', async () => {
    const composite = new CompositeSkillProvider(
      [
        { provider: new LocalDirectoryProvider(BUNDLED_STYLE_FIXTURE), source: 'bundled-fixture' },
        { provider: new LocalDirectoryProvider(DUPLICATE_EXTERNAL), source: 'external:duplicate' },
      ],
      { duplicatePolicy: 'first-wins' },
    )
    const skills = await composite.list()
    const security = skills.find((s) => s.id === 'security')
    expect(security).toBeDefined()
    expect(security!.source).toBe('bundled-fixture')
  })

  it('"last-wins" keeps the last-listed provider\'s definition', async () => {
    const composite = new CompositeSkillProvider(
      [
        { provider: new LocalDirectoryProvider(BUNDLED_STYLE_FIXTURE), source: 'bundled-fixture' },
        { provider: new LocalDirectoryProvider(DUPLICATE_EXTERNAL), source: 'external:duplicate' },
      ],
      { duplicatePolicy: 'last-wins' },
    )
    const skills = await composite.list()
    const security = skills.find((s) => s.id === 'security')
    expect(security).toBeDefined()
    expect(security!.source).toBe('external:duplicate')
  })
})

describe('CompositeSkillProvider — broken provider (list() itself rejects)', () => {
  function brokenProvider(): SkillProvider {
    return {
      list: () => Promise.reject(new Error('permission denied')),
    }
  }

  it('non-strict (default): a broken provider does not prevent other providers\' skills from being discovered', async () => {
    const composite = new CompositeSkillProvider([
      { provider: new LocalDirectoryProvider(BUNDLED_DIR), source: 'bundled' },
      { provider: brokenProvider(), source: 'external:broken' },
    ])
    const { skills, diagnostics } = await composite.listDetailed()
    expect(skills.map((s) => s.id)).toContain('security')
    const failure = diagnostics.find((d) => d.kind === 'provider-failed')
    expect(failure).toBeDefined()
    expect(failure!.message).toContain('permission denied')
  })

  it('strict mode: a broken provider throws instead of silently returning a partial list', async () => {
    const composite = new CompositeSkillProvider(
      [
        { provider: new LocalDirectoryProvider(BUNDLED_DIR), source: 'bundled' },
        { provider: brokenProvider(), source: 'external:broken' },
      ],
      { strict: true },
    )
    await expect(composite.list()).rejects.toThrow(/permission denied/)
  })
})

describe('CompositeSkillProvider satisfies SkillProvider — Planner needs zero changes', () => {
  it('type-checks as a SkillProvider and is accepted directly by runPlanner', async () => {
    vi.resetModules()
    vi.doMock('../src/llm.js', () => ({ complete: vi.fn().mockResolvedValue(
      JSON.stringify({ relevant: false, summary: 'n/a', concerns: [], forks: [] }),
    ) }))
    const { runPlanner } = await import('../src/direction/skills/planner.js')
    const composite: SkillProvider = new CompositeSkillProvider([
      { provider: new LocalDirectoryProvider(BUNDLED_DIR), source: 'bundled' },
      { provider: new LocalDirectoryProvider(VALID_EXTERNAL), source: 'external:valid' },
    ])
    const result = await runPlanner(
      'add rate limiting to the widget API', // matches "widget" + "api"-ish research/security vocab
      join(here, 'fixtures/planner-repo'),
      [],
      composite,
      'claude-haiku-4-5',
    )
    expect(result.results.length).toBeGreaterThan(0)
    vi.doUnmock('../src/llm.js')
  })

  it('planner.ts source has zero provider-composition-specific branching', () => {
    const src = readFileSync(join(here, '../src/direction/skills/planner.ts'), 'utf8')
    expect(src).not.toContain('CompositeSkillProvider')
    expect(src).not.toContain('duplicatePolicy')
    expect(src).not.toContain('listDetailed')
  })
})
