import { describe, expect, it } from 'vitest'
import { issuePacket } from '../src/packet.js'
import { verifyReceipt } from '../src/receipt.js'
import type { AgentClaim, WorkPacket } from '../src/types.js'

// TypeScript callers cannot pass these shapes, but JavaScript callers and
// anything parsed from JSON can. The kit must fail loudly, never quietly
// widen what a packet authorizes.

const fixed = { id: 'pkt-validate', issuedAt: '2026-09-24T00:00:00.000Z' }

describe('issuePacket input checks', () => {
  it('rejects a string where the allowed-action list belongs instead of splitting it into characters', () => {
    expect(() => issuePacket({}, 'local', 'log-in' as unknown as string[], [], fixed)).toThrow(
      new TypeError('allowedActions must be an array (got string).'),
    )
  })

  it('rejects a string evidence list, which would otherwise authorize single-character ids', () => {
    expect(() => issuePacket({}, 'local', [], 'screenshot-1' as unknown as string[], fixed)).toThrow(
      new TypeError('evidenceIds must be an array (got string).'),
    )
  })

  it('names the first non-string entry and its type', () => {
    expect(() => issuePacket({}, 'local', ['ok', 5 as unknown as string], [], fixed)).toThrow(
      new TypeError('allowedActions[1] must be a string (got number).'),
    )
    expect(() => issuePacket({}, 'local', [], [null as unknown as string], fixed)).toThrow(
      new TypeError('evidenceIds[0] must be a string (got null).'),
    )
    expect(() => issuePacket({}, 'local', [], [['nested'] as unknown as string], fixed)).toThrow(
      new TypeError('evidenceIds[0] must be a string (got an array).'),
    )
  })

  it('rejects a missing list', () => {
    expect(() => issuePacket({}, 'local', undefined as unknown as string[], [], fixed)).toThrow(
      new TypeError('allowedActions must be an array (got undefined).'),
    )
  })

  it('accepts empty lists', () => {
    const packet = issuePacket({}, 'observe', [], [], fixed)
    expect(packet.allowedActions).toEqual([])
    expect(packet.evidenceIds).toEqual([])
  })
})

describe('verifyReceipt input checks', () => {
  const packet = issuePacket({}, 'local', ['log-in'], ['screenshot-1'], fixed)
  const claim: AgentClaim = { packetId: 'pkt-validate', claimedActions: ['log-in'], citedEvidenceIds: ['screenshot-1'] }

  it('throws a named TypeError when a claim list is missing or not an array', () => {
    expect(() => verifyReceipt(packet, { packetId: 'pkt-validate' } as AgentClaim)).toThrow(
      new TypeError('claim.claimedActions must be an array (got undefined).'),
    )
    expect(() => verifyReceipt(packet, { ...claim, citedEvidenceIds: 'screenshot-1' as unknown as string[] })).toThrow(
      new TypeError('claim.citedEvidenceIds must be an array (got string).'),
    )
  })

  it('throws a named TypeError when a stored packet list is not an array', () => {
    const broken = { ...packet, allowedActions: null } as unknown as WorkPacket
    expect(() => verifyReceipt(broken, claim)).toThrow(new TypeError('packet.allowedActions must be an array (got null).'))
    const brokenEvidence = { ...packet, evidenceIds: {} } as unknown as WorkPacket
    expect(() => verifyReceipt(brokenEvidence, claim)).toThrow(new TypeError('packet.evidenceIds must be an array (got object).'))
  })

  it('throws this kit\'s own TypeError for a null/undefined/wrong-type packet or claim, not a raw property-access crash', () => {
    // Before the fix, verifyReceipt(null, claim) threw a native
    // "Cannot read properties of null (reading 'allowedActions')" —
    // technically a TypeError, but not one this kit names or documents, and
    // not matchable by message the way every other validation error is.
    expect(() => verifyReceipt(null as unknown as WorkPacket, claim)).toThrow(
      new TypeError('packet must be an object (got null).'),
    )
    expect(() => verifyReceipt(undefined as unknown as WorkPacket, claim)).toThrow(
      new TypeError('packet must be an object (got undefined).'),
    )
    expect(() => verifyReceipt('not-a-packet' as unknown as WorkPacket, claim)).toThrow(
      new TypeError('packet must be an object (got string).'),
    )
    expect(() => verifyReceipt(packet, null as unknown as AgentClaim)).toThrow(
      new TypeError('claim must be an object (got null).'),
    )
    expect(() => verifyReceipt(packet, 123 as unknown as AgentClaim)).toThrow(
      new TypeError('claim must be an object (got number).'),
    )
  })

  it('treats a non-string entry in a claim as unauthorized rather than throwing', () => {
    const result = verifyReceipt(packet, {
      ...claim,
      claimedActions: ['log-in', 7 as unknown as string],
      citedEvidenceIds: [{} as unknown as string],
    })
    expect(result.accepted).toBe(false)
    expect(result.unauthorizedActions).toEqual([7])
    expect(result.droppedEvidenceIds).toEqual([{}])
    expect(result.reason).toContain('never authorized: <number>.')
  })
})
