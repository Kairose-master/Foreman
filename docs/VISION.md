# Vision — why Foreman

## The bet in one sentence

**People won't become agent-orchestration engineers just to get one good result
— and the product that does that work for them wins the mass market, not the
expert niche.**

## The pain (real, felt, today)

Coding agents are capable. Getting a *good* result out of one is not. In
practice you get:

- The agent picks the wrong approach and you find out 20 tool-calls deep.
- It routes to the wrong tool, re-reads the same files, retries, thrashes.
- The token bill is huge and the output is mediocre or wrong.
- You have no way to say "don't spend more than this" or "don't hand me garbage."

The gap between *a powerful tool* and *a good result* is currently filled by
**expertise** — prompt-craft, task decomposition, routing, cost control. Most
people don't have it and won't learn it for a single task.

## "Lazy" is the tell, not the weakness

A common dismissal: *"so it's for people too lazy to build their own workflows?"*

Yes — and that's the biggest market there is, not the smallest.

- Too lazy to write → Instagram. Too lazy to search → TikTok. Too lazy to
  manage servers → Vercel. Too lazy to walk → delivery apps.
- "Willing to do the hard work themselves" is always a tiny expert market, and
  it's already served (by the raw tools).
- Betting on convenience is betting on everyone; betting on expertise is betting
  on the few.

Demand-side, it's called laziness. Supply-side, it's **the expertise gap**.
Products that close that gap at scale are the largest products in software.

## The specific insight: today's tools are backwards

Where humans actually want control vs. convenience:

- **Direction** (approach, tradeoffs, "which way") — humans want to *own* this.
  It's judgment, it's taste, and mistakes here are expensive and hard to undo.
- **Execution** (code, files, commands) — humans want to *offload* this. It's
  mechanical and reversible.

Current agents invert it: they interrupt you for permission on execution ("can I
edit this file?" — cheap, reversible) and silently commit to a direction
(expensive, and you pay for it in burned tokens when it's wrong).

**Foreman puts the human where judgment is scarce (direction) and automates
where it's mechanical (execution).** Measure twice, cut once — for agents.

## Why now

- Coding agents crossed the "actually useful" line, so the bottleneck moved from
  *capability* to *drivability*.
- The people feeling the pain (token burn, thrash, blank-canvas) are early
  adopters who already pay for tokens — they feel the cost directly.
- The trust primitives that make "execute without asking" safe (independent
  grading, budget caps, signed proofs) already exist in Ledgermind.

Might be early on timing. That's a bet, not an accident.

## Who it's for

The developer who has Claude Code / an agent open, knows it's powerful, and is
tired of babysitting it — who wants to say what they want, argue about the
approach for 30 seconds, and then get working code back without watching every
step or fearing the bill.

## Non-goals

- **Not** a no-code tool. The user is technical; they want to own *decisions*,
  not keystrokes.
- **Not** another prompt/recipe library of unverified claims. Every result is
  independently graded; a claim without a grade doesn't ship.
- **Not** a fully-autonomous "set it and forget it" agent. The direction loop is
  the point — it's what keeps the token burn and the wrong-way runs from
  happening.
- **Not** a marketplace. Single-player from the first use; no second side to
  cold-start.
