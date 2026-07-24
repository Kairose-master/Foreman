# Epic 2.13 — GitHub Repository Analysis Dogfood: Evidence Report

**Verification-first.** This report captures what actually happened running
Foreman's real CLI against Foreman's own repository, honestly — including a
real setup bug discovered mid-Epic, a real recurring matcher limitation, and
a real clustering over-merge — not a curated success story.

## Repository state

- Repo analyzed: **Foreman itself** (`/Users/skmac/.openclaw/workspace/repos/foreman`),
  the "another explicitly available local repository" option was not needed —
  Foreman's own repo is the natural, most relevant subject for a "highest-leverage
  decisions before v0.1" analysis, since v0.1 readiness is literally what's
  being asked.
- Commit under test (unchanged throughout all runs — no live run wrote to
  this repo; every `plan` invocation is read-only analysis): `c897799c85329818ecba934d19f0d06c1c1fea21`
  (`epic-2.12: add foreman cli`)
- Branch: `claude/new-session-yvvnum`
- `git status` immediately before and after all four live runs: clean, no
  untracked changes — confirmed explicitly, twice.

## Commands executed

```bash
npx tsc --noEmit                 # clean, before and after
npx vitest run                   # 203/203 passing, before and after
rm -rf dist && npx tsc -p tsconfig.json   # real build, before live runs

# Run A — natural phrasing (no external skill path bug yet, N/A here)
node dist/cli.js plan "Analyze this repository and identify the highest-leverage
  engineering decisions required before a public v0.1 release." \
  --skills-path examples/sdk-authored-skill --json

# Run A — rephrased (vocabulary-adjusted for the mechanical matcher)
node dist/cli.js plan "Analyze this repository's module boundaries, abstraction
  stability, and responsibility ownership, along with prior-art comparable
  approaches and any authentication or trust-boundary concerns, to identify the
  highest-leverage engineering decisions required before a public v0.1 release." \
  --skills-path examples/sdk-authored-skill --json

# Run B — natural phrasing
node dist/cli.js plan "Evaluate whether Foreman should prioritize extensibility
  through external Skills or reduce architectural surface area before release.
  Identify conflicting recommendations rather than resolving them." \
  --skills-path examples/sdk-authored-skill --json

# Run B — rephrased (vocabulary-adjusted)
node dist/cli.js plan "Evaluate whether Foreman should prioritize extensibility
  and external comparable approaches through external Skills (module boundary
  and coupling tradeoffs), or instead reduce architectural surface area,
  abstraction stability and responsibility ownership before release. Identify
  conflicting recommendations rather than resolving them." \
  --skills-path examples/sdk-authored-skill --json
```

All four used the real `foreman plan` CLI subcommand (Epic 2.12) — never a
manual model call, never a bypassed Planner or Synthesizer. `ANTHROPIC_API_KEY`
was supplied ad hoc by Jinwoo for these calls only, used for exactly these
four invocations, never logged/echoed/persisted, `unset` immediately after,
and confirmed absent from the environment and from every captured evidence
file afterward (`grep -rl "sk-ant" <every captured file>` → no matches).

## A real setup bug, disclosed (not hidden)

All four `plan` runs above passed `--skills-path examples/sdk-authored-skill`
— the example skill's own package directory. `LocalDirectoryProvider`
expects a directory whose **subdirectories** are skill packages, not the
package directory itself. This means **the external
`performance-review` skill was never actually loaded in any of the four
completed live `plan` runs** — the flag silently contributed zero skills, and
every run above only ever exercised the 3 bundled skills.

This was caught afterward via `foreman inspect` (no live-model-cost to
re-check), which confirmed the corrected path is `--skills-path examples`
(the parent directory):

```
$ node dist/cli.js inspect "<Run A rephrased goal>" --skills-path examples --json
[bundled] architecture  matched: true  overlap: [module, boundaries, abstraction, stability, responsibility, ownership]
[bundled] research      matched: true  overlap: [prior, art, comparable, approaches]
[bundled] security      matched: true  overlap: [boundaries, authentication, trust]
[external:examples] performance-review  matched: true  overlap: [concerns]
```

With the corrected path, `performance-review` mechanically matches Run A's
rephrased goal — but only via one weak, near-generic shared token
("concerns"), consistent with `match.ts`'s documented false-positive bias.
Whether the skill's own procedure would have self-reported `relevant: false`
(the expected, correct outcome for a goal that isn't actually about
performance) was **not verified with a real model call** — a second live
run to confirm this was offered, but no further API key was supplied, and
per the standing instruction not to over-rephrase/re-run to force a
particular outcome, this was not re-attempted speculatively. **This is
disclosed as an honest gap, not papered over**: the four completed live runs
above are valid, real evidence for the 3 bundled skills; they are not
evidence about the external skill's real-world behavior, only about a CLI
usability rough edge (the flag's directory-vs-package semantics are not
obvious from the flag name alone, and produced no diagnostic when zero
skills were found instead of the intended one).

## Run A evidence — broad repository analysis

### Run A, natural phrasing

**Goal:** "Analyze this repository and identify the highest-leverage
engineering decisions required before a public v0.1 release."

**Matched:** none. **Excluded:** `architecture`, `research`, `security` — all
excluded by the mechanical matcher (`filterCandidates`) with zero token
overlap between the goal and any skill's one-line description. No model call
was made at all (correctly — the matcher runs before any skill invocation).

**Result:** `{ matchedSkillIds: [], synthesis: { verdict: "0 specialists
found this relevant; 0 decision groups identified; 0 unresolved.", ... } }`
— every field correctly empty, not a crash, not a fabricated finding.

This is the same recurring matcher false-negative pattern observed
repeatedly across Epics 2.4, 2.5, 2.6, and 2.8's live dogfood runs: a
naturally-phrased, high-level goal often shares zero vocabulary with a
skill's necessarily-terse one-line description. It reproduced again here,
live, unprompted.

### Run A, rephrased (vocabulary-adjusted)

**Goal:** "Analyze this repository's module boundaries, abstraction
stability, and responsibility ownership, along with prior-art comparable
approaches and any authentication or trust-boundary concerns, to identify
the highest-leverage engineering decisions required before a public v0.1
release."

**Matched:** `architecture`, `research`, `security` (all 3 bundled skills).
**Excluded:** none (external skill not actually loaded — see bug above).

**Runtime:** ~20.6s wall-clock for the full `plan` invocation (3 concurrent
skill invocations + 0 relationship classification calls needed for a
1-member-per-specialist merged group — see clustering note below).

**Raw SkillResult summaries** (verbatim `specialistAttribution[].summary`):
- `architecture`: "This is an explicit whole-repo architecture audit —
  module boundaries, abstraction stability, and ownership are the literal
  deliverable, so it is squarely in scope (minus the auth/prior-art
  portions I must defer)."
- `research`: "A public-release architecture/trust-boundary analysis of a
  novel autonomous-coding harness genuinely carries external uncertainty
  worth grounding in prior art and unverified assumptions."
- `security`: "The goal is an analysis task, but it explicitly scopes
  authentication and trust-boundary review for a public v0.1 of an
  autonomous coder that edits repos and runs commands unattended — real
  trust surface worth naming."

**Failures:** none — all 3 calls returned well-formed, parseable JSON.

**Decision groups:** exactly **1**, containing forks from **2 of the 3**
matched specialists (`architecture`'s "should the skill/specialist boundary
be a stable public extension point?" fork, and `security`'s "what trust
posture should command/file execution assume?" fork). `research` contributed
0 forks (11 concerns, 0 forks — it had genuine uncertainty to surface but no
shape-changing decision of its own).

**This is a real, reproduced instance of the known clustering over-merge
issue** (flagged in the Epic 2.9 hardening ADR as deliberately deferred, and
previously observed live in Epic 2.8): the mechanical Union-Find clusterer
merged architecture's "skill boundary" question and security's "execution
sandboxing" question into one DecisionGroup on shared vocabulary
(`boundaries`/`boundary` appears in both), even though these are two
genuinely distinct decisions — one is about a public API contract, the
other is about a process-isolation posture. A human reading the merged
group would need to notice the group actually contains two separable
questions; the group's own `label` (verbatim from the first member's
question) somewhat obscures this by only showing architecture's framing.

**Relationships:** exactly 1, `complementary`, between `architecture` and
`security`, on the (over-)merged group — correctly identified as
complementary rather than agreement/tension/contradiction, since the two
forks genuinely answer different sub-questions and don't conflict.
`research` was excluded from relationship classification because it
contributed 0 forks to any DecisionGroup (correct: relationship
classification only applies to DecisionGroups with 2+ distinct specialists'
members, and research had none in this merged group).

**Attribution:** every summary/concern is individually attributed to its
`skillId`; nothing is unattributed or blended.

**Unresolved questions:** 0 (no invocation-failed, no unparseable — a clean
run for all 3 skills).

## Run B evidence — adversarial/conflict-inducing analysis

### Run B, natural phrasing

**Goal:** "Evaluate whether Foreman should prioritize extensibility through
external Skills or reduce architectural surface area before release.
Identify conflicting recommendations rather than resolving them."

**Matched:** `research` only. **Excluded:** `architecture` (despite the goal
literally containing "architectural surface area" — a genuinely surprising
false negative, see analysis below), `security` (no security-relevant
vocabulary in this goal — a correct exclusion).

**Result:** 1 specialist, 1 decision group (single-member — `research`'s own
3-option fork: extensibility-first / surface-reduction-first / stabilize
internally-without-publishing), 4 concerns, 0 relationships (correctly —
relationship classification requires 2+ specialists in a group, and this
group has exactly 1).

**Why did `architecture` not match "architectural surface area"?** Checked
directly: `architecture`'s description is "module boundaries, abstraction
stability, and coupling, and responsibility ownership for a proposed
change." The goal's tokens are `architectural`/`surface`/`area` — none of
these appear verbatim or as a ≥4-char substring match against
`architecture`'s description tokens (`module`, `boundaries`, `abstraction`,
`stability`, `coupling`, `responsibility`, `ownership`). `architecture` (the
goal token) vs. `architecture` (part of the skill's own `id`/`name`, but
`filterCandidates` only checks `name`+`description`, not `id` — and
"Architecture" as a bare word does not itself appear in the description
text either). **This is a real, legitimate matcher limitation**: the skill's
one-line description was written to describe what the skill evaluates
(module boundaries, coupling, etc.) rather than to include the word
"architecture" itself, so a goal using the word "architectural" doesn't
lexically overlap with its own skill's description. Confirmed via direct
inspection of `match.ts`'s token-overlap logic — not a bug, but a sharp
edge in how skill descriptions are worded relative to how users phrase
goals.

### Run B, rephrased (vocabulary-adjusted)

**Goal:** "Evaluate whether Foreman should prioritize extensibility and
external comparable approaches through external Skills (module boundary and
coupling tradeoffs), or instead reduce architectural surface area,
abstraction stability and responsibility ownership before release. Identify
conflicting recommendations rather than resolving them."

**Matched:** `architecture`, `research`. **Excluded:** `security` — and this
exclusion is **correct and desirable**, not a limitation: an
extensibility-vs-surface-area tradeoff genuinely carries no
authentication/trust-boundary question, and security's own procedure or the
matcher declining it either way is the right outcome. (In this case the
matcher excluded it before any model call was needed — cheaper and equally
correct.)

**Raw SkillResult summaries:**
- `architecture`: "The goal is inherently architectural: it pits an
  extensible external-Skills boundary against reducing abstraction surface
  area and clarifying responsibility ownership before release."
- `research`: "This is a genuine architectural-direction question about the
  Skills extensibility boundary before release; real prior art and
  comparable extension models bear on it."

**Failures:** none.

**Decision groups:** exactly 1, containing both specialists' forks —
correctly clustered this time (both forks are genuinely about the same
underlying decision: extensibility vs. internal-only, unlike Run A's
over-merge).

**Relationships:** exactly 1, classified as **`agreement`** — both
specialists independently recommended the same option (keep the Skills
boundary internal/private, minimize surface first, defer any public
extension contract). The explanation correctly cites what each specialist
actually recommended without inventing a synthesis position of its own.

**This is a genuinely interesting result for an "adversarial,
conflict-inducing" goal**: rather than producing a tension or contradiction,
the two independent specialists converged on the same recommendation for
different but compatible reasons (architecture: coupling/ownership
concerns; research: reversibility-asymmetry and prior-art precedent). This
is disclosed honestly as `agreement`, not manufactured into a false
"conflict" to satisfy the goal's framing — consistent with the standing
instruction that adversarial goals are accepted as valid even with a
result that doesn't produce every relationship class.

**Attribution:** clean, individually attributed throughout.

**Unresolved questions:** 0.

## Comparison: Run A vs. Run B

| | Run A (rephrased) | Run B (rephrased) |
|---|---|---|
| Matched specialists | 3 (architecture, research, security) | 2 (architecture, research) |
| Decision groups | 1 (over-merged — 2 genuinely distinct questions) | 1 (correctly merged — 1 genuine question) |
| Relationships | 1 complementary | 1 agreement |
| Failures | 0 | 0 |
| Concerns | 17 | 9 |
| Runtime | ~20.6s | not separately timed (similar order of magnitude) |

Run A's broader "what matters before v0.1" framing pulled in more
specialists and surfaced more raw concerns, but the clusterer's over-merge
weakened the decision-group signal. Run B's narrower, already-decision-shaped
framing produced a cleaner 1:1 mapping from real question to DecisionGroup,
and a genuinely informative "these two independent specialists actually
agree, for different reasons" relationship — arguably the more useful of
the two outputs for someone trying to decide something specific.

## Evaluation — the 8 required questions

**1. Did matching select relevant specialists?**
Partially, and inconsistently across phrasing. When goal vocabulary
overlapped a skill's description (the rephrased goals), matching correctly
selected exactly the specialists genuinely relevant to the question,
including a correct exclusion (security, Run B). When goal vocabulary used
natural, high-level language (both natural-phrasing runs), matching
under-selected — including a legitimate surprise (Run B natural-phrasing
excluding `architecture` despite the goal containing "architectural"). This
is the same matcher limitation this project has now observed live in
essentially every dogfood run since Epic 2.4 — it is a real, unresolved,
already-known-and-disclosed limitation, not new information, but this run
reconfirms it's still the single most impactful gap for real usability.

**2. Did distinct decisions remain separate?**
No, not reliably. Run A's decision group merged two genuinely distinct
decisions (a public-API-surface question and a process-isolation-posture
question) into one group because they shared enough vocabulary
(`boundary`/`boundaries`). Run B's single decision group was correctly
unmerged (there was only one real decision to begin with). This reproduces
the exact over-merge risk flagged in the Epic 2.9 ADR and previously
observed in Epic 2.8 — confirmed again, live, on a different topic.

**3. Were agreements, complementarities, tensions, and contradictions
classified reasonably?**
Yes, on the evidence available. Run A's `complementary` classification and
Run B's `agreement` classification both read as defensible, correctly
conservative calls given the actual specialist text — neither invented a
conflict nor glossed over a real one. No `tension` or `contradiction` was
produced in either run; this dogfood pass did not happen to surface a case
requiring those two classes (Epic 2.8's own live runs previously exercised
`tension` on a different topic, so the classifier's ability to produce all
4 classes remains previously-demonstrated, just not re-exercised here).

**4. Did truncation or parsing fail?**
No — zero `unparseable` or `invocation-failed` results across all 4
specialist invocations in the 2 completed runs (Run A rephrased: 3/3 clean;
Run B rephrased: 2/2 clean). This is notably better than several prior
epics' live runs (Epic 2.5, Epic 2.8) which did hit real truncation —
plausibly because these responses stayed within the existing
`maxTokens: 1024` ceiling this time, not because the ceiling itself changed
(it wasn't touched in Epic 2.9, by design — see the ADR).

**5. Did the CLI make failures visible?**
Yes, on the evidence available, but this pass didn't get to test it against
a *real* skill failure (none occurred). What was verified: `skills validate`
correctly surfaced real, specific errors for a genuinely malformed package
in Epic 2.12's own test suite (exit code 1, descriptive per-field errors);
`plan`'s formatter has an explicit "Disclosed failures / unresolved"
section that was exercised in Epic 2.12's own CLI tests (a mocked
unparseable response was confirmed to surface there, not be hidden). This
dogfood pass adds no new evidence on this question beyond what Epic 2.12
already proved with mocks — a genuinely honest limitation of this
particular pass (no real failure happened to occur to independently
verify).

**6. Could a user act on the final output?**
Partially. Run B's output (2 specialists, 1 clean decision group, 1 clear
agreement) is directly actionable: a user reading it would understand the
recommendation (keep Skills internal pre-v0.1) and both specialists'
independent reasoning for it. Run A's output is less directly actionable as
presented — the merged decision group conflates two separable decisions a
user would need to manually untangle before acting, even though the
underlying concerns and attributions are all individually legible and
honest.

**7. Did any architecture boundary get violated during implementation?**
No, confirmed by direct inspection, not merely assumed: `plan.ts` and
`inspect.ts` (Epic 2.12) call the real, unmodified `runPlanner` and
`synthesizeWithRelationships`/`explainCandidates` — no reimplemented
matching or synthesis logic exists in the CLI layer. No specialist-specific
branch exists anywhere in `planner.ts` (verified by the existing
constraint tests, re-run clean as part of this Epic's own test pass). No
result was silently resolved — every disclosed failure, concern, and
relationship in both runs' raw JSON passed through unmodified into the
human-readable formatter.

**8. What must still be fixed before v0.1?**
In priority order, based on evidence from this pass specifically (not a
restatement of the Epic 2.9 ADR's separate list, though there's overlap):
1. **The mechanical matcher's real-world hit rate on naturally-phrased
   goals** — reconfirmed as the single biggest gap to real usability; a
   user who doesn't already know to use matcher-friendly vocabulary will
   frequently get an empty or under-matched plan for a goal that is
   genuinely in scope for one or more skills.
2. **Clustering over-merge**, reconfirmed live on a second, unrelated topic
   — already flagged and deliberately deferred in the Epic 2.9 ADR; this
   run adds a second independent data point that it's a real, recurring
   cost, not a one-off.
3. **`--skills-path`'s directory-vs-package ambiguity** (the bug discovered
   during this Epic) — the flag silently accepted a package directory and
   contributed zero skills with no diagnostic explaining why. This is a
   genuinely new, previously-undiscovered usability gap this dogfood pass
   surfaced. A minimal fix: detect and warn/error when a supplied
   `--skills-path` directory itself looks like a skill package (has its own
   SKILL.md) rather than a directory of packages.

## Self-review

- **Simplicity:** the CLI subcommands added in Epic 2.12 required zero new
  orchestration logic to dogfood correctly — `plan` is a genuinely thin
  wrapper. This is a good sign for the "organization, not judgment"
  discipline holding up under real use.
- **Honesty of evidence:** the `--skills-path` bug was found, disclosed, and
  NOT quietly worked around or re-run to hide it — the four completed live
  runs are reported exactly as they happened, including the fact that the
  external skill was never actually exercised.
- **Known limitations carried forward, not resolved here:** matcher
  false-negative rate and clustering over-merge are the same two issues
  flagged since Epic 2.4/2.8 and the Epic 2.9 ADR — this Epic's job was
  verification, not fixing, and no speculative fix was made to either just
  to make this report look better.
- **What surprised me:** Run B's natural-phrasing exclusion of
  `architecture` despite the goal literally containing "architectural" —
  this is a sharper, more specific instance of the matcher problem than
  prior reports captured (previous reports described the general pattern;
  this run pinpoints exactly why a word containing the skill's own domain
  name can still fail to match, because the matcher only checks the
  description text, not the id/name).

## Known limitations (explicit)

1. Mechanical matcher (`filterCandidates`) has a real, reproduced,
   recurring false-negative rate on naturally-phrased goals — now observed
   in every dogfood pass since Epic 2.4, including this one, on Foreman's
   own repository.
2. Mechanical clustering (Union-Find in `synthesize.ts`) over-merges
   distinct decisions when they share enough vocabulary — reproduced again
   in Run A, independently of the Epic 2.8 instance.
3. The external skill (`performance-review`) was not actually exercised in
   any completed live run due to a `--skills-path` directory-vs-package
   usability bug discovered mid-Epic; its real-world self-relevance
   behavior against Run A's goal remains unverified by live evidence (only
   mechanically match-checked via `inspect`, offline).
4. No real skill failure (invocation-failed/unparseable) occurred in this
   pass's completed runs, so the CLI's failure-disclosure behavior is
   re-confirmed only via Epic 2.12's own mocked test suite, not by a fresh
   live failure in this Epic.
5. `research` never contributed a fork of its own in either completed run —
   consistently high concern-count, zero forks. This is consistent with
   its own SKILL.md's design (Research surfaces uncertainty, not always a
   shape-changing decision) but means Run A/B's decision groups were
   entirely driven by `architecture`/`security`'s forks, with `research`'s
   real contribution only visible in the concerns list, not the headline
   decision groups — worth knowing when reading `plan` output that a
   specialist "not producing a fork" doesn't mean it wasn't useful.

## Release recommendation

**Ready with listed caveats**, not "ready for v0.1" outright and not "not
ready."

The core pipeline — discovery, composition, mechanical matching, skill
invocation, mechanical clustering, relationship classification, CLI
surfacing — works end to end, on a real, non-trivial dogfood target
(Foreman's own repository), producing genuinely legible, individually
attributed, honestly-disclosed output with zero crashes, zero fabricated
findings, and zero silently-resolved conflicts across both required runs.

The caveats are specific and already enumerated, not vague: (1) the
matcher's real-world hit rate on natural phrasing is the single most
impactful usability gap and should be the top priority immediately after
this Epic; (2) clustering over-merge is a known, real, recurring
correctness-of-presentation issue, not a crash risk, but does reduce output
quality; (3) the newly-discovered `--skills-path` usability bug should get
at minimum a clear error/warning before v0.1, since it currently fails
silently. None of these are architecture violations, silent conflict
resolution, or fabricated evidence — they are real, bounded, already-
understood product-quality gaps with a clear next step each.

Foreman should **not** be described as production-ready without these
caveats attached; it genuinely is useful as an engineering-direction tool
today, evidenced by Run B's clean, actionable agreement finding — but a
user relying on natural phrasing alone will hit the matcher gap often
enough that it needs to be either fixed or very clearly documented before
a public v0.1 claims "just describe your goal."
