/**
 * The involvement dial (docs/INTERACTION.md). The dial only ever changes how
 * many *direction* check-ins happen — it never turns execution permission
 * prompts back on. All pure, so the whole interaction contract is unit-tested.
 *
 *   light     → show the approach once, ask no forks (auto-pick recommended)
 *   normal    → ask only the shape-changing forks
 *   hands-on  → ask every fork
 */
import type { Approach, Dial, Fork } from '../types.js'

/** Which forks Foreman stops to ask about, given the dial. */
export function forksToSurface(approach: Approach, dial: Dial): Fork[] {
  switch (dial) {
    case 'light':
      return []
    case 'normal':
      return approach.forks.filter((f) => f.shapeChanging)
    case 'hands-on':
      return approach.forks
  }
}

/** The default choice for every fork: the planner's recommendation. */
export function defaultChoices(approach: Approach): Record<string, string> {
  const out: Record<string, string> = {}
  for (const fork of approach.forks) out[fork.id] = fork.recommended
  return out
}

/**
 * Merge the user's answers over the defaults. Any fork not surfaced (or not
 * answered) falls back to its recommended option — so a light-mode run still
 * has a concrete choice for every fork.
 */
export function resolveForkChoices(
  approach: Approach,
  userChoices: Record<string, string>,
): Record<string, string> {
  const resolved = defaultChoices(approach)
  for (const fork of approach.forks) {
    const picked = userChoices[fork.id]
    if (picked && fork.options.some((o) => o.id === picked)) {
      resolved[fork.id] = picked
    }
  }
  return resolved
}

/** Human-readable label of the chosen option for a fork (for the brief/report). */
export function chosenOptionLabel(fork: Fork, choices: Record<string, string>): string {
  const id = choices[fork.id] ?? fork.recommended
  const opt = fork.options.find((o) => o.id === id)
  return opt ? opt.label : id
}
