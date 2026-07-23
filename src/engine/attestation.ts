/**
 * Proof of Authorship & Grade — mirrored from Ledgermind's off-chain EAS-style
 * attestation (engine/ledgermind/lib/attestation.ts), so a proof the LocalEngine
 * issues is verifiable by the same code as one Ledgermind issues.
 *
 * A deliverable is fingerprinted with keccak256 and, when an oracle key is
 * present, signed EIP-712 by the trusted attester. No key → an unsigned,
 * hash-only proof (still content-verifiable). This is the optional-on-chain
 * pattern: it degrades gracefully without its env.
 */
import { keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export const WORK_PROOF_SCHEMA = 'ledgermind.work.v1'
/** Sepolia — the testnet Ledgermind attests on. Keeps the domain interoperable. */
const CHAIN_ID = 11155111

export interface WorkProof {
  schema: string
  jobRef: string
  kind: string
  contentHash: `0x${string}`
  worker: string
  requester: string
  verdict: string
  grader: string
  gradedAt: number
}

const DOMAIN = { name: 'Ledgermind', version: '1', chainId: CHAIN_ID } as const
const TYPES = {
  WorkProof: [
    { name: 'schema', type: 'string' },
    { name: 'jobRef', type: 'string' },
    { name: 'kind', type: 'string' },
    { name: 'contentHash', type: 'bytes32' },
    { name: 'worker', type: 'string' },
    { name: 'requester', type: 'string' },
    { name: 'verdict', type: 'string' },
    { name: 'grader', type: 'string' },
    { name: 'gradedAt', type: 'uint256' },
  ],
} as const

/** keccak256 fingerprint of the deliverable text (utf-8). */
export function contentHashOf(text: string): `0x${string}` {
  return keccak256(toBytes(text))
}

/**
 * Sign a work proof EIP-712 with the oracle key, or return null when no key is
 * configured (the hash-only path). Never throws on a bad key — returns null so
 * proof issuance never blocks the report.
 */
export async function signWorkProof(
  proof: WorkProof,
  oracleKey: string | undefined,
): Promise<{ signature: `0x${string}`; attester: `0x${string}` } | null> {
  if (!oracleKey) return null
  try {
    const key = (oracleKey.startsWith('0x') ? oracleKey : `0x${oracleKey}`) as `0x${string}`
    const account = privateKeyToAccount(key)
    const signature = await account.signTypedData({
      domain: DOMAIN,
      types: TYPES,
      primaryType: 'WorkProof',
      message: { ...proof, gradedAt: BigInt(proof.gradedAt) },
    })
    return { signature, attester: account.address }
  } catch {
    return null
  }
}
