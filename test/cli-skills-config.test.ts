import { describe, it, expect } from 'vitest'
import { parseSkillsFlags, CliArgError } from '../src/cli/skills-config.js'

describe('parseSkillsFlags', () => {
  it('applies sane defaults with no flags', () => {
    const { config, positionals } = parseSkillsFlags([])
    expect(config.includeBundled).toBe(true)
    expect(config.externalSkillPaths).toEqual([])
    expect(config.duplicatePolicy).toBe('reject')
    expect(config.strict).toBe(false)
    expect(config.json).toBe(false)
    expect(positionals).toEqual([])
  })

  it('collects positionals (a goal) separately from flags', () => {
    const { positionals } = parseSkillsFlags(['add', 'rate', 'limiting', '--json'])
    expect(positionals).toEqual(['add', 'rate', 'limiting'])
  })

  it('parses --skills-path, repeatable', () => {
    const { config } = parseSkillsFlags(['--skills-path', '/a', '--skills-path', '/b'])
    expect(config.externalSkillPaths).toEqual(['/a', '/b'])
  })

  it('parses --no-bundled', () => {
    const { config } = parseSkillsFlags(['--no-bundled'])
    expect(config.includeBundled).toBe(false)
  })

  it('parses --duplicate-policy', () => {
    const { config } = parseSkillsFlags(['--duplicate-policy', 'first-wins'])
    expect(config.duplicatePolicy).toBe('first-wins')
  })

  it('rejects an invalid --duplicate-policy value', () => {
    expect(() => parseSkillsFlags(['--duplicate-policy', 'bogus'])).toThrow(CliArgError)
  })

  it('parses --strict and --json', () => {
    const { config } = parseSkillsFlags(['--strict', '--json'])
    expect(config.strict).toBe(true)
    expect(config.json).toBe(true)
  })

  it('parses --dir/-C and --model', () => {
    const { config } = parseSkillsFlags(['--dir', '/repo', '--model', 'claude-haiku-4-5'])
    expect(config.dir).toBe('/repo')
    expect(config.model).toBe('claude-haiku-4-5')
  })

  it('throws a descriptive error for an unknown flag', () => {
    expect(() => parseSkillsFlags(['--nope'])).toThrow(/unknown flag: --nope/)
  })

  it('throws when a value-taking flag is missing its value', () => {
    expect(() => parseSkillsFlags(['--skills-path'])).toThrow(CliArgError)
  })

  it('applies env-supplied external skill paths as defaults, overridable by explicit flags', () => {
    const { config } = parseSkillsFlags(['--skills-path', '/explicit'], ['/from-env'])
    expect(config.externalSkillPaths).toEqual(['/from-env', '/explicit'])
  })
})
