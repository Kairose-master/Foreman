import { describe, it, expect } from 'vitest'
import { estimateCostUsd, pricingFor, PRICING, DEFAULT_PRICING } from '../src/execution/cost.js'

describe('estimateCostUsd', () => {
  const opus = PRICING['claude-opus-4-8']!

  it('bills input and output at their per-MTok rates', () => {
    // 1M input @ $5, 1M output @ $25
    const cost = estimateCostUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, opus)
    expect(cost).toBeCloseTo(30, 6)
  })

  it('bills cache reads and writes separately', () => {
    const cost = estimateCostUsd(
      { cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 },
      opus,
    )
    expect(cost).toBeCloseTo(opus.cacheReadPerMTok + opus.cacheWritePerMTok, 6)
  })

  it('treats missing usage fields as zero', () => {
    expect(estimateCostUsd({}, opus)).toBe(0)
  })
})

describe('pricingFor', () => {
  it('returns the model table entry', () => {
    expect(pricingFor('claude-sonnet-5')).toBe(PRICING['claude-sonnet-5'])
  })
  it('falls back to Opus-tier for unknown models', () => {
    expect(pricingFor('some-future-model')).toBe(DEFAULT_PRICING)
  })
})
