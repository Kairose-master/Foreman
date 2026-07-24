/**
 * Shared "strip a code fence, then JSON.parse" primitive (Epic 2.9
 * hardening, docs/ADR-0001-architecture-hardening.md).
 *
 * Before this file, four call sites (src/direction/propose.ts,
 * src/direction/skills/run-skill.ts, src/direction/skills/synthesize.ts,
 * src/engine/grading.ts) each hand-duplicated the identical fence-strip +
 * JSON.parse block. This extracts only that shared, mechanical parsing step
 * — never the shape-specific validation logic, which stays local to each
 * caller (a proposal, a skill result, a relationship, and a grade verdict
 * each validate genuinely different shapes, and forcing them through one
 * shared validator would be exactly the kind of premature, over-general
 * abstraction this project avoids).
 *
 * `src/engine/grading.ts` is NOT modified in this Epic — it belongs to the
 * execution-phase engine seam, not the direction-phase skills layer this
 * hardening pass is scoped to, and touching it isn't required for Epics
 * 2.10-2.13. Only the three direction-phase call sites are migrated.
 */

/**
 * Strip a leading/trailing ```json fence (or bare ```), then JSON.parse.
 * Returns null (never throws) on anything that isn't parseable JSON — the
 * caller decides what an unparseable response means for its own contract.
 */
export function parseFencedJson(raw: string): unknown | null {
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
