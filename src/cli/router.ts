/**
 * Subcommand router for the skills-pipeline commands (`skills list`,
 * `skills validate`, `plan`, `inspect` — Epic 2.12). `src/cli.ts` dispatches
 * here for these subcommand names and falls through to the existing
 * full-run behavior for everything else, preserving `foreman "<goal>"`'s
 * current behavior completely unchanged.
 *
 * Exit codes (meaningful, per the Epic 2.12 acceptance criteria):
 *   0  — command succeeded, and (for `skills validate`) every package valid
 *   1  — command ran, but reported a genuine failure (invalid skill(s),
 *        plan produced zero usable results due to disclosed failures — NOT
 *        used for a plain "no skills matched", which is a valid outcome)
 *   2  — usage error (bad flags, missing goal, unknown subcommand)
 */
import { CliArgError, parseSkillsFlags, type SkillsCliConfig } from './skills-config.js'
import { runSkillsList, formatSkillsListHuman } from './skills-list.js'
import { runSkillsValidate, formatValidateHuman } from './skills-validate.js'
import { runInspect, formatInspectHuman } from './inspect.js'
import { runPlan, formatPlanHuman } from './plan.js'
import { hasCredentials } from '../llm.js'

export const SUBCOMMANDS = ['skills', 'plan', 'inspect'] as const

export const SUBCOMMAND_HELP = `Skills-pipeline subcommands:
  foreman skills list [flags]
  foreman skills validate [flags]
  foreman plan "<goal>" [flags]
  foreman inspect "<goal>" [flags]

Shared flags:
  --dir, -C <path>            Repo used for plan's repo-context (default: cwd)
  --skills-path <path>        Add a local external skill directory (repeatable)
  --no-bundled                 Exclude Foreman's own bundled skills
  --duplicate-policy <reject|first-wins|last-wins>
                                Duplicate skill id policy (default: reject)
  --strict                     Fail loudly if any provider path can't be read
  --model <id>                 Model for plan's skill invocations + synthesis
  --json                       Machine-readable JSON output

Examples:
  foreman skills list
  foreman skills list --skills-path ./my-skills --json
  foreman skills validate --strict
  foreman inspect "add rate limiting to the API"
  foreman plan "add rate limiting to the API" --json
`

function write(line: string): void {
  process.stdout.write(line + '\n')
}
function writeErr(line: string): void {
  process.stderr.write(line + '\n')
}

/** Returns the process exit code. */
export async function dispatchSubcommand(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv

  if (sub === 'skills') {
    const [action, ...flagArgv] = rest
    let config: SkillsCliConfig
    try {
      ;({ config } = parseSkillsFlags(flagArgv))
    } catch (err) {
      if (err instanceof CliArgError) {
        writeErr(`foreman: ${err.message}`)
        return 2
      }
      throw err
    }

    if (action === 'list') {
      const result = await runSkillsList(config)
      write(config.json ? JSON.stringify(result, null, 2) : formatSkillsListHuman(result))
      return 0
    }
    if (action === 'validate') {
      const result = await runSkillsValidate(config)
      write(config.json ? JSON.stringify(result, null, 2) : formatValidateHuman(result))
      return result.allValid ? 0 : 1
    }
    writeErr(`foreman: unknown subcommand "skills ${action ?? ''}" — expected "list" or "validate"`)
    return 2
  }

  if (sub === 'inspect' || sub === 'plan') {
    let config: SkillsCliConfig
    let positionals: string[]
    try {
      ;({ config, positionals } = parseSkillsFlags(rest))
    } catch (err) {
      if (err instanceof CliArgError) {
        writeErr(`foreman: ${err.message}`)
        return 2
      }
      throw err
    }
    const goal = positionals.join(' ').trim()
    if (!goal) {
      writeErr(`foreman: ${sub} needs a goal, e.g. foreman ${sub} "add rate limiting to the API"`)
      return 2
    }

    if (sub === 'inspect') {
      const result = await runInspect(goal, config)
      write(config.json ? JSON.stringify(result, null, 2) : formatInspectHuman(result))
      return 0
    }

    // plan: real skill invocations require model credentials.
    if (!hasCredentials()) {
      writeErr('foreman: plan needs Claude credentials — set ANTHROPIC_API_KEY (or run `ant auth login`).')
      return 2
    }
    try {
      const result = await runPlan(goal, config)
      write(config.json ? JSON.stringify(result, null, 2) : formatPlanHuman(result))
      // A failure here means every candidate disclosed a failure and none
      // were relevant — a genuine "couldn't produce a usable plan" outcome,
      // not merely "no skills matched" (which is zero matches, zero
      // results, zero disclosed failures — a valid empty plan, exit 0).
      const allDisclosedFailures =
        result.matchedSkillIds.length === 0 && result.synthesis.unresolvedQuestions.length > 0
      return allDisclosedFailures ? 1 : 0
    } catch (err) {
      writeErr(`foreman: plan failed: ${(err as Error).message}`)
      return 1
    }
  }

  writeErr(`foreman: unknown subcommand "${sub}"`)
  return 2
}
