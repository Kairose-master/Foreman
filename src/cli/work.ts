/**
 * CLI surface for `foreman work` — flag parsing (pure) and human output.
 */
import { CliArgError } from './skills-config.js'
import type { Dial } from '../types.js'
import type { WorkOptions, WorkResult } from '../work/run.js'

export const WORK_HELP = `foreman work — claim a GitHub repo job from Ledgermind, do it, submit the diff.

  foreman work [flags]

Flags:
  --job <id>              Claim this specific job (default: highest bounty)
  --min-bounty <usd>      Skip jobs paying less than this
  --budget <usd>          Lower the cost ceiling (never above the bounty)
  --workspace <path>      Where clones go (default: ~/.foreman/work)
  --dial <light|normal|hands-on>
  --model <id>            Model for direction + grading
  --executor-model <id>   Model the Agent SDK executes with
  --dry-run               Show what would be claimed; claim nothing
  --clean                 Delete the clone after submitting
  --json                  Machine-readable result

Environment:
  LEDGERMIND_AGENT_ID       your worker agent's id
  LEDGERMIND_WORKER_SECRET  that agent's connection secret
  LEDGERMIND_URL            deployment (default: the public one)

The bounty is the hard cost ceiling: this never spends more on the model than
the job pays. The worker holds no repository credentials — it clones a public
repo, edits locally, and submits a unified diff. The platform opens the pull
request; the repository's own CI grades it, and merging releases the escrow.
`

export interface WorkCliConfig extends WorkOptions {
  json: boolean
}

const DIALS: Dial[] = ['light', 'normal', 'hands-on']

function positiveNumber(flag: string, raw: string | undefined): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new CliArgError(`${flag} needs a positive number (got ${raw ?? 'nothing'})`)
  return n
}

export function parseWorkFlags(argv: string[]): WorkCliConfig {
  const cfg: WorkCliConfig = { json: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case '--job': {
        const v = argv[++i]
        if (!v) throw new CliArgError('--job needs a job id')
        cfg.jobId = v
        break
      }
      case '--min-bounty':
        cfg.minBountyUsd = positiveNumber('--min-bounty', argv[++i])
        break
      case '--budget':
        cfg.budgetUsd = positiveNumber('--budget', argv[++i])
        break
      case '--workspace': {
        const v = argv[++i]
        if (!v) throw new CliArgError('--workspace needs a path')
        cfg.workspaceRoot = v
        break
      }
      case '--dial': {
        const v = argv[++i] as Dial | undefined
        if (!v || !DIALS.includes(v)) throw new CliArgError(`--dial must be one of: ${DIALS.join(', ')}`)
        cfg.dial = v
        break
      }
      case '--model': {
        const v = argv[++i]
        if (!v) throw new CliArgError('--model needs a value')
        cfg.model = v
        break
      }
      case '--executor-model': {
        const v = argv[++i]
        if (!v) throw new CliArgError('--executor-model needs a value')
        cfg.executorModel = v
        break
      }
      case '--dry-run':
        cfg.dryRun = true
        break
      case '--clean':
        cfg.keepWorkspace = false
        break
      case '--json':
        cfg.json = true
        break
      default:
        throw new CliArgError(`unknown flag "${arg}" for work`)
    }
  }
  return cfg
}

/** Exit code for a result: 0 when the loop did its job (including an honest
 *  "nothing to do"), 1 when it genuinely failed. A FAILED grade is still a
 *  successful run of the harness — the market's verdict, not a crash. */
export function workExitCode(result: WorkResult): number {
  return result.status === 'error' ? 1 : 0
}

export function formatWorkHuman(result: WorkResult): string {
  // The live-progress `say` stream already narrated these; repeating the note
  // here printed every "no open repo jobs" twice.
  if (result.status === 'no-jobs' || result.status === 'dry-run' || result.status === 'no-changes') return ''
  const lines: string[] = []
  if (result.job) lines.push(`Job #${result.job.id} — ${result.job.repo.fullName}`)
  lines.push(`Spent $${result.costUsd.toFixed(2)}${result.job ? ` of $${result.job.rewardUsd}` : ''}`)
  if (result.workspace) lines.push(`Clone kept at ${result.workspace}`)
  if (result.note) lines.push(result.note)
  return lines.join('\n')
}
