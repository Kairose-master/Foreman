/**
 * The Skill Runner — generic, domain-agnostic invocation of one discovered
 * skill (docs/SKILL_CONTRACT.md, "invocation is not discovery's job").
 *
 * This file must never hardcode or special-case any particular specialist
 * skill by name. Its only inputs are a SkillDescriptor (generic metadata)
 * and a SkillInput (the one shared packet, identical for every skill). All
 * subject-matter judgment lives inside each skill's own SKILL.md procedure
 * body, which this runner treats as an opaque string handed verbatim to the
 * model — it never inspects or special-cases the content.
 *
 * Reuses the existing model seam (`complete()` from ../../llm.js) — the same
 * function the direction proposal and the grader already call. No new
 * model-calling machinery.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Fork } from '../../types.js'
import { complete } from '../../llm.js'
import type { SkillDescriptor } from './discover.js'
import type { SkillFinding, SkillInput, SkillResult } from './contract.js'
import { parseFencedJson } from './json-response.js'

/** Strip the frontmatter block, if present, and return the procedure body. */
function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
}

/** Read a skill package's SKILL.md and return its procedure body (frontmatter stripped). */
async function loadProcedure(path: string): Promise<string> {
  const raw = await readFile(join(path, 'SKILL.md'), 'utf8')
  return stripFrontmatter(raw)
}

/** Render the shared input packet the same way for every skill — no per-skill shape. */
function renderInput(input: SkillInput): string {
  const parts = [`GOAL:\n${input.goal}`, '', `REPOSITORY CONTEXT:\n${input.repoContext}`]
  if (input.reputationHints.length) {
    parts.push('', `REPUTATION HINTS:\n- ${input.reputationHints.join('\n- ')}`)
  }
  return parts.join('\n')
}

const RUNNER_SYSTEM_PREFIX = `You are one specialist skill inside an autonomous coding harness. Follow the
procedure below exactly. Your FIRST job is to decide, for yourself, whether
you actually apply to this goal — most goals will not need every skill.

Respond with ONLY a JSON object, no prose, matching exactly:
{
  "relevant": true | false,
  "summary": "one line — why you do or don't apply, or what you found",
  "concerns": ["short concern 1", "..."],
  "forks": [ { "id": "...", "question": "...", "options": [{"id":"a","label":"...","tradeoff":"..."}], "recommended": "a" } ]
}

If relevant is false, "concerns" and "forks" should be empty arrays — do not
manufacture a finding you don't actually have. A fork here follows the exact
same rule as everywhere else in this harness: only a decision that changes
the shape of the outcome, never "which file" or "what to name it".

--- YOUR PROCEDURE ---
`

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
 * Parse a skill's raw response. Returns null (never throws) on anything that
 * isn't well-formed JSON with a boolean `relevant` field — the caller turns a
 * null into an explicit 'unparseable' result, distinct from 'not-relevant'.
 */
function parseSkillResponse(
  raw: string,
): { relevant: boolean; summary: string; concerns: string[]; forks: Fork[] } | null {
  const parsed = parseFencedJson(raw)
  if (parsed === null || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  if (typeof o.relevant !== 'boolean') return null
  const summary = typeof o.summary === 'string' ? o.summary : ''
  const concerns = asStringArray(o.concerns)
  const forks = (Array.isArray(o.forks) ? o.forks : [])
    .map((f, i) => normalizeFork(f, i))
    .filter((f): f is Fork => f !== null)
  return { relevant: o.relevant, summary, concerns, forks }
}

/**
 * Invoke one skill against the shared input. Never throws — every failure
 * mode (load failure, model-call failure, unparseable response) returns an
 * explicit SkillResult variant instead of propagating an exception, so one
 * bad skill can never crash the run that dispatched it.
 */
export async function runSkill(
  descriptor: SkillDescriptor,
  input: SkillInput,
  model: string,
): Promise<SkillResult> {
  let procedure: string
  try {
    procedure = await loadProcedure(descriptor.path)
  } catch (err) {
    return {
      kind: 'invocation-failed',
      skillId: descriptor.id,
      reason: `could not load procedure: ${(err as Error).message}`,
    }
  }

  let raw: string
  try {
    raw = await complete({
      model,
      system: RUNNER_SYSTEM_PREFIX + procedure,
      user: renderInput(input),
      maxTokens: 1024,
    })
  } catch (err) {
    return { kind: 'invocation-failed', skillId: descriptor.id, reason: (err as Error).message }
  }

  const parsed = parseSkillResponse(raw)
  if (!parsed) {
    return {
      kind: 'unparseable',
      skillId: descriptor.id,
      reason: 'response did not match the expected { relevant, summary, concerns, forks } shape',
      raw,
    }
  }

  if (!parsed.relevant) {
    return {
      kind: 'not-relevant',
      skillId: descriptor.id,
      reason: parsed.summary || '(no reason given)',
    }
  }

  const finding: SkillFinding = {
    skillId: descriptor.id,
    summary: parsed.summary,
    concerns: parsed.concerns,
    proposedForks: parsed.forks,
  }
  return { kind: 'relevant', finding }
}
