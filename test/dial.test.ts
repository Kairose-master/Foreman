import { describe, it, expect } from 'vitest'
import { forksToSurface, defaultChoices, resolveForkChoices, chosenOptionLabel } from '../src/direction/dial.js'
import type { Approach } from '../src/types.js'

const approach: Approach = {
  summary: 's',
  steps: [],
  budgetUsd: 0.6,
  spec: 'sp',
  forks: [
    {
      id: 'shape',
      question: 'rewrite or patch?',
      options: [
        { id: 'a', label: 'patch', tradeoff: 'fast' },
        { id: 'b', label: 'rewrite', tradeoff: 'clean' },
      ],
      recommended: 'a',
      shapeChanging: true,
    },
    {
      id: 'minor',
      question: 'a smaller call',
      options: [
        { id: 'a', label: 'x', tradeoff: 't' },
        { id: 'b', label: 'y', tradeoff: 't' },
      ],
      recommended: 'b',
      shapeChanging: false,
    },
  ],
}

describe('forksToSurface (the dial)', () => {
  it('light surfaces nothing', () => {
    expect(forksToSurface(approach, 'light')).toHaveLength(0)
  })
  it('normal surfaces only shape-changing forks', () => {
    const f = forksToSurface(approach, 'normal')
    expect(f.map((x) => x.id)).toEqual(['shape'])
  })
  it('hands-on surfaces every fork', () => {
    expect(forksToSurface(approach, 'hands-on')).toHaveLength(2)
  })
})

describe('choices', () => {
  it('defaults every fork to its recommendation', () => {
    expect(defaultChoices(approach)).toEqual({ shape: 'a', minor: 'b' })
  })

  it('merges valid user choices over defaults, keeps recommended for the rest', () => {
    const resolved = resolveForkChoices(approach, { shape: 'b' })
    expect(resolved).toEqual({ shape: 'b', minor: 'b' })
  })

  it('ignores an invalid user choice and keeps the recommendation', () => {
    const resolved = resolveForkChoices(approach, { shape: 'zzz' })
    expect(resolved.shape).toBe('a')
  })

  it('labels the chosen option', () => {
    expect(chosenOptionLabel(approach.forks[0]!, { shape: 'b' })).toBe('rewrite')
    expect(chosenOptionLabel(approach.forks[0]!, {})).toBe('patch') // falls to recommended
  })
})
