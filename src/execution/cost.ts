/**
 * Cost accounting for the execution loop.
 *
 * The Agent SDK reports an authoritative `total_cost_usd` only on its final
 * `result` message. To enforce the budget *continuously* (the whole point of a
 * hard ceiling) we estimate spend per assistant turn from token usage. These
 * are pure functions so the math is unit-tested.
 */

/** Per-million-token USD prices. Cache reads bill ~0.1x input; writes ~1.25x. */
export interface ModelPricing {
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok: number
  cacheWritePerMTok: number
}

/** Prices as of the knowledge cutoff (USD / 1M tokens). Opus 4.8: $5 in / $25 out. */
export const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5, cacheWritePerMTok: 6.25 },
  'claude-opus-4-7': { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5, cacheWritePerMTok: 6.25 },
  'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 },
}

/** Fallback when the model id isn't in the table — assume Opus-tier. */
export const DEFAULT_PRICING: ModelPricing = PRICING['claude-opus-4-8']!

export function pricingFor(model: string): ModelPricing {
  return PRICING[model] ?? DEFAULT_PRICING
}

/** The token-usage shape we read off an assistant message (all optional). */
export interface Usage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/**
 * Estimate the USD cost of a single model turn from its token usage.
 * Uncached input, output, cache reads and cache writes are billed separately.
 */
export function estimateCostUsd(usage: Usage, pricing: ModelPricing): number {
  const input = usage.input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const perTok = (mtok: number) => mtok / 1_000_000
  return (
    input * perTok(pricing.inputPerMTok) +
    output * perTok(pricing.outputPerMTok) +
    cacheRead * perTok(pricing.cacheReadPerMTok) +
    cacheWrite * perTok(pricing.cacheWritePerMTok)
  )
}
