# Skill Contract

This document defines how a **specialist skill** is packaged and how Foreman
discovers one. It does not define how a skill's procedure is *invoked* — that
is the Skill Runner's contract (a later epic); this document stops at
"what exists," not "how it runs."

## Why skills, not agents

Foreman's direction layer (Planner → specialists → Synthesizer) composes
domain expertise — research, architecture, security, performance, UX,
documentation, and any domain added later — as **stateless, reusable skills**,
not long-lived hardcoded agent classes. A new domain should be addable by
writing a package, not by writing and registering a TypeScript class. This
document is the contract that makes that true.

## A skill is a package, not a file

A single `SKILL.md` file would work for the simplest case, but would force a
breaking change to the discovery API the day a skill needs a fixture, a
worked example, or a machine-readable schema alongside its procedure. So a
skill is defined as a **directory** — a package — with one required file and
several optional ones:

```
<skill-id>/
├── SKILL.md        ← required: frontmatter + procedure body
├── README.md        ← optional: human-oriented explanation, not read by Foreman
├── examples/         ← optional: worked examples, not read by discovery
├── tests/            ← optional: skill-author's own fixtures, not read by discovery
└── schema.json        ← optional: structured I/O schema, not read by discovery
```

Only `SKILL.md` is read by the discovery layer. Everything else exists for
humans and for the skill's own maintenance — discovery never needs to change
to accommodate new optional siblings.

## `SKILL.md` shape

Required YAML frontmatter, then a markdown procedure body:

```markdown
---
id: security
name: Security Review
description: Auth, input validation, secrets, and trust-boundary concerns.
---

<the procedure — what this skill does when invoked, including its own
self-relevance check as the first instruction>
```

- `id` — stable, unique, used for referencing this skill elsewhere (e.g. in a
  Synthesizer's finding). Lowercase, hyphenated.
- `name` — short human label.
- `description` — one line. This is the **only** field used for mechanical
  candidate matching (a later epic) — keep it specific enough to match
  against real goals, not generic marketing copy.

The procedure body is not parsed or validated by discovery. It is read
verbatim by whatever later invokes the skill (the Skill Runner). Discovery's
job ends at "this package exists and here is its metadata."

## The `SkillDescriptor`

What discovery returns per skill, conceptually:

- `id` — from frontmatter.
- `name` — from frontmatter.
- `description` — from frontmatter.
- `path` — where the package lives, so a later stage can read `SKILL.md`'s
  full body (or its optional siblings) when it actually needs to.

Discovery deliberately does **not** return the parsed procedure body. Loading
and running a skill's full content is a concern of the thing that invokes it,
not of the thing that lists what's available — keeping this boundary narrow
is what lets a skill package grow larger (more optional files) without ever
changing what discovery hands back.

## The `SkillProvider` contract

Discovery is expressed as a **provider abstraction**, not a directory walk.
The orchestration layer (Planner and everything downstream) only ever talks
to a `SkillProvider`; it must never assume skills come from a local
filesystem. A provider exposes exactly one operation: list the skills it
currently knows about. Nothing else — no fetching a single skill by id, no
watching for changes, no caching contract. Those are additions to make later,
if and when something downstream actually needs them; a narrow interface is
cheap to extend and expensive to shrink back down from "just in case."

Providers are expected to multiply over time, all satisfying the same
contract:

- **Bundled** — skills shipped inside Foreman itself.
- **Local directory** — a user-configured path on disk (the first
  implementation; see below).
- **Git repository** — a pinned or tracked external repo of skill packages.
- **Remote registry** — skills fetched from a network service (e.g. a
  ClawHub-style catalog).

The orchestration layer holds a list of providers and merges their results;
it never holds a path, a URL, or any provider-specific detail.

## The first implementation: `LocalDirectoryProvider`

Backed by the local filesystem internally, but that fact is not visible
outside the module — it is one interchangeable implementation of
`SkillProvider`, constructed with a root path, and it satisfies the contract
above like any future provider would. It walks one level of subdirectories
under its root, and for each one attempts to read and parse `SKILL.md`'s
frontmatter into a `SkillDescriptor`. A subdirectory that is missing
`SKILL.md`, or whose frontmatter is malformed, is silently excluded from the
result — it is not a fatal error for one bad package to exist alongside good
ones, and discovery has no user-facing surface to report a warning through
at this layer.

## Non-goals of this document

- How a skill's procedure is actually invoked (the Skill Runner's job).
- How candidates are narrowed down for a specific goal (the mechanical
  matcher's job).
- How multiple providers' results are merged or de-duplicated by id (the
  orchestration layer's job, once more than one provider exists).

This document only answers: what is a skill package, and what does listing
the available ones look like.
