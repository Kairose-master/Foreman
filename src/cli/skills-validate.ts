/**
 * `foreman skills validate` (Epic 2.12) — validate every discovered skill
 * package (bundled + any configured external ones) against the same
 * manifest rules `foreman/sdk`'s `validateSkillManifest` enforces, plus
 * surface any compose-layer diagnostics (duplicate ids, provider failures)
 * as configuration problems in their own right. Exits non-zero on any
 * invalid definition — never hides a failure to make output cleaner.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { validateSkillPackage } from '../direction/skills/validate-package.js'
import { bundledSkillsDir } from '../direction/skills/bundled.js'
import { buildProvider } from './build-provider.js'
import type { SkillsCliConfig } from './skills-config.js'

export interface ValidatePackageOutcome {
  path: string
  ok: boolean
  errors: string[]
}

export interface ValidateResult {
  packages: ValidatePackageOutcome[]
  /** Compose-layer problems (duplicate ids, a provider directory that
   * couldn't be read) — distinct from a single package's own manifest
   * errors, but still configuration problems this command should surface. */
  composeDiagnostics: string[]
  /** True only when every package passed AND there are no compose-layer
   * diagnostics. Drives the CLI's exit code. */
  allValid: boolean
}

async function packageDirsUnder(root: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter((e) => e.isDirectory()).map((e) => join(root, e.name))
}

export async function runSkillsValidate(config: SkillsCliConfig): Promise<ValidateResult> {
  const roots: string[] = []
  if (config.includeBundled) roots.push(bundledSkillsDir())
  roots.push(...config.externalSkillPaths)

  const allDirs: string[] = []
  for (const root of roots) {
    allDirs.push(...(await packageDirsUnder(root)))
  }

  const packages = await Promise.all(allDirs.map((dir) => validateSkillPackage(dir)))

  // Compose-layer check, reusing the real CompositeSkillProvider so
  // duplicate-id/provider-failure diagnostics come from the exact same
  // logic `skills list`/`plan` use — not re-derived here.
  const provider = buildProvider(config)
  const { diagnostics } = await provider.listDetailed()
  const composeDiagnostics = diagnostics.map((d) => `[${d.kind}] ${d.message}`)

  const allValid = packages.every((p) => p.ok) && composeDiagnostics.length === 0
  return { packages, composeDiagnostics, allValid }
}

export function formatValidateHuman(result: ValidateResult): string {
  const lines: string[] = []
  for (const p of result.packages) {
    lines.push(`${p.ok ? '✓' : '✗'} ${p.path}`)
    for (const err of p.errors) lines.push(`    ${err}`)
  }
  if (result.composeDiagnostics.length > 0) {
    lines.push('')
    lines.push('Compose-layer diagnostics:')
    for (const d of result.composeDiagnostics) lines.push(`  ${d}`)
  }
  lines.push('')
  lines.push(result.allValid ? 'All skill packages valid.' : 'One or more skill packages are invalid.')
  return lines.join('\n')
}
