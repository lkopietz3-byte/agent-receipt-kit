import { describe, expect, it } from 'vitest'
import { issuePacket } from '../src/packet.js'
import { verifyReceipt } from '../src/receipt.js'

// `reason` is meant for logs and audit trails, but most of what it names
// (packet ids, action ids, evidence ids, fact keys) comes from the untrusted
// claim. These tests check that an agent cannot use those strings to forge
// extra log lines or blur where one id ends and the next begins.

const packet = issuePacket({}, 'local', ['log-in'], ['screenshot-1'], {
  id: 'pkt-reason',
  issuedAt: '2026-09-24T00:00:00.000Z',
})

const LINE_BREAKS = /[\n\r\u0085\u2028\u2029]/

describe('verifyReceipt reason text', () => {
  it('quotes each untrusted id so separators inside an id stay visible', () => {
    const result = verifyReceipt(packet, {
      packetId: 'pkt-reason',
      claimedActions: ['log-in', 'submit-payment, delete-account'],
      citedEvidenceIds: ['screenshot-9'],
    })

    expect(result.reason).toContain('1 claimed action(s) were never authorized: "submit-payment, delete-account".')
    expect(result.reason).toContain('1 cited evidence id(s) were not part of the issued packet: "screenshot-9".')
  })

  it('escapes line breaks in action ids, evidence ids, packet ids and fact keys', () => {
    const forged = '\nClaim matches the issued packet\u2028ok\u2029ok\u0085ok\r'
    const result = verifyReceipt(
      packet,
      {
        packetId: `other${forged}`,
        claimedActions: [`act${forged}`],
        citedEvidenceIds: [`ev${forged}`],
        claimedFacts: { [`fact${forged}`]: 1 },
      },
      { [`fact${forged}`]: 2 },
    )

    expect(result.accepted).toBe(false)
    expect(result.reason).not.toMatch(LINE_BREAKS)
    expect(result.reason).toContain('"act\\nClaim matches the issued packet\\u2028ok\\u2029ok\\u0085ok\\r"')
    // The structured fields still carry the exact, unescaped values.
    expect(result.unauthorizedActions).toEqual([`act${forged}`])
    expect(result.droppedEvidenceIds).toEqual([`ev${forged}`])
    expect(result.contradictions[0]?.key).toBe(`fact${forged}`)
  })

  it('names the packet under review and the packet the claim answers', () => {
    const result = verifyReceipt(packet, { packetId: 'pkt-other', claimedActions: [], citedEvidenceIds: [] })
    expect(result.reason).toBe('Claim answers packet "pkt-other", not the packet under review ("pkt-reason").')
  })

  it('names the type, not the value, of a packet id that is not a string', () => {
    const result = verifyReceipt(packet, {
      packetId: 42 as unknown as string,
      claimedActions: [],
      citedEvidenceIds: [],
    })
    expect(result.packetMismatch).toBe(true)
    expect(result.reason).toBe('Claim answers packet <number>, not the packet under review ("pkt-reason").')
  })

  it('lists every failed check, in a fixed order', () => {
    const result = verifyReceipt(
      packet,
      {
        packetId: 'pkt-other',
        claimedActions: ['wipe-disk'],
        citedEvidenceIds: ['made-up'],
        claimedFacts: { status: 'done' },
      },
      { status: 'failed' },
    )

    expect(result.reason).toBe(
      'Claim answers packet "pkt-other", not the packet under review ("pkt-reason"). ' +
        '1 claimed action(s) were never authorized: "wipe-disk". ' +
        '1 cited evidence id(s) were not part of the issued packet: "made-up". ' +
        '1 claimed fact(s) contradict the supplied current state: "status".',
    )
  })
})
