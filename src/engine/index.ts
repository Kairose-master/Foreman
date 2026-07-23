/**
 * Engine factory: pick the trust engine that backs the harness. Everything the
 * harness needs lives behind the `Engine` interface (contract.ts).
 */
import type { Config } from '../config.js'
import type { Engine } from './contract.js'
import { LocalEngine } from './local.js'
import { LedgermindEngine } from './ledgermind.js'

export type { Engine } from './contract.js'

export function createEngine(config: Config, env: NodeJS.ProcessEnv = process.env): Engine {
  const common = {
    model: config.model,
    oracleKey: env.FOREMAN_ORACLE_KEY,
  }
  if (config.engine === 'ledgermind') {
    return new LedgermindEngine({
      ...common,
      ledgermindUrl: env.LEDGERMIND_URL,
      gradeUrl: env.FOREMAN_LEDGERMIND_GRADE_URL,
    })
  }
  return new LocalEngine(common)
}
