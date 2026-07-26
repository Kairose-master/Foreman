import { afterEach, describe, expect, it, vi } from 'vitest'
import { LedgermindEngine } from '../src/engine/ledgermind.js'
import type { Deliverable } from '../src/types.js'

const deliverable: Deliverable = {
  diff: 'diff --git a/x b/x\n+hello',
  summary: 'Added hello',
  filesChanged: 1,
}
const input = { deliverable, spec: 'x contains hello' }

function engineWithToken(token?: string) {
  return new LedgermindEngine({ model: 'claude-haiku-4-5', token, ledgermindUrl: 'https://lm.example' })
}

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

/** The local-fallback tests depend on the local grader FAILING CLOSED (no
 *  credentials). Strip any real key from the env so a developer machine with
 *  ANTHROPIC_API_KEY set doesn't turn these into live API calls. */
function stripCredentials() {
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('LedgermindEngine.grade', () => {
  it('routes to the live /api/grade with the bearer token and returns its verdict', async () => {
    const fetchMock = mockFetchOnce(200, { passed: true, reason: 'meets the spec' })
    const result = await engineWithToken('tok_123').grade(input)

    expect(result).toEqual({ passed: true, reason: '[ledgermind] meets the spec' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://lm.example/api/grade')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok_123')
    const body = JSON.parse(init.body as string)
    expect(body.spec).toBe('x contains hello')
    expect(body.deliverable).toContain('Added hello')
    expect(body.deliverable).toContain('+hello')
  })

  it('a platform FAIL is a verdict too — no second opinion from the local grader', async () => {
    mockFetchOnce(200, { passed: false, reason: 'spec not met' })
    const result = await engineWithToken('tok').grade(input)
    expect(result.passed).toBe(false)
    expect(result.reason).toContain('[ledgermind]')
  })

  it('passed: null (grading unavailable) is NOT a verdict — falls back to local review', async () => {
    stripCredentials()
    mockFetchOnce(200, { passed: null, reason: 'no LLM key on the account' })
    const result = await engineWithToken('tok').grade(input)
    expect(result.passed).toBe(false)
    expect(result.reason).toContain('[local review]')
  })

  it('without a token it never calls the network', async () => {
    stripCredentials()
    const fetchMock = mockFetchOnce(200, { passed: true })
    const result = await engineWithToken(undefined).grade(input)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.reason).toContain('[local review]')
  })
})

describe('LedgermindEngine.proof', () => {
  it('returns the platform proof minted during grade() for the same deliverable', async () => {
    mockFetchOnce(200, {
      passed: true,
      reason: 'ok',
      proof: { id: 'p1', contentHash: '0xabc', attester: '0xA9', url: 'https://lm.example/proof/p1' },
    })
    const engine = engineWithToken('tok')
    await engine.grade(input)
    const proof = await engine.proof({ deliverable, grade: { passed: true, reason: 'ok' }, runId: 'r1' })
    expect(proof.id).toBe('p1')
    expect(proof.url).toBe('https://lm.example/proof/p1')
    expect(proof.attester).toBe('0xA9')
  })

  it('falls back to the local (hash-only) proof when the platform minted none', async () => {
    mockFetchOnce(200, { passed: true, reason: 'ok' })
    const engine = engineWithToken('tok')
    await engine.grade(input)
    const proof = await engine.proof({ deliverable, grade: { passed: true, reason: 'ok' }, runId: 'r1' })
    expect(proof.url).toBeNull()
    expect(proof.hash).toMatch(/^0x/)
  })
})
