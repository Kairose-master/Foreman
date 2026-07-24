import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { filterCandidates } from '../src/direction/skills/match.js'
import type { SkillDescriptor } from '../src/direction/skills/discover.js'

const here = dirname(fileURLToPath(import.meta.url))

function skill(id: string, name: string, description: string): SkillDescriptor {
  return { id, name, description, path: `/fixtures/${id}` }
}

describe('filterCandidates', () => {
  it('excludes a skill with zero token overlap against the goal', () => {
    const skills = [skill('memes', 'Meme Generator', 'find and caption funny images')]
    expect(filterCandidates('add rate limiting to the API', skills)).toEqual([])
  })

  it('includes a skill via direct token overlap', () => {
    const skills = [skill('perf', 'Performance Review', 'hot paths, blocking calls, complexity')]
    expect(filterCandidates('reduce blocking calls in the request path', skills)).toEqual(skills)
  })

  it('includes a skill via substring/morphological containment', () => {
    const skills = [skill('sec', 'Security Review', 'auth, input validation, secrets')]
    // goal token "authentication" contains descriptor token "auth"
    expect(filterCandidates('review the authentication flow', skills)).toEqual(skills)
  })

  it('returns every skill when the goal yields no usable tokens', () => {
    const skills = [
      skill('a', 'A', 'aaa bbb ccc'),
      skill('b', 'B', 'ddd eee fff'),
    ]
    // entirely stopwords / too-short tokens
    expect(filterCandidates('the of it', skills)).toEqual(skills)
  })

  it('returns [] for an empty skill list', () => {
    expect(filterCandidates('add rate limiting', [])).toEqual([])
  })

  it('retains matches and excludes non-matches within one mixed call', () => {
    const relevant = skill('perf', 'Performance Review', 'hot paths and blocking calls')
    const irrelevant = skill('memes', 'Meme Generator', 'find and caption funny images')
    const result = filterCandidates('fix a blocking call in the hot path', [relevant, irrelevant])
    expect(result).toEqual([relevant])
  })

  it('matches case-insensitively', () => {
    const skills = [skill('sec', 'SECURITY REVIEW', 'AUTH and SECRETS handling')]
    expect(filterCandidates('check the auth flow', skills)).toEqual(skills)
  })
})

describe('match.ts constraints', () => {
  const src = readFileSync(join(here, '../src/direction/skills/match.ts'), 'utf8')

  it('never references a named specialist domain in its own source', () => {
    const forbidden = ['security', 'research', 'ux', 'performance', 'documentation', 'architecture']
    for (const word of forbidden) {
      expect(src.toLowerCase()).not.toContain(word)
    }
  })

  it('never imports the model-calling seam — mechanical proof of zero model calls', () => {
    expect(src).not.toContain("from '../../llm.js'")
    expect(src).not.toContain('complete(')
  })
})
