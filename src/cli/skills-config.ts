/**
 * Shared config for the skills-pipeline subcommands (`skills list`, `skills
 * validate`, `plan`, `inspect` — Epic 2.12). Deliberately separate from
 * `src/config.ts`'s `Config` (the full-run `foreman "<goal>"` command's own
 * config): these subcommands operate on the direction-only skills pipeline
 * and don't need executorModel/engine/dial/budget in the same shape a full
 * execution run does.
 */
import { DEFAULT_MODEL } from '../config.js'
import { bundledSkillsDir } from '../direction/skills/bundled.js'

export type DuplicatePolicyFlag = 'reject' | 'first-wins' | 'last-wins'

export interface SkillsCliConfig {
  /** Repo Foreman would act on (used by `plan` for repo-context gathering). */
  dir: string
  /** Extra local external skill directories, composed alongside bundled. */
  externalSkillPaths: string[]
  /** Whether to include Foreman's own bundled skills/ directory. Default true. */
  includeBundled: boolean
  duplicatePolicy: DuplicatePolicyFlag
  /** Non-strict (default): one broken provider doesn't block the others. */
  strict: boolean
  model: string
  json: boolean
}

export class CliArgError extends Error {}

/** Reads `FOREMAN_SKILLS_PATH` (colon-separated, like $PATH) as a default
 * external-skill-path list, mirroring config.ts's env-default convention. */
export function skillsEnvDefaults(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!env.FOREMAN_SKILLS_PATH) return []
  return env.FOREMAN_SKILLS_PATH.split(':').filter(Boolean)
}

/**
 * Parse the flags shared by all skills-pipeline subcommands. `positionals`
 * collects everything that isn't a recognized flag (e.g. the goal text for
 * `plan`/`inspect`), returned alongside the parsed config.
 */
export function parseSkillsFlags(
  argv: string[],
  envExternalPaths: string[] = skillsEnvDefaults(),
): { config: SkillsCliConfig; positionals: string[] } {
  const config: SkillsCliConfig = {
    dir: process.cwd(),
    externalSkillPaths: [...envExternalPaths],
    includeBundled: true,
    duplicatePolicy: 'reject',
    strict: false,
    model: DEFAULT_MODEL,
    json: false,
  }
  const positionals: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case '--dir':
      case '-C': {
        const v = argv[++i]
        if (v === undefined) throw new CliArgError(`${arg} needs a path`)
        config.dir = v
        break
      }
      case '--skills-path': {
        const v = argv[++i]
        if (v === undefined) throw new CliArgError('--skills-path needs a path')
        config.externalSkillPaths.push(v)
        break
      }
      case '--no-bundled':
        config.includeBundled = false
        break
      case '--duplicate-policy': {
        const v = argv[++i]
        if (v !== 'reject' && v !== 'first-wins' && v !== 'last-wins') {
          throw new CliArgError('--duplicate-policy must be one of: reject, first-wins, last-wins')
        }
        config.duplicatePolicy = v
        break
      }
      case '--strict':
        config.strict = true
        break
      case '--model': {
        const v = argv[++i]
        if (v === undefined) throw new CliArgError('--model needs a value')
        config.model = v
        break
      }
      case '--json':
        config.json = true
        break
      default:
        if (arg.startsWith('-')) throw new CliArgError(`unknown flag: ${arg}`)
        positionals.push(arg)
    }
  }

  return { config, positionals }
}

export { bundledSkillsDir }
