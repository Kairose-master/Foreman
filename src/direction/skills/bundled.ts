/**
 * Locates Foreman's own bundled skills directory (the repo-root `skills/`
 * folder: research/, architecture/, security/) relative to this module's
 * own location, so callers (the CLI, Epic 2.12) don't need to hardcode or
 * guess a path. Works whether running from source (`src/direction/skills/
 * bundled.ts`, one level deeper than `src/cli.ts`) or from the compiled
 * output (`dist/direction/skills/bundled.js`), since `dist/` mirrors `src/`'s
 * directory structure exactly (tsconfig: rootDir "src", outDir "dist").
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/** Absolute path to the repo-root `skills/` directory bundled with Foreman. */
export function bundledSkillsDir(): string {
  return join(here, '..', '..', '..', 'skills')
}
