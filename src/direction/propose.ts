/**
 * The direction layer: turn a goal into an approach proposal — the one
 * in-the-loop artifact (docs/INTERACTION.md). Foreman interrupts for
 * *direction*, not for *doing*, so the proposal names the approach, the forks
 * that change the shape of the result, and a concrete acceptance spec.
 *
 * `parseProposal` is pure and unit-tested: it validates/normalizes whatever the
 * planner emits into a well-formed Approach, so a malformed LLM response can't
 * crash the run or smuggle in a half-built plan.
 */
import type { Approach, Fork } from '../types.js'
import { DEFAULT_BUDGET_USD } from '../config.js'
import { complete } from '../llm.js'
import { renderRepoContext, type RepoContext } from './repo-context.js'

export const PROPOSAL_SYSTEM = `You are the direction layer of an autonomous coding harness. A user gives you a
goal for a real repository. Do NOT write code and do NOT ask about keystrokes.
Produce a short APPROACH PROPOSAL: the plan at altitude, the forks that change
the SHAPE of the result, and a concrete acceptance spec the work will be graded
against.

A "fork" is a decision that changes the shape of the outcome — two legitimately
different approaches (rewrite vs patch, library A vs B), or a tradeoff the user's
taste should settle. "Which file to open" or "what to name a variable" is NOT a
fork; never emit those. Mark a fork shapeChanging:true only when picking the
other option would meaningfully change the result. Most goals have zero to two
real forks — if there are none, return an empty list.

The spec is the contract an independent grader will judge the diff against. Make
it concrete and checkable (e.g. "a token-bucket limiter is applied to the API
request pipeline; limits are configurable; tests cover the limited path"), never
vague ("make it good").

Output ONLY a JSON object, no prose, matching exactly:
{
  "summary": "one tight paragraph describing the approach",
  "steps": ["step 1", "step 2", "..."],
  "forks": [
    {
      "id": "short-id",
      "question": "the decision to make",
      "options": [
        { "id": "a", "label": "option A", "tradeoff": "what you gain / give up" },
        { "id": "b", "label": "option B", "tradeoff": "what you gain / give up" }
      ],
      "recommended": "a",
      "shapeChanging": true
    }
  ],
  "budgetUsd": 0.60,
  "spec": "the concrete, checkable acceptance criteria"
}`

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function normalizeFork(raw: unknown, index: number): Fork | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const optionsRaw = Array.isArray(o.options) ? o.options : []
  const options = optionsRaw
    .map((op, i) => {
      if (typeof op !== 'object' || op === null) return null
      const oo = op as Record<string, unknown>
      const id = asString(oo.id) || String.fromCharCode(97 + i) // a, b, c…
      return { id, label: asString(oo.label, id), tradeoff: asString(oo.tradeoff) }
    })
    .filter((x): x is { id: string; label: string; tradeoff: string } => x !== null)
  // A fork with fewer than two options isn't a fork — drop it.
  if (options.length < 2) return null
  const id = asString(o.id) || `fork-${index + 1}`
  const recommended = options.some((op) => op.id === o.recommended)
    ? asString(o.recommended)
    : options[0]!.id
  return {
    id,
    question: asString(o.question, 'Which way?'),
    options,
    recommended,
    shapeChanging: o.shapeChanging !== false, // default true unless explicitly false
  }
}

/**
 * Validate/normalize a raw planner response into a well-formed Approach.
 * Tolerates ```json fences and missing/garbage fields. Throws only when the
 * text isn't JSON at all.
 */
export function parseProposal(raw: string): Approach {
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('planner did not return JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('planner returned a non-object')
  const o = parsed as Record<string, unknown>

  const steps = Array.isArray(o.steps) ? o.steps.map((s) => asString(s)).filter(Boolean) : []
  const forks = (Array.isArray(o.forks) ? o.forks : [])
    .map((f, i) => normalizeFork(f, i))
    .filter((f): f is Fork => f !== null)

  const budgetRaw = Number(o.budgetUsd)
  const budgetUsd = Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : DEFAULT_BUDGET_USD

  return {
    summary: asString(o.summary, '(no summary provided)'),
    steps,
    forks,
    budgetUsd,
    spec: asString(o.spec, asString(o.summary)),
  }
}

/** Build the user turn for the proposal call. */
export function buildProposalUser(goal: string, ctx: RepoContext, hints: string[]): string {
  const parts = [`GOAL:\n${goal}`, '', `REPOSITORY CONTEXT:\n${renderRepoContext(ctx)}`]
  if (hints.length) {
    parts.push('', `REPUTATION (which past approaches passed — bias toward what works):\n- ${hints.join('\n- ')}`)
  }
  parts.push('', 'Produce the approach proposal as the JSON object described.')
  return parts.join('\n')
}

/** Call the model to produce an approach proposal for a goal. */
export async function proposeApproach(
  goal: string,
  ctx: RepoContext,
  hints: string[],
  model: string,
): Promise<Approach> {
  const raw = await complete({
    model,
    system: PROPOSAL_SYSTEM,
    user: buildProposalUser(goal, ctx, hints),
    maxTokens: 2048,
  })
  return parseProposal(raw)
}
