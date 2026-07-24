/**
 * `foreman inspect <goal>` (Epic 2.12) — show which skills would be
 * candidates for a goal, and why, WITHOUT any model call. Runs discovery +
 * composition (real) and the mechanical candidate filter (real,
 * `explainCandidates` from match.ts — Epic 2.12 addition, same underlying
 * logic as `filterCandidates`, never a re-implementation) — stops there.
 * Does not invoke any skill's procedure and does not synthesize; that's
 * `plan`'s job.
 */
import { buildProvider } from './build-provider.js'
import { explainCandidates } from '../direction/skills/match.js'
import type { SkillsCliConfig } from './skills-config.js'

export interface InspectEntry {
  id: string
  name: string
  source: string
  matched: boolean
  overlappingTokens: string[]
}

export interface InspectResult {
  goal: string
  entries: InspectEntry[]
}

export async function runInspect(goal: string, config: SkillsCliConfig): Promise<InspectResult> {
  const provider = buildProvider(config)
  const skills = await provider.list()
  const explained = explainCandidates(goal, skills)
  return {
    goal,
    entries: explained.map((e) => ({
      id: e.skill.id,
      name: e.skill.name,
      source: e.skill.source ?? '(unknown)',
      matched: e.matched,
      overlappingTokens: e.overlappingTokens,
    })),
  }
}

export function formatInspectHuman(result: InspectResult): string {
  const lines: string[] = [`Goal: ${result.goal}`, '']
  const matched = result.entries.filter((e) => e.matched)
  const notMatched = result.entries.filter((e) => !e.matched)
  lines.push(`Matched (${matched.length}):`)
  for (const e of matched) {
    const why = e.overlappingTokens.length ? `shared tokens: ${e.overlappingTokens.join(', ')}` : '(goal had no usable tokens — every skill matches)'
    lines.push(`  ✓ ${e.id} (${e.source}) — ${why}`)
  }
  if (notMatched.length > 0) {
    lines.push('')
    lines.push(`Not matched (${notMatched.length}):`)
    for (const e of notMatched) {
      lines.push(`  ✗ ${e.id} (${e.source}) — no overlapping vocabulary with the goal`)
    }
  }
  return lines.join('\n')
}
