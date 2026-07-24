import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

vi.mock('../src/llm.js', () => ({
  complete: vi.fn(),
}))

import { complete } from '../src/llm.js'
import { runSkill } from '../src/direction/skills/run-skill.js'
import type { SkillDescriptor } from '../src/direction/skills/discover.js'
import type { SkillInput } from '../src/direction/skills/contract.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, 'fixtures/skills/run-skill')

const mockComplete = vi.mocked(complete)

const input: SkillInput = {
  goal: 'add rate limiting to the API',
  repoContext: '(fixture repo context)',
  reputationHints: [],
}

function descriptor(id: string): SkillDescriptor {
  return { id, name: id, description: `fixture: ${id}`, path: join(FIXTURES, id) }
}

beforeEach(() => {
  mockComplete.mockReset()
})

describe('runSkill', () => {
  it('returns a relevant finding, normalized, when the model reports relevance', async () => {
    mockComplete.mockResolvedValueOnce(
      JSON.stringify({
        relevant: true,
        summary: 'Rate limiting touches request-handling hot paths.',
        concerns: ['no backpressure signal today'],
        forks: [
          {
            id: 'scope',
            question: 'Per-IP or per-key?',
            options: [
              { id: 'a', label: 'per-IP', tradeoff: 'simple' },
              { id: 'b', label: 'per-key', tradeoff: 'fairer' },
            ],
            recommended: 'b',
          },
        ],
      }),
    )
    const result = await runSkill(descriptor('echoes-relevant'), input, 'claude-haiku-4-5')
    expect(result.kind).toBe('relevant')
    if (result.kind !== 'relevant') throw new Error('unreachable')
    expect(result.finding.skillId).toBe('echoes-relevant')
    expect(result.finding.summary).toContain('hot paths')
    expect(result.finding.concerns).toEqual(['no backpressure signal today'])
    expect(result.finding.proposedForks).toHaveLength(1)
    expect(result.finding.proposedForks[0]!.recommended).toBe('b')
  })

  it('returns not-relevant, distinct from a failure, when the skill declares itself out of scope', async () => {
    mockComplete.mockResolvedValueOnce(
      JSON.stringify({ relevant: false, summary: 'no UX surface in this goal', concerns: [], forks: [] }),
    )
    const result = await runSkill(descriptor('declares-not-relevant'), input, 'claude-haiku-4-5')
    expect(result.kind).toBe('not-relevant')
    if (result.kind !== 'not-relevant') throw new Error('unreachable')
    expect(result.skillId).toBe('declares-not-relevant')
    expect(result.reason).toContain('no UX surface')
  })

  it('returns unparseable — NOT not-relevant — when the model response is not valid JSON', async () => {
    mockComplete.mockResolvedValueOnce('sure, I looked into it and it seems fine I guess')
    const result = await runSkill(descriptor('returns-garbage'), input, 'claude-haiku-4-5')
    expect(result.kind).toBe('unparseable')
    if (result.kind !== 'unparseable') throw new Error('unreachable')
    expect(result.skillId).toBe('returns-garbage')
    expect(result.raw).toContain('seems fine')
  })

  it('returns unparseable when JSON is well-formed but missing the required `relevant` field', async () => {
    mockComplete.mockResolvedValueOnce(JSON.stringify({ summary: 'no relevant field here' }))
    const result = await runSkill(descriptor('returns-garbage'), input, 'claude-haiku-4-5')
    expect(result.kind).toBe('unparseable')
  })

  it('returns invocation-failed — never throws — when the model call rejects', async () => {
    mockComplete.mockRejectedValueOnce(new Error('network unreachable'))
    const result = await runSkill(descriptor('echoes-relevant'), input, 'claude-haiku-4-5')
    expect(result.kind).toBe('invocation-failed')
    if (result.kind !== 'invocation-failed') throw new Error('unreachable')
    expect(result.reason).toContain('network unreachable')
  })

  it('returns invocation-failed when the descriptor path has no readable SKILL.md', async () => {
    const badDescriptor: SkillDescriptor = {
      id: 'missing',
      name: 'missing',
      description: 'no such package on disk',
      path: join(FIXTURES, 'does-not-exist'),
    }
    const result = await runSkill(badDescriptor, input, 'claude-haiku-4-5')
    expect(result.kind).toBe('invocation-failed')
    expect(mockComplete).not.toHaveBeenCalled()
  })

  it('never rejects, for any fixture, even when the model call fails', async () => {
    mockComplete.mockRejectedValueOnce(new Error('boom'))
    await expect(runSkill(descriptor('echoes-relevant'), input, 'claude-haiku-4-5')).resolves.toBeDefined()
  })
})

describe('domain-agnosticism', () => {
  it('run-skill.ts never references a named specialist domain in its own source', () => {
    const src = readFileSync(join(here, '../src/direction/skills/run-skill.ts'), 'utf8')
    const forbidden = ['security', 'research', 'ux', 'performance', 'documentation', 'architecture']
    for (const word of forbidden) {
      expect(src.toLowerCase()).not.toContain(word)
    }
  })
})
