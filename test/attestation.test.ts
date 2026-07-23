import { describe, it, expect } from 'vitest'
import { contentHashOf, signWorkProof, WORK_PROOF_SCHEMA, type WorkProof } from '../src/engine/attestation.js'

// Well-known anvil/hardhat test key #0 → a deterministic address.
const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const TEST_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

function proof(): WorkProof {
  return {
    schema: WORK_PROOF_SCHEMA,
    jobRef: 'run-1',
    kind: 'code',
    contentHash: contentHashOf('the diff'),
    worker: 'foreman-agent-sdk',
    requester: 'foreman-user',
    verdict: 'pass',
    grader: 'local',
    gradedAt: 1_700_000_000,
  }
}

describe('contentHashOf', () => {
  it('is deterministic and 0x-prefixed keccak256 (32 bytes)', () => {
    const a = contentHashOf('hello')
    const b = contentHashOf('hello')
    expect(a).toBe(b)
    expect(a).toMatch(/^0x[0-9a-f]{64}$/)
  })
  it('differs for different content', () => {
    expect(contentHashOf('a')).not.toBe(contentHashOf('b'))
  })
})

describe('signWorkProof', () => {
  it('returns null when no oracle key is configured (hash-only path)', async () => {
    expect(await signWorkProof(proof(), undefined)).toBeNull()
  })

  it('signs EIP-712 with the oracle key and recovers the attester address', async () => {
    const signed = await signWorkProof(proof(), TEST_KEY)
    expect(signed).not.toBeNull()
    expect(signed!.attester.toLowerCase()).toBe(TEST_ADDR.toLowerCase())
    expect(signed!.signature).toMatch(/^0x[0-9a-f]{130}$/)
  })

  it('accepts a key without the 0x prefix', async () => {
    const signed = await signWorkProof(proof(), TEST_KEY.slice(2))
    expect(signed!.attester.toLowerCase()).toBe(TEST_ADDR.toLowerCase())
  })

  it('returns null (not throw) on a malformed key', async () => {
    expect(await signWorkProof(proof(), 'not-a-key')).toBeNull()
  })
})
