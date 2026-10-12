import { describe, expect, it } from 'vitest'
import { issuePacket } from '../src/packet.js'
import { verifyReceipt } from '../src/receipt.js'
import type { AgentClaim } from '../src/types.js'

// Verdict rows for the opt-in `requireCoverage` option. Without the option the
// verdicts are unchanged (an unchecked fact is reported in `coverage` and
// accepted); with it, a claimed fact nothing was compared against is refused.

const packet = issuePacket({}, 'local', ['run-tests'], ['log-1'], {
  id: 'pkt-require',
  issuedAt: '2026-10-12T00:00:00.000Z',
})

function claimWith(facts?: Record<string, unknown>): AgentClaim {
  return {
    packetId: 'pkt-require',
    claimedActions: ['run-tests'],
    citedEvidenceIds: ['log-1'],
    ...(facts === undefined ? {} : { claimedFacts: facts }),
  }
}

describe('requireCoverage: verdict rows', () => {
  it('default: a headline claim with no state key is still accepted, and listed as unchecked', () => {
    const result = verifyReceipt(packet, claimWith({ allTestsPass: true }), { other: 1 })
    expect(result.accepted).toBe(true)
    expect(result.coverage.uncheckedFactKeys).toEqual(['allTestsPass'])
    expect(result.uncoveredFactKeys).toEqual([])
  })

  it('requireCoverage: a claimed fact with no matching state key is refused', () => {
    const result = verifyReceipt(packet, claimWith({ allTestsPass: true }), { other: 1 }, { requireCoverage: true })
    expect(result.accepted).toBe(false)
    expect(result.uncoveredFactKeys).toEqual(['allTestsPass'])
    expect(result.contradictions).toEqual([])
    expect(result.reason).toMatch(/not covered by the supplied current state: "allTestsPass"/)
  })

  it('requireCoverage: facts with no current state at all are refused', () => {
    const result = verifyReceipt(packet, claimWith({ allTestsPass: true, rows: 3 }), undefined, { requireCoverage: true })
    expect(result.accepted).toBe(false)
    expect(result.uncoveredFactKeys).toEqual(['allTestsPass', 'rows'])
    expect(result.reason).toMatch(/no current state was supplied/)
  })

  it('requireCoverage: null current state counts as none', () => {
    const result = verifyReceipt(packet, claimWith({ a: 1 }), null as never, { requireCoverage: true })
    expect(result.accepted).toBe(false)
    expect(result.uncoveredFactKeys).toEqual(['a'])
  })

  it('requireCoverage: every fact compared and equal is accepted', () => {
    const result = verifyReceipt(packet, claimWith({ a: 1, b: 'x' }), { a: 1, b: 'x', extra: 2 }, { requireCoverage: true })
    expect(result.accepted).toBe(true)
    expect(result.uncoveredFactKeys).toEqual([])
  })

  it('requireCoverage: a claim with no facts is accepted (it asserts nothing to cover)', () => {
    expect(verifyReceipt(packet, claimWith(), undefined, { requireCoverage: true }).accepted).toBe(true)
    expect(verifyReceipt(packet, claimWith({}), { a: 1 }, { requireCoverage: true }).accepted).toBe(true)
  })

  it('requireCoverage: a contradiction and an uncovered fact are both reported', () => {
    const result = verifyReceipt(packet, claimWith({ a: 1, b: 2 }), { a: 9 }, { requireCoverage: true })
    expect(result.accepted).toBe(false)
    expect(result.contradictions.map((c) => c.key)).toEqual(['a'])
    expect(result.uncoveredFactKeys).toEqual(['b'])
  })

  it('requireCoverage: false behaves like the default', () => {
    const result = verifyReceipt(packet, claimWith({ a: 1 }), {}, { requireCoverage: false })
    expect(result.accepted).toBe(true)
    expect(result.uncoveredFactKeys).toEqual([])
  })

  it('requireCoverage: an inherited state key does not cover a fact', () => {
    const result = verifyReceipt(packet, claimWith({ toString: 'x' }), {}, { requireCoverage: true })
    expect(result.accepted).toBe(false)
    expect(result.uncoveredFactKeys).toEqual(['toString'])
  })

  it('requireCoverage: a rejected claimedFacts is still refused, with the claim problem', () => {
    const bad = { ...claimWith(), claimedFacts: [1] as unknown as Record<string, unknown> }
    const result = verifyReceipt(packet, bad, { a: 1 }, { requireCoverage: true })
    expect(result.accepted).toBe(false)
    expect(result.claimProblems.length).toBe(1)
  })

  it('requireCoverage: an uncovered key is JSON-quoted in the reason', () => {
    const result = verifyReceipt(packet, claimWith({ 'a\nb‮': 1 }), {}, { requireCoverage: true })
    expect(result.reason).not.toMatch(/\n/)
    expect(result.reason).toContain('"a\\nb\\u202e"')
    expect(result.uncoveredFactKeys).toEqual(['a\nb‮'])
  })
})

describe('requireCoverage: option validation (options come from your own code, so bad ones throw)', () => {
  const claim = claimWith({ a: 1 })
  it('rejects a non-object options argument', () => {
    for (const bad of [null, 1, 'x', true, [], () => undefined]) {
      expect(() => verifyReceipt(packet, claim, { a: 1 }, bad as never)).toThrow(TypeError)
    }
  })
  it('rejects a non-boolean requireCoverage', () => {
    for (const bad of ['true', 1, 0, null, {}]) {
      expect(() => verifyReceipt(packet, claim, { a: 1 }, { requireCoverage: bad } as never)).toThrow(TypeError)
    }
  })
  it('rejects an unknown option key, so a typo cannot silently disable the check', () => {
    expect(() => verifyReceipt(packet, claim, { a: 1 }, { requireCoverge: true } as never)).toThrow(TypeError)
  })
  it('treats undefined options and an undefined requireCoverage as the default', () => {
    expect(verifyReceipt(packet, claim, {}, undefined).accepted).toBe(true)
    expect(verifyReceipt(packet, claim, {}, { requireCoverage: undefined } as never).accepted).toBe(true)
  })
  it('reads the option once (a getter cannot flip between validation and use)', () => {
    let reads = 0
    const options = {
      get requireCoverage() {
        reads += 1
        return reads === 1
      },
    }
    verifyReceipt(packet, claim, {}, options)
    expect(reads).toBe(1)
  })
})
