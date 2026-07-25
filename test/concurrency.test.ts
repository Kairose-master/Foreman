import { describe, it, expect } from 'vitest'
import { mapLimit } from '../src/direction/skills/concurrency.js'

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

describe('mapLimit', () => {
  it('runs everything in parallel when limit >= item count', async () => {
    // Overlap, not elapsed time — same technique as the limit test below. A
    // wall-clock bound turns a slow or loaded machine into a false failure.
    let inFlight = 0
    let maxInFlight = 0
    const result = await mapLimit([1, 2, 3], 3, async (n) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await delay(20, n)
      inFlight--
      return n * 10
    })
    expect(result).toEqual([10, 20, 30])
    expect(maxInFlight).toBe(3) // all three open at once — no serialization
  })

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const items = [1, 2, 3, 4, 5, 6]
    await mapLimit(items, 2, async (n) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await delay(20, n)
      inFlight--
      return n
    })
    expect(maxInFlight).toBeLessThanOrEqual(2)
  })

  it('preserves input order in the output, regardless of completion order', async () => {
    // Item 0 finishes last, item 2 finishes first — order must still be [0,1,2].
    const delays = [30, 20, 5]
    const result = await mapLimit([0, 1, 2], 3, (i) => delay(delays[i]!, i))
    expect(result).toEqual([0, 1, 2])
  })

  it('handles an empty array without error', async () => {
    const result = await mapLimit([], 3, async (n: number) => n)
    expect(result).toEqual([])
  })

  it('clamps a limit larger than the item count without error', async () => {
    const result = await mapLimit([1, 2], 100, async (n) => n * 2)
    expect(result).toEqual([2, 4])
  })

  it('clamps a limit of 0 or negative to at least 1 worker', async () => {
    const result = await mapLimit([1, 2], 0, async (n) => n)
    expect(result).toEqual([1, 2])
  })
})
