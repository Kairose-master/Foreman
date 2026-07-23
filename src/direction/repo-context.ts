/**
 * Lightweight signal about the target repo, injected into the proposal prompt
 * so the approach is grounded in what's actually there — without reading the
 * whole tree (that's the executor's job, on the clock).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const exec = promisify(execFile)

export interface RepoContext {
  dir: string
  /** Top-level entries (dirs marked with a trailing /). */
  topLevel: string[]
  /** Detected stack markers (package.json, Cargo.toml, …). */
  markers: string[]
  /** First lines of a README, if present. */
  readmeHead: string
  /** `git status --short` if it's a repo, else a note. */
  gitStatus: string
}

const STACK_MARKERS = [
  'package.json',
  'tsconfig.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'composer.json',
]

async function firstReadme(dir: string, entries: string[]): Promise<string> {
  const readme = entries.find((e) => /^readme(\.md|\.txt)?$/i.test(e))
  if (!readme) return ''
  const text = await readFile(join(dir, readme), 'utf8').catch(() => '')
  return text.split('\n').slice(0, 20).join('\n')
}

export async function gatherRepoContext(dir: string): Promise<RepoContext> {
  const dirents = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const topLevel = dirents
    .filter((d) => !d.name.startsWith('.git'))
    .map((d) => (d.isDirectory() ? `${d.name}/` : d.name))
    .sort()
    .slice(0, 60)

  const names = dirents.map((d) => d.name)
  const markers = STACK_MARKERS.filter((m) => names.includes(m))
  const readmeHead = await firstReadme(dir, names)

  let gitStatus = '(not a git repository)'
  try {
    const { stdout } = await exec('git', ['-C', dir, 'status', '--short'], { maxBuffer: 4 * 1024 * 1024 })
    gitStatus = stdout.trim() || '(clean working tree)'
  } catch {
    /* leave the default note */
  }

  return { dir, topLevel, markers, readmeHead, gitStatus }
}

/** Render the context as a compact block for the proposal prompt. */
export function renderRepoContext(ctx: RepoContext): string {
  return [
    `Working directory: ${ctx.dir}`,
    `Stack markers: ${ctx.markers.length ? ctx.markers.join(', ') : '(none detected)'}`,
    `Top-level entries: ${ctx.topLevel.join(', ') || '(empty)'}`,
    ctx.readmeHead ? `README (head):\n${ctx.readmeHead}` : 'README: (none)',
    `git status:\n${ctx.gitStatus}`,
  ].join('\n')
}
