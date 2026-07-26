/**
 * The local workspace for a repo job: where the clone lives and how the diff
 * comes back out.
 *
 * Two properties this file exists to guarantee:
 *
 *  1. **A bounded, predictable location.** Work happens under one root the
 *     operator can see, name, and delete — never the current directory, never
 *     somewhere a job title could steer it. The path is derived from the repo
 *     and job id through a sanitizer, so a hostile job title cannot escape it.
 *  2. **Only public HTTPS clones.** No credentials are configured, offered, or
 *     available to the worker. That isn't a policy we enforce with a check —
 *     it's simply true, because nothing here ever holds a token.
 */
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'

export const DEFAULT_WORKSPACE_ROOT = join(homedir(), '.foreman', 'work')

/** Collapse anything that isn't a safe path atom. Keeps directory names
 *  readable while making traversal and separators impossible. */
export function sanitizeSegment(s: string): string {
  const cleaned = s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  return cleaned.slice(0, 64) || 'job'
}

/**
 * Where a given job's clone goes. Always strictly inside `root` — the return
 * value is verified, not merely constructed, so a future change to the
 * sanitizer can't silently reintroduce an escape.
 */
export function workspacePathFor(root: string, repoFullName: string, jobId: string): string {
  const [owner, name] = repoFullName.split('/')
  const dir = `${sanitizeSegment(owner ?? 'owner')}-${sanitizeSegment(name ?? 'repo')}-job${sanitizeSegment(jobId)}`
  const full = resolve(root, dir)
  const rootResolved = resolve(root)
  if (full !== rootResolved && !full.startsWith(rootResolved + sep)) {
    throw new Error(`Refusing a workspace path outside ${rootResolved}: ${full}`)
  }
  return full
}

/** The clone URL for a repo job. Public HTTPS only — a repo job's worker has
 *  no credentials to offer, by design. */
export function cloneUrlFor(repoFullName: string): string {
  return `https://github.com/${repoFullName}.git`
}

export interface GitResult {
  code: number
  stdout: string
  stderr: string
}

/** Run git with an explicit argv (never a shell string) and a credential
 *  helper that cannot prompt — an unauthenticated clone must fail fast
 *  rather than hang waiting for a username on a private repo. */
export function runGit(args: string[], cwd?: string, timeoutMs = 10 * 60 * 1000): Promise<GitResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: 'echo',
        GCM_INTERACTIVE: 'never',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`git ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
    child.stdout.on('data', (d) => (stdout += String(d)))
    child.stderr.on('data', (d) => (stderr += String(d)))
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`git is not available on this machine (${err.message})`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code: code ?? -1, stdout, stderr })
    })
  })
}

/** Shallow-clone one branch into `dir`. Shallow because the job needs the
 *  current head to patch against, not the project's history. */
export async function cloneRepo(repoFullName: string, branch: string, dir: string): Promise<void> {
  const result = await runGit(['clone', '--depth', '1', '--branch', branch, cloneUrlFor(repoFullName), dir])
  if (result.code !== 0) {
    throw new Error(
      `Could not clone ${repoFullName}@${branch}: ${result.stderr.trim().slice(0, 300)}\n` +
        'Repo jobs cover PUBLIC repositories only — a worker is never given credentials.',
    )
  }
}

/**
 * The full diff of the working tree against the clone's head, INCLUDING new
 * files. `git add -A` stages everything first (intent only — nothing is
 * committed or pushed), because an untracked new file is invisible to a plain
 * `git diff`, and silently dropping a new file from a submission would fail
 * CI for a reason the worker could never see.
 */
export async function workingDiff(dir: string): Promise<string> {
  const add = await runGit(['add', '-A'], dir)
  if (add.code !== 0) throw new Error(`git add failed: ${add.stderr.trim().slice(0, 200)}`)
  const diff = await runGit(['diff', '--cached', '--no-color'], dir)
  if (diff.code !== 0) throw new Error(`git diff failed: ${diff.stderr.trim().slice(0, 200)}`)
  return diff.stdout
}
