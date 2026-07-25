import { describe, expect, it } from 'vitest'
import { renderFork, renderProposal } from '../src/interaction/prompt-user.js'
import type { Approach, Fork } from '../src/types.js'

const fork: Fork = {
  id: 'mechanism',
  question: 'Library or hand-rolled limiter?',
  options: [
    { id: 'a', label: 'express-rate-limit', tradeoff: 'battle-tested; adds a dependency' },
    { id: 'b', label: 'hand-rolled token bucket', tradeoff: 'zero deps; more code to own' },
  ],
  recommended: 'a',
  shapeChanging: true,
}

const approach: Approach = {
  summary: 'Add a configurable rate limiter to the request pipeline.',
  steps: ['Inspect server.js', 'Wire the middleware'],
  forks: [fork],
  budgetUsd: 0.5,
  spec: 'Requests over the limit get 429; limits configurable; tests cover both paths.',
}

describe('renderFork', () => {
  it('renders the question, every option, and its tradeoff', () => {
    const out = renderFork(fork, 0)
    expect(out).toContain('(1) Library or hand-rolled limiter?')
    expect(out).toContain('[a] express-rate-limit — battle-tested; adds a dependency')
    expect(out).toContain('[b] hand-rolled token bucket — zero deps; more code to own')
  })

  it('marks the recommended option', () => {
    expect(renderFork(fork, 0)).toMatch(/\[a\][^\n]*← recommended/)
  })

  it('omits the dash when an option has no tradeoff text', () => {
    const bare: Fork = { ...fork, options: [
      { id: 'a', label: 'A', tradeoff: '' },
      { id: 'b', label: 'B', tradeoff: '' },
    ] }
    expect(renderFork(bare, 0)).toContain('[a] A ← recommended')
    expect(renderFork(bare, 0)).not.toContain('A —')
  })
})

describe('renderProposal', () => {
  it('includes the approach, plan, budget and acceptance spec', () => {
    const out = renderProposal(approach, [])
    expect(out).toContain(approach.summary)
    expect(out).toContain('1. Inspect server.js')
    expect(out).toContain('Budget for this: ~$0.50')
    expect(out).toContain(`Acceptance: ${approach.spec}`)
  })

  // The regression: --dry-run / --yes never reach the interactive loop, so a
  // surfaced fork announced but not rendered is invisible to the user. That
  // shipped once — the announcement printed with no fork under it.
  it('renders surfaced forks inline, not just their count', () => {
    const out = renderProposal(approach, [fork])
    expect(out).toContain('1 fork I want your call on:')
    expect(out).toContain('Library or hand-rolled limiter?')
    expect(out).toContain('[a] express-rate-limit')
    expect(out).toContain('[b] hand-rolled token bucket')
  })

  it('pluralizes the fork count', () => {
    const second: Fork = { ...fork, id: 'scope', question: 'Per-IP or per-API-key?' }
    const out = renderProposal({ ...approach, forks: [fork, second] }, [fork, second])
    expect(out).toContain('2 forks I want your call on:')
    expect(out).toContain('Per-IP or per-API-key?')
  })

  it('explains when forks exist but the dial hides them', () => {
    const out = renderProposal(approach, [])
    expect(out).toContain('No forks to surface at this dial')
    expect(out).not.toContain('Library or hand-rolled limiter?')
  })

  it('says nothing about forks when the approach has none', () => {
    const out = renderProposal({ ...approach, forks: [] }, [])
    expect(out).not.toContain('fork')
  })
})
