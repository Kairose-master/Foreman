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
 *   4. Run every narrowed candidate through runSkill, concurrently, and
 *      return the raw results — uninterpreted. This file never inspects,
 *      ranks, scores, or reacts differently to what a SkillResult contains;
 *      it does not even branch on `result.kind`.
 *
 * Failure isolation is a hard requirement: one skill failing (however it
 * fails) must never stop the others' results from coming back, and must
 * never throw out of `runPlanner`. `runSkill` already guarantees this by
 * its own contract (Epic 2.2) — the wrapper below exists so that guarantee
 * holds by this file's own construction, not merely because a callee
 * currently behaves well.
 */
import { gatherRepoContext, renderRepoContext } from '../repo-context.js'
import { filterCandidates } from './match.js'
import { runSkill } from './run-skill.js'
import type { SkillDescriptor, SkillProvider } from './discover.js'
import type { SkillInput, SkillResult } from './contract.js'

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
): Promise<PlannerResult> {
  // 1. Normalize.
  const ctx = await gatherRepoContext(dir)
  const packet: SkillInput = { goal, repoContext: renderRepoContext(ctx), reputationHints }

  // 2. Discover. The Planner never knows how the provider found these.
  const all = await provider.list()

  // 3. Narrow. Mechanical only — no judgment performed here.
  const candidates = filterCandidates(goal, all)

  // 4. Run every candidate concurrently. No sequencing beyond awaiting
  // completion; no retries; results returned uninterpreted.
  const results = await Promise.all(candidates.map((c) => safeRunSkill(c, packet, model)))

  return { packet, results }
}
