import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

vi.mock('../src/llm.js', () => ({
  complete: vi.fn(),
}))

import { complete } from '../src/llm.js'
import { runPlanner } from '../src/direction/skills/planner.js'
import { LocalDirectoryProvider } from '../src/direction/skills/discover.js'

const here = dirname(fileURLToPath(import.meta.url))
const EXAMPLE_DIR = join(here, '../examples/sdk-authored-skill')
const REPO_DIR = join(here, 'fixtures/planner-repo')

const mockComplete = vi.mocked(complete)

beforeEach(() => {
  mockComplete.mockReset()
})

describe('the SDK-authored example skill', () => {
  it('is discovered by the real LocalDirectoryProvider, unmodified', async () => {
    const provider = new LocalDirectoryProvider(join(here, '../examples'))
    const skills = await provider.list()
    const found = skills.find((s) => s.id === 'performance-review')
    expect(found).toBeDefined()
    expect(found?.name).toBe('Performance Review')
  })

  it('runs through the real, unmodified Planner pipeline end to end', async () => {
    mockComplete.mockResolvedValue(
      JSON.stringify({
        relevant: true,
        summary: 'unbounded Promise.all fan-out over a growing list is a real perf risk',
        concerns: ['no concurrency cap on the dispatch loop'],
        forks: [],
      }),
    )
    // The example's own package lives at examples/sdk-authored-skill; its
    // *parent* directory (examples/) is what a SkillProvider root points at.
    const provider = new LocalDirectoryProvider(join(here, '../examples'))
    const result = await runPlanner(
      'add unbounded concurrent fan-out performance latency for a hot request path',
      REPO_DIR,
      [],
      provider,
      'claude-haiku-4-5',
    )
    const finding = result.results.find(
      (r) => r.kind === 'relevant' && r.finding.skillId === 'performance-review',
    )
    expect(finding).toBeDefined()
  })

  it('manifest.ts imports only the public SDK surface, never planner/runner/discovery internals', () => {
    const src = readFileSync(join(EXAMPLE_DIR, 'manifest.ts'), 'utf8')
    expect(src).toContain("from '../../src/sdk.js'")
    expect(src).not.toContain('direction/skills/planner')
    expect(src).not.toContain('direction/skills/run-skill')
    expect(src).not.toContain('direction/skills/discover')
    expect(src).not.toContain('direction/skills/match')
    expect(src).not.toContain('direction/skills/synthesize')
  })

  it('generate.ts imports only the public SDK surface, never planner/runner/discovery internals', () => {
    const src = readFileSync(join(EXAMPLE_DIR, 'generate.ts'), 'utf8')
    expect(src).toContain("from '../../src/sdk.js'")
    expect(src).not.toContain('direction/skills/planner')
    expect(src).not.toContain('direction/skills/run-skill')
    expect(src).not.toContain('direction/skills/discover')
    expect(src).not.toContain('direction/skills/match')
    expect(src).not.toContain('direction/skills/synthesize')
  })

  it('runs alongside the bundled skills with zero Planner-side special-casing', async () => {
    // A provider whose root has BOTH the bundled skills directory's siblings
    // and the SDK example living under examples/ would require two roots in
    // real use (that's Epic 2.11's job) — here we prove the narrower, still
    // load-bearing claim: the Planner's own source has no branch, no
    // conditional, no allowlist that treats "performance-review" (an
    // SDK-authored, non-bundled skill id) any differently than any bundled
    // skill id. The existing planner.test.ts constraint test already proves
    // the Planner's source never names ANY specialist domain; this test
    // additionally proves a real SDK-authored skill's own id doesn't appear
    // in the Planner's source either — not just the bundled ones.
    const src = readFileSync(join(here, '../src/direction/skills/planner.ts'), 'utf8')
    expect(src.toLowerCase()).not.toContain('performance-review')
    expect(src.toLowerCase()).not.toContain('performance')
  })
})
