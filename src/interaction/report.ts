/**
 * The final report. Honest, not hidden: a failure surfaces the truth (what
 * couldn't pass, how far it got, what it cost) rather than dressing up a
 * near-miss as done (docs/INTERACTION.md, "Failure is honest, not hidden").
 *
 * `formatReport` is pure so the shape is unit-tested.
 */
import type { RunReport } from '../types.js'

function money(n: number): string {
  return `$${n.toFixed(2)}`
}

export function formatReport(report: RunReport): string {
  const lines: string[] = []
  const cost = `${money(report.costUsd)} of ${money(report.budgetUsd)}`

  switch (report.status) {
    case 'dry-run':
      lines.push('◇ Dry run — proposal only, nothing executed.')
      break
    case 'cancelled':
      lines.push('✕ Cancelled — no changes made.')
      if (report.note) lines.push(`  ${report.note}`)
      break
    case 'error':
      lines.push('✕ Error.')
      if (report.note) lines.push(`  ${report.note}`)
      lines.push(`  Cost: ${cost}`)
      break
    case 'passed': {
      lines.push('✓ Done. Passed the independent grade.')
      const d = report.deliverable
      if (d) lines.push(`  • ${d.filesChanged} file${d.filesChanged === 1 ? '' : 's'} changed`)
      lines.push(`  • cost: ${cost}`)
      if (report.grade) lines.push(`  • grade: ${report.grade.reason}`)
      if (report.proof) {
        const signed = report.proof.signature ? 'signed' : 'hash-only'
        lines.push(`  • proof: ${report.proof.id} (${signed}, ${report.proof.schema})`)
      }
      break
    }
    case 'failed': {
      lines.push("✕ Couldn't hand this back as done — it didn't pass the independent grade.")
      if (report.grade) lines.push(`  • why: ${report.grade.reason}`)
      const d = report.deliverable
      if (d) lines.push(`  • got as far as: ${d.filesChanged} file${d.filesChanged === 1 ? '' : 's'} changed`)
      lines.push(`  • cost: ${cost}`)
      if (report.windedDown) lines.push('  • note: hit the budget ceiling and wound down before it was done')
      if (report.note) lines.push(`  • note: ${report.note}`)
      lines.push('  Raise the budget or change the approach and try again.')
      break
    }
  }
  return lines.join('\n')
}

export function printReport(report: RunReport): void {
  process.stdout.write('\n' + formatReport(report) + '\n')
}
