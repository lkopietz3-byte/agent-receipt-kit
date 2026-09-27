import { describe, expect, it } from 'vitest'
import { issuePacket } from '../src/packet.js'
import { verifyReceipt } from '../src/receipt.js'
import { createRefutationTrail } from '../src/trail.js'
import type { AgentClaim } from '../src/types.js'

// A toy browser-automation agent scenario is used throughout: it was
// authorized to log into an account and add an item to a cart, citing
// screenshot evidence ids the orchestrator issued.

function baseClaim(overrides: Partial<AgentClaim> = {}): AgentClaim {
  return {
    packetId: 'pkt-fixed-for-tests',
    claimedActions: ['log-in', 'add-to-cart'],
    citedEvidenceIds: ['screenshot-1', 'screenshot-2'],
    claimedFacts: { cartItemCount: 1 },
    summary: 'Logged in and added the item to the cart.',
    reportedAt: '2026-08-02T12:05:00.000Z',
    ...overrides,
  }
}

describe('issuePacket', () => {
  it('creates a packet with a unique id, the supplied scope, authority, allowed actions, and evidence ids', () => {
    const packet = issuePacket(
      { site: 'shop.example.com' },
      'local',
      ['log-in', 'add-to-cart'],
      ['screenshot-1', 'screenshot-2'],
    )
    expect(packet.id).toBeTruthy()
    expect(packet.scope).toEqual({ site: 'shop.example.com' })
    expect(packet.authorityLevel).toBe('local')
    expect(packet.allowedActions).toEqual(['log-in', 'add-to-cart'])
    expect(packet.evidenceIds).toEqual(['screenshot-1', 'screenshot-2'])
    expect(packet.issuedAt).toBeTruthy()

    const other = issuePacket({}, 'observe', [], [])
    expect(other.id).not.toBe(packet.id)
  })
})

describe('verifyReceipt', () => {
  it('flags a claimed action outside allowedActions as unauthorized, and does not accept the claim', () => {
    const packet = issuePacket(
      { site: 'shop.example.com' },
      'local',
      ['log-in', 'add-to-cart'],
      ['screenshot-1', 'screenshot-2'],
      { id: 'pkt-fixed-for-tests' },
    )
    const claim = baseClaim({
      claimedActions: ['log-in', 'add-to-cart', 'submit-payment'],
    })

    const result = verifyReceipt(packet, claim)

    expect(result.unauthorizedActions).toEqual(['submit-payment'])
    expect(result.accepted).toBe(false)
    expect(result.reason).toContain('submit-payment')
  })

  it('flags a cited evidence id that was never issued in droppedEvidenceIds, and does not silently accept it', () => {
    const packet = issuePacket(
      { site: 'shop.example.com' },
      'local',
      ['log-in', 'add-to-cart'],
      ['screenshot-1', 'screenshot-2'],
      { id: 'pkt-fixed-for-tests' },
    )
    const claim = baseClaim({
      citedEvidenceIds: ['screenshot-1', 'screenshot-99-invented'],
    })

    const result = verifyReceipt(packet, claim)

    expect(result.droppedEvidenceIds).toEqual(['screenshot-99-invented'])
    expect(result.accepted).toBe(false)
    expect(result.reason).toContain('screenshot-99-invented')
  })

  it('flags a claim that contradicts a supplied currentState, and does not accept it', () => {
    const packet = issuePacket(
      { site: 'shop.example.com' },
      'local',
      ['log-in', 'add-to-cart'],
      ['screenshot-1', 'screenshot-2'],
      { id: 'pkt-fixed-for-tests' },
    )
    const claim = baseClaim({ claimedFacts: { cartItemCount: 1 } })
    // A fresher, independent scrape of the cart page disagrees with the claim.
    const currentState = { cartItemCount: 0 }

    const result = verifyReceipt(packet, claim, currentState)

    expect(result.contradictions).toEqual([
      { key: 'cartItemCount', claimedFact: 1, currentFact: 0 },
    ])
    expect(result.accepted).toBe(false)
    expect(result.reason).toContain('cartItemCount')
  })

  it('accepts a fully valid, fully authorized, non-contradicted claim', () => {
    const packet = issuePacket(
      { site: 'shop.example.com' },
      'local',
      ['log-in', 'add-to-cart'],
      ['screenshot-1', 'screenshot-2'],
      { id: 'pkt-fixed-for-tests' },
    )
    const claim = baseClaim()
    const currentState = { cartItemCount: 1 }

    const { reason, ...checks } = verifyReceipt(packet, claim, currentState)

    expect(checks).toEqual({
      accepted: true,
      unauthorizedActions: [],
      droppedEvidenceIds: [],
      contradictions: [],
      packetMismatch: false,
    })
    expect(reason).toContain('matches the issued packet')
  })

  it('rejects a claim answering a different packet id, even if everything else lines up', () => {
    const packet = issuePacket(
      { site: 'shop.example.com' },
      'local',
      ['log-in', 'add-to-cart'],
      ['screenshot-1', 'screenshot-2'],
      { id: 'pkt-fixed-for-tests' },
    )
    const claim = baseClaim({ packetId: 'pkt-some-other-packet' })

    const result = verifyReceipt(packet, claim)

    expect(result.packetMismatch).toBe(true)
    expect(result.accepted).toBe(false)
  })

  it('is silent (no contradictions) when currentState is omitted, since there is nothing to cross-check against', () => {
    const packet = issuePacket(
      { site: 'shop.example.com' },
      'local',
      ['log-in', 'add-to-cart'],
      ['screenshot-1', 'screenshot-2'],
      { id: 'pkt-fixed-for-tests' },
    )
    const claim = baseClaim({ claimedFacts: { cartItemCount: 999 } })

    const result = verifyReceipt(packet, claim)

    expect(result.contradictions).toEqual([])
    expect(result.accepted).toBe(true)
  })
})

describe('createRefutationTrail', () => {
  it('retains a refuted/contradicted claim in an accessible log rather than deleting it', () => {
    const packet = issuePacket(
      { site: 'shop.example.com' },
      'local',
      ['log-in', 'add-to-cart'],
      ['screenshot-1', 'screenshot-2'],
      { id: 'pkt-fixed-for-tests' },
    )
    const claim = baseClaim({ claimedFacts: { cartItemCount: 1 } })
    const currentState = { cartItemCount: 0 }
    const result = verifyReceipt(packet, claim, currentState)
    expect(result.accepted).toBe(false)

    const trail = createRefutationTrail()
    const entry = trail.record(claim, result)

    expect(trail.list()).toHaveLength(1)
    expect(trail.list()[0]).toBe(entry)
    expect(trail.find(entry.id)).toBe(entry)
    expect(entry.claim).toBe(claim)
    expect(entry.result.contradictions).toEqual(result.contradictions)

    // Recording a second, unrelated refuted claim must not evict the first:
    // the trail is a log, not a single-slot cache.
    const secondClaim = baseClaim({
      packetId: 'pkt-fixed-for-tests',
      claimedActions: ['log-in', 'add-to-cart', 'delete-account'],
    })
    const secondResult = verifyReceipt(packet, secondClaim)
    trail.record(secondClaim, secondResult)

    expect(trail.list()).toHaveLength(2)
    expect(trail.list()[0]).toBe(entry)
    expect(trail.find(entry.id)).toBe(entry)

    // No public method exists to remove an entry once it is recorded.
    expect((trail as unknown as Record<string, unknown>).remove).toBeUndefined()
    expect((trail as unknown as Record<string, unknown>).delete).toBeUndefined()
  })
})

describe('verifyReceipt edge cases', () => {
  const packet = issuePacket({}, 'local', ['log-in', 'add-to-cart'], ['screenshot-1'], {
    id: 'pkt-edges',
    issuedAt: '2026-09-24T00:00:00.000Z',
  })
  const claim = (overrides: Partial<AgentClaim> = {}): AgentClaim => ({
    packetId: 'pkt-edges',
    claimedActions: ['log-in'],
    citedEvidenceIds: ['screenshot-1'],
    ...overrides,
  })

  it('accepts an empty claim, because nothing in it falls outside the packet', () => {
    const result = verifyReceipt(packet, claim({ claimedActions: [], citedEvidenceIds: [] }))
    expect(result.accepted).toBe(true)
  })

  it('matches ids exactly: no case folding, trimming or Unicode normalization', () => {
    const decomposed = 'log-i\u006e\u0303' // "log-in" plus a combining tilde (U+0303)
    const result = verifyReceipt(packet, claim({ claimedActions: ['Log-In', 'log-in ', decomposed] }))
    expect(result.unauthorizedActions).toEqual(['Log-In', 'log-in ', decomposed])
    expect(result.accepted).toBe(false)
  })

  it('reports each repeated unauthorized entry as given', () => {
    const result = verifyReceipt(packet, claim({ claimedActions: ['wipe', 'wipe'], citedEvidenceIds: ['x', 'x'] }))
    expect(result.unauthorizedActions).toEqual(['wipe', 'wipe'])
    expect(result.droppedEvidenceIds).toEqual(['x', 'x'])
  })

  it('skips claimed facts the current state does not cover, and ignores extra current-state keys', () => {
    const result = verifyReceipt(
      packet,
      claim({ claimedFacts: { checked: 1, unchecked: 'anything' } }),
      { checked: 1, unrelated: false },
    )
    expect(result.contradictions).toEqual([])
    expect(result.accepted).toBe(true)
  })

  it('does not treat inherited properties such as toString as present in the current state', () => {
    const result = verifyReceipt(packet, claim({ claimedFacts: { toString: 'x', constructor: 'y' } }), {})
    expect(result.contradictions).toEqual([])
  })

  it('compares an own __proto__ key from parsed JSON like any other key', () => {
    const claimedFacts = JSON.parse('{"__proto__": {"admin": true}}') as Record<string, unknown>
    const currentState = JSON.parse('{"__proto__": {"admin": false}}') as Record<string, unknown>
    const result = verifyReceipt(packet, claim({ claimedFacts }), currentState)
    expect(result.contradictions).toHaveLength(1)
    expect(result.contradictions[0]?.key).toBe('__proto__')
    expect(result.accepted).toBe(false)
  })

  it('throws, rather than accepting, when a fact is circular', () => {
    const cyclicClaim: Record<string, unknown> = {}
    cyclicClaim.self = cyclicClaim
    const cyclicState: Record<string, unknown> = {}
    cyclicState.self = cyclicState
    expect(() => verifyReceipt(packet, claim({ claimedFacts: { loop: cyclicClaim } }), { loop: cyclicState })).toThrow(RangeError)
  })

  it('does not mutate the packet, claim or current state', () => {
    const input = claim({ claimedActions: ['log-in', 'wipe'], claimedFacts: { n: 1 } })
    const state = { n: 2 }
    const snapshot = JSON.stringify([packet, input, state])
    verifyReceipt(packet, input, state)
    expect(JSON.stringify([packet, input, state])).toBe(snapshot)
  })

  it('reports a packet mismatch together with the other failures, not instead of them', () => {
    const result = verifyReceipt(packet, claim({ packetId: 'other', claimedActions: ['wipe'] }))
    expect(result.packetMismatch).toBe(true)
    expect(result.unauthorizedActions).toEqual(['wipe'])
  })
})
