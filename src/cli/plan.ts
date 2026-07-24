/**
 * `foreman plan <goal>` (Epic 2.12) — the real direction-only pipeline, end
 * to end: discovery + composition -> runPlanner (mechanical filter + real
 * skill invocations) -> synthesizeWithRelationships. No bypassing the
 * Planner, no manual model calls, no reimplemented synthesis logic — this
 * command is a thin caller of the real pipeline modules, nothing else.
 *
 * Never hides a failure to make output cleaner: every disclosed
 * unresolved question (an invocation-failed or unparseable skill) and every
 * relationship (agreement/complementary/tension/contradiction) from the
 * real synthesizer is surfaced, not filtered out for a "cleaner" verdict.
 */
import { runPlanner } from '../direction/skills/planner.js'
import { synthesizeWithRelationships, type SynthesisResultWithRelationships } from '../direction/skills/synthesize.js'
import { buildProvider } from './build-provider.js'
import type { SkillsCliConfig } from './skills-config.js'

export interface PlanResult {
  goal: string
  matchedSkillIds: string[]
  synthesis: SynthesisResultWithRelationships
}

export async function runPlan(goal: string, config: SkillsCliConfig): Promise<PlanResult> {
  const provider = buildProvider(config)
  const { results } = await runPlanner(goal, config.dir, [], provider, config.model)
  const matchedSkillIds = results.map((r) => (r.kind === 'relevant' ? r.finding.skillId : r.skillId))
  const synthesis = await synthesizeWithRelationships(results, config.model)
  return { goal, matchedSkillIds, synthesis }
}

export function formatPlanHuman(result: PlanResult): string {
  const lines: string[] = [`Goal: ${result.goal}`, '']
  lines.push(`Verdict: ${result.synthesis.verdict}`)
  lines.push('')

  if (result.synthesis.decisionGroups.length > 0) {
    lines.push('Decision groups:')
    for (const g of result.synthesis.decisionGroups) {
      lines.push(`  • ${g.label}`)
      for (const m of g.members) {
        lines.push(`      [${m.skillId}] recommends "${m.fork.recommended}" — ${m.fork.question}`)
      }
    }
    lines.push('')
  }

  if (result.synthesis.relationships.length > 0) {
    lines.push('Relationships:')
    for (const r of result.synthesis.relationships) {
      lines.push(`  • [${r.kind}] ${r.skillIds.join(' + ')} on "${r.decisionGroupLabel}"`)
      lines.push(`      ${r.explanation}`)
    }
    lines.push('')
  }

  if (result.synthesis.supportingConcerns.length > 0) {
    lines.push('Concerns:')
    for (const c of result.synthesis.supportingConcerns) {
      lines.push(`  • [${c.skillId}] ${c.concern}${c.relatedGroup ? ` (relates to: ${c.relatedGroup})` : ''}`)
    }
    lines.push('')
  }

  lines.push('Attribution:')
  for (const a of result.synthesis.specialistAttribution) {
    lines.push(`  • [${a.skillId}] ${a.summary}`)
  }

  if (result.synthesis.unresolvedQuestions.length > 0) {
    lines.push('')
    lines.push('Disclosed failures / unresolved:')
    for (const q of result.synthesis.unresolvedQuestions) {
      lines.push(`  ⚠ ${q}`)
    }
  }

  return lines.join('\n')
}
