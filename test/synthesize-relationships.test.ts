import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/llm.js', () => ({
  complete: vi.fn(),
}))

import { complete } from '../src/llm.js'
import { synthesize } from '../src/direction/skills/synthesize.js'
import { classifyRelationships, synthesizeWithRelationships } from '../src/direction/skills/synthesize.js'
import type { SkillResult } from '../src/direction/skills/contract.js'
import type { Fork } from '../src/types.js'

const mockComplete = vi.mocked(complete)

function fork(id: string, question: string, options: Fork['options'], recommended: string): Fork {
  return { id, question, options, recommended, shapeChanging: true }
}

function relevant(skillId: string, forks: Fork[], concerns: string[] = []): SkillResult {
  return { kind: 'relevant', finding: { skillId, summary: `${skillId} summary`, concerns, proposedForks: forks } }
}

beforeEach(() => {
  mockComplete.mockReset()
})

describe('classifyRelationships', () => {
  it('1. agreement — two specialists independently compatible, both attributions preserved', async () => {
    const results: SkillResult[] = [
      relevant('architecture', [
        fork('f1', 'Should settlement state be canonical in one place?', [
          { id: 'a', label: 'single source', tradeoff: 't' },
          { id: 'b', label: 'split', tradeoff: 't' },
        ], 'a'),
      ]),
      relevant('security', [
        fork('f2', 'Should escrow settlement state have one canonical authority?', [
          { id: 'a', label: 'single source', tradeoff: 't' },
          { id: 'b', label: 'split', tradeoff: 't' },
        ], 'a'),
      ]),
    ]
    const base = synthesize(results)
    expect(base.decisionGroups).toHaveLength(1) // clustered by the unchanged Epic 2.7 logic

    mockComplete.mockResolvedValueOnce(
      JSON.stringify({ kind: 'agreement', explanation: 'Both recommend a single canonical settlement authority for the same consistency reason.' }),
    )
    const relationships = await classifyRelationships(base.decisionGroups, 'claude-haiku-4-5')
    expect(relationships).toHaveLength(1)
    expect(relationships[0]!.kind).toBe('agreement')
    expect(relationships[0]!.skillIds.sort()).toEqual(['architecture', 'security'])
    expect(relationships[0]!.decisionGroupLabel).toBe(base.decisionGroups[0]!.label)
  })

  it('2. complementary — different angles on one decision, not agreement, not contradiction', async () => {
    const results: SkillResult[] = [
      relevant('architecture', [
        fork('f1', 'Where should escrow settlement state ownership live?', [
          { id: 'a', label: 'module A', tradeoff: 't' },
          { id: 'b', label: 'module B', tradeoff: 't' },
        ], 'a'),
      ]),
      relevant('security', [
        fork('f2', 'Who is trusted as the authoritative settlement source for escrow state?', [
          { id: 'a', label: 'trusted service', tradeoff: 't' },
          { id: 'b', label: 'verified signature', tradeoff: 't' },
        ], 'b'),
      ]),
    ]
    const base = synthesize(results)
    mockComplete.mockResolvedValueOnce(
      JSON.stringify({
        kind: 'complementary',
        explanation: 'Architecture asks where ownership structurally lives; Security asks who is trusted as authoritative — different angles on the same decision.',
      }),
    )
    const relationships = await classifyRelationships(base.decisionGroups, 'claude-haiku-4-5')
    expect(relationships).toHaveLength(1)
    expect(relationships[0]!.kind).toBe('complementary')
    expect(relationships[0]!.kind).not.toBe('agreement')
    expect(relationships[0]!.kind).not.toBe('contradiction')
  })

  it('3. tension — different values, different leanings, neither position selected', async () => {
    const results: SkillResult[] = [
      relevant('architecture', [
        fork('f1', 'Should settlement stay minimally changed or gain new shared machinery?', [
          { id: 'a', label: 'minimal change', tradeoff: 'simpler' },
          { id: 'b', label: 'new shared machinery', tradeoff: 'safer but more structure' },
        ], 'a'),
      ]),
      relevant('security', [
        fork('f2', 'Should settlement gain explicit shared-state machinery or stay minimally changed?', [
          { id: 'a', label: 'new shared machinery', tradeoff: 'safer' },
          { id: 'b', label: 'minimal change', tradeoff: 'faster but riskier' },
        ], 'a'),
      ]),
    ]
    const base = synthesize(results)
    mockComplete.mockResolvedValueOnce(
      JSON.stringify({
        kind: 'tension',
        explanation: 'Architecture favors minimal structural change for simplicity; Security favors explicit shared-state machinery for safety — both could still coexist.',
      }),
    )
    const relationships = await classifyRelationships(base.decisionGroups, 'claude-haiku-4-5')
    expect(relationships).toHaveLength(1)
    expect(relationships[0]!.kind).toBe('tension')
    // No winner is ever recorded anywhere on the relationship.
    expect(relationships[0]).not.toHaveProperty('winner')
    expect(relationships[0]).not.toHaveProperty('recommended')
  })

  it('4. contradiction — mutually incompatible claims, clearly disclosed', async () => {
    const results: SkillResult[] = [
      relevant('architecture', [
        fork('f1', 'Can both settlement paths write the same escrow record concurrently?', [
          { id: 'a', label: 'yes, both may write', tradeoff: 't' },
          { id: 'b', label: 'no, single writer only', tradeoff: 't' },
        ], 'a'),
      ]),
      relevant('security', [
        fork('f2', 'Must only one settlement path ever write a given escrow record?', [
          { id: 'a', label: 'yes, single writer required', tradeoff: 't' },
          { id: 'b', label: 'no, concurrent writes are fine', tradeoff: 't' },
        ], 'a'),
      ]),
    ]
    const base = synthesize(results)
    mockComplete.mockResolvedValueOnce(
      JSON.stringify({
        kind: 'contradiction',
        explanation: 'Architecture accepts both paths writing the same escrow record concurrently; Security requires exactly one writer — these cannot both hold.',
      }),
    )
    const relationships = await classifyRelationships(base.decisionGroups, 'claude-haiku-4-5')
    expect(relationships).toHaveLength(1)
    expect(relationships[0]!.kind).toBe('contradiction')
  })

  it('5. similar wording without semantic equivalence produces no false relationship (classifier says complementary, not agreement)', async () => {
    // Two forks share vocabulary (cluster together) but the classifier itself
    // determines they are not actually in agreement — this test asserts the
    // classifier's verdict is trusted and reported as given, not upgraded.
    const results: SkillResult[] = [
      relevant('architecture', [
        fork('f1', 'Should the settlement module be extracted?', [
          { id: 'a', label: 'extract', tradeoff: 't' },
          { id: 'b', label: 'keep inline', tradeoff: 't' },
        ], 'a'),
      ]),
      relevant('research', [
        fork('f2', 'Has any comparable settlement extraction pattern been tried elsewhere?', [
          { id: 'a', label: 'yes, precedent exists', tradeoff: 't' },
          { id: 'b', label: 'no precedent found', tradeoff: 't' },
        ], 'b'),
      ]),
    ]
    const base = synthesize(results)
    mockComplete.mockResolvedValueOnce(
      JSON.stringify({
        kind: 'complementary',
        explanation: 'Architecture is deciding whether to extract; Research is only reporting whether precedent exists — not the same claim, not agreement.',
      }),
    )
    const relationships = await classifyRelationships(base.decisionGroups, 'claude-haiku-4-5')
    expect(relationships[0]!.kind).toBe('complementary')
    expect(relationships[0]!.kind).not.toBe('agreement')
  })

  it('6. one specialist only — no invented cross-specialist relationship, no model call made', async () => {
    const results: SkillResult[] = [
      relevant('architecture', [
        fork('f1', 'Should this be extracted?', [
          { id: 'a', label: 'x', tradeoff: 't' },
          { id: 'b', label: 'y', tradeoff: 't' },
        ], 'a'),
      ]),
    ]
    const base = synthesize(results)
    expect(base.decisionGroups).toHaveLength(1)
    const relationships = await classifyRelationships(base.decisionGroups, 'claude-haiku-4-5')
    expect(relationships).toEqual([])
    expect(mockComplete).not.toHaveBeenCalled() // deterministic skip, not a wasted call
  })

  it('7. failed/unparseable specialist — disclosure remains intact, not interpreted as disagreement', async () => {
    const results: SkillResult[] = [
      relevant('architecture', [
        fork('f1', 'Should this be extracted?', [
          { id: 'a', label: 'x', tradeoff: 't' },
          { id: 'b', label: 'y', tradeoff: 't' },
        ], 'a'),
      ]),
      { kind: 'invocation-failed', skillId: 'security', reason: 'network unreachable' },
      { kind: 'unparseable', skillId: 'ux', reason: 'bad shape', raw: 'garbage' },
    ]
    const base = synthesize(results)
    expect(base.unresolvedQuestions).toHaveLength(2) // unchanged synthesize() behavior, still intact
    const relationships = await classifyRelationships(base.decisionGroups, 'claude-haiku-4-5')
    // Only one specialist actually produced a fork — no relationship to classify,
    // and the failed specialists must not appear as a "disagreement" of any kind.
    expect(relationships).toEqual([])
    expect(mockComplete).not.toHaveBeenCalled()
  })

  it('8. attribution preservation — every relationship traces back to its DecisionGroup and skillIds', async () => {
    const results: SkillResult[] = [
      relevant('architecture', [
        fork('f1', 'Should settlement state be canonical in one place?', [
          { id: 'a', label: 'single source', tradeoff: 't' },
          { id: 'b', label: 'split', tradeoff: 't' },
        ], 'a'),
      ]),
      relevant('security', [
        fork('f2', 'Should escrow settlement state have one canonical authority?', [
          { id: 'a', label: 'single source', tradeoff: 't' },
          { id: 'b', label: 'split', tradeoff: 't' },
        ], 'a'),
      ]),
    ]
    const base = synthesize(results)
    mockComplete.mockResolvedValueOnce(JSON.stringify({ kind: 'agreement', explanation: 'compatible' }))
    const relationships = await classifyRelationships(base.decisionGroups, 'claude-haiku-4-5')
    const rel = relationships[0]!
    // decisionGroupLabel resolves back to a real, existing group.
    const group = base.decisionGroups.find((g) => g.label === rel.decisionGroupLabel)
    expect(group).toBeDefined()
    // Every skillId in the relationship is actually a member of that group.
    const groupSkillIds = group!.members.map((m) => m.skillId)
    for (const id of rel.skillIds) {
      expect(groupSkillIds).toContain(id)
    }
  })

  it('9. determinism — same ordered input produces structurally stable output (group count, membership, order)', async () => {
    const results: SkillResult[] = [
      relevant('architecture', [
        fork('f1', 'Should settlement state be canonical in one place?', [
          { id: 'a', label: 'single source', tradeoff: 't' },
          { id: 'b', label: 'split', tradeoff: 't' },
        ], 'a'),
      ]),
      relevant('security', [
        fork('f2', 'Should escrow settlement state have one canonical authority?', [
          { id: 'a', label: 'single source', tradeoff: 't' },
          { id: 'b', label: 'split', tradeoff: 't' },
        ], 'a'),
      ]),
    ]
    const base1 = synthesize(results)
    const base2 = synthesize(results)
    // Deterministic pre-classification structure (no model call involved yet).
    expect(base1.decisionGroups.length).toBe(base2.decisionGroups.length)
    expect(base1.decisionGroups[0]!.members.map((m) => m.skillId)).toEqual(
      base2.decisionGroups[0]!.members.map((m) => m.skillId),
    )
  })

  it('never fabricates a relationship when the model response is unparseable — omits, does not crash', async () => {
    const results: SkillResult[] = [
      relevant('architecture', [
        fork('f1', 'Should settlement state be canonical?', [
          { id: 'a', label: 'x', tradeoff: 't' },
          { id: 'b', label: 'y', tradeoff: 't' },
        ], 'a'),
      ]),
      relevant('security', [
        fork('f2', 'Should escrow settlement have canonical authority?', [
          { id: 'a', label: 'x', tradeoff: 't' },
          { id: 'b', label: 'y', tradeoff: 't' },
        ], 'a'),
      ]),
    ]
    const base = synthesize(results)
    mockComplete.mockResolvedValueOnce('not json at all')
    const relationships = await classifyRelationships(base.decisionGroups, 'claude-haiku-4-5')
    expect(relationships).toEqual([]) // omitted, group itself untouched
    expect(base.decisionGroups[0]!.members).toHaveLength(2) // unaffected
  })

  it('never fabricates a relationship when the model call rejects', async () => {
    const results: SkillResult[] = [
      relevant('architecture', [
        fork('f1', 'Should settlement state be canonical?', [
          { id: 'a', label: 'x', tradeoff: 't' },
          { id: 'b', label: 'y', tradeoff: 't' },
        ], 'a'),
      ]),
      relevant('security', [
        fork('f2', 'Should escrow settlement have canonical authority?', [
          { id: 'a', label: 'x', tradeoff: 't' },
          { id: 'b', label: 'y', tradeoff: 't' },
        ], 'a'),
      ]),
    ]
    const base = synthesize(results)
    mockComplete.mockRejectedValueOnce(new Error('boom'))
    await expect(classifyRelationships(base.decisionGroups, 'claude-haiku-4-5')).resolves.toEqual([])
  })

  it('rejects an invalid "kind" value from the model rather than accepting it', async () => {
    const results: SkillResult[] = [
      relevant('architecture', [
        fork('f1', 'Should settlement state be canonical?', [
          { id: 'a', label: 'x', tradeoff: 't' },
          { id: 'b', label: 'y', tradeoff: 't' },
        ], 'a'),
      ]),
      relevant('security', [
        fork('f2', 'Should escrow settlement have canonical authority?', [
          { id: 'a', label: 'x', tradeoff: 't' },
          { id: 'b', label: 'y', tradeoff: 't' },
        ], 'a'),
      ]),
    ]
    const base = synthesize(results)
    mockComplete.mockResolvedValueOnce(JSON.stringify({ kind: 'security_wins', explanation: 'x' }))
    const relationships = await classifyRelationships(base.decisionGroups, 'claude-haiku-4-5')
    expect(relationships).toEqual([])
  })
})

describe('synthesizeWithRelationships', () => {
  it('composes synthesize() unchanged plus relationships, additively', async () => {
    const results: SkillResult[] = [
      relevant('architecture', [
        fork('f1', 'Should settlement state be canonical?', [
          { id: 'a', label: 'x', tradeoff: 't' },
          { id: 'b', label: 'y', tradeoff: 't' },
        ], 'a'),
      ]),
      relevant('security', [
        fork('f2', 'Should escrow settlement have canonical authority?', [
          { id: 'a', label: 'x', tradeoff: 't' },
          { id: 'b', label: 'y', tradeoff: 't' },
        ], 'a'),
      ]),
    ]
    mockComplete.mockResolvedValueOnce(JSON.stringify({ kind: 'agreement', explanation: 'compatible' }))
    const withRel = await synthesizeWithRelationships(results, 'claude-haiku-4-5')
    const base = synthesize(results)
    expect(withRel.decisionGroups).toEqual(base.decisionGroups)
    expect(withRel.verdict).toEqual(base.verdict)
    expect(withRel.relationships).toHaveLength(1)
  })
})
