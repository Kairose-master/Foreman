/**
 * `foreman skills list` (Epic 2.12) — show every discovered skill: id, name,
 * description, and which provider it came from. No model call; pure
 * discovery + composition.
 */
import { buildProvider } from './build-provider.js'
import type { SkillsCliConfig } from './skills-config.js'

export interface SkillListEntry {
  id: string
  name: string
  description: string
  source: string
}

export interface SkillListDiagnostic {
  kind: string
  message: string
}

export interface SkillListResult {
  skills: SkillListEntry[]
  diagnostics: SkillListDiagnostic[]
}

export async function runSkillsList(config: SkillsCliConfig): Promise<SkillListResult> {
  const provider = buildProvider(config)
  const { skills, diagnostics } = await provider.listDetailed()
  return {
    skills: skills.map((s) => ({ id: s.id, name: s.name, description: s.description, source: s.source ?? '(unknown)' })),
    diagnostics: diagnostics.map((d) => ({ kind: d.kind, message: d.message })),
  }
}

export function formatSkillsListHuman(result: SkillListResult): string {
  const lines: string[] = []
  if (result.skills.length === 0) {
    lines.push('No skills discovered.')
  } else {
    for (const s of result.skills) {
      lines.push(`${s.id}  (${s.source})`)
      lines.push(`  ${s.name}`)
      lines.push(`  ${s.description}`)
      lines.push('')
    }
  }
  if (result.diagnostics.length > 0) {
    lines.push('Diagnostics:')
    for (const d of result.diagnostics) {
      lines.push(`  [${d.kind}] ${d.message}`)
    }
  }
  return lines.join('\n').trimEnd()
}
