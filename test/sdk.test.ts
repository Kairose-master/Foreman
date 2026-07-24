import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  defineSkill,
  validateSkillManifest,
  validateSkillResponse,
  type SkillManifest,
} from '../src/sdk.js'

const here = dirname(fileURLToPath(import.meta.url))

const VALID_MANIFEST: SkillManifest = {
  id: 'performance-review',
  name: 'Performance Review',
  description: 'Hot-path latency, N+1 queries, and unbounded allocation concerns.',
  procedure: `You are the Performance specialist. Decide relevance first, then respond with ONLY JSON:
{ "relevant": true|false, "summary": "...", "concerns": [], "forks": [] }`,
}

describe('validateSkillManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(validateSkillManifest(VALID_MANIFEST)).toEqual({ ok: true })
  })

  it('rejects a missing id', () => {
    const result = validateSkillManifest({ ...VALID_MANIFEST, id: '' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.errors.some((e) => e.includes('"id"'))).toBe(true)
  })

  it('rejects an id that is not lowercase-hyphenated', () => {
    const result = validateSkillManifest({ ...VALID_MANIFEST, id: 'Performance_Review!' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.errors.some((e) => e.includes('lowercase, hyphenated'))).toBe(true)
  })

  it('rejects a missing name', () => {
    const result = validateSkillManifest({ ...VALID_MANIFEST, name: '' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.errors.some((e) => e.includes('"name"'))).toBe(true)
  })

  it('rejects a missing description', () => {
    const result = validateSkillManifest({ ...VALID_MANIFEST, description: '' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.errors.some((e) => e.includes('"description"'))).toBe(true)
  })

  it('rejects a multi-line description', () => {
    const result = validateSkillManifest({ ...VALID_MANIFEST, description: 'line one\nline two' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.errors.some((e) => e.includes('single line'))).toBe(true)
  })

  it('rejects a missing procedure', () => {
    const result = validateSkillManifest({ ...VALID_MANIFEST, procedure: '' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.errors.some((e) => e.includes('"procedure"'))).toBe(true)
  })

  it('reports every violation at once, not just the first', () => {
    const result = validateSkillManifest({ id: '', name: '', description: '', procedure: '' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.errors).toHaveLength(4)
  })
})

describe('defineSkill', () => {
  it('renders valid frontmatter + procedure for a well-formed manifest', () => {
    const md = defineSkill(VALID_MANIFEST)
    expect(md).toMatch(/^---\nid: performance-review\nname: Performance Review\ndescription: .*\n---\n\n/)
    expect(md).toContain('You are the Performance specialist')
  })

  it('throws with all validation errors listed when the manifest is invalid', () => {
    expect(() => defineSkill({ ...VALID_MANIFEST, id: '', name: '' })).toThrow(/"id".*"name"|"name".*"id"/s)
  })

  it('round-trips through the real discovery parser (frontmatter is readable back out)', async () => {
    const md = defineSkill(VALID_MANIFEST)
    // Reuse discovery's own frontmatter reader indirectly: write to a temp
    // dir and run LocalDirectoryProvider over it, proving defineSkill's
    // output is accepted by the actual discovery layer, not just "looks
    // like YAML" to the eye.
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
    const os = await import('node:os')
    const dir = await mkdtemp(join(os.tmpdir(), 'foreman-sdk-test-'))
    try {
      const pkgDir = join(dir, VALID_MANIFEST.id)
      await import('node:fs/promises').then((fs) => fs.mkdir(pkgDir))
      await writeFile(join(pkgDir, 'SKILL.md'), md)
      const { LocalDirectoryProvider } = await import('../src/direction/skills/discover.js')
      const provider = new LocalDirectoryProvider(dir)
      const found = await provider.list()
      expect(found).toHaveLength(1)
      expect(found[0]).toMatchObject({
        id: 'performance-review',
        name: 'Performance Review',
        description: VALID_MANIFEST.description,
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('quotes a description containing a colon so YAML parsing stays correct', () => {
    const manifest = { ...VALID_MANIFEST, description: 'Ratio: cost vs. latency tradeoffs' }
    const md = defineSkill(manifest)
    expect(md).toContain('description: "Ratio: cost vs. latency tradeoffs"')
  })
})

describe('validateSkillResponse', () => {
  it('accepts a well-formed relevant response', () => {
    const result = validateSkillResponse(
      JSON.stringify({ relevant: true, summary: 'applies', concerns: ['x'], forks: [] }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.value.relevant).toBe(true)
    expect(result.value.summary).toBe('applies')
  })

  it('accepts a well-formed not-relevant response with empty arrays', () => {
    const result = validateSkillResponse(JSON.stringify({ relevant: false, summary: 'n/a', concerns: [], forks: [] }))
    expect(result.ok).toBe(true)
  })

  it('accepts a fenced ```json response', () => {
    const result = validateSkillResponse('```json\n' + JSON.stringify({ relevant: true }) + '\n```')
    expect(result.ok).toBe(true)
  })

  it('rejects non-JSON with a descriptive error', () => {
    const result = validateSkillResponse('sure, sounds fine')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toContain('not valid JSON')
  })

  it('rejects JSON missing the required "relevant" field', () => {
    const result = validateSkillResponse(JSON.stringify({ summary: 'no relevant field' }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toContain('relevant')
  })

  it('rejects a JSON array (valid JSON, wrong top-level shape)', () => {
    const result = validateSkillResponse(JSON.stringify([1, 2, 3]))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toContain('object')
  })

  it('drops a fork with fewer than two options, without failing the whole response', () => {
    const result = validateSkillResponse(
      JSON.stringify({
        relevant: true,
        summary: 's',
        concerns: [],
        forks: [{ id: 'f1', question: 'q', options: [{ id: 'a', label: 'A', tradeoff: 't' }], recommended: 'a' }],
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.value.forks).toHaveLength(0)
  })
})

describe('SDK public surface constraints', () => {
  const src = readFileSync(join(here, '../src/sdk.ts'), 'utf8')

  it('does not import the Planner, the Skill Runner, or any provider implementation', () => {
    expect(src).not.toContain("from './direction/skills/planner.js'")
    expect(src).not.toContain("from './direction/skills/run-skill.js'")
    expect(src).not.toContain("from './direction/skills/discover.js'")
    expect(src).not.toContain("from './direction/skills/match.js'")
    expect(src).not.toContain("from './direction/skills/synthesize.js'")
  })
})
