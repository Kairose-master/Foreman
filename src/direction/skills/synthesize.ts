/**
 * The Minimum Honest Synthesizer — organization, not judgment.
 *
 * Takes every SkillResult from a Planner run and produces exactly five
 * things: a Verdict, Decision Groups, Supporting Concerns, Specialist
 * Attribution, and Unresolved Questions. Nothing else.
 *
 * What this file is explicitly NOT allowed to do (by construction, not just
 * by convention):
 *   - choose a winning fork — a DecisionGroup has no "winner" field; every
 *     member's own original Fork (with its own `recommended`) is retained.
 *   - rank specialists — specialistAttribution is an unordered list of
 *     {skillId, summary}, nothing scores or orders them.
 *   - resolve disagreements — when two specialists' forks land in the same
 *     DecisionGroup, both stay, each still attributed to its own skillId.
 *   - invent missing evidence — the verdict is built from counts only
 *     (how many specialists, how many groups, how many unresolved), never
 *     from a model call synthesizing new prose.
 *   - discard minority opinions — a fork or concern unrelated to anything
 *     else still gets its own singleton DecisionGroup / ungrouped concern;
 *     nothing is dropped for being alone.
 *   - rewrite specialist reasoning — every fork object and every concern
 *     string is carried through verbatim, by reference where possible.
 *
 * Clustering (the one genuinely new capability here) is mechanical: a
 * locally-defined tokenizer + a cheap prefix-stem relatedness check + a
 * Union-Find over shared-token counts. This is intentionally NOT an LLM
 * call — grouping decisions that read differently but mean the same thing
 * is exactly the kind of judgment this epic scopes out; the union-find
 * result is honestly imperfect (see the live-run evidence for where it
 * succeeds and where it doesn't), and that honesty is preferable to an
 * opaque model call presented as certainty.
 *
 * The tokenizer here is deliberately NOT imported from match.ts (which
 * solves a different, easier problem — goal vs. one short description) and
 * match.ts is not modified to export it — this is a small, independent
 * duplication rather than touching a file this epic is scoped to leave
 * alone.
 */
import type { Fork } from '../../types.js'
import type { SkillResult } from './contract.js'

export interface DecisionGroupMember {
  skillId: string
  fork: Fork
}

export interface DecisionGroup {
  /** The first member's own question, verbatim. Never an invented title. */
  label: string
  members: DecisionGroupMember[]
}

export interface AttributedConcern {
  skillId: string
  concern: string
  /** Set only when this concern's text mechanically overlaps a decision
   * group's combined text. Undefined, not a guess, when it doesn't. */
  relatedGroup?: string
}

export interface SpecialistAttribution {
  skillId: string
  summary: string
}

export interface SynthesisResult {
  verdict: string
  decisionGroups: DecisionGroup[]
  supportingConcerns: AttributedConcern[]
  specialistAttribution: SpecialistAttribution[]
  unresolvedQuestions: string[]
}

// --- Mechanical clustering primitives (local to this file, on purpose) ----

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has', 'have',
  'this', 'that', 'with', 'from', 'into', 'onto', 'about', 'over', 'under',
  'to', 'of', 'in', 'on', 'at', 'is', 'it', 'as', 'be', 'by', 'or', 'an', 'a',
  'will', 'would', 'should', 'could', 'their', 'its', 'own', 'each', 'any',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
}

/** Cheap, generic stem tolerance — no domain vocabulary, no hardcoded pairs. */
function tokensRelated(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length >= 6 && b.length >= 6) return a.slice(0, 6) === b.slice(0, 6)
  return false
}

function sharedTokenCount(aTokens: string[], bTokens: string[]): number {
  const bUnique = [...new Set(bTokens)]
  let count = 0
  for (const a of new Set(aTokens)) {
    if (bUnique.some((b) => tokensRelated(a, b))) count++
  }
  return count
}

/** Two forks/concerns link when they share at least this many related tokens.
 * Deliberately NOT biased toward over-inclusion (unlike match.ts's candidate
 * filter) — wrongly merging two distinct decisions has a real cost here that
 * wrongly excluding a candidate specialist doesn't have. */
const CLUSTER_THRESHOLD = 2

function forkText(fork: Fork): string {
  return [fork.question, ...fork.options.map((o) => `${o.label} ${o.tradeoff}`)].join(' ')
}

class UnionFind {
  private readonly parent: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }
  find(i: number): number {
    if (this.parent[i] !== i) this.parent[i] = this.find(this.parent[i]!)
    return this.parent[i]!
  }
  union(i: number, j: number): void {
    const a = this.find(i)
    const b = this.find(j)
    if (a !== b) this.parent[a] = b
  }
}

// --- The synthesizer itself -------------------------------------------------

function buildVerdict(
  relevantCount: number,
  skillIds: string[],
  groupCount: number,
  unresolvedCount: number,
): string {
  const parts = [
    `${relevantCount} specialist${relevantCount === 1 ? '' : 's'} found this relevant${
      skillIds.length ? ` (${skillIds.join(', ')})` : ''
    }`,
  ]
  parts.push(`${groupCount} decision group${groupCount === 1 ? '' : 's'} identified`)
  parts.push(`${unresolvedCount} unresolved`)
  return parts.join('; ') + '.'
}

export function synthesize(results: SkillResult[]): SynthesisResult {
  const relevant = results.filter((r) => r.kind === 'relevant').map((r) => r.finding)
  const disclosed = results.filter((r) => r.kind === 'invocation-failed' || r.kind === 'unparseable')
  // 'not-relevant' results are silently dropped — a confident "no" is not an
  // unresolved question, and surfacing it would violate silence-by-default.

  // Flatten every fork with its origin, preserving the original object.
  const allForks: DecisionGroupMember[] = []
  for (const finding of relevant) {
    for (const fork of finding.proposedForks) {
      allForks.push({ skillId: finding.skillId, fork })
    }
  }

  const forkTokens = allForks.map((m) => tokenize(forkText(m.fork)))
  const uf = new UnionFind(allForks.length)
  for (let i = 0; i < allForks.length; i++) {
    for (let j = i + 1; j < allForks.length; j++) {
      if (sharedTokenCount(forkTokens[i]!, forkTokens[j]!) >= CLUSTER_THRESHOLD) uf.union(i, j)
    }
  }
  const byRoot = new Map<number, DecisionGroupMember[]>()
  allForks.forEach((m, i) => {
    const root = uf.find(i)
    const bucket = byRoot.get(root) ?? []
    bucket.push(m)
    byRoot.set(root, bucket)
  })
  const decisionGroups: DecisionGroup[] = [...byRoot.values()].map((members) => ({
    label: members[0]!.fork.question,
    members,
  }))
  const groupTokensByLabel = new Map(
    decisionGroups.map((g) => [g.label, tokenize(g.members.map((m) => forkText(m.fork)).join(' '))]),
  )

  const supportingConcerns: AttributedConcern[] = []
  for (const finding of relevant) {
    for (const concern of finding.concerns) {
      const concernTokens = tokenize(concern)
      let relatedGroup: string | undefined
      for (const group of decisionGroups) {
        const groupTokens = groupTokensByLabel.get(group.label)!
        if (sharedTokenCount(concernTokens, groupTokens) >= CLUSTER_THRESHOLD) {
          relatedGroup = group.label
          break
        }
      }
      supportingConcerns.push({ skillId: finding.skillId, concern, ...(relatedGroup ? { relatedGroup } : {}) })
    }
  }

  const specialistAttribution: SpecialistAttribution[] = relevant.map((f) => ({
    skillId: f.skillId,
    summary: f.summary,
  }))

  const unresolvedQuestions: string[] = disclosed.map((r) => {
    if (r.kind === 'invocation-failed') return `${r.skillId} could not be evaluated: ${r.reason}`
    return `${r.skillId} returned a response that could not be interpreted: ${r.reason}`
  })

  const verdict = buildVerdict(
    relevant.length,
    relevant.map((f) => f.skillId),
    decisionGroups.length,
    unresolvedQuestions.length,
  )

  return { verdict, decisionGroups, supportingConcerns, specialistAttribution, unresolvedQuestions }
}
