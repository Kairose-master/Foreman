# ADR-0001: Architecture Hardening (Epic 2.9)

## Status

Accepted.

## Context

After Epic 2.8 (conflict-aware synthesis), a dedicated architecture review of
`src/direction/skills/` identified five recurring risks, ranked by observed
or projected maintenance cost:

1. **No direction-phase budget governance.** Zero budget/cost code anywhere
   in `src/direction/skills/`. The Planner dispatches every matched
   candidate via a bare `Promise.all`, with no cap. At today's 3 bundled
   skills this is harmless; it stops being harmless once a skill library
   grows toward the scale this project is designing for (Epic 2.11 explicitly
   introduces external, third-party-authored skills).
2. **Hardcoded per-call-site `maxTokens` literals**, no shared policy.
   (`run-skill.ts`: 1024, `synthesize.ts`: 512, `propose.ts`: 2048,
   `engine/local.ts`: 512.) This has already caused two *reproduced* live
   truncation failures: the Architecture skill in Epic 2.5's live dogfood
   run, and the Security skill in Epic 2.8's adversarial live run. Both
   surfaced correctly as `unparseable` (the contract worked as designed),
   but the underlying ceiling itself is not evidence-based or centrally
   owned.
3. **O(n²) mechanical clustering over-merges** in `synthesize.ts`
   (`sharedTokenCount` pairwise comparison, fixed `CLUSTER_THRESHOLD = 2`).
   Already observed live in Epic 2.8's standard 3-skill run: 6 forks from 3
   specialists collapsed into a single DecisionGroup on a dense-vocabulary
   topic.
4. **`SkillProvider` is designed for plurality** (`docs/SKILL_CONTRACT.md`
   explicitly anticipates multiple providers: local, bundled, git, registry)
   **but the only consumer, `runPlanner`, accepts a single `provider:
   SkillProvider`.** No provider-merge or duplicate-id-resolution code exists
   anywhere.
5. **Duplicated "strip fence → JSON.parse → validate" logic**, hand-copied
   at four call sites (`propose.ts`, `run-skill.ts`, `synthesize.ts`,
   `engine/grading.ts`), plus a duplicated tokenizer/stopword list between
   `match.ts` and `synthesize.ts`.

Epic 2.9's charter is narrow: fix only what is correctness-required, needed
as a direct prerequisite for an already-planned upcoming epic, or already
causing reproduced failures. Everything else is disclosed as deferred debt,
not silently dropped and not spontaneously over-engineered.

## Decision

### Fixed now (this Epic)

**Fix A — Concurrency ceiling (`src/direction/skills/concurrency.ts`,
`mapLimit`).** Addresses risk #1, narrowly. `runPlanner`'s step 4 now runs
candidates through a bounded-concurrency map (`mapLimit`, default limit
`DEFAULT_SKILL_CONCURRENCY = 5`) instead of an unbounded `Promise.all`. This
is deliberately *only* a concurrency cap — a plain scheduling primitive, not
a cost ledger, budget tracker, or spend-aware gate. It prevents an
unboundedly wide fan-out of concurrent model calls once the skill library
grows past a handful of entries; it does **not** attempt to estimate or cap
dollar cost.

The limit of 5 is a conservative ceiling chosen to be comfortably above
today's 3-bundled-skill library (so no behavior changes today — confirmed by
the full test suite passing unchanged) while still bounding worst-case
fan-out once Epic 2.11 (external skill loading) makes larger libraries
routine. It is not derived from any load-testing or cost model; it is an
engineering judgment call, disclosed as such, and callable with a different
value via `runPlanner`'s new optional `concurrency` parameter.

**Real budget governance — tracking dollar cost, enforcing a spend ceiling,
or integrating with the existing Engine budget contract
(`src/engine/contract.ts`) — is explicitly NOT done here.** That is a
separate, real design question this Epic does not resolve: does
direction-phase spend draw from the same budget ceiling as execution-phase
spend, or a distinct one? Today's Engine budget contract only covers
execution. Answering this requires a deliberate decision, not a
Promise.all-swap. **Deferred — see "Deferred" below.**

**Fix B — Shared fenced-JSON parsing primitive
(`src/direction/skills/json-response.ts`, `parseFencedJson`).** Addresses
half of risk #5. Extracts only the mechanical "strip a ```json fence, then
`JSON.parse`" step — never the shape-specific validation, which stays local
to each caller, because a proposal, a skill result, and a relationship each
validate a genuinely different shape. Migrated three call sites:

- `src/direction/propose.ts` (`parseProposal`) — preserves its existing
  throw-on-invalid contract (distinct error messages for "not JSON" vs.
  "not an object" retained).
- `src/direction/skills/run-skill.ts` (`parseSkillResponse`) — preserves its
  existing return-null-on-invalid contract.
- `src/direction/skills/synthesize.ts` (`parseRelationshipResponse`) —
  preserves its existing return-null-on-invalid contract.

`src/engine/grading.ts` is **explicitly NOT migrated** in this Epic — it is
an execution-phase file outside `src/direction/skills/`'s scope, and no
upcoming Epic (2.10–2.13) depends on it changing. Migrating it is safe,
low-priority follow-up debt, not a hardening requirement.

### Deferred (not fixed in this Epic, with reasons)

- **Risk #1, the budget-ledger half.** A concurrency cap (Fix A) bounds
  fan-out width; it does not track or limit dollar spend. Whether
  direction-phase spend should share the Engine's execution budget or use
  its own ceiling is an open design question, not resolved here. Tracked as
  follow-up work; not blocking Epics 2.10–2.13, none of which require a
  spend ceiling to function correctly.
- **Risk #2, the `maxTokens` ceiling values themselves.** The two reproduced
  truncations are real, but *changing* the ceiling numbers is a judgment
  call about token economics (cost vs. truncation risk) this Epic was not
  asked to make, and doing so without real usage data risks trading a known,
  correctly-disclosed failure mode (`unparseable`) for a new, unevaluated
  cost increase. Centralizing the *values themselves* into one shared
  constants module (as opposed to just the parsing logic, which Fix B
  covers) is left as explicit future debt.
- **Risk #3, clustering over-merge.** Confirmed real via a live run, but a
  correct fix needs a real algorithm-design pass (e.g., a
  group-size-normalized threshold, or bounding cluster diameter, not just a
  bigger magic number) — that is its own epic-sized piece of work, not a
  hardening-pass patch. Does not block Epics 2.10–2.13 (none of which depend
  on clustering precision). Deferred as documented, disclosed debt.
- **Risk #4, single-provider Planner wiring.** This is a genuine
  prerequisite — but for Epic 2.11 specifically, whose task list already
  covers multi-provider composition and an explicit duplicate-id policy.
  Building it early, inside 2.9, would be scope creep into 2.11's own job.
  Noted here, resolved there.
- **Tokenizer/stopword duplication** between `match.ts` and `synthesize.ts`
  (the other half of risk #5). `match.ts`'s filter is deliberately biased
  toward inclusion (false positives) and `synthesize.ts`'s clustering is
  deliberately biased against over-merging (the opposite bias) — sharing one
  tokenizer risks accidentally coupling two thresholds that must stay
  independently tunable. Left duplicated, disclosed as debt, not merged
  reflexively.

## Consequences

- `runPlanner`'s signature gained one new optional parameter
  (`concurrency: number = DEFAULT_SKILL_CONCURRENCY`), fully
  backward-compatible — every existing call site and test continues to work
  unchanged.
- No SkillResult, SkillFinding, DecisionGroup, or Relationship type changed
  shape. No specialist-specific logic was added anywhere. No conflict was
  silently resolved.
- Full test suite (127 tests, 17 files) passes; `tsc --noEmit` is clean.
- The one intermittent flake in `test/planner.test.ts` ("runs candidates
  concurrently, not sequentially") reproduced once during this Epic's test
  runs (elapsed 108ms against a 108ms threshold) and passed cleanly on
  immediate rerun — consistent with its pre-existing, previously-documented
  wall-clock margin flakiness (known since Epic 2.3B), not a regression
  introduced by `mapLimit`. Not fixed in this Epic; loosening or replacing
  this test's timing assertion remains open follow-up work.

## Non-goals of this Epic

- Building a cost/budget ledger for the direction phase.
- Changing any `maxTokens` numeric value.
- Redesigning the clustering algorithm.
- Implementing multi-provider composition (that is Epic 2.11's job).
- Migrating `src/engine/grading.ts` to the shared JSON-parsing primitive.
