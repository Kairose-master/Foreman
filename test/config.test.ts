import { describe, it, expect } from 'vitest'
import { parseArgs, envDefaults, ArgError, DEFAULT_BUDGET_USD, DEFAULT_DIAL } from '../src/config.js'

describe('parseArgs', () => {
  it('takes the goal from positionals and applies defaults', () => {
    const c = parseArgs(['add', 'rate', 'limiting'])
    expect(c.goal).toBe('add rate limiting')
    expect(c.budgetUsd).toBe(DEFAULT_BUDGET_USD)
    expect(c.dial).toBe(DEFAULT_DIAL)
    expect(c.engine).toBe('local')
    expect(c.yes).toBe(false)
    expect(c.dryRun).toBe(false)
  })

  it('parses flags', () => {
    const c = parseArgs(['fix bug', '--dir', '/repo', '--budget', '1.25', '--dial', 'hands-on', '--yes', '--dry-run', '--engine', 'ledgermind'])
    expect(c.dir).toBe('/repo')
    expect(c.budgetUsd).toBe(1.25)
    expect(c.dial).toBe('hands-on')
    expect(c.yes).toBe(true)
    expect(c.dryRun).toBe(true)
    expect(c.engine).toBe('ledgermind')
    expect(c.goal).toBe('fix bug')
  })

  it('defaults executor-model to --model when only --model is given', () => {
    const c = parseArgs(['g', '--model', 'claude-sonnet-5'])
    expect(c.model).toBe('claude-sonnet-5')
    expect(c.executorModel).toBe('claude-sonnet-5')
  })

  it('keeps an explicit --executor-model distinct', () => {
    const c = parseArgs(['g', '--model', 'claude-opus-4-8', '--executor-model', 'claude-haiku-4-5'])
    expect(c.model).toBe('claude-opus-4-8')
    expect(c.executorModel).toBe('claude-haiku-4-5')
  })

  it('requires a goal', () => {
    expect(() => parseArgs(['--dir', '/x'])).toThrow(ArgError)
  })

  it('rejects a bad budget', () => {
    expect(() => parseArgs(['g', '--budget', 'free'])).toThrow(ArgError)
    expect(() => parseArgs(['g', '--budget', '-1'])).toThrow(ArgError)
  })

  it('rejects a bad dial and unknown flags', () => {
    expect(() => parseArgs(['g', '--dial', 'loud'])).toThrow(ArgError)
    expect(() => parseArgs(['g', '--nope'])).toThrow(ArgError)
  })

  it('reads env defaults but flags win', () => {
    const defaults = envDefaults({ FOREMAN_BUDGET_USD: '2', FOREMAN_DIAL: 'light', FOREMAN_ENGINE: 'ledgermind' } as NodeJS.ProcessEnv)
    expect(defaults.budgetUsd).toBe(2)
    const c = parseArgs(['g', '--budget', '3'], defaults)
    expect(c.budgetUsd).toBe(3)
    expect(c.dial).toBe('light')
    expect(c.engine).toBe('ledgermind')
  })
})
