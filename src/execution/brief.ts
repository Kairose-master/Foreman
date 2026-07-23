/**
 * Turn an approved direction into the brief the Agent SDK executes against.
 * Pure so the wiring (approach + fork choices + user adjustments + spec) is
 * unit-tested. This is the compact plan each execution carries so it knows
 * exactly what "done" means and where its piece fits.
 */
import type { Approach, Fork } from '../types.js'
import { chosenOptionLabel } from '../direction/dial.js'

/** A short label for the approach, for the reputation record. */
export function approachLabel(approach: Approach): string {
  return approach.summary.split(/[.\n]/)[0]!.trim().slice(0, 80) || 'approach'
}

export interface BuildBriefInput {
  goal: string
  approach: Approach
  choices: Record<string, string>
  adjustments?: string
  /** Grader feedback from a prior failed attempt, if retrying. */
  priorFailure?: string
}

/** The system prompt handed to the Agent SDK executor. */
export function buildBrief(input: BuildBriefInput): string {
  const { goal, approach, choices, adjustments, priorFailure } = input
  const forkLines = approach.forks.map((f: Fork) => `- ${f.question} → ${chosenOptionLabel(f, choices)}`)

  const parts = [
    'You are the execution layer of Foreman, an autonomous coding harness. The',
    'DIRECTION below has already been approved by the user. Execute it end to end',
    'on this repository: read what you need, make the edits, run the tests. Do not',
    'ask for permission and do not stop to re-litigate the approach — the user',
    'approved it. Work within the approach and the acceptance spec.',
    '',
    `GOAL:\n${goal}`,
    '',
    `APPROACH:\n${approach.summary}`,
  ]

  if (approach.steps.length) {
    parts.push('', `PLAN:\n${approach.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`)
  }
  if (forkLines.length) {
    parts.push('', `DECISIONS ALREADY MADE (honor these):\n${forkLines.join('\n')}`)
  }
  if (adjustments && adjustments.trim()) {
    parts.push('', `USER ADJUSTMENT (overrides the above where they conflict):\n${adjustments.trim()}`)
  }
  parts.push('', `ACCEPTANCE SPEC (your work is graded against exactly this):\n${approach.spec}`)
  if (priorFailure && priorFailure.trim()) {
    parts.push(
      '',
      `A PREVIOUS ATTEMPT FAILED THE INDEPENDENT GRADE for this reason:\n${priorFailure.trim()}\n` +
        'Fix that specifically. Do not repeat the same mistake.',
    )
  }
  parts.push(
    '',
    'When finished, end with a short summary of what you changed and why, so it',
    'can be reported to the user.',
  )
  return parts.join('\n')
}
