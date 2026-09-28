import { describe, expect, it } from 'vitest'
import { issuePacket } from '../src/packet.js'
import { verifyReceipt } from '../src/receipt.js'
import type { AgentClaim, CurrentState } from '../src/types.js'

// ARK-004: how much of the claim was compared has to be readable from the
// structured result, on accepted and rejected results alike, without parsing
// `reason`.

const packet = issuePacket({}, 'local', ['log-in'], ['screenshot-1'], {
  id: 'pkt-coverage',
  issuedAt: '2026-09-28T00:00:00.000Z',
})
const claimWith = (claimedFacts?: Record<string, unknown>, overrides: Partial<AgentClaim> = {}): AgentClaim => ({
  packetId: 'pkt-coverage',
  claimedActions: ['log-in'],
  citedEvidenceIds: ['screenshot-1'],
  ...(claimedFacts === undefined ? {} : { claimedFacts }),
  ...overrides,
})

describe('result.coverage', () => {
  it('reports no facts and no state', () => {
    expect(verifyReceipt(packet, claimWith()).coverage).toEqual({
      stateSupplied: false,
      claimedFactCount: 0,
      comparedFactCount: 0,
      uncheckedFactKeys: [],
    })
  })

  it('reports no facts with a state as supplied but nothing to compare', () => {
    expect(verifyReceipt(packet, claimWith({}), { a: 1 }).coverage).toEqual({
      stateSupplied: true,
      claimedFactCount: 0,
      comparedFactCount: 0,
      uncheckedFactKeys: [],
    })
  })

  it('lists every asserted key as unchecked when no state is supplied', () => {
    const result = verifyReceipt(packet, claimWith({ a: 1, b: 2 }))
    expect(result.accepted).toBe(true)
    expect(result.coverage).toEqual({
      stateSupplied: false,
      claimedFactCount: 2,
      comparedFactCount: 0,
      uncheckedFactKeys: ['a', 'b'],
    })
  })

  it('treats a null state like an absent one', () => {
    const result = verifyReceipt(packet, claimWith({ a: 1 }), null as unknown as undefined)
    expect(result.coverage).toEqual({
      stateSupplied: false,
      claimedFactCount: 1,
      comparedFactCount: 0,
      uncheckedFactKeys: ['a'],
    })
  })

  it('reports an empty state as supplied, with every asserted key unchecked', () => {
    expect(verifyReceipt(packet, claimWith({ a: 1 }), {}).coverage).toEqual({
      stateSupplied: true,
      claimedFactCount: 1,
      comparedFactCount: 0,
      uncheckedFactKeys: ['a'],
    })
  })

  it('reports a partly observed claim and keeps the missing key exactly', () => {
    const result = verifyReceipt(packet, claimWith({ seen: 1, 'missing\nkey': 2 }), { seen: 1, extra: 3 })
    expect(result.accepted).toBe(true)
    expect(result.coverage).toEqual({
      stateSupplied: true,
      claimedFactCount: 2,
      comparedFactCount: 1,
      uncheckedFactKeys: ['missing\nkey'],
    })
  })

  it('counts a contradicted fact as compared', () => {
    const result = verifyReceipt(packet, claimWith({ status: 'done' }), { status: 'failed' })
    expect(result.accepted).toBe(false)
    expect(result.contradictions).toHaveLength(1)
    expect(result.coverage).toEqual({
      stateSupplied: true,
      claimedFactCount: 1,
      comparedFactCount: 1,
      uncheckedFactKeys: [],
    })
  })

  it('reports coverage on a rejected result too', () => {
    const result = verifyReceipt(packet, claimWith({ a: 1, b: 2 }, { claimedActions: ['wipe-disk'] }), { a: 1 })
    expect(result.accepted).toBe(false)
    expect(result.unauthorizedActions).toEqual(['wipe-disk'])
    expect(result.coverage).toEqual({
      stateSupplied: true,
      claimedFactCount: 2,
      comparedFactCount: 1,
      uncheckedFactKeys: ['b'],
    })
  })

  it('reports coverage when the claim answers a different packet', () => {
    const result = verifyReceipt(packet, claimWith({ a: 1 }, { packetId: 'pkt-other' }), { a: 1 })
    expect(result.packetMismatch).toBe(true)
    expect(result.coverage.comparedFactCount).toBe(1)
  })

  it('does not compare a fact against an inherited state key such as toString', () => {
    const result = verifyReceipt(packet, claimWith({ toString: 'x', constructor: 'y' }), {})
    expect(result.coverage).toEqual({
      stateSupplied: true,
      claimedFactCount: 2,
      comparedFactCount: 0,
      uncheckedFactKeys: ['toString', 'constructor'],
    })
  })

  it('keeps compared plus unchecked equal to claimed, and never labels a compared fact as agreeing', () => {
    const states: Array<CurrentState | undefined> = [undefined, {}, { a: 1 }, { a: 2, b: 2 }, { c: 1 }]
    for (const state of states) {
      const { coverage, contradictions } = verifyReceipt(packet, claimWith({ a: 1, b: 2, c: 3 }), state)
      expect(coverage.comparedFactCount + coverage.uncheckedFactKeys.length).toBe(coverage.claimedFactCount)
      expect(contradictions.length).toBeLessThanOrEqual(coverage.comparedFactCount)
    }
  })

  it('lists unchecked keys in the claim\'s own key order and handles an own __proto__ key', () => {
    const parsed = JSON.parse('{"b":1,"__proto__":2,"a":3}') as Record<string, unknown>
    const result = verifyReceipt(packet, claimWith(parsed))
    expect(result.coverage.uncheckedFactKeys).toEqual(['b', '__proto__', 'a'])
    expect(result.coverage.claimedFactCount).toBe(3)
  })

  it('returns a fresh keys array each call, so editing it changes nothing else', () => {
    const facts = { a: 1 }
    const first = verifyReceipt(packet, claimWith(facts))
    first.coverage.uncheckedFactKeys.push('tampered')
    expect(verifyReceipt(packet, claimWith(facts)).coverage.uncheckedFactKeys).toEqual(['a'])
    expect(Object.keys(facts)).toEqual(['a'])
  })

  it('has exactly the four documented fields', () => {
    expect(Object.keys(verifyReceipt(packet, claimWith()).coverage).sort()).toEqual([
      'claimedFactCount',
      'comparedFactCount',
      'stateSupplied',
      'uncheckedFactKeys',
    ])
  })

  it('leaves every existing result field as it was', () => {
    const result = verifyReceipt(packet, claimWith({ a: 1 }), { a: 1 })
    const { coverage, ...rest } = result
    expect(coverage.comparedFactCount).toBe(1)
    expect(rest).toEqual({
      accepted: true,
      unauthorizedActions: [],
      droppedEvidenceIds: [],
      contradictions: [],
      packetMismatch: false,
      reason:
        "Claim matches the issued packet's authority and evidence and answers the correct packet. " +
        '1 claimed fact(s) agree with the supplied current state.',
    })
  })
})
