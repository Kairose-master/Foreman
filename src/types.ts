/**
 * Shared types for the Foreman harness.
 *
 * These describe the direction layer (what the user approves), the execution
 * layer (what the Agent SDK produces), and the narrow harness→engine seam.
 * Keep this file dependency-free so both layers and the tests can import it.
 */

/** How often Foreman stops to align on direction. One knob; see docs/INTERACTION.md. */
export type Dial = 'light' | 'normal' | 'hands-on'

export const DIALS: readonly Dial[] = ['light', 'normal', 'hands-on'] as const

/** One option within a fork — a legitimately different way to go. */
export interface ForkOption {
  /** Short id used to select this option, e.g. "a", "b". */
  id: string
  label: string
  /** The tradeoff this option carries — what you gain and what you give up. */
  tradeoff: string
}

/**
 * A fork: a decision that changes the *shape* of the result (rewrite vs patch,
 * library A vs B, a taste tradeoff). Not "which file to open" — that's just
 * doing, and Foreman never asks about it.
 */
export interface Fork {
  id: string
  question: string
  options: ForkOption[]
  /** id of the option Foreman would pick by default. */
  recommended: string
  /**
   * Does this fork change the shape of the outcome? Normal-mode asks only the
   * shape-changing forks; hands-on asks all; light asks none. Set by the planner.
   */
  shapeChanging: boolean
}

/**
 * The approach proposal — the one in-the-loop artifact. Produced before any
 * execution; the user approves or adjusts it.
 */
export interface Approach {
  /** One tight paragraph: the approach, in plain terms. */
  summary: string
  /** The plan at altitude — a handful of steps, not keystrokes. */
  steps: string[]
  /** The forks Foreman wants a call on (may be empty). */
  forks: Fork[]
  /** Foreman's estimate of what this task should cost, in USD. */
  budgetUsd: number
  /**
   * The acceptance spec the independent grader will judge the deliverable
   * against. Concrete and checkable, not "make it good".
   */
  spec: string
}

/** The user's call on a proposed direction. */
export interface DirectionDecision {
  approved: boolean
  /** Free-text adjustment ("go, but make the limits configurable"). */
  adjustments?: string
  /** forkId -> chosen optionId. Unanswered forks fall back to `recommended`. */
  forkChoices: Record<string, string>
}

/** The engine's answer to "may I keep spending?" */
export interface BudgetStatus {
  remaining: number
  /** True once the run has reached (or passed) the ceiling. Wind down cleanly. */
  stop: boolean
  spentUsd: number
  limitUsd: number
}

/** The independent grade of a deliverable against its spec. */
export interface GradeResult {
  passed: boolean
  reason: string
}

/** What the Agent SDK actually produced on the repo. */
export interface Deliverable {
  /** The unified diff of everything that changed (incl. new files). */
  diff: string
  /** A short natural-language summary of what was done. */
  summary: string
  filesChanged: number
}

/** A signed proof of authorship + grade for a passing deliverable. */
export interface WorkProof {
  id: string
  /** keccak256 content fingerprint of the deliverable. */
  hash: string
  /** EIP-712 signature by the trusted attester, or null if unsigned (hash-only). */
  signature: string | null
  /** Where the proof can be resolved, if the engine anchors it (else null). */
  url: string | null
  /** The attester address, or null when unsigned. */
  attester: string | null
  schema: string
}

/** Fed to the engine's reputation record: which directions tend to pass. */
export interface RunOutcome {
  /** A short label for the approach taken (drives future proposals). */
  approach: string
  passed: boolean
  costUsd: number
}

/** The end-to-end result of one Foreman run, for the report. */
export interface RunReport {
  goal: string
  approach: Approach
  /** null when the run was a dry run or was cancelled before execution. */
  deliverable: Deliverable | null
  grade: GradeResult | null
  proof: WorkProof | null
  costUsd: number
  budgetUsd: number
  /** True if the run hit the budget ceiling and wound down early. */
  windedDown: boolean
  status: 'passed' | 'failed' | 'cancelled' | 'dry-run' | 'error'
  /** Present when status === 'error' or a note worth surfacing. */
  note?: string
}
