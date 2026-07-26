/**
 * LedgermindEngine — the adapter where the live Ledgermind platform plugs in
 * as the trust engine (docs/ARCHITECTURE.md, "The engine").
 *
 * The seam stays narrow, and each call goes where it honestly belongs:
 *
 *   • budget / reputation — engine-local math; delegate to a composed
 *     LocalEngine rather than duplicate it.
 *
 *   • grade — the quality gate, routed to the platform's POST /api/grade:
 *     the deliverable is judged by Ledgermind's independent grader under the
 *     USER'S OWN account (Bearer token, BYOK billing, grader ≠ solver), and a
 *     pass earns a signed, PUBLICLY verifiable proof at /proof/<id> — a
 *     stronger credential than the local one, because anyone can resolve it.
 *     Fail-closed + honest fallback: an unreachable instance, a bad token, or
 *     a "grading unavailable" (passed: null) response falls back to the same
 *     independent local LLM review, and the reason string always says which
 *     path graded the work.
 *
 *   • proof — when the live grade already minted a platform proof for this
 *     deliverable, return that (it has a public URL); otherwise sign locally
 *     (same schema + EIP-712 domain, so it stays Ledgermind-verifiable).
 *
 * Config: LEDGERMIND_URL (default the public deployment) + LEDGERMIND_TOKEN
 * (mint one: POST /api/oauth/personal-token with your email/password). With no
 * token the engine runs fully local — no guessing, no anonymous calls.
 */
import type { BudgetStatus, RunOutcome, WorkProof } from '../types.js'
import type { Engine, GradeInput, ProofInput } from './contract.js'
import { LocalEngine, type LocalEngineOptions } from './local.js'
import { contentHashOf, WORK_PROOF_SCHEMA } from './attestation.js'

const DEFAULT_URL = 'https://ai-agent-credit-dashboard.vercel.app'

export interface LedgermindEngineOptions extends LocalEngineOptions {
  /** Base URL of the Ledgermind instance. Defaults to the public deployment. */
  ledgermindUrl?: string | undefined
  /** Bearer token (personal token or OAuth). No token → fully local engine. */
  token?: string | undefined
}

interface PlatformProof {
  id: string
  contentHash: string
  attester: string
  url: string
}

export class LedgermindEngine implements Engine {
  readonly name = 'ledgermind'
  private readonly local: LocalEngine
  private readonly baseUrl: string
  private readonly token: string | undefined
  /** Platform proofs minted by grade(), keyed by deliverable content hash so
   *  proof() can hand back the public credential for the same deliverable. */
  private readonly mintedProofs = new Map<string, PlatformProof>()

  constructor(opts: LedgermindEngineOptions) {
    this.local = new LocalEngine(opts)
    this.baseUrl = (opts.ledgermindUrl ?? process.env.LEDGERMIND_URL ?? DEFAULT_URL).replace(/\/+$/, '')
    this.token = opts.token ?? process.env.LEDGERMIND_TOKEN
  }

  // Budget and reputation are engine-local mechanics — delegate.
  openBudget(runId: string, limitUsd: number): Promise<void> {
    return this.local.openBudget(runId, limitUsd)
  }
  recordSpend(runId: string, deltaUsd: number): Promise<void> {
    return this.local.recordSpend(runId, deltaUsd)
  }
  checkBudget(runId: string): Promise<BudgetStatus> {
    return this.local.checkBudget(runId)
  }
  recordOutcome(outcome: RunOutcome): Promise<void> {
    return this.local.recordOutcome(outcome)
  }
  reputationHints(): Promise<string[]> {
    return this.local.reputationHints()
  }

  async grade(input: GradeInput): Promise<{ passed: boolean; reason: string }> {
    if (this.token) {
      try {
        const res = await fetch(`${this.baseUrl}/api/grade`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
          body: JSON.stringify({
            deliverable: renderDeliverable(input),
            spec: input.spec,
            label: 'Foreman run',
          }),
          signal: AbortSignal.timeout(60_000),
        })
        if (res.ok) {
          const body = (await res.json()) as {
            passed: boolean | null
            reason?: string
            proof?: PlatformProof
          }
          // passed: null = the platform couldn't grade (no LLM key, provider
          // error). That is NOT a verdict — fall through to local review.
          if (body.passed === true || body.passed === false) {
            if (body.proof) this.mintedProofs.set(contentHashOf(input.deliverable.diff), body.proof)
            return { passed: body.passed, reason: `[ledgermind] ${body.reason ?? ''}`.trim() }
          }
        }
      } catch {
        /* unreachable instance — fall back to local review below */
      }
    }
    const local = await this.local.grade(input)
    return { passed: local.passed, reason: `[local review] ${local.reason}` }
  }

  async proof(input: ProofInput): Promise<WorkProof> {
    const platform = this.mintedProofs.get(contentHashOf(input.deliverable.diff))
    if (platform) {
      return {
        id: platform.id,
        hash: platform.contentHash,
        signature: null, // the signature lives with the platform record; the URL resolves it
        url: platform.url,
        attester: platform.attester,
        schema: WORK_PROOF_SCHEMA,
      }
    }
    return this.local.proof(input)
  }
}

/** What the platform grader sees: the summary plus the actual diff. */
function renderDeliverable(input: GradeInput): string {
  const parts = [`SUMMARY:\n${input.deliverable.summary}`, '', `DIFF:\n${input.deliverable.diff}`]
  // The platform caps deliverables at 120k chars; trim the diff, never the summary.
  const text = parts.join('\n')
  return text.length > 110_000 ? `${text.slice(0, 110_000)}\n… (diff truncated for grading)` : text
}
