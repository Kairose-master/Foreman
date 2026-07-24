# Worked example — a relevant case

This illustrates the shape of a genuinely relevant finding. It is not
executed by any code — it exists for a human (or a future skill author)
reading this package to understand the expected output discipline.

## Goal

> Add a second, alternative settlement path for Labor Market escrow payouts
> that doesn't depend on the on-chain MiniVault, for users who opt out of the
> chain layer entirely.

## Why this is relevant (real structural weight)

This introduces a second settlement path alongside an existing one — a
question of whether settlement logic stays a single responsibility owned by
one module, or splits across two paths that must both stay consistent with
the same escrow state. That's a structural question independent of whether
any prior art exists for it (Research's concern) or whether it's secure
(Security's concern).

## Illustrative output

```json
{
  "relevant": true,
  "summary": "This change would let two different settlement paths mutate the same escrow record, which strains the current assumption that settlement is a single-owner responsibility.",
  "concerns": [
    "Escrow state (open/paid/disputed) currently appears to be mutated from one settlement code path; adding a second path means that state's ownership boundary now has two writers, not one",
    "The MiniVault-backed path and a new non-chain path would need to converge on the same escrow status semantics, or the escrow state model itself becomes an ambiguous shared abstraction between them"
  ],
  "forks": [
    {
      "id": "settlement_ownership",
      "question": "Should the two settlement paths share one settlement module, or be extracted as independent subsystems behind a common interface?",
      "options": [
        { "id": "a", "label": "One shared settlement module, branching internally on chain vs non-chain", "tradeoff": "Keeps escrow-state mutation in one place (single writer), but the module now has two responsibilities to reason about" },
        { "id": "b", "label": "Two independent settlement subsystems behind a shared extension point", "tradeoff": "Cleaner separation of concerns per path, but requires a real interface boundary so both stay consistent with escrow state — more structure to design and maintain" }
      ],
      "recommended": "b",
      "shapeChanging": true
    }
  ]
}
```

Note this says nothing about whether an off-chain custody pattern is secure,
nor whether similar systems exist elsewhere — those are Security's and
Research's questions respectively, not this skill's to answer.
