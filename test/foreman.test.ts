import { describe, it, expect } from 'vitest'
import { run, type Runners } from '../src/foreman.js'
import type { Engine, GradeInput, ProofInput } from '../src/engine/contract.js'
import type { Config } from '../src/config.js'
import type { Approach, BudgetStatus, DirectionDecision, RunOutcome, WorkProof } from '../src/types.js'
import type { ExecuteInput, ExecutionResult } from '../src/execution/run.js'

const approach: Approach = {
  summary: 'Patch a limiter in.',
  steps: ['do it'],
  budgetUsd: 0.6,
  spec: 'a limiter is applied',
  forks: [],
}

class FakeEngine implements Engine {
  readonly name = 'fake'
  private spent = 0
  private limit = Infinity
  gradeQueue: Array<{ passed: boolean; reason: string }>
  outcomes: RunOutcome[] = []
  proofCalls = 0
  constructor(grades: Array<{ passed: boolean; reason: string }>) {
    this.gradeQueue = grades
  }
  async openBudget(_id: string, limitUsd: number) {
    this.limit = limitUsd
    this.spent = 0
  }
  async recordSpend(_id: string, d: number) {
    this.spent += d
  }
  async checkBudget(_id: string): Promise<BudgetStatus> {
    const remaining = this.limit - this.spent
    return { remaining, stop: remaining <= 0, spentUsd: this.spent, limitUsd: this.limit }
  }
  async grade(_i: GradeInput) {
    return this.gradeQueue.shift() ?? { passed: false, reason: 'no verdict' }
  }
  async proof(_i: ProofInput): Promise<WorkProof> {
    this.proofCalls++
    return { id: 'proof_x', hash: '0xhash', signature: null, url: null, attester: null, schema: 'ledgermind.work.v1' }
  }
  async recordOutcome(o: RunOutcome) {
    this.outcomes.push(o)
  }
  async reputationHints() {
    return []
  }
}

function cfg(over: Partial<Config> = {}): Config {
  return {
    goal: 'add limiting',
    dir: '/repo',
    budgetUsd: 0.6,
    dial: 'normal',
    yes: true,
    dryRun: false,
    engine: 'local',
    model: 'claude-opus-4-8',
    executorModel: 'claude-opus-4-8',
    ...over,
  }
}

function runners(over: Partial<Runners> = {}): Partial<Runners> {
  let executeCalls = 0
  const base: Runners = {
    gatherContext: async () => ({ dir: '/repo', topLevel: [], markers: [], readmeHead: '', gitStatus: '' }),
    propose: async () => approach,
    decide: async (): Promise<DirectionDecision> => ({ approved: true, forkChoices: {} }),
    execute: async (_i: ExecuteInput): Promise<ExecutionResult> => {
      executeCalls++
      return { deliverable: { diff: 'a diff', summary: 'did it', filesChanged: 3 }, costUsd: 0.2, windedDown: false }
    },
    say: () => {},
  }
  // expose the counter via closure on the returned object
  ;(base as Runners & { executeCalls: () => number }).executeCalls = () => executeCalls
  return { ...base, ...over }
}

describe('foreman.run', () => {
  it('pass path: executes, grades, proves, records a winning outcome', async () => {
    const engine = new FakeEngine([{ passed: true, reason: 'ok' }])
    const report = await run(cfg(), engine, runners())
    expect(report.status).toBe('passed')
    expect(report.proof?.id).toBe('proof_x')
    expect(engine.proofCalls).toBe(1)
    expect(engine.outcomes).toEqual([{ approach: 'Patch a limiter in', passed: true, costUsd: 0.2 }])
  })

  it('fail-then-pass: retries within budget and succeeds', async () => {
    const engine = new FakeEngine([
      { passed: false, reason: 'no tests' },
      { passed: true, reason: 'fixed' },
    ])
    const r = runners()
    const report = await run(cfg(), engine, r)
    expect(report.status).toBe('passed')
    expect((r as Runners & { executeCalls: () => number }).executeCalls()).toBe(2)
  })

  it('honest failure: surfaces the reason, no proof, records a failed outcome', async () => {
    const engine = new FakeEngine([
      { passed: false, reason: 'still broken' },
      { passed: false, reason: 'still broken' },
    ])
    const report = await run(cfg(), engine, runners())
    expect(report.status).toBe('failed')
    expect(report.proof).toBeNull()
    expect(report.grade?.reason).toBe('still broken')
    expect(engine.proofCalls).toBe(0)
    expect(engine.outcomes[0]?.passed).toBe(false)
  })

  it('dry-run: proposes only, never executes', async () => {
    const engine = new FakeEngine([{ passed: true, reason: 'ok' }])
    const r = runners()
    const report = await run(cfg({ dryRun: true }), engine, r)
    expect(report.status).toBe('dry-run')
    expect((r as Runners & { executeCalls: () => number }).executeCalls()).toBe(0)
  })

  it('cancelled: a declined direction stops before execution', async () => {
    const engine = new FakeEngine([{ passed: true, reason: 'ok' }])
    const r = runners({ decide: async () => ({ approved: false, forkChoices: {} }) })
    const report = await run(cfg({ yes: false }), engine, r)
    expect(report.status).toBe('cancelled')
    expect((r as Runners & { executeCalls: () => number }).executeCalls()).toBe(0)
  })

  it('proposal failure surfaces as an error report', async () => {
    const engine = new FakeEngine([])
    const report = await run(cfg(), engine, runners({
      propose: async () => {
        throw new Error('planner down')
      },
    }))
    expect(report.status).toBe('error')
    expect(report.note).toContain('planner down')
  })
})
