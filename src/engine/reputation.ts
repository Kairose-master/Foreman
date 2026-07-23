/**
 * Reputation from real graded history: which directions tend to pass. Feeds the
 * next proposal so it gets better over time — the engine's job in the seam.
 *
 * `summarizeReputation` is pure and unit-tested. The store just appends and
 * reads a JSONL file; the intelligence is in the summary.
 */
import type { RunOutcome } from '../types.js'

/** Normalize an approach label into a coarse bucket for aggregation. */
export function approachKey(approach: string): string {
  return approach.toLowerCase().replace(/[^a-z0-9 ]+/g, '').trim().split(/\s+/).slice(0, 4).join(' ')
}

/**
 * Turn graded history into a handful of short hints. Buckets by approach label,
 * reports pass rate for buckets with enough signal, newest patterns first.
 * Returns at most `max` hints.
 */
export function summarizeReputation(outcomes: RunOutcome[], max = 4): string[] {
  if (outcomes.length === 0) return []
  const buckets = new Map<string, { label: string; pass: number; total: number; lastIndex: number }>()
  outcomes.forEach((o, i) => {
    const key = approachKey(o.approach)
    if (!key) return
    const b = buckets.get(key) ?? { label: o.approach, pass: 0, total: 0, lastIndex: -1 }
    b.total += 1
    if (o.passed) b.pass += 1
    b.lastIndex = i
    b.label = o.approach // keep the most recent human label
    buckets.set(key, b)
  })

  return [...buckets.values()]
    .filter((b) => b.total >= 1)
    .sort((a, b) => b.lastIndex - a.lastIndex)
    .slice(0, max)
    .map((b) => {
      const rate = Math.round((b.pass / b.total) * 100)
      return `Approach "${b.label}" passed ${b.pass}/${b.total} recent runs (${rate}%).`
    })
}
