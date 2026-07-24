/**
 * The Skill Runner's result contract (docs/SKILL_CONTRACT.md covers the
 * package format; this covers what invoking one produces).
 *
 * `SkillInput` is the one shared packet every skill receives — identical for
 * every skill, no per-domain customization. Writing per-skill briefs is
 * centralized-planning behavior this design deliberately avoids (see the
 * Planner's scope in later epics: normalize + orchestrate, nothing else).
 *
 * `SkillResult` is a 4-way discriminated union, not a boolean + error field.
 * The distinction is load-bearing: a skill that ran and said "I don't apply"
 * is not the same fact as a skill that couldn't be reached, which is not the
 * same fact as a skill that responded with something unparseable. Collapsing
 * any of these into `relevant: false` would misrepresent a failure as an
 * opinion — never do that (see run-skill.ts).
 */
import type { Fork } from '../../types.js'

/** The shared input every invoked skill receives. Never customized per-skill. */
export interface SkillInput {
  goal: string
  repoContext: string
  reputationHints: string[]
}

/** A skill's own self-reported relevance + contribution, once it ran successfully. */
export interface SkillFinding {
  skillId: string
  summary: string
  concerns: string[]
  /** Reuses the existing Fork shape verbatim — no new fork type invented here. */
  proposedForks: Fork[]
}

/**
 * The outcome of attempting to run one skill. Exactly one of four shapes:
 *   - relevant          — ran, and the skill says it applies (finding attached)
 *   - not-relevant       — ran, and the skill says it does NOT apply (its own call)
 *   - invocation-failed  — could not even complete the call (I/O, network, credentials)
 *   - unparseable        — the call completed, but the response didn't parse/normalize
 *
 * A consumer that only branches on 'relevant' and drops everything else into
 * one bucket is discarding a real distinction on purpose — that's a decision
 * for whatever consumes this (the Synthesizer, a later epic), not something
 * this contract should make silently by collapsing the shape.
 */
export type SkillResult =
  | { kind: 'relevant'; finding: SkillFinding }
  | { kind: 'not-relevant'; skillId: string; reason: string }
  | { kind: 'invocation-failed'; skillId: string; reason: string }
  | { kind: 'unparseable'; skillId: string; reason: string; raw: string }
