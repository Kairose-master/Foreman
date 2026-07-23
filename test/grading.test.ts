import { describe, it, expect } from 'vitest'
import { parseGraderVerdict, buildGraderPrompt } from '../src/engine/grading.js'

describe('parseGraderVerdict', () => {
  it('parses a clean pass', () => {
    expect(parseGraderVerdict('{"pass": true, "reason": "tests cover the limited path"}')).toEqual({
      pass: true,
      reason: 'tests cover the limited path',
    })
  })

  it('parses a fail', () => {
    expect(parseGraderVerdict('{"pass": false, "reason": "no limiter applied"}')).toEqual({
      pass: false,
      reason: 'no limiter applied',
    })
  })

  it('tolerates ```json fences', () => {
    expect(parseGraderVerdict('```json\n{"pass": true, "reason": "ok"}\n```')?.pass).toBe(true)
  })

  it('returns null on a missing/invalid pass field (never a guess)', () => {
    expect(parseGraderVerdict('{"reason": "hmm"}')).toBeNull()
    expect(parseGraderVerdict('{"pass": "yes"}')).toBeNull()
  })

  it('returns null on non-JSON', () => {
    expect(parseGraderVerdict('the change looks fine to me')).toBeNull()
  })

  it('defaults a missing reason to empty string', () => {
    expect(parseGraderVerdict('{"pass": true}')).toEqual({ pass: true, reason: '' })
  })
})

describe('buildGraderPrompt', () => {
  it('includes the spec and the diff, and notes an empty diff', () => {
    const p = buildGraderPrompt('add a limiter', '', 'did nothing')
    expect(p).toContain('add a limiter')
    expect(p).toContain('no changes were made')
  })
})
