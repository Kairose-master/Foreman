# Worked example — a relevant case

This illustrates the shape of a genuinely relevant finding. It is not
executed by any code — it exists for a human (or a future skill author)
reading this package to understand the expected output discipline.

## Goal

> Add a second, alternative settlement path for Labor Market escrow payouts
> that doesn't depend on the on-chain MiniVault, for users who opt out of the
> chain layer entirely.

## Why this is relevant (not a trivial goal)

This introduces a new settlement path alongside an existing one, in a
codebase whose own conventions already treat the chain layer as optional —
so there's a real question of what "settlement" means when the chain is
off, and whether an existing pattern in the repo already answers that.

## Illustrative output

```json
{
  "relevant": true,
  "summary": "This adds a second escrow-settlement path; the repo's existing off-chain-degrade convention may already imply the answer, but it's not verified against Labor Market specifically.",
  "concerns": [
    "Other optional-chain features in this repo degrade to an off-chain equivalent when chain env vars are unset — unverified whether Labor Market settlement already has (or should reuse) an equivalent off-chain code path rather than a new one",
    "No prior art found in this repo for a dual settlement path on the same escrow record — worth checking whether existing settlement state (open/paid/disputed) already accommodates a non-chain payout, or whether that's an unverified assumption baked into the goal"
  ],
  "forks": []
}
```

Note `forks` is empty here — a real fork would only belong if two prior-art
-informed directions were both genuinely live options; a single "here's what
to verify before deciding" finding does not need one manufactured.
