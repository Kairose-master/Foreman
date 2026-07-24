#!/usr/bin/env -S npx tsx
/**
 * Regenerates this directory's SKILL.md from `manifest.ts`, using ONLY the
 * public SDK surface (`defineSkill` from `../../src/sdk.js` — a real
 * external author would depend on the published package and import from its
 * public `foreman/sdk` entry point instead of a relative path; the surface
 * used is identical either way).
 *
 * This is the proof artifact for Epic 2.10's requirement: "at least one
 * example external-style Skill built using only the public SDK surface."
 * Neither this script nor manifest.ts imports anything from
 * `src/direction/skills/*` (planner/runner/discovery internals) — only
 * `src/sdk.ts`'s exports (verified by test/sdk-example.test.ts).
 *
 * Run: npx tsx examples/sdk-authored-skill/generate.ts
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { defineSkill } from '../../src/sdk.js'
import { manifest } from './manifest.js'

const here = dirname(fileURLToPath(import.meta.url))

const skillMd = defineSkill(manifest)
await writeFile(join(here, 'SKILL.md'), skillMd)
process.stdout.write(`wrote ${join(here, 'SKILL.md')} (${skillMd.length} bytes)\n`)
