/**
 * `foreman work` — the pure decisions. Three of these encode promises the
 * whole arrangement rests on: never spend more than the bounty, never treat
 * a non-repo job as one, never let a workspace path escape its root.
 */
import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  budgetForBounty,
  formatDiffSubmission,
  marketConfigFromEnv,
  pickRepoJob,
  selectRepoJobs,
  MarketError,
  type RepoJob,
} from '../src/work/market.js'
import { sanitizeSegment, workspacePathFor, cloneUrlFor } from '../src/work/workspace.js'
import { formatWorkHuman, parseWorkFlags, workExitCode } from '../src/cli/work.js'
import { CliArgError } from '../src/cli/skills-config.js'

const repoJob = (over: Partial<RepoJob> = {}): RepoJob => ({
  id: '1',
  title: 'fix the thing',
  description: null,
  acceptanceCriteria: null,
  rewardUsd: 10,
  minScore: 0,
  status: 'Open',
  repo: { fullName: 'acme/widget', baseBranch: 'main' },
  ...over,
})

describe('selectRepoJobs', () => {
  it('keeps only open paid jobs that carry a repo', () => {
    const tasks = [
      { id: '1', kind: 'paid_job', title: 'a', description: null, acceptanceCriteria: null, rewardUsd: 5, minScore: 0, status: 'Open', repo: { fullName: 'a/b', baseBranch: 'main' } },
      { id: '2', kind: 'paid_job', title: 'plain text job', description: null, acceptanceCriteria: null, rewardUsd: 9, minScore: 0, status: 'Open', repo: null },
      { id: '3', kind: 'paid_job', title: 'already taken', description: null, acceptanceCriteria: null, rewardUsd: 9, minScore: 0, status: 'Accepted', repo: { fullName: 'a/c', baseBranch: 'main' } },
      { id: '4', kind: 'verified_task', title: 'proving ground', description: null, acceptanceCriteria: null, rewardUsd: 9, minScore: null, status: 'Open', repo: null },
    ]
    expect(selectRepoJobs(tasks).map((j) => j.id)).toEqual(['1'])
  })

  it('defaults a missing base branch rather than cloning nothing', () => {
    const [job] = selectRepoJobs([
      { id: '7', kind: 'paid_job', title: 't', description: null, acceptanceCriteria: null, rewardUsd: 1, minScore: 0, status: 'Open', repo: { fullName: 'a/b', baseBranch: '' } },
    ])
    expect(job.repo.baseBranch).toBe('main')
  })
})

describe('pickRepoJob', () => {
  it('takes the highest bounty by default', () => {
    const jobs = [repoJob({ id: '1', rewardUsd: 5 }), repoJob({ id: '2', rewardUsd: 25 }), repoJob({ id: '3', rewardUsd: 12 })]
    expect(pickRepoJob(jobs)?.id).toBe('2')
  })

  it('honours an explicit job id, even a cheap one', () => {
    const jobs = [repoJob({ id: '1', rewardUsd: 5 }), repoJob({ id: '2', rewardUsd: 25 })]
    expect(pickRepoJob(jobs, { jobId: '1' })?.id).toBe('1')
    expect(pickRepoJob(jobs, { jobId: '999' })).toBeNull()
  })

  it('respects a bounty floor and reports nothing rather than something cheap', () => {
    const jobs = [repoJob({ id: '1', rewardUsd: 5 })]
    expect(pickRepoJob(jobs, { minBountyUsd: 10 })).toBeNull()
    expect(pickRepoJob([], {})).toBeNull()
  })
})

describe('budgetForBounty — never spend more than the job pays', () => {
  it('defaults the ceiling to the whole bounty', () => {
    expect(budgetForBounty(15)).toBe(15)
  })

  it('lets --budget lower the ceiling', () => {
    expect(budgetForBounty(15, 3)).toBe(3)
  })

  it('REFUSES to let --budget raise it above the bounty', () => {
    expect(budgetForBounty(15, 500)).toBe(15)
  })

  it('never returns a negative ceiling', () => {
    expect(budgetForBounty(-5)).toBe(0)
    expect(budgetForBounty(10, -2)).toBe(0)
  })
})

describe('formatDiffSubmission', () => {
  it('wraps the diff in the fence the platform extracts', () => {
    const out = formatDiffSubmission('  did the thing  ', '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b')
    expect(out).toContain('did the thing')
    expect(out).toContain('```diff\n--- a/x')
    expect(out.trimEnd().endsWith('```')).toBe(true)
  })

  it('does not double the trailing newline of an already-terminated diff', () => {
    expect(formatDiffSubmission('s', 'x\n')).toBe('s\n\n```diff\nx\n```\n')
  })
})

describe('marketConfigFromEnv', () => {
  it('explains what is missing instead of failing obscurely', () => {
    expect(() => marketConfigFromEnv({} as NodeJS.ProcessEnv)).toThrow(MarketError)
    expect(() => marketConfigFromEnv({ LEDGERMIND_AGENT_ID: 'a' } as NodeJS.ProcessEnv)).toThrow(/WORKER_SECRET/)
  })

  it('defaults the host and trims a trailing slash', () => {
    const cfg = marketConfigFromEnv({
      LEDGERMIND_AGENT_ID: 'ag1',
      LEDGERMIND_WORKER_SECRET: 's',
      LEDGERMIND_URL: 'https://x.dev/',
    } as NodeJS.ProcessEnv)
    expect(cfg.baseUrl).toBe('https://x.dev')
    expect(cfg.agentId).toBe('ag1')
  })
})

describe('workspace paths stay inside their root', () => {
  const root = join(tmpdir(), 'foreman-test-root')

  it('builds a readable directory per repo + job', () => {
    expect(workspacePathFor(root, 'acme/widget', '42')).toBe(join(root, 'acme-widget-job42'))
  })

  it('neutralises traversal in every component', () => {
    const path = workspacePathFor(root, '../../etc/passwd', '../../..')
    expect(path.startsWith(root)).toBe(true)
    expect(path).not.toContain('..')
  })

  it('sanitizes separators and exotic characters out of segments', () => {
    expect(sanitizeSegment('a/b\\c')).toBe('a-b-c')
    expect(sanitizeSegment('...')).toBe('job')
    expect(sanitizeSegment('')).toBe('job')
    expect(sanitizeSegment('x'.repeat(200)).length).toBe(64)
  })

  it('clones over public HTTPS — there is no credential to embed', () => {
    expect(cloneUrlFor('acme/widget')).toBe('https://github.com/acme/widget.git')
  })
})

describe('work flags', () => {
  it('parses the flags it documents', () => {
    const cfg = parseWorkFlags(['--job', '7', '--budget', '2.5', '--min-bounty', '5', '--dial', 'light', '--dry-run', '--json', '--clean'])
    expect(cfg).toMatchObject({ jobId: '7', budgetUsd: 2.5, minBountyUsd: 5, dial: 'light', dryRun: true, json: true, keepWorkspace: false })
  })

  it('rejects bad input with a usage error, not a crash', () => {
    expect(() => parseWorkFlags(['--budget', 'free'])).toThrow(CliArgError)
    expect(() => parseWorkFlags(['--dial', 'turbo'])).toThrow(CliArgError)
    expect(() => parseWorkFlags(['--job'])).toThrow(CliArgError)
    expect(() => parseWorkFlags(['--nope'])).toThrow(CliArgError)
  })
})

describe('formatWorkHuman', () => {
  const base = { job: null, taskId: null, workspace: null, costUsd: 0, filesChanged: 0, verdict: null }
  it('stays silent for outcomes the progress stream already narrated', () => {
    expect(formatWorkHuman({ ...base, status: 'no-jobs', note: 'No open repo jobs on the board.' })).toBe('')
    expect(formatWorkHuman({ ...base, status: 'dry-run', note: 'x' })).toBe('')
  })
  it('summarises a submission', () => {
    const out = formatWorkHuman({
      ...base,
      status: 'submitted',
      job: { id: '4', title: 't', description: null, acceptanceCriteria: null, rewardUsd: 12, minScore: 0, status: 'Open', repo: { fullName: 'a/b', baseBranch: 'main' } },
      costUsd: 1.5,
      workspace: '/tmp/x',
    })
    expect(out).toContain('Job #4 — a/b')
    expect(out).toContain('$1.50 of $12')
  })
})

describe('workExitCode', () => {
  const base = { job: null, taskId: null, workspace: null, costUsd: 0, filesChanged: 0, verdict: null }
  it('treats a market verdict of FAILED as a successful run of the harness', () => {
    expect(workExitCode({ ...base, status: 'submitted', verdict: { passed: false, settled: 'refunded', reason: 'x' } })).toBe(0)
  })
  it('reports only genuine failures non-zero', () => {
    expect(workExitCode({ ...base, status: 'error' })).toBe(1)
    expect(workExitCode({ ...base, status: 'no-jobs' })).toBe(0)
    expect(workExitCode({ ...base, status: 'no-changes' })).toBe(0)
    expect(workExitCode({ ...base, status: 'dry-run' })).toBe(0)
  })
})
