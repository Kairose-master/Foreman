import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

vi.mock('../src/llm.js', () => ({
  complete: vi.fn(),
}))

import { complete } from '../src/llm.js'
import { runPlanner } from '../src/direction/skills/planner.js'
import { LocalDirectoryProvider } from '../src/direction/skills/discover.js'
import type { SkillProvider, SkillDescriptor } from '../src/direction/skills/discover.js'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_DIR = join(here, 'fixtures/planner-repo')
const SKILLS_DIR = join(here, 'fixtures/skills/planner')

const mockComplete = vi.mocked(complete)

const RELEVANT_RESPONSE = JSON.stringify({
  relevant: true,
  summary: 'applies',
  concerns: [],
  forks: [],
})
const NOT_RELEVANT_RESPONSE = JSON.stringify({
  relevant: false,
  summary: 'does not apply',
  concerns: [],
  forks: [],
})

beforeEach(() => {
  mockComplete.mockReset()
})

describe('runPlanner', () => {
  it('builds the packet from real repo context and the given goal/hints', async () => {
    mockComplete.mockResolvedValue(NOT_RELEVANT_RESPONSE)
    const provider = new LocalDirectoryProvider(SKILLS_DIR)
    const result = await runPlanner('add rate limiting', REPO_DIR, ['past approach X passed'], provider, 'claude-haiku-4-5')
    expect(result.packet.goal).toBe('add rate limiting')
    expect(result.packet.reputationHints).toEqual(['past approach X passed'])
    expect(result.packet.repoContext).toContain('package.json')
  })

  it('calls provider.list() exactly once', async () => {
    mockComplete.mockResolvedValue(NOT_RELEVANT_RESPONSE)
    const list = vi.fn().mockResolvedValue([])
    const fakeProvider: SkillProvider = { list }
    await runPlanner('add rate limiting', REPO_DIR, [], fakeProvider, 'claude-haiku-4-5')
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('narrows via the real mechanical filter — only overlapping skills are invoked', async () => {
    mockComplete.mockResolvedValue(RELEVANT_RESPONSE)
    const provider = new LocalDirectoryProvider(SKILLS_DIR)
    const result = await runPlanner('add rate limiting to the API', REPO_DIR, [], provider, 'claude-haiku-4-5')
    const ids = result.results
      .filter((r) => r.kind === 'relevant' || r.kind === 'not-relevant')
      .map((r) => (r as { skillId?: string; finding?: { skillId: string } }).skillId ?? (r as { finding: { skillId: string } }).finding.skillId)
    expect(ids.sort()).toEqual(['alpha', 'beta'])
    expect(ids).not.toContain('gamma')
    expect(mockComplete).toHaveBeenCalledTimes(2)
  })

  it('returns every narrowed candidate uninterpreted, not filtered by outcome', async () => {
    mockComplete
      .mockResolvedValueOnce(RELEVANT_RESPONSE)
      .mockResolvedValueOnce(NOT_RELEVANT_RESPONSE)
    const provider = new LocalDirectoryProvider(SKILLS_DIR)
    const result = await runPlanner('add rate limiting to the API', REPO_DIR, [], provider, 'claude-haiku-4-5')
    expect(result.results).toHaveLength(2)
    const kinds = result.results.map((r) => r.kind).sort()
    expect(kinds).toEqual(['not-relevant', 'relevant'])
  })

  it('failure isolation: one skill invocation-failing does not drop or block the other', async () => {
    mockComplete
      .mockResolvedValueOnce(RELEVANT_RESPONSE)
      .mockRejectedValueOnce(new Error('network unreachable'))
    const provider = new LocalDirectoryProvider(SKILLS_DIR)
    const result = await runPlanner('add rate limiting to the API', REPO_DIR, [], provider, 'claude-haiku-4-5')
    expect(result.results).toHaveLength(2)
    const kinds = result.results.map((r) => r.kind).sort()
    expect(kinds).toEqual(['invocation-failed', 'relevant'])
  })

  it('never throws even if every candidate fails', async () => {
    mockComplete.mockRejectedValue(new Error('boom'))
    const provider = new LocalDirectoryProvider(SKILLS_DIR)
    await expect(
      runPlanner('add rate limiting to the API', REPO_DIR, [], provider, 'claude-haiku-4-5'),
    ).resolves.toBeDefined()
  })

  it('runs candidates concurrently, not sequentially', async () => {
    const DELAY_MS = 60
    mockComplete.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(RELEVANT_RESPONSE), DELAY_MS)),
    )
    const provider = new LocalDirectoryProvider(SKILLS_DIR)
    const start = Date.now()
    await runPlanner('add rate limiting to the API', REPO_DIR, [], provider, 'claude-haiku-4-5')
    const elapsed = Date.now() - start
    // Two candidates each with a DELAY_MS mock. Sequential would take ~2x;
    // concurrent should stay well under that.
    expect(elapsed).toBeLessThan(DELAY_MS * 1.8)
  })

  it('never retries — each candidate is called exactly once, even on failure', async () => {
    mockComplete.mockRejectedValue(new Error('boom'))
    const provider = new LocalDirectoryProvider(SKILLS_DIR)
    await runPlanner('add rate limiting to the API', REPO_DIR, [], provider, 'claude-haiku-4-5')
    expect(mockComplete).toHaveBeenCalledTimes(2) // alpha + beta, once each
  })
})

describe('planner.ts constraints', () => {
  const src = readFileSync(join(here, '../src/direction/skills/planner.ts'), 'utf8')

  it('never references a named specialist domain in its own source', () => {
    const forbidden = ['security', 'research', 'ux', 'performance', 'documentation', 'architecture']
    for (const word of forbidden) {
      expect(src.toLowerCase()).not.toContain(word)
    }
  })

  it('never reads SKILL.md directly — that stays inside run-skill.ts', () => {
    expect(src).not.toContain('SKILL.md')
    expect(src).not.toContain('readFile')
  })
})
