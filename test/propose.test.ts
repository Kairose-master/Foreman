import { describe, it, expect } from 'vitest'
import { parseProposal, buildProposalUser } from '../src/direction/propose.js'
import { DEFAULT_BUDGET_USD } from '../src/config.js'
import type { RepoContext } from '../src/direction/repo-context.js'

const full = JSON.stringify({
  summary: 'Patch a token-bucket limiter into the request pipeline.',
  steps: ['add middleware', 'wire config', 'add tests'],
  forks: [
    {
      id: 'scope',
      question: 'Per-IP or per-API-key?',
      options: [
        { id: 'a', label: 'per-IP', tradeoff: 'simple; proxies share an IP' },
        { id: 'b', label: 'per-API-key', tradeoff: 'fairer; authed routes only' },
      ],
      recommended: 'b',
      shapeChanging: true,
    },
  ],
  budgetUsd: 0.6,
  spec: 'a token-bucket limiter is applied; limits configurable; tests cover it',
})

describe('parseProposal', () => {
  it('parses a well-formed proposal', () => {
    const a = parseProposal(full)
    expect(a.summary).toContain('token-bucket')
    expect(a.steps).toHaveLength(3)
    expect(a.forks).toHaveLength(1)
    expect(a.forks[0]!.recommended).toBe('b')
    expect(a.forks[0]!.shapeChanging).toBe(true)
    expect(a.budgetUsd).toBe(0.6)
  })

  it('tolerates ```json fences', () => {
    expect(parseProposal('```json\n' + full + '\n```').forks).toHaveLength(1)
  })

  it('drops forks with fewer than two options', () => {
    const raw = JSON.stringify({
      summary: 's',
      steps: [],
      forks: [{ id: 'x', question: 'q', options: [{ id: 'a', label: 'only', tradeoff: 't' }], recommended: 'a' }],
      spec: 'sp',
    })
    expect(parseProposal(raw).forks).toHaveLength(0)
  })

  it('repairs a bad recommended to the first option, and defaults shapeChanging to true', () => {
    const raw = JSON.stringify({
      summary: 's',
      forks: [
        {
          id: 'x',
          question: 'q',
          options: [
            { id: 'a', label: 'A', tradeoff: 't' },
            { id: 'b', label: 'B', tradeoff: 't' },
          ],
          recommended: 'zzz',
        },
      ],
      spec: 'sp',
    })
    const f = parseProposal(raw).forks[0]!
    expect(f.recommended).toBe('a')
    expect(f.shapeChanging).toBe(true)
  })

  it('falls back to the default budget when missing/invalid', () => {
    const raw = JSON.stringify({ summary: 's', spec: 'x' })
    expect(parseProposal(raw).budgetUsd).toBe(DEFAULT_BUDGET_USD)
  })

  it('falls back spec to summary when spec is absent', () => {
    const raw = JSON.stringify({ summary: 'the summary' })
    expect(parseProposal(raw).spec).toBe('the summary')
  })

  it('throws on non-JSON', () => {
    expect(() => parseProposal('not json at all')).toThrow()
  })
})

describe('buildProposalUser', () => {
  const ctx: RepoContext = {
    dir: '/repo',
    topLevel: ['src/', 'package.json'],
    markers: ['package.json'],
    readmeHead: '# My App',
    gitStatus: '(clean working tree)',
  }
  it('includes the goal and repo context', () => {
    const u = buildProposalUser('add limiting', ctx, [])
    expect(u).toContain('add limiting')
    expect(u).toContain('package.json')
  })
  it('includes reputation hints when present', () => {
    const u = buildProposalUser('g', ctx, ['Approach "patch" passed 3/3 recent runs (100%).'])
    expect(u).toContain('REPUTATION')
    expect(u).toContain('patch')
  })
})
