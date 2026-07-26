/**
 * The Ledgermind labor-market client for `foreman work` — the supply side of
 * GitHub repo jobs.
 *
 * Foreman is already the thing a repo job needs: a direction-first harness
 * that produces a reviewed unified diff under a hard budget. A repo job is
 * already the thing Foreman needs: a bounded goal with an independent grader
 * (the requester's CI) and a payout. This module is the seam between them.
 *
 * Three HTTP calls, all pre-existing platform endpoints — no new server
 * surface was invented for this:
 *   GET  /api/tasks            public open-job feed (TaskSpec)
 *   POST /api/worker/claim     take one job, receive the full brief
 *   POST /api/runtime/callback submit the deliverable; grading + settlement
 *
 * The pure parts (selection, budget, fencing) are separated from the I/O so
 * they can be tested without a network.
 */

export const DEFAULT_LEDGERMIND_URL = 'https://ai-agent-credit-dashboard.vercel.app'

export interface RepoJob {
  id: string
  title: string
  description: string | null
  acceptanceCriteria: string | null
  rewardUsd: number
  minScore: number | null
  status: string
  repo: { fullName: string; baseBranch: string }
}

type TaskSpecLike = {
  id: string
  kind?: string
  title: string
  description: string | null
  acceptanceCriteria: string | null
  rewardUsd: number
  minScore: number | null
  status: string
  repo?: { fullName: string; baseBranch: string } | null
}

export interface MarketConfig {
  baseUrl: string
  agentId: string
  workerSecret: string
}

export class MarketError extends Error {}

/** Config from the environment, with the public deployment as the default
 *  host. Missing credentials are an actionable message, not a stack trace. */
export function marketConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MarketConfig {
  const baseUrl = (env.LEDGERMIND_URL ?? DEFAULT_LEDGERMIND_URL).replace(/\/+$/, '')
  const agentId = env.LEDGERMIND_AGENT_ID?.trim()
  const workerSecret = env.LEDGERMIND_WORKER_SECRET?.trim()
  if (!agentId || !workerSecret) {
    throw new MarketError(
      'foreman work needs LEDGERMIND_AGENT_ID and LEDGERMIND_WORKER_SECRET.\n' +
        'Both come from your worker agent on Ledgermind (Worker Console → the agent → connection details).\n' +
        'The secret authenticates this machine as that agent; it is never sent to a repository.',
    )
  }
  return { baseUrl, agentId, workerSecret }
}

/** Keep only genuinely claimable repo jobs. A job without `repo` is some
 *  other kind of work and must not be cloned. */
export function selectRepoJobs(tasks: TaskSpecLike[]): RepoJob[] {
  return tasks
    .filter((t) => (t.kind ?? 'paid_job') === 'paid_job' && t.status === 'Open' && t.repo?.fullName)
    .map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      acceptanceCriteria: t.acceptanceCriteria,
      rewardUsd: t.rewardUsd,
      minScore: t.minScore,
      status: t.status,
      repo: { fullName: t.repo!.fullName, baseBranch: t.repo!.baseBranch || 'main' },
    }))
}

/**
 * Which job to take. Highest bounty first — the honest ordering when the
 * budget is the bounty, because it buys the most model headroom per job.
 * An explicit `jobId` overrides the ranking entirely.
 */
export function pickRepoJob(jobs: RepoJob[], opts: { jobId?: string; minBountyUsd?: number } = {}): RepoJob | null {
  if (opts.jobId) return jobs.find((j) => j.id === String(opts.jobId)) ?? null
  const floor = opts.minBountyUsd ?? 0
  const eligible = jobs.filter((j) => j.rewardUsd >= floor)
  if (eligible.length === 0) return null
  return eligible.reduce((best, j) => (j.rewardUsd > best.rewardUsd ? j : best))
}

/**
 * The run budget for a bounty. Never spend more on the model than the job
 * pays — the economics of an agent labor market only stay honest if the
 * worker's cost ceiling is the price it agreed to. `--budget` may lower this
 * but never raise it above the bounty.
 */
export function budgetForBounty(bountyUsd: number, requestedUsd?: number): number {
  const ceiling = Math.max(0, bountyUsd)
  if (requestedUsd === undefined) return ceiling
  return Math.min(Math.max(0, requestedUsd), ceiling)
}

/** The deliverable a repo job expects: a summary plus one fenced diff. */
export function formatDiffSubmission(summary: string, diff: string): string {
  const body = diff.endsWith('\n') ? diff : `${diff}\n`
  return `${summary.trim()}\n\n\`\`\`diff\n${body}\`\`\`\n`
}

// ── I/O ─────────────────────────────────────────────────────────────────

async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new MarketError(`${url} → ${res.status}: ${text.slice(0, 300)}`)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new MarketError(`${url} returned non-JSON: ${text.slice(0, 200)}`)
  }
}

/** Open repo jobs on the public board. No credentials — this feed is public. */
export async function fetchOpenRepoJobs(baseUrl: string, limit = 50): Promise<RepoJob[]> {
  const res = await fetch(`${baseUrl}/api/tasks?status=Open&limit=${limit}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new MarketError(`GET /api/tasks → ${res.status}`)
  const body = (await res.json()) as { tasks?: TaskSpecLike[] } | TaskSpecLike[]
  const tasks = Array.isArray(body) ? body : (body.tasks ?? [])
  return selectRepoJobs(tasks)
}

export interface ClaimedJob {
  taskId: string
  prompt: string
  bounty: number
}

/** Take the job on-chain. From here the agent's credit score is committed:
 *  not submitting, or failing grading, is recorded against it. */
export async function claimJob(config: MarketConfig, jobId: string): Promise<ClaimedJob> {
  const body = await postJson<{ task_id: string; prompt: string; bounty: number; error?: string }>(
    `${config.baseUrl}/api/worker/claim`,
    { agent_id: config.agentId, job_id: Number(jobId) },
    { 'X-Runtime-Secret': config.workerSecret },
  )
  return { taskId: body.task_id, prompt: body.prompt, bounty: body.bounty }
}

export interface SubmitResult {
  status?: string
  grading?: { passed: boolean | null; settled: string; reason: string } | null
}

/** Submit through the same callback every other worker uses, so grading,
 *  credit and settlement cannot drift from the model-worker path. */
export async function submitWork(
  config: MarketConfig,
  taskId: string,
  output: string,
  costUsd: number,
): Promise<SubmitResult> {
  return postJson<SubmitResult>(
    `${config.baseUrl}/api/runtime/callback`,
    {
      task_id: taskId,
      agent_id: config.agentId,
      success: true,
      output,
      quality_score: null,
      execution_time: 0,
      token_cost: costUsd,
      events: [],
    },
    { 'X-Runtime-Secret': config.workerSecret },
  )
}
