/**
 * The independent quality gate, mirrored from Ledgermind's text-grading path
 * (engine/ledgermind/lib/text-grading.ts): judge a deliverable against its
 * acceptance criteria and emit {"pass", "reason"}.
 *
 * Grader ≠ solver holds structurally: the executor is the Agent SDK driving
 * the repo; the grader is a *separate* Claude call with only the spec + the
 * diff, no memory of how the work was produced.
 *
 * `parseGraderVerdict` is pure and unit-tested — unparseable output returns
 * null (no verdict), never a guess in either direction.
 */

export const GRADER_SYSTEM =
  'You are an independent reviewer for an autonomous coding harness. Judge whether the submitted ' +
  'code change satisfies the acceptance criteria. The criteria are the contract — do not invent extra ' +
  'requirements, and do not excuse clear failures. Judge only what the diff shows. Output ONLY a JSON ' +
  'object {"pass": boolean, "reason": "one sentence"}.'

/** Unparseable output returns null — never a guess. Tolerates ```json fences. */
export function parseGraderVerdict(raw: string): { pass: boolean; reason: string } | null {
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const obj = parsed as Record<string, unknown>
    if (typeof obj.pass !== 'boolean') return null
    return { pass: obj.pass, reason: String(obj.reason ?? '') }
  } catch {
    return null
  }
}

/** The user-turn content handed to the grader: spec + the deliverable. */
export function buildGraderPrompt(spec: string, diff: string, summary: string): string {
  const diffBlock = diff.trim() ? diff : '(no changes were made to the repository)'
  return [
    'ACCEPTANCE CRITERIA (the contract):',
    spec.trim() || '(none provided)',
    '',
    "WORKER'S SUMMARY OF THE CHANGE:",
    summary.trim() || '(none)',
    '',
    'THE DIFF:',
    '```diff',
    diffBlock,
    '```',
    '',
    'Does the diff satisfy the acceptance criteria? Reply with ONLY {"pass": boolean, "reason": "one sentence"}.',
  ].join('\n')
}
