/**
 * Provider composition (Epic 2.11, external skill loading).
 *
 * `docs/SKILL_CONTRACT.md` already designs `SkillProvider` for plurality
 * ("bundled", "local directory", "git", "remote registry" — expected to
 * multiply over time) but, until this file, nothing actually merged more
 * than one. This is that merge, expressed as one more `SkillProvider`
 * implementation — `CompositeSkillProvider` satisfies the exact same
 * single-method interface every other provider does, so the Planner (and
 * anything else downstream) needs ZERO changes to accept a composed set of
 * providers instead of a single one. No provider-specific branch is added
 * anywhere outside this file.
 *
 * Two concerns this file owns, kept explicit rather than left ambiguous:
 *
 * 1. **Duplicate skill ids.** When two providers each define a skill with
 *    the same `id`, one policy applies, chosen once and documented here
 *    (see `DuplicateIdPolicy`) — never silently guessed per-call. Default:
 *    `'reject'` — see the rationale below.
 *
 * 2. **A provider's `list()` call itself failing** (the directory doesn't
 *    exist, a permissions error, etc — distinct from one malformed package
 *    inside an otherwise-working directory, which `LocalDirectoryProvider`
 *    already silently excludes on its own, unchanged by this file). By
 *    default, one failing provider does not prevent the others' skills from
 *    being returned — it is disclosed as a diagnostic, not thrown. Passing
 *    `strict: true` changes that: any provider failure throws, surfacing
 *    the problem immediately instead of silently returning a partial list.
 */
import type { SkillDescriptor, SkillProvider } from './discover.js'

/** One provider participating in composition, labeled with a stable source
 * name used both for `SkillDescriptor.source` attribution and diagnostics. */
export interface ProviderEntry {
  provider: SkillProvider
  /** A short, stable label, e.g. "bundled" or "external:/path/to/skills". */
  source: string
}

/**
 * How a duplicate skill id across providers is resolved. Chosen once, not
 * per-call: default is `'reject'`.
 *
 * `'reject'` (the default) excludes BOTH (all) definitions of a colliding
 * id from the merged result entirely, and records a diagnostic explaining
 * why. This is the safest option: it never silently picks a winner between
 * two skill packages that might have materially different procedures, and
 * it matches this project's existing standing position (see the
 * Synthesizer's own contract) that conflicts are disclosed, not resolved
 * for the caller. A missing skill is loud and debuggable; a silently
 * shadowed one is not.
 *
 * `'first-wins'` keeps the first-encountered definition (in provider-entry
 * order, i.e. the order the caller passed to `CompositeSkillProvider`) and
 * discards the rest. Useful when a caller deliberately orders trusted
 * providers (e.g. bundled) ahead of less-trusted ones and wants bundled
 * skills to always take precedence over an external skill that happens to
 * reuse the same id.
 *
 * `'last-wins'` is the mirror of `'first-wins'` — useful when a caller
 * wants a later-listed provider (e.g. a user's local override directory) to
 * intentionally supersede an earlier one.
 */
export type DuplicateIdPolicy = 'reject' | 'first-wins' | 'last-wins'

export interface ComposeOptions {
  /** Default: `'reject'`. */
  duplicatePolicy?: DuplicateIdPolicy
  /** Default: `false`. When true, a provider's `list()` rejecting throws
   * out of composition instead of being disclosed as a diagnostic. */
  strict?: boolean
}

export interface ProviderDiagnostic {
  /** The source label(s) involved. */
  source: string
  kind: 'provider-failed' | 'duplicate-id'
  message: string
}

export interface ComposedResult {
  skills: SkillDescriptor[]
  diagnostics: ProviderDiagnostic[]
}

/**
 * Composes multiple `SkillProvider`s into one. Implements `SkillProvider`
 * itself — the Planner (or any other consumer) holds this exactly like any
 * single provider; it has no idea composition happened underneath.
 */
export class CompositeSkillProvider implements SkillProvider {
  constructor(
    private readonly entries: ProviderEntry[],
    private readonly options: ComposeOptions = {},
  ) {}

  /**
   * The rich result: merged skills plus every diagnostic (provider
   * failures, duplicate-id resolutions) generated while composing. Use this
   * form when diagnostics matter (e.g. `foreman skills list`/`validate` in
   * Epic 2.12). `list()` below is the narrow `SkillProvider`-compatible
   * form that just discards diagnostics.
   */
  async listDetailed(): Promise<ComposedResult> {
    const policy = this.options.duplicatePolicy ?? 'reject'
    const strict = this.options.strict ?? false
    const diagnostics: ProviderDiagnostic[] = []

    // 1. Collect each provider's own skills, attributing `source`. Order
    // preserved (deterministic merge order = the order entries were given).
    const perProvider: { source: string; skills: SkillDescriptor[] }[] = []
    for (const entry of this.entries) {
      let skills: SkillDescriptor[]
      try {
        skills = await entry.provider.list()
      } catch (err) {
        const message = `provider "${entry.source}" failed: ${(err as Error).message}`
        if (strict) throw new Error(message)
        diagnostics.push({ source: entry.source, kind: 'provider-failed', message })
        continue
      }
      perProvider.push({
        source: entry.source,
        skills: skills.map((s) => ({ ...s, source: entry.source })),
      })
    }

    // 2. Group by id, preserving first-seen order for determinism.
    const byId = new Map<string, SkillDescriptor[]>()
    for (const { skills } of perProvider) {
      for (const s of skills) {
        const bucket = byId.get(s.id) ?? []
        bucket.push(s)
        byId.set(s.id, bucket)
      }
    }

    // 3. Apply the duplicate-id policy.
    const merged: SkillDescriptor[] = []
    for (const [id, candidates] of byId) {
      if (candidates.length === 1) {
        merged.push(candidates[0]!)
        continue
      }
      const sources = candidates.map((c) => c.source).join(', ')
      if (policy === 'reject') {
        diagnostics.push({
          source: sources,
          kind: 'duplicate-id',
          message: `skill id "${id}" was defined by multiple providers (${sources}) — rejected, excluded from results (duplicatePolicy: reject)`,
        })
        continue
      }
      const kept = policy === 'first-wins' ? candidates[0]! : candidates[candidates.length - 1]!
      merged.push(kept)
      diagnostics.push({
        source: sources,
        kind: 'duplicate-id',
        message: `skill id "${id}" was defined by multiple providers (${sources}) — kept "${kept.source}" (duplicatePolicy: ${policy})`,
      })
    }

    return { skills: merged, diagnostics }
  }

  /** SkillProvider-compatible: merged skills only, diagnostics discarded.
   * Use `listDetailed()` when diagnostics are needed. */
  async list(): Promise<SkillDescriptor[]> {
    const { skills } = await this.listDetailed()
    return skills
  }
}
