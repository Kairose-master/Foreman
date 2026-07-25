#!/usr/bin/env node
/**
 * Foreman CLI. Parse args, pick the engine, run the loop, print the report.
 */
import { ArgError, HELP, envDefaults, parseArgs } from './config.js'
import { createEngine } from './engine/index.js'
import { run } from './foreman.js'
import { printReport } from './interaction/report.js'
import { hasCredentials } from './llm.js'
import { dispatchSubcommand, SUBCOMMANDS, SUBCOMMAND_HELP } from './cli/router.js'

/**
 * Finish with an exit code WITHOUT calling process.exit().
 *
 * process.exit() tears the event loop down synchronously. If a threadpool op is
 * still completing (DNS/TLS from the Claude call, an fs read from repo-context),
 * its completion tries to signal an async handle that is already closing, and
 * libuv aborts — on Windows that surfaces as
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\\win\\async.c`
 * *after* the run has already printed its result. Setting exitCode instead lets
 * those handles close cleanly.
 *
 * The unref'd timer is a bounded backstop: if something (an idle keep-alive
 * socket) still holds the loop open, force the exit shortly after — by then the
 * in-flight teardown that triggered the assertion has finished. Because it's
 * unref'd, it never keeps the process alive on its own, so a clean run still
 * exits immediately.
 */
function finish(code: number): void {
  process.exitCode = code
  setTimeout(() => process.exit(code), EXIT_GRACE_MS).unref()
}

const EXIT_GRACE_MS = 500

function fail(message: string, code: number): void {
  process.stderr.write(message + '\n')
  finish(code)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(HELP + '\n' + SUBCOMMAND_HELP)
    finish(argv.length === 0 ? 1 : 0)
    return
  }

  // Epic 2.12: `skills`, `plan`, `inspect` are subcommands of the
  // skills-only direction pipeline, dispatched separately from the
  // existing full-run `foreman "<goal>"` behavior below, which is
  // completely unchanged for every other invocation.
  if (SUBCOMMANDS.includes(argv[0] as (typeof SUBCOMMANDS)[number])) {
    const code = await dispatchSubcommand(argv)
    finish(code)
    return
  }

  let config
  try {
    config = parseArgs(argv, envDefaults())
  } catch (err) {
    if (err instanceof ArgError) {
      fail(`foreman: ${err.message}`, 2)
      return
    }
    throw err
  }

  if (!hasCredentials()) {
    fail('foreman: needs Claude credentials — set ANTHROPIC_API_KEY (or run `ant auth login`).', 2)
    return
  }

  const engine = createEngine(config)
  const report = await run(config, engine)
  printReport(report)

  // Exit non-zero only on a genuine failure/error; a pass, a dry run, or a
  // user cancellation are all "worked as intended".
  const ok = report.status === 'passed' || report.status === 'dry-run' || report.status === 'cancelled'
  finish(ok ? 0 : 1)
}

main().catch((err) => {
  process.stderr.write(`foreman: ${(err as Error).stack ?? err}\n`)
  finish(1)
})
