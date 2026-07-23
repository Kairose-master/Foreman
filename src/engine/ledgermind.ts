/**
 * LedgermindEngine — the adapter where the existing Ledgermind product plugs in
 * as the trust engine (docs/ARCHITECTURE.md, "The engine").
 *
 * The seam is deliberately narrow, and the honest shape of this integration is:
 *
 *   • budget / proof / reputation — the same mechanics the LocalEngine uses;
 *     these are engine-local math, so this class delegates to a composed
 *     LocalEngine rather than duplicate them. (Proof already uses Ledgermind's
 *     exact schema + EIP-712 domain, so a local proof is Ledgermind-verifiable.)
 *
 *   • grade — the quality gate. The grading *contract* is identical to
 *     Ledgermind's text-grading path ({"pass","reason"}, grader ≠ solver). A
 *     running Ledgermind instance adds richer graders (pytest on its platform
 *     runtime, vision, whisper) and escrow settlement. To route a deliverable
 *     to a live instance, set FOREMAN_LEDGERMIND_GRADE_URL to an endpoint that
 *     accepts { spec, diff, summary } and returns { pass, reason }. Absent that,
 *     this falls back to the same independent LLM review the LocalEngine runs —
 *     no fabricated endpoint, and the report says which path graded the work.
 */
import type { BudgetStatus, RunOutcome, WorkProof } from '../types.js'
import type { Engine, GradeInput, ProofInput } from './contract.js'
import { LocalEngine, type LocalEngineOptions } from './local.js'
import { parseGraderVerdict } from './grading.js'

export interface LedgermindEngineOptions extends LocalEngineOptions {
  /** Base URL of the running Ledgermind instance (for reference/health). */
  ledgermindUrl?: string
  /** Explicit endpoint that grades a deliverable. Opt-in; no default guess. */
  gradeUrl?: string | undefined
}

export class LedgermindEngine implements Engine {
  readonly name = 'ledgermind'
  private readonly local: LocalEngine
  private readonly gradeUrl: string | undefined

  constructor(opts: LedgermindEngineOptions) {
    this.local = new LocalEngine(opts)
    this.gradeUrl = opts.gradeUrl ?? process.env.FOREMAN_LEDGERMIND_GRADE_URL
  }

  // Budget, proof, reputation are engine-local mechanics — delegate.
  openBudget(runId: string, limitUsd: number): Promise<void> {
    return this.local.openBudget(runId, limitUsd)
  }
  recordSpend(runId: string, deltaUsd: number): Promise<void> {
    return this.local.recordSpend(runId, deltaUsd)
  }
  checkBudget(runId: string): Promise<BudgetStatus> {
    return this.local.checkBudget(runId)
  }
  proof(input: ProofInput): Promise<WorkProof> {
    return this.local.proof(input)
  }
  recordOutcome(outcome: RunOutcome): Promise<void> {
    return this.local.recordOutcome(outcome)
  }
  reputationHints(): Promise<string[]> {
    return this.local.reputationHints()
  }

  async grade(input: GradeInput): Promise<{ passed: boolean; reason: string }> {
    if (this.gradeUrl) {
      try {
        const res = await fetch(this.gradeUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            spec: input.spec,
            diff: input.deliverable.diff,
            summary: input.deliverable.summary,
          }),
          signal: AbortSignal.timeout(60_000),
        })
        if (res.ok) {
          const verdict = parseGraderVerdict(await res.text())
          if (verdict) return { passed: verdict.pass, reason: `[ledgermind] ${verdict.reason}` }
        }
        // Fall through to local review on a non-OK or unparseable response.
      } catch {
        /* unreachable instance — fall back to local review */
      }
    }
    const local = await this.local.grade(input)
    return { passed: local.passed, reason: `[local review] ${local.reason}` }
  }
}
