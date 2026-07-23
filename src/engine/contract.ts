/**
 * The harness → engine seam.
 *
 * This is the whole surface the harness is allowed to know about. Everything
 * behind it — how grading actually runs, escrow, on-chain, the marketplace —
 * stays invisible (docs/ARCHITECTURE.md, "The contract"). The headline calls
 * are grade / proof / recordOutcome plus a budget ledger the engine owns.
 *
 * The harness owns *no* trust logic. It asks the engine.
 */
import type { BudgetStatus, Deliverable, GradeResult, RunOutcome, WorkProof } from '../types.js'

export interface GradeInput {
  deliverable: Deliverable
  /** The acceptance spec — the contract the deliverable is judged against. */
  spec: string
}

export interface ProofInput {
  deliverable: Deliverable
  grade: GradeResult
  runId: string
}

export interface Engine {
  /** Human-facing name of this engine, for the report. */
  readonly name: string

  // --- Budget: the engine owns the per-run cost ledger and hard ceiling. ---
  /** Open a ledger for a run with its hard USD ceiling. */
  openBudget(runId: string, limitUsd: number): Promise<void>
  /** Report incremental spend as the run progresses. */
  recordSpend(runId: string, deltaUsd: number): Promise<void>
  /** "May I keep spending?" — the guardrail the execution loop polls. */
  checkBudget(runId: string): Promise<BudgetStatus>

  // --- Quality gate: is this output actually good? (grader ≠ solver). ---
  grade(input: GradeInput): Promise<GradeResult>

  // --- Signed proof of authorship + grade for a passing deliverable. ---
  proof(input: ProofInput): Promise<WorkProof>

  // --- Reputation: which approaches actually pass (feeds better proposals). ---
  recordOutcome(outcome: RunOutcome): Promise<void>
  /** Short hints derived from graded history, injected into future proposals. */
  reputationHints(): Promise<string[]>
}
