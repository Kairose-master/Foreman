/**
 * mapLimit — the direction-phase concurrency guardrail (Epic 2.9 hardening,
 * docs/ADR-0001-architecture-hardening.md).
 *
 * Before this file, `runPlanner` dispatched every matched candidate via a
 * bare `Promise.all`, with no cap. At 3 bundled skills that's harmless; the
 * architecture review identified it as a real, currently-nonexistent
 * guardrail that matters once a skill library grows toward the 20-skill
 * scale this project is designing for — a broad goal matching many
 * candidates would otherwise fire unboundedly many concurrent model calls
 * with no ceiling at all.
 *
 * This is deliberately the smallest fix: a plain concurrency limiter, not a
 * cost-ledger or budget-tracking system. Tying direction-phase spend into
 * the existing Engine budget contract (`src/engine/contract.ts`) is a real,
 * separate design question — today's Engine budget only covers execution,
 * and there's no established answer for whether direction-phase spend
 * should draw from the same ceiling or a distinct one. That question is
 * explicitly deferred (see the ADR), not resolved silently here.
 */

/**
 * Run `fn` over `items` with at most `limit` concurrent in flight. Preserves
 * input order in the returned array, regardless of completion order — same
 * convention as `Promise.all`, and the same non-rank caveat applies: order
 * reflects input position only, never priority or confidence.
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0

  async function worker(): Promise<void> {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i]!)
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
