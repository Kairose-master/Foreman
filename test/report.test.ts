import { describe, it, expect } from 'vitest'
import { formatReport } from '../src/interaction/report.js'
import type { RunReport } from '../src/types.js'

const base: RunReport = {
  goal: 'add rate limiting',
  approach: { summary: 's', steps: [], forks: [], budgetUsd: 0.6, spec: 'sp' },
  deliverable: { diff: 'x', summary: 'did it', filesChanged: 7 },
  grade: { passed: true, reason: 'tests green + spec met' },
  proof: { id: 'proof_abc', hash: '0xabc', signature: '0xsig', url: null, attester: '0xatt', schema: 'ledgermind.work.v1' },
  costUsd: 0.41,
  budgetUsd: 0.6,
  windedDown: false,
  status: 'passed',
}

describe('formatReport', () => {
  it('reports a pass with files, cost, grade, and proof', () => {
    const out = formatReport(base)
    expect(out).toContain('Passed the independent grade')
    expect(out).toContain('7 files changed')
    expect(out).toContain('$0.41 of $0.60')
    expect(out).toContain('proof_abc')
    expect(out).toContain('signed')
  })

  it('marks a hash-only proof', () => {
    const out = formatReport({ ...base, proof: { ...base.proof!, signature: null } })
    expect(out).toContain('hash-only')
  })

  it('surfaces a failure honestly with the reason and a next step', () => {
    const out = formatReport({
      ...base,
      status: 'failed',
      grade: { passed: false, reason: "couldn't get tests green" },
      proof: null,
    })
    expect(out).toContain("didn't pass the independent grade")
    expect(out).toContain("couldn't get tests green")
    expect(out).toContain('Raise the budget or change the approach')
  })

  it('notes a budget wind-down on failure', () => {
    const out = formatReport({ ...base, status: 'failed', windedDown: true, proof: null })
    expect(out).toContain('budget ceiling')
  })

  it('handles cancelled and dry-run', () => {
    expect(formatReport({ ...base, status: 'cancelled' })).toContain('Cancelled')
    expect(formatReport({ ...base, status: 'dry-run' })).toContain('Dry run')
  })
})
