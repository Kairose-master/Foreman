/**
 * LocalEngine — a self-contained implementation of the harness→engine seam, so
 * Foreman runs standalone. It mirrors Ledgermind's real semantics:
 *
 *   • grade   — independent LLM review ({"pass","reason"}), grader ≠ solver,
 *               fail-closed when grading is unavailable (never present
 *               unverified work as done).
 *   • proof   — keccak256 content fingerprint + optional EIP-712 signature,
 *               using the same schema/domain as Ledgermind's attestation.
 *   • budget  — an in-process cost ledger with a hard ceiling.
 *   • reputation — a JSONL record of graded outcomes → hints for proposals.
 *
 * The heavy trust machinery (escrow, on-chain, the marketplace) stays behind
 * the LedgermindEngine; this is the honest local floor.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import type { BudgetStatus, RunOutcome, WorkProof } from '../types.js'
import type { Engine, GradeInput, ProofInput } from './contract.js'
import { complete, hasCredentials } from '../llm.js'
import { GRADER_SYSTEM, buildGraderPrompt, parseGraderVerdict } from './grading.js'
import { WORK_PROOF_SCHEMA, contentHashOf, signWorkProof, type WorkProof as SignableProof } from './attestation.js'
import { summarizeReputation } from './reputation.js'

interface Ledger {
  limit: number
  spent: number
}

export interface LocalEngineOptions {
  model: string
  oracleKey?: string | undefined
  /** Where the reputation JSONL lives. Defaults to ~/.foreman (FOREMAN_HOME). */
  stateDir?: string
}

export class LocalEngine implements Engine {
  readonly name = 'local'
  private readonly model: string
  private readonly oracleKey: string | undefined
  private readonly stateDir: string
  private readonly ledgers = new Map<string, Ledger>()

  constructor(opts: LocalEngineOptions) {
    this.model = opts.model
    this.oracleKey = opts.oracleKey
    this.stateDir = opts.stateDir ?? process.env.FOREMAN_HOME ?? join(homedir(), '.foreman')
  }

  private get reputationFile(): string {
    return join(this.stateDir, 'reputation.jsonl')
  }

  // --- Budget ---------------------------------------------------------------

  async openBudget(runId: string, limitUsd: number): Promise<void> {
    this.ledgers.set(runId, { limit: limitUsd, spent: 0 })
  }

  async recordSpend(runId: string, deltaUsd: number): Promise<void> {
    const l = this.ledgers.get(runId)
    if (l) l.spent += Math.max(0, deltaUsd)
  }

  async checkBudget(runId: string): Promise<BudgetStatus> {
    const l = this.ledgers.get(runId) ?? { limit: Infinity, spent: 0 }
    const remaining = l.limit - l.spent
    return { remaining, stop: remaining <= 0, spentUsd: l.spent, limitUsd: l.limit }
  }

  // --- Quality gate ---------------------------------------------------------

  async grade(input: GradeInput): Promise<{ passed: boolean; reason: string }> {
    if (!hasCredentials()) {
      return { passed: false, reason: 'grading unavailable: no ANTHROPIC_API_KEY — failing closed rather than presenting unverified work as done' }
    }
    try {
      const raw = await complete({
        model: this.model,
        system: GRADER_SYSTEM,
        user: buildGraderPrompt(input.spec, input.deliverable.diff, input.deliverable.summary),
        maxTokens: 512,
      })
      const verdict = parseGraderVerdict(raw)
      if (!verdict) return { passed: false, reason: 'grader returned an unparseable verdict — failing closed' }
      return { passed: verdict.pass, reason: verdict.reason }
    } catch (err) {
      return { passed: false, reason: `grading errored (${(err as Error).message}) — failing closed` }
    }
  }

  // --- Proof ----------------------------------------------------------------

  async proof(input: ProofInput): Promise<WorkProof> {
    const hash = contentHashOf(input.deliverable.diff)
    const proof: SignableProof = {
      schema: WORK_PROOF_SCHEMA,
      jobRef: input.runId,
      kind: 'code',
      contentHash: hash,
      worker: 'foreman-agent-sdk',
      requester: 'foreman-user',
      verdict: input.grade.passed ? 'pass' : 'fail',
      grader: this.name,
      gradedAt: Math.floor(Date.now() / 1000),
    }
    const signed = await signWorkProof(proof, this.oracleKey)
    return {
      id: `proof_${hash.slice(2, 18)}`,
      hash,
      signature: signed?.signature ?? null,
      url: null,
      attester: signed?.attester ?? null,
      schema: WORK_PROOF_SCHEMA,
    }
  }

  // --- Reputation -----------------------------------------------------------

  async recordOutcome(outcome: RunOutcome): Promise<void> {
    try {
      await mkdir(this.stateDir, { recursive: true })
      await appendFile(this.reputationFile, JSON.stringify(outcome) + '\n', 'utf8')
    } catch {
      /* reputation is best-effort — never block a run on it */
    }
  }

  async reputationHints(): Promise<string[]> {
    try {
      const text = await readFile(this.reputationFile, 'utf8')
      const outcomes = text
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as RunOutcome
          } catch {
            return null
          }
        })
        .filter((o): o is RunOutcome => o !== null)
      return summarizeReputation(outcomes)
    } catch {
      return []
    }
  }
}
