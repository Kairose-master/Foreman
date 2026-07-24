/**
 * The Thin Planner — orchestration only, no judgment.
 *
 * Analogous to a process scheduler: it coordinates work, it never decides
 * which conclusion is correct. Every decision belongs to one of three other
 * places — `filterCandidates` (mechanical narrowing), each skill itself
 * (self-reported relevance), or the future Synthesizer (interpreting the
 * collected results) — never to this file.
 *
 * Exactly four steps, in order:
 *   1. Normalize the goal + repo into the one shared SkillInput packet
 *      (reuses the existing gatherRepoContext/renderRepoContext — no new
 *      context-gathering is built here).
 *   2. Ask the SkillProvider for every skill it knows about. Discovery is
 *      the provider's job; the Planner never scans a directory itself and
 *      never knows which provider (local/bundled/git/registry) it's talking to.
 *   3. Narrow candidates via the mechanical filter from match.ts. The
 *      Planner performs no semantic judgment of its own here.
 *   4. Run every narrowed candidate through runSkill, bounded-concurrently,
 *      and return the raw results — uninterpreted. This file never inspects,
 *      ranks, scores, or reacts differently to what a SkillResult contains;
 *      it does not even branch on `result.kind`.
 *
 * Failure isolation is a hard requirement: one skill failing (however it
 * fails) must never stop the others' results from coming back, and must
 * never throw out of `runPlanner`. `runSkill` already guarantees this by
 * its own contract (Epic 2.2) — the wrapper below exists so that guarantee
 * holds by this file's own construction, not merely because a callee
 * currently behaves well.
 *
 * Step 4 uses `mapLimit` (Epic 2.9 hardening ADR) instead of a bare
 * `Promise.all` — a concurrency ceiling, not a cost-ledger. See the ADR
 * (docs/ folder) for why a ceiling was added now and a real budget-ledger
 * integration deliberately was not.
 */
import { gatherRepoContext, renderRepoContext } from '../repo-context.js'
import { filterCandidates } from './match.js'
import { runSkill } from './run-skill.js'
import { mapLimit } from './concurrency.js'
import type { SkillDescriptor, SkillProvider } from './discover.js'
import type { SkillInput, SkillResult } from './contract.js'

/** Default cap on concurrently in-flight skill invocations per planner run.
 * See the Epic 2.9 hardening ADR for rationale (chosen as a conservative
 * ceiling well above today's 3-skill bundled library, not a cost/spend
 * control). */
export const DEFAULT_SKILL_CONCURRENCY = 5

export interface PlannerResult {
  packet: SkillInput
  results: SkillResult[]
}

/** Wrap runSkill so an unexpected throw can never escape runPlanner, even
 * though runSkill's own contract already promises not to throw. Defense at
 * this file's boundary, not a claim that runSkill is untrusted. */
async function safeRunSkill(descriptor: SkillDescriptor, packet: SkillInput, model: string): Promise<SkillResult> {
  try {
    return await runSkill(descriptor, packet, model)
  } catch (err) {
    return {
      kind: 'invocation-failed',
      skillId: descriptor.id,
      reason: `unexpected error: ${(err as Error).message}`,
    }
  }
}

export async function runPlanner(
  goal: string,
  dir: string,
  reputationHints: string[],
  provider: SkillProvider,
  model: string,
  concurrency: number = DEFAULT_SKILL_CONCURRENCY,
): Promise<PlannerResult> {
  // 1. Normalize.
  const ctx = await gatherRepoContext(dir)
  const packet: SkillInput = { goal, repoContext: renderRepoContext(ctx), reputationHints }

  // 2. Discover. The Planner never knows how the provider found these.
  const all = await provider.list()

  // 3. Narrow. Mechanical only — no judgment performed here.
  const candidates = filterCandidates(goal, all)

  // 4. Run every candidate, capped at `concurrency` in flight. No retries;
  // results returned uninterpreted, in input order (never a rank).
  const results = await mapLimit(candidates, concurrency, (c) => safeRunSkill(c, packet, model))

  return { packet, results }
}
