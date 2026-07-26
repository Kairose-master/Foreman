/**
 * `foreman work` — claim one GitHub repo job, do it, submit the diff.
 *
 * The whole loop is composed from pieces that already existed and are already
 * trusted; nothing here re-implements execution, grading, or settlement:
 *
 *   board  → GET /api/tasks (public feed)
 *   claim  → POST /api/worker/claim (the same call the MCP tool makes)
 *   work   → run() — Foreman's normal direction→execute loop, pointed at a
 *            fresh clone, with the BOUNTY as the hard cost ceiling
 *   submit → POST /api/runtime/callback (the same path every worker uses,
 *            so grading, credit and escrow cannot drift)
 *
 * The worker holds no repository credentials at any point. It clones a public
 * repo over HTTPS, edits locally, and hands back text. Turning that text into
 * a pull request is the platform's job, and merging it is the requester's.
 */
import { mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { Config } from '../config.js'
import { DEFAULT_MODEL } from '../config.js'
import { createEngine } from '../engine/index.js'
import { run } from '../foreman.js'
import type { RunReport } from '../types.js'
import {
  budgetForBounty,
  claimJob,
  fetchOpenRepoJobs,
  formatDiffSubmission,
  marketConfigFromEnv,
  pickRepoJob,
  submitWork,
  type MarketConfig,
  type RepoJob,
} from './market.js'
import { DEFAULT_WORKSPACE_ROOT, cloneRepo, workingDiff, workspacePathFor } from './workspace.js'

export interface WorkOptions {
  /** Claim this specific job instead of the highest-paying one. */
  jobId?: string
  /** Ignore jobs paying less than this. */
  minBountyUsd?: number
  /** Lower the cost ceiling below the bounty (never above it). */
  budgetUsd?: number
  /** Where clones go. */
  workspaceRoot?: string
  /** Show what would be claimed and stop — nothing is claimed, cloned or run. */
  dryRun?: boolean
  /** Keep the clone after submitting (default: keep, so a failure is inspectable). */
  keepWorkspace?: boolean
  dial?: Config['dial']
  model?: string
  executorModel?: string
  say?: (line: string) => void
}

export interface WorkResult {
  status: 'submitted' | 'no-jobs' | 'dry-run' | 'no-changes' | 'error'
  job: RepoJob | null
  taskId: string | null
  workspace: string | null
  costUsd: number
  filesChanged: number
  verdict: { passed: boolean | null; settled: string; reason: string } | null
  note?: string
}

export async function runWork(options: WorkOptions = {}): Promise<WorkResult> {
  const say = options.say ?? ((line: string) => process.stdout.write(line + '\n'))
  const empty: WorkResult = {
    status: 'error',
    job: null,
    taskId: null,
    workspace: null,
    costUsd: 0,
    filesChanged: 0,
    verdict: null,
  }

  // Credentials are only needed to claim; a dry run can browse anonymously.
  let market: MarketConfig | null = null
  let baseUrl = (process.env.LEDGERMIND_URL ?? 'https://ai-agent-credit-dashboard.vercel.app').replace(/\/+$/, '')
  if (!options.dryRun) {
    market = marketConfigFromEnv()
    baseUrl = market.baseUrl
  }

  say(`Looking for open repo jobs on ${baseUrl}…`)
  const jobs = await fetchOpenRepoJobs(baseUrl)
  const job = pickRepoJob(jobs, { jobId: options.jobId, minBountyUsd: options.minBountyUsd })
  if (!job) {
    const why = options.jobId
      ? `Job #${options.jobId} is not an open repo job right now.`
      : jobs.length === 0
        ? 'No open repo jobs on the board.'
        : `No open repo job pays at least $${options.minBountyUsd}.`
    say(why)
    return { ...empty, status: 'no-jobs', note: why }
  }

  const budgetUsd = budgetForBounty(job.rewardUsd, options.budgetUsd)
  say(`\nJob #${job.id} — ${job.title}`)
  say(`  repo    ${job.repo.fullName} @ ${job.repo.baseBranch}`)
  say(`  bounty  $${job.rewardUsd}   cost ceiling $${budgetUsd.toFixed(2)}`)

  if (options.dryRun) {
    say('\nDry run — nothing claimed, cloned or spent.')
    return { ...empty, status: 'dry-run', job }
  }

  if (budgetUsd <= 0) {
    const note = `Bounty $${job.rewardUsd} leaves no budget to work with.`
    say(note)
    return { ...empty, status: 'error', job, note }
  }

  // Claiming commits the agent on-chain: from here, not submitting counts
  // against its credit score. Everything after this point either submits or
  // says plainly why it could not.
  say('\nClaiming…')
  const claimed = await claimJob(market!, job.id)
  say(`  task ${claimed.taskId}`)

  const workspaceRoot = options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT
  const dir = workspacePathFor(workspaceRoot, job.repo.fullName, job.id)
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true })
  await mkdir(workspaceRoot, { recursive: true })

  say(`\nCloning ${job.repo.fullName} → ${dir}`)
  await cloneRepo(job.repo.fullName, job.repo.baseBranch, dir)

  const config: Config = {
    goal: claimed.prompt,
    dir,
    budgetUsd,
    dial: options.dial ?? 'light', // a claimed job is already the decision; don't stop to ask
    yes: true,
    dryRun: false,
    engine: 'local',
    model: options.model ?? process.env.FOREMAN_MODEL ?? DEFAULT_MODEL,
    executorModel: options.executorModel ?? options.model ?? process.env.FOREMAN_EXECUTOR_MODEL ?? DEFAULT_MODEL,
  }

  say(`\nWorking (ceiling $${budgetUsd.toFixed(2)})…\n`)
  let report: RunReport
  try {
    report = await run(config, createEngine(config), { say })
  } catch (err) {
    const note = `Execution failed: ${(err as Error).message}`
    say(`\n${note}`)
    return { ...empty, status: 'error', job, taskId: claimed.taskId, workspace: dir, note }
  }

  // Trust the working tree, not the report: `git diff` is what the platform
  // will actually apply, so it is what gets submitted.
  const diff = (await workingDiff(dir)).trim()
  if (!diff) {
    const note =
      'The run finished without changing any files, so there is nothing to submit. ' +
      `The claim on job #${job.id} stands until the platform's inactivity reaper releases it.`
    say(`\n${note}`)
    return {
      ...empty,
      status: 'no-changes',
      job,
      taskId: claimed.taskId,
      workspace: dir,
      costUsd: report.costUsd,
      note,
    }
  }

  const summary = report.deliverable?.summary?.trim() || `Automated fix for job #${job.id}: ${job.title}`
  say(`\nSubmitting a ${diff.split('\n').length}-line diff…`)
  const result = await submitWork(market!, claimed.taskId, formatDiffSubmission(summary, diff), report.costUsd)

  const verdict = result.grading ?? null
  if (verdict) {
    say(`\nVerdict: ${verdict.passed === null ? 'awaiting review' : verdict.passed ? 'passed' : 'failed'} (${verdict.settled})`)
    say(verdict.reason.slice(0, 500))
  } else {
    say('\nSubmitted. The platform opens the pull request; the CI verdict and merge follow there.')
  }

  if (options.keepWorkspace === false) await rm(dir, { recursive: true, force: true })

  return {
    status: 'submitted',
    job,
    taskId: claimed.taskId,
    workspace: options.keepWorkspace === false ? null : dir,
    costUsd: report.costUsd,
    filesChanged: report.deliverable?.filesChanged ?? 0,
    verdict,
  }
}
