/**
 * Mechanical candidate filter — narrows a skill list to plausible candidates
 * for a goal using ONLY cheap metadata (name + description). Zero model
 * calls. This is candidate NARROWING, not relevance determination: a skill
 * surviving this filter has not been judged relevant — only "not obviously
 * unrelated enough to skip asking." Final relevance remains each skill's own
 * call (see run-skill.ts's `relevant` field) — this file never produces or
 * implies a relevance verdict, and returns no score or confidence value that
 * could be mistaken for one.
 *
 * Deliberately biased toward false positives over false negatives: when the
 * signal is weak or ambiguous, this filter includes rather than excludes. A
 * skill that gets asked and says "not relevant" costs one cheap call; a
 * skill wrongly excluded here never gets the chance to speak at all, which
 * is the more expensive mistake.
 *
 * The matching strategy here (token overlap + simple substring containment)
 * is intentionally the only implementation, not one of several behind a
 * strategy interface. Swapping it out later means editing this file, not
 * threading a new abstraction through callers — introducing a pluggable
 * strategy framework now would be exactly the "future infrastructure before
 * it's needed" this project avoids.
 */
import type { SkillDescriptor } from './discover.js'

/** Small, generic English stopwords — no domain vocabulary of any kind. */
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

/** True if any goal token exactly matches, or (for tokens >=4 chars) is a
 * substring of/contains, a descriptor token. Deliberately low bar — see the
 * false-positive/false-negative tradeoff note above. */
function overlaps(goalTokens: string[], descTokens: string[]): boolean {
  const descSet = new Set(descTokens)
  for (const g of goalTokens) {
    if (descSet.has(g)) return true
    if (g.length >= 4) {
      for (const d of descSet) {
        if (d.length >= 4 && (d.includes(g) || g.includes(d))) return true
      }
    }
  }
  return false
}

/**
 * Narrow `skills` to plausible candidates for `goal`. Not a relevance
 * verdict — a mechanical, cheap pre-filter. When `goal` yields no usable
 * tokens (too short or entirely generic), every skill is returned rather
 * than guessing an exclusion.
 */
export function filterCandidates(goal: string, skills: SkillDescriptor[]): SkillDescriptor[] {
  const goalTokens = tokenize(goal)
  if (goalTokens.length === 0) return skills
  return skills.filter((s) => overlaps(goalTokens, tokenize(`${s.name} ${s.description}`)))
}

/** One skill's match outcome plus the actual overlapping tokens, for a
 * human/CLI-facing "why did/didn't this match" explanation (Epic 2.12,
 * `foreman inspect`). Not used by the Planner — orchestration only ever
 * needs the boolean-shaped `filterCandidates` result above; this exists
 * purely as an inspection aid layered on the exact same logic. */
export interface CandidateExplanation {
  skill: SkillDescriptor
  matched: boolean
  /** Empty when `goal` yielded no usable tokens (every skill matches
   * trivially in that case, per filterCandidates' own no-tokens rule) or
   * when nothing overlapped. */
  overlappingTokens: string[]
}

/**
 * Explain, per skill, whether and why it would survive `filterCandidates`
 * for this goal. `matched` is derived by calling `filterCandidates` itself
 * (a single-skill list) — never a re-derived boolean — so it can never
 * silently drift from the real filtering behavior above.
 */
export function explainCandidates(goal: string, skills: SkillDescriptor[]): CandidateExplanation[] {
  const goalTokens = tokenize(goal)
  const goalTokenSet = new Set(goalTokens)
  return skills.map((s) => {
    const matched = filterCandidates(goal, [s]).length === 1
    if (goalTokens.length === 0) return { skill: s, matched, overlappingTokens: [] }
    const descTokens = new Set(tokenize(`${s.name} ${s.description}`))
    const overlappingTokens = [...goalTokenSet].filter((g) => {
      if (descTokens.has(g)) return true
      if (g.length < 4) return false
      for (const d of descTokens) {
        if (d.length >= 4 && (d.includes(g) || g.includes(d))) return true
      }
      return false
    })
    return { skill: s, matched, overlappingTokens }
  })
}
