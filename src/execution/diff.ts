/**
 * Collect what the Agent SDK actually changed on the repo, as a unified diff.
 *
 * Non-mutating: reads tracked changes with `git diff HEAD` and appends
 * synthesized diffs for untracked new files, without touching the index (the
 * repo is the user's — we don't stage or reset on their behalf).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const exec = promisify(execFile)

/** Cap on synthesized untracked-file content, to keep the grader prompt sane. */
const MAX_UNTRACKED_BYTES = 20_000

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', dir, ...args], { maxBuffer: 32 * 1024 * 1024 })
  return stdout
}

async function isGitWorkTree(dir: string): Promise<boolean> {
  try {
    const out = await git(dir, ['rev-parse', '--is-inside-work-tree'])
    return out.trim() === 'true'
  } catch {
    return false
  }
}

/** git's own heuristic: a NUL byte in the first chunk means "binary". */
function looksBinary(content: string): boolean {
  const head = content.slice(0, 8000)
  for (let i = 0; i < head.length; i++) {
    if (head.charCodeAt(i) === 0) return true
  }
  return false
}

/** Render an untracked new file as a minimal, valid-looking unified-diff block. */
function synthesizeNewFileDiff(path: string, content: string): string {
  if (looksBinary(content)) {
    return `diff --git a/${path} b/${path}\nnew file mode 100644\nBinary file ${path} added\n`
  }
  const truncated = content.length > MAX_UNTRACKED_BYTES
  const body = truncated ? content.slice(0, MAX_UNTRACKED_BYTES) : content
  const lines = body.split('\n')
  const header = `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@`
  const added = lines.map((l) => `+${l}`).join('\n')
  const tail = truncated ? '\n… (truncated)' : ''
  return `${header}\n${added}${tail}\n`
}

export interface DiffResult {
  diff: string
  filesChanged: number
}

/**
 * Return the full diff of the repo's current state vs HEAD, including untracked
 * new files. On a non-git directory returns an honest note and zero files.
 */
export async function collectDiff(dir: string): Promise<DiffResult> {
  if (!(await isGitWorkTree(dir))) {
    return { diff: '(not a git repository — diff unavailable)', filesChanged: 0 }
  }

  // Tracked changes (staged + unstaged) vs HEAD. On an empty repo (no HEAD),
  // fall back to the working-tree diff.
  let trackedDiff = ''
  let trackedNames: string[] = []
  try {
    trackedDiff = await git(dir, ['diff', 'HEAD'])
    const names = await git(dir, ['diff', '--name-only', 'HEAD'])
    trackedNames = names.split('\n').filter(Boolean)
  } catch {
    trackedDiff = await git(dir, ['diff']).catch(() => '')
    const names = await git(dir, ['diff', '--name-only']).catch(() => '')
    trackedNames = names.split('\n').filter(Boolean)
  }

  // Untracked (new) files.
  const untrackedOut = await git(dir, ['ls-files', '--others', '--exclude-standard']).catch(() => '')
  const untracked = untrackedOut.split('\n').filter(Boolean)

  const parts: string[] = []
  if (trackedDiff.trim()) parts.push(trackedDiff.trimEnd())
  for (const rel of untracked) {
    const content = await readFile(join(dir, rel), 'utf8').catch(() => null)
    if (content === null) continue
    parts.push(synthesizeNewFileDiff(rel, content))
  }

  return {
    diff: parts.join('\n'),
    filesChanged: trackedNames.length + untracked.length,
  }
}
