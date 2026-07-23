#!/usr/bin/env node
/**
 * Foreman CLI. Parse args, pick the engine, run the loop, print the report.
 */
import { ArgError, HELP, envDefaults, parseArgs } from './config.js'
import { createEngine } from './engine/index.js'
import { run } from './foreman.js'
import { printReport } from './interaction/report.js'
import { hasCredentials } from './llm.js'

function fail(message: string, code: number): never {
  process.stderr.write(message + '\n')
  process.exit(code)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(HELP)
    process.exit(argv.length === 0 ? 1 : 0)
  }

  let config
  try {
    config = parseArgs(argv, envDefaults())
  } catch (err) {
    if (err instanceof ArgError) fail(`foreman: ${err.message}`, 2)
    throw err
  }

  if (!hasCredentials()) {
    fail('foreman: needs Claude credentials — set ANTHROPIC_API_KEY (or run `ant auth login`).', 2)
  }

  const engine = createEngine(config)
  const report = await run(config, engine)
  printReport(report)

  // Exit non-zero only on a genuine failure/error; a pass, a dry run, or a
  // user cancellation are all "worked as intended".
  const ok = report.status === 'passed' || report.status === 'dry-run' || report.status === 'cancelled'
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  process.stderr.write(`foreman: ${(err as Error).stack ?? err}\n`)
  process.exit(1)
})
