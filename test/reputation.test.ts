import { describe, it, expect } from 'vitest'
import { summarizeReputation, approachKey } from '../src/engine/reputation.js'
import type { RunOutcome } from '../src/types.js'

describe('approachKey', () => {
  it('coarsens to a lowercase 4-word bucket', () => {
    expect(approachKey('Patch the Token-Bucket Limiter into Pipeline')).toBe('patch the tokenbucket limiter')
  })
})

describe('summarizeReputation', () => {
  it('returns nothing for empty history', () => {
    expect(summarizeReputation([])).toEqual([])
  })

  it('reports pass rate per approach bucket', () => {
    const outcomes: RunOutcome[] = [
      { approach: 'patch middleware', passed: true, costUsd: 0.2 },
      { approach: 'patch middleware', passed: true, costUsd: 0.2 },
      { approach: 'patch middleware', passed: false, costUsd: 0.2 },
    ]
    const hints = summarizeReputation(outcomes)
    expect(hints).toHaveLength(1)
    expect(hints[0]).toContain('2/3')
    expect(hints[0]).toContain('67%')
  })

  it('orders newest-touched bucket first and caps output', () => {
    const outcomes: RunOutcome[] = [
      { approach: 'alpha one', passed: true, costUsd: 0.1 },
      { approach: 'beta two', passed: false, costUsd: 0.1 },
      { approach: 'gamma three', passed: true, costUsd: 0.1 },
    ]
    const hints = summarizeReputation(outcomes, 2)
    expect(hints).toHaveLength(2)
    expect(hints[0]).toContain('gamma three')
  })
})
