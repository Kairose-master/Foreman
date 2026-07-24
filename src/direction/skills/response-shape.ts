/**
 * Shared "what a skill's own response must look like" validation (Epic 2.10,
 * Skill SDK). Extracted out of run-skill.ts so the same validation an author
 * can run offline (via the SDK's `validateSkillResponse`) is byte-for-byte
 * the same check the real runner applies — not a second, drifting copy.
 *
 * `run-skill.ts` still owns its own SkillResult construction (invocation
 * failures, the canned 'unparseable' reason string) — this file only owns
 * the "is this JSON shaped like a skill response" question, returning a
 * detailed, human-readable reason on failure so an author gets more than a
 * bare null when testing their own skill offline.
 */
import type { Fork } from '../../types.js'
import { parseFencedJson } from './json-response.js'

export interface ParsedSkillResponse {
  relevant: boolean
  summary: string
  concerns: string[]
  forks: Fork[]
}

export type SkillResponseValidation =
  | { ok: true; value: ParsedSkillResponse }
  | { ok: false; error: string }

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function normalizeForkOption(raw: unknown, index: number): Fork['options'][number] | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && o.id ? o.id : String.fromCharCode(97 + index)
  const label = typeof o.label === 'string' && o.label ? o.label : id
  const tradeoff = typeof o.tradeoff === 'string' ? o.tradeoff : ''
  return { id, label, tradeoff }
}

function normalizeFork(raw: unknown, index: number): Fork | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const optionsRaw = Array.isArray(o.options) ? o.options : []
  const options = optionsRaw
    .map((op, i) => normalizeForkOption(op, i))
    .filter((x): x is Fork['options'][number] => x !== null)
  if (options.length < 2) return null
  const id = typeof o.id === 'string' && o.id ? o.id : `fork-${index + 1}`
  const question = typeof o.question === 'string' && o.question ? o.question : 'Which way?'
  const recommended = options.some((op) => op.id === o.recommended)
    ? (o.recommended as string)
    : options[0]!.id
  return { id, question, options, recommended, shapeChanging: true }
}

/**
 * Validate a skill's raw model response against the required shape:
 * `{ relevant: boolean, summary?: string, concerns?: string[], forks?: [...] }`.
 * Returns a detailed `{ ok: false, error }` on any failure — used both by
 * the real runner (which only needs the boolean outcome) and by the SDK's
 * `validateSkillResponse` (which surfaces `error` to the skill author).
 */
export function validateSkillResponseShape(raw: string): SkillResponseValidation {
  const parsed = parseFencedJson(raw)
  if (parsed === null) {
    return { ok: false, error: 'response is not valid JSON (after stripping an optional ```json fence)' }
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: `response must be a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}` }
  }
  const o = parsed as Record<string, unknown>
  if (typeof o.relevant !== 'boolean') {
    return { ok: false, error: 'response is missing a boolean "relevant" field' }
  }
  const summary = typeof o.summary === 'string' ? o.summary : ''
  const concerns = asStringArray(o.concerns)
  const forks = (Array.isArray(o.forks) ? o.forks : [])
    .map((f, i) => normalizeFork(f, i))
    .filter((f): f is Fork => f !== null)
  return { ok: true, value: { relevant: o.relevant, summary, concerns, forks } }
}
