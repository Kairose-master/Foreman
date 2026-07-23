/**
 * The run loop: propose → approve → execute → grade → prove.
 *
 * This is the harness's spine (docs/ARCHITECTURE.md, "Execution flow"). Direction
 * is the user's (a proposal + the surfaced forks, dial-controlled); execution is
 * autonomous and permission-prompt-free, bounded by the engine's budget and
 * gated by the engine's grade. On a fail it retries within budget, then surfaces
 * the truth rather than dressing up a near-miss as done.
 *
 * The four heavy steps are injectable so the whole flow is unit-testable without
 * a network (see test/foreman.test.ts).
 */
import { randomUUID } from 'node:crypto'
import type { Config } from './config.js'
import type { Approach, DirectionDecision, RunReport } from './types.js'
import type { Engine } from './engine/contract.js'
import { gatherRepoContext, type RepoContext } from './direction/repo-context.js'
import { proposeApproach } from './direction/propose.js'
import { forksToSurface, resolveForkChoices } from './direction/dial.js'
import { collectDecision, renderProposal } from './interaction/prompt-user.js'
import { approachLabel, buildBrief } from './execution/brief.js'
import { executeRun, type ExecuteInput, type ExecutionResult } from './execution/run.js'

/** The injectable steps — real implementations by default. */
export interface Runners {
  gatherContext(dir: string): Promise<RepoContext>
  propose(goal: string, ctx: RepoContext, hints: string[], model: string): Promise<Approach>
  decide(approach: Approach, surfaced: Approach['forks']): Promise<DirectionDecision>
  execute(input: ExecuteInput): Promise<ExecutionResult>
  /** Emit a user-facing line (proposal, status). */
  say(line: string): void
}

const defaultRunners: Runners = {
  gatherContext: gatherRepoContext,
  propose: proposeApproach,
  decide: collectDecision,
  execute: executeRun,
  say: (line) => process.stdout.write(line + '\n'),
}

/** Max execution attempts (initial + retries) while budget remains. */
const MAX_ATTEMPTS = 2

export async function run(
  config: Config,
  engine: Engine,
  overrides: Partial<Runners> = {},
): Promise<RunReport> {
  const r: Runners = { ...defaultRunners, ...overrides }
  const runId = randomUUID()

  const base: Omit<RunReport, 'status'> = {
    goal: config.goal,
    approach: { summary: '', steps: [], forks: [], budgetUsd: config.budgetUsd, spec: '' },
    deliverable: null,
    grade: null,
    proof: null,
    costUsd: 0,
    budgetUsd: config.budgetUsd,
    windedDown: false,
  }

  // 1. Build the approach proposal.
  let approach: Approach
  try {
    const ctx = await r.gatherContext(config.dir)
    const hints = await engine.reputationHints()
    approach = await r.propose(config.goal, ctx, hints, config.model)
  } catch (err) {
    return { ...base, status: 'error', note: `couldn't build a proposal: ${(err as Error).message}` }
  }
  base.approach = approach

  // 2. Direction check-in (dial-controlled). --yes / --dry-run skip the prompt.
  const surfaced = forksToSurface(approach, config.dial)
  let decision: DirectionDecision
  if (config.dryRun) {
    r.say(renderProposal(approach, surfaced))
    return { ...base, status: 'dry-run' }
  }
  if (config.yes) {
    r.say(renderProposal(approach, surfaced))
    decision = { approved: true, forkChoices: {} }
  } else {
    decision = await r.decide(approach, surfaced)
  }
  if (!decision.approved) {
    return { ...base, status: 'cancelled', note: 'you declined the proposed direction' }
  }

  const choices = resolveForkChoices(approach, decision.forkChoices)
  const label = approachLabel(approach)

  // 3. Open the budget ledger and execute (with a bounded retry within budget).
  await engine.openBudget(runId, config.budgetUsd)

  let exec: ExecutionResult | null = null
  let grade = { passed: false, reason: 'not executed' }
  let priorFailure: string | undefined

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const brief = buildBrief({
      goal: config.goal,
      approach,
      choices,
      ...(decision.adjustments ? { adjustments: decision.adjustments } : {}),
      ...(priorFailure ? { priorFailure } : {}),
    })

    exec = await r.execute({
      brief,
      dir: config.dir,
      model: config.executorModel,
      engine,
      runId,
      budgetUsd: config.budgetUsd,
    })

    // 4. Independent grade.
    grade = await engine.grade({ deliverable: exec.deliverable, spec: approach.spec })
    if (grade.passed) break

    // Retry only if it's worth it: budget left and we haven't exhausted attempts.
    const budget = await engine.checkBudget(runId)
    if (budget.stop || attempt >= MAX_ATTEMPTS) break
    priorFailure = grade.reason
    r.say(`↻ Grade failed — retrying within budget (${budget.remaining <= 0 ? 0 : budget.remaining.toFixed(2)} left).`)
  }

  if (!exec) {
    return { ...base, status: 'error', note: 'execution did not run' }
  }

  const filled: Omit<RunReport, 'status'> = {
    ...base,
    deliverable: exec.deliverable,
    grade,
    costUsd: exec.costUsd,
    windedDown: exec.windedDown,
  }

  // 5. On a pass: prove it and record the winning approach.
  if (grade.passed) {
    const proof = await engine.proof({ deliverable: exec.deliverable, grade, runId })
    await engine.recordOutcome({ approach: label, passed: true, costUsd: exec.costUsd })
    return { ...filled, proof, status: 'passed' }
  }

  // On a fail: record it (reputation learns) and surface honestly.
  await engine.recordOutcome({ approach: label, passed: false, costUsd: exec.costUsd })
  return { ...filled, status: 'failed', ...(exec.note ? { note: exec.note } : {}) }
}
