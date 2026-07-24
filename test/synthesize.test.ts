import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { synthesize } from '../src/direction/skills/synthesize.js'
import type { SkillResult } from '../src/direction/skills/contract.js'
import type { Fork } from '../src/types.js'

const here = dirname(fileURLToPath(import.meta.url))

function fork(id: string, question: string, options: Fork['options'], recommended: string): Fork {
  return { id, question, options, recommended, shapeChanging: true }
}

describe('synthesize', () => {
  it('clusters two forks with real text overlap from different specialists into one group', () => {
    const results: SkillResult[] = [
      {
        kind: 'relevant',
        finding: {
          skillId: 'architecture',
          summary: 'architecture summary',
          concerns: [],
          proposedForks: [
            fork(
              'ownership_boundary',
              'Which module owns the escrow settlement state after this change?',
              [
                { id: 'a', label: 'Labor Market owns it', tradeoff: 'simple' },
                { id: 'b', label: 'Settlement module owns it', tradeoff: 'cleaner' },
              ],
              'b',
            ),
          ],
        },
      },
      {
        kind: 'relevant',
        finding: {
          skillId: 'security',
          summary: 'security summary',
          concerns: [],
          proposedForks: [
            fork(
              'settlement_authority',
              'Which module is the source of truth for escrow settlement state?',
              [
                { id: 'a', label: 'Single canonical ledger', tradeoff: 'safer' },
                { id: 'b', label: 'Independent per-path state', tradeoff: 'faster' },
              ],
              'a',
            ),
          ],
        },
      },
    ]
    const result = synthesize(results)
    expect(result.decisionGroups).toHaveLength(1)
    const group = result.decisionGroups[0]!
    expect(group.members).toHaveLength(2)
    expect(group.members.map((m) => m.skillId).sort()).toEqual(['architecture', 'security'])
    // Both original recommendations survive, distinctly — no winner chosen.
    expect(group.members.find((m) => m.skillId === 'architecture')!.fork.recommended).toBe('b')
    expect(group.members.find((m) => m.skillId === 'security')!.fork.recommended).toBe('a')
  })

  it('does NOT merge forks with no meaningful overlap', () => {
    const results: SkillResult[] = [
      {
        kind: 'relevant',
        finding: {
          skillId: 'architecture',
          summary: 's1',
          concerns: [],
          proposedForks: [
            fork('a', 'Should this be a layered or event-driven design?', [
              { id: 'a', label: 'layered', tradeoff: 't' },
              { id: 'b', label: 'event-driven', tradeoff: 't' },
            ], 'a'),
          ],
        },
      },
      {
        kind: 'relevant',
        finding: {
          skillId: 'security',
          summary: 's2',
          concerns: [],
          proposedForks: [
            fork('b', 'Should tokens be stateless or session-based?', [
              { id: 'a', label: 'stateless token', tradeoff: 't' },
              { id: 'b', label: 'session token', tradeoff: 't' },
            ], 'a'),
          ],
        },
      },
    ]
    const result = synthesize(results)
    expect(result.decisionGroups).toHaveLength(2)
  })

  it('transitively clusters A-B-C via Union-Find even when A and C share no direct overlap', () => {
    const results: SkillResult[] = [
      {
        kind: 'relevant',
        finding: {
          skillId: 'a-skill',
          summary: 's',
          concerns: [],
          proposedForks: [
            fork('f1', 'How should escrow settlement authority be modeled?', [
              { id: 'a', label: 'x', tradeoff: 't' },
              { id: 'b', label: 'y', tradeoff: 't' },
            ], 'a'),
          ],
        },
      },
      {
        kind: 'relevant',
        finding: {
          skillId: 'b-skill',
          summary: 's',
          concerns: [],
          proposedForks: [
            fork('f2', 'What settlement authority model should govern payout routing decisions?', [
              { id: 'a', label: 'x', tradeoff: 't' },
              { id: 'b', label: 'y', tradeoff: 't' },
            ], 'a'),
          ],
        },
      },
      {
        kind: 'relevant',
        finding: {
          skillId: 'c-skill',
          summary: 's',
          concerns: [],
          proposedForks: [
            fork('f3', 'How should payout routing decisions handle concurrent requests?', [
              { id: 'a', label: 'x', tradeoff: 't' },
              { id: 'b', label: 'y', tradeoff: 't' },
            ], 'a'),
          ],
        },
      },
    ]
    const result = synthesize(results)
    expect(result.decisionGroups).toHaveLength(1)
    expect(result.decisionGroups[0]!.members).toHaveLength(3)
  })

  it('drops not-relevant results silently — no attribution, no unresolved noise', () => {
    const results: SkillResult[] = [
      { kind: 'not-relevant', skillId: 'ux', reason: 'no user-facing surface in this goal' },
    ]
    const result = synthesize(results)
    expect(result.specialistAttribution).toEqual([])
    expect(result.unresolvedQuestions).toEqual([])
    expect(result.decisionGroups).toEqual([])
  })

  it('discloses invocation-failed and unparseable results, never silently', () => {
    const results: SkillResult[] = [
      { kind: 'invocation-failed', skillId: 'performance', reason: 'network unreachable' },
      { kind: 'unparseable', skillId: 'ux', reason: 'bad shape', raw: 'garbage' },
    ]
    const result = synthesize(results)
    expect(result.unresolvedQuestions).toHaveLength(2)
    expect(result.unresolvedQuestions.some((q) => q.includes('performance') && q.includes('network unreachable'))).toBe(true)
    expect(result.unresolvedQuestions.some((q) => q.includes('ux') && q.includes('bad shape'))).toBe(true)
  })

  it('attributes concerns to the correct originating skill with verbatim wording', () => {
    const results: SkillResult[] = [
      {
        kind: 'relevant',
        finding: {
          skillId: 'research',
          summary: 's',
          concerns: ['A very specific, exact concern string.'],
          proposedForks: [],
        },
      },
    ]
    const result = synthesize(results)
    expect(result.supportingConcerns).toEqual([
      { skillId: 'research', concern: 'A very specific, exact concern string.' },
    ])
  })

  it('preserves specialist summaries verbatim in attribution', () => {
    const results: SkillResult[] = [
      {
        kind: 'relevant',
        finding: { skillId: 'research', summary: 'The exact summary text.', concerns: [], proposedForks: [] },
      },
    ]
    const result = synthesize(results)
    expect(result.specialistAttribution).toEqual([{ skillId: 'research', summary: 'The exact summary text.' }])
  })

  it('loses nothing: every original fork object is present by reference somewhere in decisionGroups', () => {
    const f1 = fork('f1', 'Question one about escrow settlement', [
      { id: 'a', label: 'x', tradeoff: 't' },
      { id: 'b', label: 'y', tradeoff: 't' },
    ], 'a')
    const f2 = fork('f2', 'A totally unrelated fork about deployment topology', [
      { id: 'a', label: 'x', tradeoff: 't' },
      { id: 'b', label: 'y', tradeoff: 't' },
    ], 'a')
    const results: SkillResult[] = [
      { kind: 'relevant', finding: { skillId: 's1', summary: 's', concerns: [], proposedForks: [f1] } },
      { kind: 'relevant', finding: { skillId: 's2', summary: 's', concerns: [], proposedForks: [f2] } },
    ]
    const result = synthesize(results)
    const allForksInGroups = result.decisionGroups.flatMap((g) => g.members.map((m) => m.fork))
    expect(allForksInGroups).toContain(f1)
    expect(allForksInGroups).toContain(f2)
  })

  it('never introduces a group-level winner — each member keeps its own distinct recommendation', () => {
    const results: SkillResult[] = [
      {
        kind: 'relevant',
        finding: {
          skillId: 'a',
          summary: 's',
          concerns: [],
          proposedForks: [
            fork('f1', 'How should escrow settlement authority work?', [
              { id: 'x', label: 'opt x', tradeoff: 't' },
              { id: 'y', label: 'opt y', tradeoff: 't' },
            ], 'x'),
          ],
        },
      },
      {
        kind: 'relevant',
        finding: {
          skillId: 'b',
          summary: 's',
          concerns: [],
          proposedForks: [
            fork('f2', 'What should govern escrow settlement authority decisions?', [
              { id: 'x', label: 'opt x', tradeoff: 't' },
              { id: 'y', label: 'opt y', tradeoff: 't' },
            ], 'y'),
          ],
        },
      },
    ]
    const result = synthesize(results)
    expect(result.decisionGroups).toHaveLength(1)
    const recs = result.decisionGroups[0]!.members.map((m) => m.fork.recommended)
    expect(recs.sort()).toEqual(['x', 'y']) // both preserved, distinctly — no group.winner field exists
  })

  it('clusters via token overlap, not via string equality of the question text', () => {
    // Deliberately different question phrasing, overlapping vocabulary only.
    const results: SkillResult[] = [
      {
        kind: 'relevant',
        finding: {
          skillId: 'a',
          summary: 's',
          concerns: [],
          proposedForks: [
            fork('f1', 'Should escrow settlement be centralized or distributed?', [
              { id: 'a', label: 'x', tradeoff: 't' },
              { id: 'b', label: 'y', tradeoff: 't' },
            ], 'a'),
          ],
        },
      },
      {
        kind: 'relevant',
        finding: {
          skillId: 'b',
          summary: 's',
          concerns: [],
          proposedForks: [
            fork('f2', 'Where should the settlement of escrow claims be authoritative?', [
              { id: 'a', label: 'x', tradeoff: 't' },
              { id: 'b', label: 'y', tradeoff: 't' },
            ], 'a'),
          ],
        },
      },
    ]
    const result = synthesize(results)
    expect(result.decisionGroups).toHaveLength(1) // grouped despite zero identical question text
  })

  it('produces a verdict shorter than the longest individual specialist summary', () => {
    const longSummary =
      'This is a deliberately long, verbose specialist summary sentence that goes on for quite a while to simulate a real model response with substantial detail packed into one line.'
    const results: SkillResult[] = [
      { kind: 'relevant', finding: { skillId: 'a', summary: longSummary, concerns: [], proposedForks: [] } },
      { kind: 'relevant', finding: { skillId: 'b', summary: 'short', concerns: [], proposedForks: [] } },
    ]
    const result = synthesize(results)
    expect(result.verdict.length).toBeLessThan(longSummary.length)
  })

  it('produces an empty-but-valid result for an empty results array', () => {
    const result = synthesize([])
    expect(result.decisionGroups).toEqual([])
    expect(result.supportingConcerns).toEqual([])
    expect(result.specialistAttribution).toEqual([])
    expect(result.unresolvedQuestions).toEqual([])
    expect(result.verdict).toContain('0 specialists found this relevant')
  })
})

describe('synthesize.ts constraints', () => {
  const src = readFileSync(join(here, '../src/direction/skills/synthesize.ts'), 'utf8')

  it('is not hardcoded to the illustrative example from the spec', () => {
    const forbidden = [
      'ownership_boundary',
      'settlement_authority',
      'settlement_ownership',
      'Canonical Settlement Authority',
    ]
    for (const s of forbidden) {
      expect(src).not.toContain(s)
    }
  })

  it('never references a named specialist domain in its own source', () => {
    const forbidden = ['security', 'research', 'ux', 'performance', 'documentation']
    for (const word of forbidden) {
      expect(src.toLowerCase()).not.toContain(word)
    }
  })
})
