/**
 * Configuration: environment + per-invocation flags, with sane defaults.
 *
 * `parseArgs` is a pure function (tested) so the CLI surface is verifiable
 * without spawning a process.
 */
import { DIALS, type Dial } from './types.js'

export interface Config {
  /** The goal to pursue (the one required positional arg). */
  goal: string
  /** The repo Foreman acts on. */
  dir: string
  /** Hard cost ceiling for the run, USD. */
  budgetUsd: number
  /** Involvement dial. */
  dial: Dial
  /** Non-interactive: accept the recommended direction and run. */
  yes: boolean
  /** Produce the proposal only; don't execute. */
  dryRun: boolean
  /** Which engine backs the harness. */
  engine: 'local' | 'ledgermind'
  /** Model for direction proposals + grading. */
  model: string
  /** Model the Agent SDK executes with. */
  executorModel: string
}

export const DEFAULT_MODEL = 'claude-opus-4-8'
export const DEFAULT_BUDGET_USD = 0.6
export const DEFAULT_DIAL: Dial = 'normal'

export class ArgError extends Error {}

function isDial(v: string): v is Dial {
  return (DIALS as readonly string[]).includes(v)
}

/** Reads defaults from the environment. Kept separate so parseArgs stays pure. */
export function envDefaults(env: NodeJS.ProcessEnv = process.env): Partial<Config> {
  const out: Partial<Config> = {}
  if (env.FOREMAN_MODEL) out.model = env.FOREMAN_MODEL
  if (env.FOREMAN_EXECUTOR_MODEL) out.executorModel = env.FOREMAN_EXECUTOR_MODEL
  if (env.FOREMAN_BUDGET_USD) {
    const n = Number(env.FOREMAN_BUDGET_USD)
    if (Number.isFinite(n) && n > 0) out.budgetUsd = n
  }
  if (env.FOREMAN_DIAL && isDial(env.FOREMAN_DIAL)) out.dial = env.FOREMAN_DIAL
  if (env.FOREMAN_ENGINE === 'ledgermind' || env.FOREMAN_ENGINE === 'local') {
    out.engine = env.FOREMAN_ENGINE
  }
  return out
}

/**
 * Parse argv (the part after `foreman`) into a Config. Pure: takes the arg
 * list and the environment-derived defaults, returns a Config or throws
 * ArgError with a human message. `--help` is handled by the caller.
 */
export function parseArgs(argv: string[], defaults: Partial<Config> = {}): Config {
  const cfg: Config = {
    goal: '',
    dir: process.cwd(),
    budgetUsd: defaults.budgetUsd ?? DEFAULT_BUDGET_USD,
    dial: defaults.dial ?? DEFAULT_DIAL,
    yes: false,
    dryRun: false,
    engine: defaults.engine ?? 'local',
    model: defaults.model ?? DEFAULT_MODEL,
    executorModel: defaults.executorModel ?? defaults.model ?? DEFAULT_MODEL,
  }

  const positionals: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case '--dir':
      case '-C': {
        const v = argv[++i]
        if (v === undefined) throw new ArgError(`${arg} needs a path`)
        cfg.dir = v
        break
      }
      case '--budget': {
        const v = argv[++i]
        const n = Number(v)
        if (!Number.isFinite(n) || n <= 0) throw new ArgError(`--budget needs a positive number (got ${v ?? 'nothing'})`)
        cfg.budgetUsd = n
        break
      }
      case '--dial': {
        const v = argv[++i]
        if (v === undefined || !isDial(v)) throw new ArgError(`--dial must be one of: ${DIALS.join(', ')}`)
        cfg.dial = v
        break
      }
      case '--engine': {
        const v = argv[++i]
        if (v !== 'local' && v !== 'ledgermind') throw new ArgError(`--engine must be "local" or "ledgermind"`)
        cfg.engine = v
        break
      }
      case '--model': {
        const v = argv[++i]
        if (v === undefined) throw new ArgError('--model needs a value')
        cfg.model = v
        break
      }
      case '--executor-model': {
        const v = argv[++i]
        if (v === undefined) throw new ArgError('--executor-model needs a value')
        cfg.executorModel = v
        break
      }
      case '--yes':
      case '-y':
        cfg.yes = true
        break
      case '--dry-run':
        cfg.dryRun = true
        break
      default:
        if (arg.startsWith('-')) throw new ArgError(`unknown flag: ${arg}`)
        positionals.push(arg)
    }
  }

  cfg.goal = positionals.join(' ').trim()
  if (!cfg.goal) throw new ArgError('a goal is required, e.g. foreman "add rate limiting to the API"')

  // --executor-model defaults to --model when the latter is overridden but the
  // former isn't; only apply when the caller didn't pass --executor-model.
  if (!argv.includes('--executor-model') && argv.includes('--model')) {
    cfg.executorModel = cfg.model
  }
  return cfg
}

export const HELP = `foreman — an autonomous coder that argues about direction and shuts up about execution.

Usage:
  foreman "<goal>" [options]

Options:
  --dir, -C <path>          Repo Foreman acts on (default: current directory)
  --budget <usd>            Hard cost ceiling for the run (default: ${DEFAULT_BUDGET_USD})
  --dial <light|normal|hands-on>
                            How often it checks direction (default: ${DEFAULT_DIAL})
  --engine <local|ledgermind>
                            Trust engine backing the harness (default: local)
  --model <id>              Model for direction + grading (default: ${DEFAULT_MODEL})
  --executor-model <id>     Model the Agent SDK executes with (default: --model)
  --yes, -y                 Accept the recommended direction and run non-interactively
  --dry-run                 Produce the proposal only; don't execute
  -h, --help                Show this help

Example:
  foreman "add rate limiting to the API" --dir ./my-app --budget 0.60
`
