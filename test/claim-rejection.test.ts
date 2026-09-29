import { describe, expect, it } from 'vitest'
import { issuePacket } from '../src/packet.js'
import { verifyReceipt } from '../src/receipt.js'
import type { AgentClaim, ReceiptResult } from '../src/types.js'

// The trust boundary. The packet (and currentState) come from the caller's own
// code, so a malformed one throws. The claim is what the agent being checked
// produced, so a malformed claim is REJECTED in the result: accepted is false,
// claimProblems and reason say what is wrong, and nothing throws. The two
// exceptions are 0.1.1 behavior kept as it was: a claim that is not an object,
// and a claim list that is not an array, still throw a TypeError.

const packet = issuePacket({}, 'local', ['log-in'], ['screenshot-1'], {
  id: 'pkt-claim',
  issuedAt: '2026-09-28T00:00:00.000Z',
})
const good: AgentClaim = { packetId: 'pkt-claim', claimedActions: ['log-in'], citedEvidenceIds: ['screenshot-1'] }
const asClaim = (value: unknown): AgentClaim => value as AgentClaim
const verify = (claim: unknown): ReceiptResult => verifyReceipt(packet, asClaim(claim))

// eslint-disable-next-line no-sparse-arrays -- the hole is the input under test
const holeAtOne = ['log-in', , 'log-in'] as string[]

describe('a well-formed claim has no claim problems', () => {
  it('reports an empty claimProblems on accepted and rejected results', () => {
    expect(verify(good).claimProblems).toEqual([])
    expect(verify({ ...good, claimedActions: ['wipe-disk'] }).claimProblems).toEqual([])
  })
})

describe('element problems in claim lists reject the claim and never throw', () => {
  it('rejects a numeric action, names the index, and does not put the number in unauthorizedActions', () => {
    const result = verify({ ...good, claimedActions: [7] })
    expect(result.accepted).toBe(false)
    expect(result.claimProblems).toEqual(['claim.claimedActions[0] is not a string (got number).'])
    expect(result.unauthorizedActions).toEqual([])
    expect(result.reason).toBe(
      'The claim is malformed, so it cannot be accepted: claim.claimedActions[0] is not a string (got number).',
    )
  })

  it('joins several problems into one reason, in list order, separated by single spaces', () => {
    const result = verify({ ...good, claimedActions: [7, null], citedEvidenceIds: [false], claimedFacts: 1 })
    expect(result.reason).toBe(
      'The claim is malformed, so it cannot be accepted: ' +
        'claim.claimedActions[0] is not a string (got number). ' +
        'claim.claimedActions[1] is not a string (got null). ' +
        'claim.citedEvidenceIds[0] is not a string (got boolean). ' +
        'claim.claimedFacts is not a plain object (got number).',
    )
  })

  it('reads a proxy array whose keys arrive out of order as if they were in index order', () => {
    const target = new Array<unknown>(4)
    target[0] = 'log-in'
    target[3] = 'log-in'
    const shuffled = new Proxy(target, { ownKeys: () => ['3', 'length', '0'] })
    const result = verify({ ...good, claimedActions: shuffled })
    expect(result.claimProblems).toEqual(['claim.claimedActions[1..2] are missing (the array has holes).'])
    const reversed = new Proxy(['log-in', 7, 'wipe-disk'], { ownKeys: () => ['2', '1', '0', 'length'] })
    const second = verify({ ...good, claimedActions: reversed })
    expect(second.claimProblems).toEqual(['claim.claimedActions[1] is not a string (got number).'])
    expect(second.unauthorizedActions).toEqual(['wipe-disk'])
  })

  it('still checks the string entries around a bad one', () => {
    const result = verify({ ...good, claimedActions: ['log-in', null, 'wipe-disk'], citedEvidenceIds: ['made-up', {}] })
    expect(result.accepted).toBe(false)
    expect(result.unauthorizedActions).toEqual(['wipe-disk'])
    expect(result.droppedEvidenceIds).toEqual(['made-up'])
    expect(result.claimProblems).toEqual([
      'claim.claimedActions[1] is not a string (got null).',
      'claim.citedEvidenceIds[1] is not a string (got object).',
    ])
  })

  it('names the kind of every non-string entry without reading its content', () => {
    const hostile = { toString: () => { throw new Error('boom') }, toJSON: () => { throw new Error('boom') } }
    const result = verify({
      ...good,
      claimedActions: [1n, Symbol('s'), () => 1, [1], hostile, undefined, true],
    })
    expect(result.accepted).toBe(false)
    expect(result.claimProblems).toEqual([
      'claim.claimedActions[0] is not a string (got bigint).',
      'claim.claimedActions[1] is not a string (got a symbol).',
      'claim.claimedActions[2] is not a string (got function).',
      'claim.claimedActions[3] is not a string (got an array).',
      'claim.claimedActions[4] is not a string (got object).',
      'claim.claimedActions[5] is not a string (got undefined).',
      'claim.claimedActions[6] is not a string (got boolean).',
    ])
  })

  it('rejects a hole in a list, which filter() would skip and so accept', () => {
    const result = verify({ ...good, claimedActions: holeAtOne })
    expect(result.accepted).toBe(false)
    expect(result.claimProblems).toEqual(['claim.claimedActions[1] is missing (the array has a hole).'])
    // eslint-disable-next-line no-sparse-arrays -- the hole is the input under test
    expect(verify({ ...good, citedEvidenceIds: [, 'screenshot-1'] }).claimProblems).toEqual([
      'claim.citedEvidenceIds[0] is missing (the array has a hole).',
    ])
  })

  it('reports a run of holes once, and a trailing gap', () => {
    const run = new Array<string>(5)
    run[0] = 'log-in'
    run[4] = 'log-in'
    expect(verify({ ...good, claimedActions: run }).claimProblems).toEqual([
      'claim.claimedActions[1..3] are missing (the array has holes).',
    ])
    const trailing = new Array<string>(3)
    trailing[0] = 'log-in'
    expect(verify({ ...good, claimedActions: trailing }).claimProblems).toEqual([
      'claim.claimedActions[1..2] are missing (the array has holes).',
    ])
    const lastOnly = new Array<string>(2)
    lastOnly[0] = 'log-in'
    expect(verify({ ...good, claimedActions: lastOnly }).claimProblems).toEqual([
      'claim.claimedActions[1] is missing (the array has a hole).',
    ])
  })

  it('does not let an inherited index fill a hole, and ignores non-index properties on the array', () => {
    const inherited = Object.getOwnPropertyDescriptor(Array.prototype, 1)
    Object.defineProperty(Array.prototype, 1, { value: 'log-in', configurable: true, writable: true })
    try {
      expect(verify({ ...good, claimedActions: holeAtOne }).claimProblems).toEqual([
        'claim.claimedActions[1] is missing (the array has a hole).',
      ])
    } finally {
      if (inherited) Object.defineProperty(Array.prototype, 1, inherited)
      else delete (Array.prototype as unknown as Record<number, unknown>)[1]
    }
    const tagged = Object.assign(['log-in'], { note: 'x', '-1': 'y', '01': 'z' })
    const result = verify({ ...good, claimedActions: tagged })
    expect(result.accepted).toBe(true)
    expect(result.claimProblems).toEqual([])
  })

  it.each([
    ['empty', ''],
    ['spaces', '  '],
    ['a zero-width space', '​'],
    ['a bidi isolate', '⁦'],
    ['an Arabic letter mark', '؜'],
  ])('rejects a blank entry (%s) even when the packet lists that exact blank string', (_name, blank) => {
    const lax = issuePacket({}, 'local', [blank], [blank], { id: 'pkt-blank', issuedAt: 'T' })
    const claim = { packetId: 'pkt-blank', claimedActions: [blank], citedEvidenceIds: [blank] }
    const result = verifyReceipt(lax, claim)
    expect(result.accepted).toBe(false)
    expect(result.unauthorizedActions).toEqual([])
    expect(result.claimProblems).toEqual([
      'claim.claimedActions[0] shows nothing (empty, or only whitespace and invisible characters).',
      'claim.citedEvidenceIds[0] shows nothing (empty, or only whitespace and invisible characters).',
    ])
  })

  it('also reports a blank entry the packet does not list as unauthorized', () => {
    const result = verify({ ...good, claimedActions: ['⁦'] })
    expect(result.accepted).toBe(false)
    expect(result.unauthorizedActions).toEqual(['⁦'])
    expect(result.claimProblems).toHaveLength(1)
    expect(result.reason).toContain('"\\u2066"')
  })

  it('caps how many problems one list reports, and says how many were left out', () => {
    const many = Array.from({ length: 30 }, (_, index) => index)
    const result = verify({ ...good, claimedActions: many })
    expect(result.accepted).toBe(false)
    expect(result.claimProblems).toHaveLength(21)
    expect(result.claimProblems[19]).toBe('claim.claimedActions[19] is not a string (got number).')
    expect(result.claimProblems[20]).toBe('claim.claimedActions has 10 more problems that are not listed.')
    const exactly = verify({ ...good, claimedActions: many.slice(0, 20) })
    expect(exactly.claimProblems).toHaveLength(20)
    const oneOver = verify({ ...good, claimedActions: many.slice(0, 21) })
    expect(oneOver.claimProblems[20]).toBe('claim.claimedActions has 1 more problem that is not listed.')
  })

  it('does not walk an enormous sparse array index by index', () => {
    const huge = new Array<string>(2 ** 32 - 1)
    huge[0] = 'log-in'
    const started = Date.now()
    const result = verify({ ...good, claimedActions: huge })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(result.accepted).toBe(false)
    expect(result.claimProblems).toEqual(['claim.claimedActions[1..4294967294] are missing (the array has holes).'])
  })
})

describe('a claim that names a bad packet id is a mismatch, not a throw', () => {
  it.each([
    ['missing', undefined, '<undefined>'],
    ['a number', 42, '<number>'],
    ['null', null, '<object>'],
    ['an object', {}, '<object>'],
  ])('%s', (_name, packetId, shown) => {
    const result = verify({ ...good, packetId })
    expect(result.accepted).toBe(false)
    expect(result.packetMismatch).toBe(true)
    expect(result.reason).toBe(`Claim answers packet ${shown}, not the packet under review ("pkt-claim").`)
  })

  it('never lets a missing or blank claim id match, whatever the packet id is', () => {
    for (const packetId of ['', '​', ' ']) {
      expect(() => verifyReceipt({ ...packet, id: packetId }, good)).toThrow(TypeError)
    }
    for (const bad of [undefined, '', '  ', '⁦']) {
      const result = verify({ ...good, packetId: bad })
      expect(result.packetMismatch).toBe(true)
      expect(result.accepted).toBe(false)
    }
  })
})

describe('a non-plain claimedFacts rejects the claim and never throws', () => {
  class Facts {
    cartItemCount = 1
  }
  it.each([
    ['true', true, 'boolean'],
    ['a string', 'cartItemCount', 'string'],
    ['a number', 3, 'number'],
    ['null', null, 'null'],
    ['an array', [1], 'an array'],
    ['a Map', new Map([['cartItemCount', 1]]), 'a non-plain object'],
    ['a Set', new Set(['cartItemCount']), 'a non-plain object'],
    ['a Date', new Date(0), 'a non-plain object'],
    ['a RegExp', /x/u, 'a non-plain object'],
    ['a class instance', new Facts(), 'a non-plain object'],
  ])('claimedFacts that is %s', (_name, facts, got) => {
    const result = verifyReceipt(packet, asClaim({ ...good, claimedFacts: facts }), { cartItemCount: 2 })
    expect(result.accepted).toBe(false)
    expect(result.claimProblems).toEqual([`claim.claimedFacts is not a plain object (got ${got}).`])
    expect(result.contradictions).toEqual([])
    expect(result.coverage).toEqual({
      stateSupplied: true,
      claimedFactCount: 0,
      comparedFactCount: 0,
      uncheckedFactKeys: [],
    })
    expect(result.reason).toBe(
      `The claim is malformed, so it cannot be accepted: claim.claimedFacts is not a plain object (got ${got}).`,
    )
  })

  it('accepts an absent claimedFacts and a plain or null-prototype one', () => {
    expect(verify(good).accepted).toBe(true)
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 })
    expect(verify({ ...good, claimedFacts: nullPrototype }).claimProblems).toEqual([])
  })
})

describe('what still throws (0.1.1 behavior, kept)', () => {
  it('throws for a claim that is not an object', () => {
    for (const value of [null, undefined, 123, 'claim', [], true]) {
      expect(() => verify(value)).toThrow(TypeError)
    }
    expect(() => verify(null)).toThrow(new TypeError('claim must be an object (got null).'))
  })

  it('throws for a claim list that is missing or not an array', () => {
    expect(() => verify({ packetId: 'pkt-claim' })).toThrow(
      new TypeError('claim.claimedActions must be an array (got undefined).'),
    )
    expect(() => verify({ ...good, citedEvidenceIds: 'screenshot-1' })).toThrow(
      new TypeError('claim.citedEvidenceIds must be an array (got string).'),
    )
  })

  it('throws for a malformed packet, whatever the claim looks like', () => {
    expect(() => verifyReceipt({ ...packet, id: undefined } as never, good)).toThrow(
      new TypeError('packet.id must be a non-empty string (got undefined).'),
    )
    expect(() => verifyReceipt({ ...packet, allowedActions: [7] } as never, good)).toThrow(
      new TypeError('packet.allowedActions[0] must be a string (got number).'),
    )
  })
})

describe('a malformed claim is never accepted', () => {
  it('holds for every malformed shape, with and without a current state', () => {
    const malformed: unknown[] = [
      { ...good, claimedActions: [7] },
      { ...good, claimedActions: holeAtOne },
      { ...good, claimedActions: [''] },
      { ...good, citedEvidenceIds: [null] },
      { ...good, claimedFacts: true },
      { ...good, claimedFacts: null },
      { ...good, claimedFacts: new Map() },
      { ...good, packetId: undefined },
      { ...good, packetId: 5 },
    ]
    const lax = issuePacket({}, 'local', ['log-in', '', 'x'], ['screenshot-1', ''], { id: 'pkt-claim', issuedAt: 'T' })
    for (const claim of malformed) {
      for (const state of [undefined, {}, { a: 1 }]) {
        expect(verifyReceipt(lax, asClaim(claim), state).accepted).toBe(false)
      }
    }
  })
})
