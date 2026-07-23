/**
 * The one in-the-loop moment: present the approach proposal, take the user's
 * call on the surfaced forks, and get approve/adjust. Execution never prompts —
 * only direction does. In --yes mode the caller skips this entirely.
 */
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import type { Approach, DirectionDecision, Fork } from '../types.js'

export function renderProposal(approach: Approach, surfaced: Fork[]): string {
  const out: string[] = []
  out.push('\n─ Approach ─────────────────────────────────────────')
  out.push(approach.summary)
  if (approach.steps.length) {
    out.push('\nPlan:')
    approach.steps.forEach((s, i) => out.push(`  ${i + 1}. ${s}`))
  }
  out.push(`\nBudget for this: ~$${approach.budgetUsd.toFixed(2)}`)
  out.push(`Acceptance: ${approach.spec}`)
  if (surfaced.length) {
    out.push(`\n${surfaced.length} fork${surfaced.length === 1 ? '' : 's'} I want your call on:`)
  } else if (approach.forks.length) {
    out.push('\n(No forks to surface at this dial — going with the recommended calls.)')
  }
  out.push('────────────────────────────────────────────────────')
  return out.join('\n')
}

function renderFork(fork: Fork, index: number): string {
  const out: string[] = [`\n(${index + 1}) ${fork.question}`]
  for (const opt of fork.options) {
    const star = opt.id === fork.recommended ? ' ← recommended' : ''
    out.push(`    [${opt.id}] ${opt.label} — ${opt.tradeoff}${star}`)
  }
  return out.join('\n')
}

/**
 * Interactive direction check-in. Returns the user's decision. On EOF/empty
 * approval defaults to "go" with recommended choices — the light-touch default.
 */
export async function collectDecision(approach: Approach, surfaced: Fork[]): Promise<DirectionDecision> {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    stdout.write(renderProposal(approach, surfaced) + '\n')

    const forkChoices: Record<string, string> = {}
    for (let i = 0; i < surfaced.length; i++) {
      const fork = surfaced[i]!
      stdout.write(renderFork(fork, i) + '\n')
      const valid = fork.options.map((o) => o.id)
      const answer = (await rl.question(`  choose [${valid.join('/')}] (default ${fork.recommended}): `)).trim()
      forkChoices[fork.id] = valid.includes(answer) ? answer : fork.recommended
    }

    const go = (await rl.question('\nGo? [Y/n], or type an adjustment: ')).trim()
    if (/^n(o)?$/i.test(go)) return { approved: false, forkChoices }
    const isPlainYes = go === '' || /^y(es)?$/i.test(go)
    return {
      approved: true,
      forkChoices,
      ...(isPlainYes ? {} : { adjustments: go }),
    }
  } finally {
    rl.close()
  }
}
