/**
 * Guard-railed execution: drive the Claude Agent SDK against the user's real
 * repo with execution permission-prompts OFF, wrapped so that (1) spend is
 * checked against the engine's budget every turn and the run winds down cleanly
 * at the ceiling, and (2) the diff is what gets graded (collected by the caller).
 *
 * The harness owns no trust logic here — it asks the engine `checkBudget`, and
 * also sets the SDK's own `maxBudgetUsd` as a hard backstop at the same ceiling.
 */
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Deliverable } from '../types.js'
import type { Engine } from '../engine/contract.js'
import { collectDiff } from './diff.js'
import { estimateCostUsd, pricingFor, type Usage } from './cost.js'

/** Tools the executor is allowed — the Agent SDK built-ins the spec names. */
const ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob']

export interface ExecuteInput {
  brief: string
  dir: string
  model: string
  engine: Engine
  runId: string
  budgetUsd: number
  /** Safety cap on agent turns. */
  maxTurns?: number
  /** Optional progress sink (defaults to stderr line writer). */
  onProgress?: (line: string) => void
}

export interface ExecutionResult {
  deliverable: Deliverable
  costUsd: number
  windedDown: boolean
  note?: string
}

export async function executeRun(input: ExecuteInput): Promise<ExecutionResult> {
  const { brief, dir, model, engine, runId, budgetUsd } = input
  const progress = input.onProgress ?? ((l: string) => process.stderr.write(l + '\n'))
  const pricing = pricingFor(model)
  const abort = new AbortController()

  let estimatedSpend = 0
  let authoritativeCost = 0
  let windedDown = false
  let note: string | undefined
  let finalSummary = ''
  let lastAssistantText = ''

  const q = query({
    prompt: brief,
    options: {
      cwd: dir,
      model,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      tools: ALLOWED_TOOLS,
      allowedTools: ALLOWED_TOOLS,
      maxTurns: input.maxTurns ?? 60,
      maxBudgetUsd: budgetUsd,
      abortController: abort,
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      stderr: () => {},
    },
  })

  try {
    for await (const message of q) {
      if (message.type === 'assistant') {
        // Accumulate any text the model surfaced (final one becomes the summary).
        const text = message.message.content
          .map((b) => (b.type === 'text' ? b.text : ''))
          .join('')
          .trim()
        if (text) {
          lastAssistantText = text
          progress(`· ${text.slice(0, 120)}${text.length > 120 ? '…' : ''}`)
        }

        // Estimate this turn's spend and gate on the engine's budget.
        const usage = message.message.usage as Usage
        const delta = estimateCostUsd(usage, pricing)
        estimatedSpend += delta
        await engine.recordSpend(runId, delta)
        const budget = await engine.checkBudget(runId)
        if (budget.stop) {
          windedDown = true
          note = `hit the budget ceiling ($${budget.limitUsd.toFixed(2)}) — wound down cleanly`
          progress(`⏹ ${note}`)
          await q.interrupt().catch(() => abort.abort())
          break
        }
      } else if (message.type === 'result') {
        authoritativeCost = message.total_cost_usd
        if (message.subtype === 'success') {
          finalSummary = message.result.trim()
        } else if (message.subtype === 'error_max_budget_usd') {
          windedDown = true
          note = note ?? 'hit the budget ceiling — wound down cleanly'
        } else {
          note = note ?? `execution ended: ${message.subtype}`
        }
      }
    }
  } catch (err) {
    // AbortError from a budget wind-down is expected; anything else is a note.
    const msg = (err as Error).message ?? String(err)
    if (!/abort/i.test(msg)) note = note ?? `execution error: ${msg}`
  }

  const { diff, filesChanged } = await collectDiff(dir)
  const summary = finalSummary || lastAssistantText || '(no summary produced)'
  const costUsd = authoritativeCost > 0 ? authoritativeCost : estimatedSpend

  return {
    deliverable: { diff, summary, filesChanged },
    costUsd,
    windedDown,
    ...(note ? { note } : {}),
  }
}
