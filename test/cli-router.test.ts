import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/llm.js', async () => {
  const actual = await vi.importActual<typeof import('../src/llm.js')>('../src/llm.js')
  return { ...actual, complete: vi.fn(), hasCredentials: vi.fn().mockReturnValue(true) }
})

import { complete, hasCredentials } from '../src/llm.js'
import { dispatchSubcommand, SUBCOMMAND_HELP } from '../src/cli/router.js'

const mockComplete = vi.mocked(complete)
const mockHasCredentials = vi.mocked(hasCredentials)

function captureStdout(): { get: () => string } {
  let buf = ''
  const orig = process.stdout.write.bind(process.stdout)
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    buf += chunk.toString()
    return true
  })
  return { get: () => buf }
}
function captureStderr(): { get: () => string } {
  let buf = ''
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
    buf += chunk.toString()
    return true
  })
  return { get: () => buf }
}

beforeEach(() => {
  vi.restoreAllMocks()
  mockComplete.mockReset()
  mockHasCredentials.mockReturnValue(true)
})

describe('SUBCOMMAND_HELP', () => {
  it('documents every subcommand with a copy-pasteable example', () => {
    expect(SUBCOMMAND_HELP).toContain('foreman skills list')
    expect(SUBCOMMAND_HELP).toContain('foreman skills validate')
    expect(SUBCOMMAND_HELP).toContain('foreman plan')
    expect(SUBCOMMAND_HELP).toContain('foreman inspect')
  })
})

describe('dispatchSubcommand — invalid arguments', () => {
  it('returns exit code 2 and a descriptive message for an unknown top-level subcommand', async () => {
    const err = captureStderr()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const code = await dispatchSubcommand(['bogus'])
    expect(code).toBe(2)
    expect(err.get()).toContain('unknown subcommand "bogus"')
  })

  it('returns exit code 2 for an unknown "skills" sub-subcommand', async () => {
    const err = captureStderr()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const code = await dispatchSubcommand(['skills', 'bogus'])
    expect(code).toBe(2)
    expect(err.get()).toContain('unknown subcommand')
  })

  it('returns exit code 2 for an unknown flag', async () => {
    const err = captureStderr()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const code = await dispatchSubcommand(['skills', 'list', '--nope'])
    expect(code).toBe(2)
    expect(err.get()).toContain('unknown flag')
  })

  it('returns exit code 2 when plan/inspect is given no goal', async () => {
    const err = captureStderr()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const code = await dispatchSubcommand(['plan'])
    expect(code).toBe(2)
    expect(err.get()).toContain('needs a goal')
  })
})

describe('dispatchSubcommand — skills list', () => {
  it('lists the real bundled skills, exit code 0', async () => {
    const out = captureStdout()
    const code = await dispatchSubcommand(['skills', 'list'])
    expect(code).toBe(0)
    expect(out.get()).toContain('research')
    expect(out.get()).toContain('architecture')
    expect(out.get()).toContain('security')
  })

  it('supports --json output mode with the expected shape', async () => {
    const out = captureStdout()
    const code = await dispatchSubcommand(['skills', 'list', '--json'])
    expect(code).toBe(0)
    const parsed = JSON.parse(out.get())
    expect(Array.isArray(parsed.skills)).toBe(true)
    expect(parsed.skills.find((s: any) => s.id === 'security')).toMatchObject({ source: 'bundled' })
  })
})

describe('dispatchSubcommand — skills validate', () => {
  it('reports all-valid for the real bundled skills, exit code 0', async () => {
    const out = captureStdout()
    const code = await dispatchSubcommand(['skills', 'validate'])
    expect(code).toBe(0)
    expect(out.get()).toContain('All skill packages valid')
  })

  it('exits non-zero and lists specific errors when an external skill directory has a malformed package', async () => {
    const out = captureStdout()
    const code = await dispatchSubcommand([
      'skills',
      'validate',
      '--skills-path',
      'test/fixtures/external-skills/malformed',
    ])
    expect(code).toBe(1)
    expect(out.get()).toContain('invalid')
  })
})

describe('dispatchSubcommand — inspect (no model call)', () => {
  it('shows matched and unmatched skills with reasoning, without invoking complete()', async () => {
    const out = captureStdout()
    const code = await dispatchSubcommand(['inspect', 'reduce blocking calls in the request path'])
    expect(code).toBe(0)
    expect(mockComplete).not.toHaveBeenCalled()
    expect(out.get()).toContain('Goal:')
  })

  it('supports --json output mode', async () => {
    const out = captureStdout()
    const code = await dispatchSubcommand(['inspect', 'add rate limiting to the API', '--json'])
    expect(code).toBe(0)
    const parsed = JSON.parse(out.get())
    expect(parsed.goal).toBe('add rate limiting to the API')
    expect(Array.isArray(parsed.entries)).toBe(true)
  })
})

describe('dispatchSubcommand — plan (mocked model)', () => {
  it('runs the real pipeline end to end and reports a verdict, exit code 0', async () => {
    mockComplete.mockResolvedValue(
      JSON.stringify({ relevant: true, summary: 'applies', concerns: ['a concern'], forks: [] }),
    )
    const out = captureStdout()
    const code = await dispatchSubcommand(['plan', 'add rate limiting to the API'])
    expect(code).toBe(0)
    expect(out.get()).toContain('Verdict:')
    expect(out.get()).toContain('Attribution:')
  })

  it('requires credentials before making any call', async () => {
    mockHasCredentials.mockReturnValue(false)
    const err = captureStderr()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const code = await dispatchSubcommand(['plan', 'add rate limiting to the API'])
    expect(code).toBe(2)
    expect(err.get()).toContain('credentials')
    expect(mockComplete).not.toHaveBeenCalled()
  })

  it('discloses partial skill failure (unparseable) rather than hiding it, and still exits 0 when other skills contributed', async () => {
    let call = 0
    mockComplete.mockImplementation(async () => {
      call++
      if (call === 1) return 'not valid json at all'
      return JSON.stringify({ relevant: true, summary: 'applies', concerns: [], forks: [] })
    })
    const out = captureStdout()
    const code = await dispatchSubcommand(['plan', 'add rate limiting and review auth secrets in the API'])
    expect(code).toBe(0)
    expect(out.get()).toContain('Disclosed failures')
  })

  it('supports --json output mode for plan', async () => {
    mockComplete.mockResolvedValue(
      JSON.stringify({ relevant: false, summary: 'n/a', concerns: [], forks: [] }),
    )
    const out = captureStdout()
    const code = await dispatchSubcommand(['plan', 'add rate limiting to the API', '--json'])
    expect(code).toBe(0)
    const parsed = JSON.parse(out.get())
    expect(parsed.goal).toBe('add rate limiting to the API')
    expect(parsed.synthesis).toBeDefined()
  })
})
