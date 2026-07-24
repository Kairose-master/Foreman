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
import { complete } from '../../llm.js'
import { parseFencedJson } from './json-response.js'

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

// --- Cross-specialist relationship classification (Epic 2.8) ---------------
//
// Extends the Minimum Honest Synthesizer with exactly one new capability:
// classifying how members of an already-formed DecisionGroup relate to each
// other. This does NOT change synthesize() above in any way — decision
// groups, concerns, attribution, and disclosure are all built exactly as
// before, by the exact same unmodified code. Relationship classification is
// a separate, additive step that reads a DecisionGroup's existing members
// (never rewritten) and asks one narrow question: agreement, complementary,
// tension, or contradiction? It never resolves which position is right,
// never scores confidence, never ranks or votes, and never invents a
// winner — the Relationship type has exactly four fields, none of them a
// verdict on which specialist to believe.
//
// This is the one place in the Synthesizer that calls a model (reusing the
// existing seam, `complete()` from ../../llm.js — no new model-calling
// machinery, same pattern as engine/grading.ts's narrow judge call).
// Classifying a *relationship* between existing statements is judgment a
// mechanical token-overlap check cannot honestly make — unlike clustering,
// where "do these share vocabulary" is a defensible proxy for "are these
// about the same decision," agreement vs. tension vs. contradiction is a
// real semantic distinction a lexical check would have to fake. Fails
// closed: an unparseable or invalid classification is omitted for that
// group only, never fabricated — the underlying DecisionGroup and its
// members are completely unaffected either way.
export type RelationshipKind = 'agreement' | 'complementary' | 'tension' | 'contradiction'

export interface Relationship {
  kind: RelationshipKind
  /** The specialists involved — at least 2, distinct. */
  skillIds: string[]
  /** Which DecisionGroup (by its label) this relationship concerns. */
  decisionGroupLabel: string
  /** Concise, model-provided reasoning — describes the relationship, never a recommendation. */
  explanation: string
}

/** SynthesisResult plus relationships — additive only; every existing field
 * is untouched. Produced by synthesizeWithRelationships, never by
 * synthesize() itself. */
export interface SynthesisResultWithRelationships extends SynthesisResult {
  relationships: Relationship[]
}

const RELATIONSHIP_SYSTEM = `You are classifying how independent specialists' perspectives on ONE shared
decision relate to each other. You are given several specialists' own forks
(question + options + which they recommend) about what has already been
determined to be the same underlying decision. Classify the relationship
between them as EXACTLY ONE of four kinds:

- "agreement": the specialists independently support materially compatible
  directions, for substantially the same reason or outcome.
- "complementary": the specialists discuss the same underlying decision from
  different, non-competing angles — neither position competes with the
  other; they answer different sub-questions of the same decision.
- "tension": the specialists optimize for different values and lean toward
  different directions, but both positions could still coexist or be
  reconciled by a later decision — this is not a hard conflict.
- "contradiction": two claims cannot both be true, or two recommendations
  cannot both be adopted under the stated constraints. Use this
  conservatively — a mere wording difference or a different emphasis is NOT
  a contradiction.

When genuinely uncertain between two adjacent classes, prefer the weaker,
more conservative one: prefer "complementary" over "agreement" if unsure
they truly agree for the same reason; prefer "tension" over "contradiction"
if unsure they are truly incompatible.

You are NOT deciding which specialist is right. Never say one should win,
never rank them, never assign a confidence score or severity. Your only job
is to name the relationship and explain it in one or two sentences, citing
what each specialist actually said.

Respond with ONLY a JSON object, no prose, matching exactly:
{ "kind": "agreement" | "complementary" | "tension" | "contradiction", "explanation": "one or two sentences" }`

function renderGroupForClassification(group: DecisionGroup): string {
  return group.members
    .map(
      (m) =>
        `SPECIALIST: ${m.skillId}\nQUESTION: ${m.fork.question}\nOPTIONS:\n${m.fork.options
          .map((o) => `  - [${o.id}] ${o.label} (${o.tradeoff})`)
          .join('\n')}\nRECOMMENDS: ${m.fork.recommended}`,
    )
    .join('\n\n')
}

function parseRelationshipResponse(raw: string): { kind: RelationshipKind; explanation: string } | null {
  const parsed = parseFencedJson(raw)
  if (parsed === null || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  const validKinds: RelationshipKind[] = ['agreement', 'complementary', 'tension', 'contradiction']
  if (typeof o.kind !== 'string' || !validKinds.includes(o.kind as RelationshipKind)) return null
  if (typeof o.explanation !== 'string' || !o.explanation) return null
  return { kind: o.kind as RelationshipKind, explanation: o.explanation }
}

/**
 * Classify relationships for every DecisionGroup that involves 2+ distinct
 * specialists. Groups with a single member, or multiple members from the
 * SAME specialist, are skipped entirely — there is no cross-specialist
 * relationship to classify, and no model call is made for them (fully
 * deterministic for that case, and no invented relationship). Runs the
 * independent classification calls concurrently — same concurrency
 * discipline as the Planner (Epic 2.3B); Promise.all's returned order
 * matches input order, used here only for determinism, never as rank.
 * Never throws: an unparseable or errored classification is omitted for
 * that group only.
 */
export async function classifyRelationships(
  decisionGroups: DecisionGroup[],
  model: string,
): Promise<Relationship[]> {
  const eligible = decisionGroups.filter((g) => new Set(g.members.map((m) => m.skillId)).size >= 2)

  const results = await Promise.all(
    eligible.map(async (group): Promise<Relationship | null> => {
      let raw: string
      try {
        raw = await complete({
          model,
          system: RELATIONSHIP_SYSTEM,
          user: renderGroupForClassification(group),
          maxTokens: 512,
        })
      } catch {
        return null
      }
      const parsed = parseRelationshipResponse(raw)
      if (!parsed) return null
      const skillIds = [...new Set(group.members.map((m) => m.skillId))]
      return { kind: parsed.kind, skillIds, decisionGroupLabel: group.label, explanation: parsed.explanation }
    }),
  )

  return results.filter((r): r is Relationship => r !== null)
}

/**
 * synthesize() + classifyRelationships(), composed. synthesize() itself is
 * completely unchanged by this — this only adds the new step after it runs.
 */
export async function synthesizeWithRelationships(
  results: SkillResult[],
  model: string,
): Promise<SynthesisResultWithRelationships> {
  const base = synthesize(results)
  const relationships = await classifyRelationships(base.decisionGroups, model)
  return { ...base, relationships }
}
