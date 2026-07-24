/**
 * Build the composed SkillProvider a skills-pipeline subcommand should use,
 * from its parsed SkillsCliConfig (Epic 2.12). One shared helper so `skills
 * list`, `skills validate`, `plan`, and `inspect` all compose bundled +
 * external skills identically — no subcommand reimplements this wiring.
 */
import { LocalDirectoryProvider } from '../direction/skills/discover.js'
import { CompositeSkillProvider, type ProviderEntry } from '../direction/skills/compose.js'
import { bundledSkillsDir } from '../direction/skills/bundled.js'
import type { SkillsCliConfig } from './skills-config.js'

export function buildProvider(config: SkillsCliConfig): CompositeSkillProvider {
  const entries: ProviderEntry[] = []
  if (config.includeBundled) {
    entries.push({ provider: new LocalDirectoryProvider(bundledSkillsDir()), source: 'bundled' })
  }
  for (const p of config.externalSkillPaths) {
    entries.push({ provider: new LocalDirectoryProvider(p), source: `external:${p}` })
  }
  return new CompositeSkillProvider(entries, {
    duplicatePolicy: config.duplicatePolicy,
    strict: config.strict,
  })
}
