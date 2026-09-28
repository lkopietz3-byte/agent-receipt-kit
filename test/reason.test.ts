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

  it.each([
    ['U+202A left-to-right embedding', '\u202A', '\\u202a'],
    ['U+202B right-to-left embedding', '\u202B', '\\u202b'],
    ['U+202C pop directional formatting', '\u202C', '\\u202c'],
    ['U+202D left-to-right override', '\u202D', '\\u202d'],
    ['U+202E right-to-left override', '\u202E', '\\u202e'],
    ['U+2066 left-to-right isolate', '\u2066', '\\u2066'],
    ['U+2067 right-to-left isolate', '\u2067', '\\u2067'],
    ['U+2068 first strong isolate', '\u2068', '\\u2068'],
    ['U+2069 pop directional isolate', '\u2069', '\\u2069'],
    ['U+200E left-to-right mark', '\u200E', '\\u200e'],
    ['U+200F right-to-left mark', '\u200F', '\\u200f'],
    ['U+061C Arabic letter mark', '\u061C', '\\u061c'],
  ])('escapes the bidirectional control %s so an id cannot reorder the log line', (_name, control, escaped) => {
    const result = verifyReceipt(
      packet,
      {
        packetId: `other${control}`,
        claimedActions: [`act${control}ion`],
        citedEvidenceIds: [`ev${control}`],
        claimedFacts: { [`key${control}`]: 1 },
      },
      { [`key${control}`]: 2 },
    )
    expect(result.reason).not.toContain(control)
    expect(result.reason).toContain(`"act${escaped}ion"`)
    expect(result.reason).toContain(`"ev${escaped}"`)
    expect(result.reason).toContain(`"other${escaped}"`)
    expect(result.reason).toContain(`"key${escaped}"`)
    // The structured fields keep the raw text.
    expect(result.unauthorizedActions).toEqual([`act${control}ion`])
    expect(result.contradictions[0]?.key).toBe(`key${control}`)
  })

  it('escapes terminal escape sequences and other control characters', () => {
    const result = verifyReceipt(packet, {
      packetId: 'pkt-reason',
      claimedActions: ['\u001b[31mred\u001b[0m', 'bell\u0007', 'nul\u0000', 'del\u007f', 'csi\u009b31m'],
      citedEvidenceIds: [],
    })
    // eslint-disable-next-line no-control-regex -- the point of the test is that none survive
    expect(result.reason).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u)
    expect(result.reason).toContain('"\\u001b[31mred\\u001b[0m"')
    expect(result.reason).toContain('"bell\\u0007"')
    expect(result.reason).toContain('"nul\\u0000"')
    expect(result.reason).toContain('"del\\u007f"')
    expect(result.reason).toContain('"csi\\u009b31m"')
  })

  it('leaves ordinary text, non-ASCII letters and emoji readable', () => {
    const result = verifyReceipt(packet, {
      packetId: 'pkt-reason',
      claimedActions: ['envoyer-café', '削除', '👩‍💻'],
      citedEvidenceIds: [],
    })
    expect(result.reason).toContain('"envoyer-café", "削除", "👩‍💻"')
  })

  it('names the packet under review and the packet the claim answers', () => {
    const result = verifyReceipt(packet, { packetId: 'pkt-other', claimedActions: [], citedEvidenceIds: [] })
    expect(result.reason).toBe('Claim answers packet "pkt-other", not the packet under review ("pkt-reason").')
  })

  describe('when the claim is accepted', () => {
    const accepted = { packetId: 'pkt-reason', claimedActions: ['log-in'], citedEvidenceIds: ['screenshot-1'] }
    const base = "Claim matches the issued packet's authority and evidence and answers the correct packet."

    it('says so when the claim asserts no facts', () => {
      const result = verifyReceipt(packet, accepted, { loggedIn: true })
      expect(result.accepted).toBe(true)
      expect(result.reason).toBe(`${base} The claim asserts no facts, so there was nothing to cross-check.`)
    })

    it('does not imply a cross-check when no current state was supplied', () => {
      const result = verifyReceipt(packet, { ...accepted, claimedFacts: { loggedIn: true, cartItemCount: 1 } })
      expect(result.accepted).toBe(true)
      expect(result.reason).toBe(`${base} No current state was supplied, so its 2 claimed fact(s) were not cross-checked.`)
      expect(result.reason).not.toContain('supplied current state')
    })

    it('treats a null current state (possible from JavaScript or JSON) as not supplied', () => {
      const result = verifyReceipt(packet, { ...accepted, claimedFacts: { loggedIn: true } }, null as unknown as undefined)
      expect(result.accepted).toBe(true)
      expect(result.reason).toContain('No current state was supplied')
    })

    it('counts the facts that were checked and names the ones that were not', () => {
      const result = verifyReceipt(
        packet,
        { ...accepted, claimedFacts: { loggedIn: true, cartItemCount: 1, 'coupon\nApplied': 'yes' } },
        { loggedIn: true },
      )
      expect(result.accepted).toBe(true)
      expect(result.reason).toBe(
        `${base} 1 claimed fact(s) agree with the supplied current state. ` +
          '2 claimed fact(s) were not checked because the current state has no value for them: "cartItemCount", "coupon\\nApplied".',
      )
    })

    it('reports a full cross-check without an unchecked list', () => {
      const result = verifyReceipt(packet, { ...accepted, claimedFacts: { loggedIn: true } }, { loggedIn: true, extra: 1 })
      expect(result.reason).toBe(`${base} 1 claimed fact(s) agree with the supplied current state.`)
    })
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
