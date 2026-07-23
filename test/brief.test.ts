import { describe, it, expect } from 'vitest'
import { buildBrief, approachLabel } from '../src/execution/brief.js'
import type { Approach } from '../src/types.js'

const approach: Approach = {
  summary: 'Patch a token-bucket limiter into the pipeline. It is small.',
  steps: ['add middleware', 'add tests'],
  budgetUsd: 0.6,
  spec: 'a limiter is applied and tested',
  forks: [
    {
      id: 'scope',
      question: 'per-IP or per-key?',
      options: [
        { id: 'a', label: 'per-IP', tradeoff: 't' },
        { id: 'b', label: 'per-API-key', tradeoff: 't' },
      ],
      recommended: 'b',
      shapeChanging: true,
    },
  ],
}

describe('approachLabel', () => {
  it('is the first sentence, trimmed', () => {
    expect(approachLabel(approach)).toBe('Patch a token-bucket limiter into the pipeline')
  })
})

describe('buildBrief', () => {
  it('embeds the goal, plan, decided forks, and the acceptance spec', () => {
    const brief = buildBrief({ goal: 'add limiting', approach, choices: { scope: 'a' } })
    expect(brief).toContain('add limiting')
    expect(brief).toContain('1. add middleware')
    expect(brief).toContain('per-IP') // the chosen option label, not the recommended
    expect(brief).toContain('a limiter is applied and tested')
    expect(brief).toContain('do not stop to re-litigate the approach')
  })

  it('includes user adjustments and prior-failure feedback when present', () => {
    const brief = buildBrief({
      goal: 'g',
      approach,
      choices: { scope: 'b' },
      adjustments: 'make limits configurable',
      priorFailure: 'no tests were added',
    })
    expect(brief).toContain('make limits configurable')
    expect(brief).toContain('PREVIOUS ATTEMPT FAILED')
    expect(brief).toContain('no tests were added')
  })
})
