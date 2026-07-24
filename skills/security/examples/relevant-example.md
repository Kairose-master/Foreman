# Worked example — a relevant case

This illustrates the shape of a genuinely relevant finding. It is not
executed by any code — it exists for a human (or a future skill author)
reading this package to understand the expected output discipline.

## Goal

> Add a second, alternative settlement path for Labor Market escrow payouts
> that doesn't depend on the on-chain MiniVault, for users who opt out of the
> chain layer entirely.

## Why this is relevant (real trust/abuse weight)

A second settlement path is a new way value moves between two parties. That
is inherently a trust-boundary question — who is authoritative for "this
escrow is settled" on the new path, and can a party double-claim or forge
settlement — independent of whether the design is architecturally clean
(Architecture's concern) or has precedent elsewhere (Research's concern).

## Illustrative output

```json
{
  "relevant": true,
  "summary": "A non-chain settlement path removes the on-chain finality guarantee, so something else must now be trusted to say 'this escrow is settled,' and that trust source isn't specified.",
  "concerns": [
    "Without on-chain enforcement, whichever party or service confirms settlement becomes a new, unverified trust anchor — if that confirmation can be forged or replayed, a payout could be claimed twice or claimed without the underlying work being real",
    "If the same escrow record can be settled through either path, a race between the two paths could let a party settle via the weaker (non-chain) path to avoid the stronger one's guarantees — that needs an explicit rule, not an implicit assumption"
  ],
  "forks": [
    {
      "id": "settlement_trust_model",
      "question": "What replaces on-chain finality as the trust anchor for the non-chain path?",
      "options": [
        { "id": "a", "label": "Zero trust: every non-chain settlement still requires an independently verifiable signed commitment before being treated as final", "tradeoff": "Preserves a hard-to-forge guarantee, but adds signature/verification overhead to every non-chain settlement" },
        { "id": "b", "label": "Trusted internal service: a platform-operated service is trusted to declare settlement final, no independent verification", "tradeoff": "Simpler and faster, but the platform itself becomes a single point of trust and forgery risk — no way to independently verify a false 'settled' claim" }
      ],
      "recommended": "a",
      "shapeChanging": true
    }
  ]
}
```

Note this says nothing about how the two paths should be structured as
modules (Architecture's question) or what precedent exists elsewhere
(Research's question) — only what changes about who is trusted and how that
trust could be abused.
