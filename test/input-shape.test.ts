import { describe, expect, it } from 'vitest'
import { issuePacket } from '../src/packet.js'
import { verifyReceipt } from '../src/receipt.js'
import { createRefutationTrail } from '../src/trail.js'
import type { AgentClaim, CurrentState, WorkPacket } from '../src/types.js'

// Regression inputs for the external audit (ARK-001, OBS-01 to OBS-04) and the
// shared bug classes: identity that is missing or blank, sparse lists,
// non-plain containers, and caller input that is read more than once.

const fixed = { id: 'pkt-shape', issuedAt: '2026-09-28T00:00:00.000Z' }
const packet = issuePacket({}, 'local', ['log-in'], ['screenshot-1'], fixed)
const claim: AgentClaim = { packetId: 'pkt-shape', claimedActions: ['log-in'], citedEvidenceIds: ['screenshot-1'] }

const asPacket = (value: unknown): WorkPacket => value as WorkPacket
const asClaim = (value: unknown): AgentClaim => value as AgentClaim

describe('identity must be a present, visible string (OBS-01)', () => {
  it('rejects a packet and a claim that both have no id, instead of matching undefined with undefined', () => {
    expect(() =>
      verifyReceipt(asPacket({ allowedActions: [], evidenceIds: [] }), asClaim({ claimedActions: [], citedEvidenceIds: [] })),
    ).toThrow(new TypeError('packet.id must be a non-empty string (got undefined).'))
  })

  it('names claim.packetId when only the claim has no id', () => {
    expect(() => verifyReceipt(packet, asClaim({ claimedActions: [], citedEvidenceIds: [] }))).toThrow(
      new TypeError('claim.packetId must be a non-empty string (got undefined).'),
    )
  })

  it.each([
    ['a number', 7, 'number'],
    ['null', null, 'null'],
    ['an array', ['pkt-shape'], 'an array'],
    ['an object', {}, 'object'],
  ])('rejects %s as an id', (_name, id, got) => {
    expect(() => verifyReceipt(asPacket({ ...packet, id }), claim)).toThrow(
      new TypeError(`packet.id must be a non-empty string (got ${got}).`),
    )
    expect(() => verifyReceipt(packet, asClaim({ ...claim, packetId: id }))).toThrow(
      new TypeError(`claim.packetId must be a non-empty string (got ${got}).`),
    )
  })

  it.each([
    ['empty', ''],
    ['spaces', '   '],
    ['a tab and newline', '\t\n'],
    ['a zero-width space', '​'],
    ['a left-to-right isolate (U+2066)', '⁦'],
    ['a pop directional isolate (U+2069)', '⁩'],
    ['an Arabic letter mark (U+061C)', '؜'],
    ['a soft hyphen and a Hangul filler', '­ㅤ'],
    ['a byte order mark', '﻿'],
    ['a no-break space', ' '],
  ])('rejects an id that shows nothing (%s), which would otherwise match another blank id', (_name, blank) => {
    expect(() => verifyReceipt(asPacket({ ...packet, id: blank }), asClaim({ ...claim, packetId: blank }))).toThrow(
      new TypeError('packet.id must be a non-empty string (got a string with nothing visible in it).'),
    )
    expect(() => verifyReceipt(packet, asClaim({ ...claim, packetId: blank }))).toThrow(
      new TypeError('claim.packetId must be a non-empty string (got a string with nothing visible in it).'),
    )
  })

  it('still compares ids exactly: surrounding spaces make a different id, not an error', () => {
    const result = verifyReceipt(packet, { ...claim, packetId: ' pkt-shape' })
    expect(result.packetMismatch).toBe(true)
    expect(result.accepted).toBe(false)
  })
})

describe('lists must be dense arrays of strings (OBS-02, OBS-04)', () => {
  it('rejects a numeric entry in a stored packet list, even when the claim repeats the same number', () => {
    expect(() =>
      verifyReceipt(asPacket({ ...packet, allowedActions: [7] }), asClaim({ ...claim, claimedActions: [7] })),
    ).toThrow(new TypeError('packet.allowedActions[0] must be a string (got number).'))
    expect(() => verifyReceipt(asPacket({ ...packet, evidenceIds: ['ok', null] }), claim)).toThrow(
      new TypeError('packet.evidenceIds[1] must be a string (got null).'),
    )
  })

  it('rejects a non-string entry in a claim list instead of reporting it', () => {
    expect(() => verifyReceipt(packet, asClaim({ ...claim, claimedActions: ['log-in', 7] }))).toThrow(
      new TypeError('claim.claimedActions[1] must be a string (got number).'),
    )
    expect(() => verifyReceipt(packet, asClaim({ ...claim, citedEvidenceIds: [{}] }))).toThrow(
      new TypeError('claim.citedEvidenceIds[0] must be a string (got object).'),
    )
  })

  it('rejects a hole in a claim list, which filter() would skip and so accept', () => {
    // eslint-disable-next-line no-sparse-arrays -- the hole is the test input
    const sparse = ['log-in', , 'log-in']
    expect(() => verifyReceipt(packet, asClaim({ ...claim, claimedActions: sparse }))).toThrow(
      new TypeError('claim.claimedActions[1] is missing (the array has a hole).'),
    )
    // eslint-disable-next-line no-sparse-arrays -- the hole is the test input
    expect(() => verifyReceipt(packet, asClaim({ ...claim, citedEvidenceIds: [, 'screenshot-1'] }))).toThrow(
      new TypeError('claim.citedEvidenceIds[0] is missing (the array has a hole).'),
    )
  })

  it('rejects a hole in a stored packet list', () => {
    // eslint-disable-next-line no-sparse-arrays -- the hole is the test input
    expect(() => verifyReceipt(asPacket({ ...packet, allowedActions: ['log-in', ,] }), claim)).toThrow(
      new TypeError('packet.allowedActions[1] is missing (the array has a hole).'),
    )
    const trailing = new Array<string>(2)
    trailing[0] = 'screenshot-1'
    expect(() => verifyReceipt(asPacket({ ...packet, evidenceIds: trailing }), claim)).toThrow(
      new TypeError('packet.evidenceIds[1] is missing (the array has a hole).'),
    )
  })

  it('does not let an inherited array index fill a hole', () => {
    const inherited = Object.getOwnPropertyDescriptor(Array.prototype, 1)
    Object.defineProperty(Array.prototype, 1, { value: 'log-in', configurable: true, writable: true })
    try {
      // eslint-disable-next-line no-sparse-arrays -- the hole is the test input
      expect(() => verifyReceipt(packet, asClaim({ ...claim, claimedActions: ['log-in', ,] }))).toThrow(
        new TypeError('claim.claimedActions[1] is missing (the array has a hole).'),
      )
    } finally {
      if (inherited) Object.defineProperty(Array.prototype, 1, inherited)
      else delete (Array.prototype as unknown as Record<number, unknown>)[1]
    }
  })

  it('rejects a hole in the lists given to issuePacket', () => {
    // eslint-disable-next-line no-sparse-arrays -- the hole is the test input
    expect(() => issuePacket({}, 'local', ['a', , 'b'] as string[], [], fixed)).toThrow(
      new TypeError('allowedActions[1] is missing (the array has a hole).'),
    )
    // eslint-disable-next-line no-sparse-arrays -- the hole is the test input
    expect(() => issuePacket({}, 'local', [], [, 'b'] as string[], fixed)).toThrow(
      new TypeError('evidenceIds[0] is missing (the array has a hole).'),
    )
  })
})

describe('claimedFacts and currentState must be plain objects (OBS-03)', () => {
  const withFacts = (claimedFacts: unknown): AgentClaim => asClaim({ ...claim, claimedFacts })
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
  ])('rejects claimedFacts that is %s, which used to read as zero facts and be accepted', (_name, facts, got) => {
    expect(() => verifyReceipt(packet, withFacts(facts), { cartItemCount: 2 })).toThrow(
      new TypeError(`claim.claimedFacts must be a plain object (got ${got}).`),
    )
  })

  it.each([
    ['a string', 'x', 'string'],
    ['a number', 0, 'number'],
    ['false', false, 'boolean'],
    ['an array', [{ cartItemCount: 2 }], 'an array'],
    ['a Map', new Map([['cartItemCount', 2]]), 'a non-plain object'],
    ['a Date', new Date(0), 'a non-plain object'],
    ['a class instance', new Facts(), 'a non-plain object'],
  ])('rejects currentState that is %s, which used to leave every fact unchecked', (_name, state, got) => {
    expect(() => verifyReceipt(packet, withFacts({ cartItemCount: 1 }), state as unknown as CurrentState)).toThrow(
      new TypeError(`currentState must be a plain object (got ${got}).`),
    )
  })

  it('accepts a missing claimedFacts, and a plain or null-prototype claimedFacts and currentState', () => {
    expect(verifyReceipt(packet, claim, { cartItemCount: 1 }).accepted).toBe(true)
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, { cartItemCount: 1 })
    expect(verifyReceipt(packet, withFacts(nullPrototype), nullPrototype).accepted).toBe(true)
  })

  it('still treats a null or undefined currentState as no observation', () => {
    const result = verifyReceipt(packet, withFacts({ cartItemCount: 1 }), null as unknown as undefined)
    expect(result.accepted).toBe(true)
    expect(verifyReceipt(packet, withFacts({ cartItemCount: 1 }), undefined).accepted).toBe(true)
  })

  it('accepts a plain object from another realm, whose prototype is not this realm\'s Object.prototype', () => {
    // A `vm` context's plain objects look like this: the prototype's own prototype is null.
    const foreign = Object.assign(Object.create(Object.create(null) as object) as Record<string, unknown>, { cartItemCount: 1 })
    expect(Object.getPrototypeOf(foreign)).not.toBe(Object.prototype)
    expect(verifyReceipt(packet, withFacts({ cartItemCount: 2 }), foreign).contradictions).toHaveLength(1)
    expect(verifyReceipt(packet, withFacts(foreign), { cartItemCount: 1 }).accepted).toBe(true)
  })
})

describe('caller input is read once (class 1)', () => {
  it('reads every packet, claim, fact and state field exactly once', () => {
    const reads: Record<string, number> = {}
    const counted = <T>(name: string, value: T): T => {
      reads[name] = (reads[name] ?? 0) + 1
      return value
    }
    const facts = {
      get cartItemCount() {
        return counted('fact', 1)
      },
    }
    const state = {
      get cartItemCount() {
        return counted('state', 1)
      },
    }
    const livePacket = {
      get id() {
        return counted('packet.id', 'pkt-shape')
      },
      get allowedActions() {
        return counted('packet.allowedActions', ['log-in'])
      },
      get evidenceIds() {
        return counted('packet.evidenceIds', ['screenshot-1'])
      },
    }
    const liveClaim = {
      get packetId() {
        return counted('claim.packetId', 'pkt-shape')
      },
      get claimedActions() {
        return counted('claim.claimedActions', ['log-in'])
      },
      get citedEvidenceIds() {
        return counted('claim.citedEvidenceIds', ['screenshot-1'])
      },
      get claimedFacts() {
        return counted('claim.claimedFacts', facts)
      },
    }
    const result = verifyReceipt(asPacket(livePacket), asClaim(liveClaim), state)
    expect(result.accepted).toBe(true)
    expect(reads).toEqual({
      'packet.id': 1,
      'packet.allowedActions': 1,
      'packet.evidenceIds': 1,
      'claim.packetId': 1,
      'claim.claimedActions': 1,
      'claim.citedEvidenceIds': 1,
      'claim.claimedFacts': 1,
      fact: 1,
      state: 1,
    })
  })

  it('judges the value it validated: a list that changes between reads cannot smuggle an action past the check', () => {
    let reads = 0
    const shifty = {
      ...claim,
      get claimedActions() {
        reads += 1
        return reads === 1 ? ['log-in'] : ['wipe-disk']
      },
    }
    const result = verifyReceipt(packet, shifty)
    expect(result.accepted).toBe(true)
    expect(result.unauthorizedActions).toEqual([])
  })

  it('does not return the caller arrays: later edits cannot change a returned result', () => {
    const actions = ['log-in', 'wipe-disk']
    const result = verifyReceipt(packet, { ...claim, claimedActions: actions })
    actions.push('another')
    expect(result.unauthorizedActions).toEqual(['wipe-disk'])
  })

  it('issuePacket copies the list it validated, not a second read of it', () => {
    let reads = 0
    const shifty = new Proxy(['log-in'], {
      get(target, key, receiver) {
        if (key === '0') {
          reads += 1
          return reads === 1 ? 'log-in' : 5
        }
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    const issued = issuePacket({}, 'local', shifty, [], fixed)
    expect(issued.allowedActions).toEqual(['log-in'])
    expect(reads).toBe(1)
  })
})

describe('issuePacket options', () => {
  it('needs a non-blank string when an id is given, and only undefined means "generate one"', () => {
    expect(() => issuePacket({}, 'local', [], [], { id: '' })).toThrow(
      new TypeError('options.id must be a non-empty string (got a string with nothing visible in it).'),
    )
    expect(() => issuePacket({}, 'local', [], [], { id: '⁦' })).toThrow(TypeError)
    expect(() => issuePacket({}, 'local', [], [], { id: 7 as unknown as string })).toThrow(
      new TypeError('options.id must be a non-empty string (got number).'),
    )
    expect(() => issuePacket({}, 'local', [], [], { id: null as unknown as string })).toThrow(
      new TypeError('options.id must be a non-empty string (got null).'),
    )
    expect(issuePacket({}, 'local', [], [], { id: undefined } as unknown as { id?: string }).id).toMatch(/^pkt-/u)
  })

  it('needs a non-blank string when issuedAt is given', () => {
    expect(() => issuePacket({}, 'local', [], [], { issuedAt: 5 as unknown as string })).toThrow(
      new TypeError('options.issuedAt must be a non-empty string (got number).'),
    )
    expect(() => issuePacket({}, 'local', [], [], { issuedAt: ' ' })).toThrow(TypeError)
    expect(issuePacket({}, 'local', [], [], { issuedAt: undefined } as unknown as { issuedAt?: string }).issuedAt).toMatch(/^\d{4}-/u)
  })

  it('needs options to be an object when given', () => {
    expect(() => issuePacket({}, 'local', [], [], null as unknown as undefined)).toThrow(
      new TypeError('options must be a plain object (got null).'),
    )
    expect(() => issuePacket({}, 'local', [], [], [] as unknown as undefined)).toThrow(
      new TypeError('options must be a plain object (got an array).'),
    )
  })
})

describe('refutation trail input checks', () => {
  const result = verifyReceipt(packet, { ...claim, claimedActions: ['wipe-disk'] })

  it('rejects a claim or result that is not an object, with this kit\'s own TypeError', () => {
    const trail = createRefutationTrail()
    expect(() => trail.record(null as unknown as AgentClaim, result)).toThrow(
      new TypeError('claim must be an object (got null).'),
    )
    expect(() => trail.record(claim, undefined as unknown as typeof result)).toThrow(
      new TypeError('result must be an object (got undefined).'),
    )
  })

  it('rejects a claim whose packetId is missing or blank', () => {
    const trail = createRefutationTrail()
    expect(() => trail.record(asClaim({ claimedActions: [] }), result)).toThrow(
      new TypeError('claim.packetId must be a non-empty string (got undefined).'),
    )
    expect(() => trail.record(asClaim({ packetId: '​' }), result)).toThrow(TypeError)
  })

  it('rejects a recordedAt that is not a non-blank string, and does not use up a sequence number', () => {
    const trail = createRefutationTrail()
    expect(() => trail.record(claim, result, Symbol('when') as unknown as string)).toThrow(
      new TypeError('recordedAt must be a non-empty string (got a symbol).'),
    )
    expect(() => trail.record(claim, result, '')).toThrow(TypeError)
    expect(() => trail.record(claim, result, 12 as unknown as string)).toThrow(
      new TypeError('recordedAt must be a non-empty string (got number).'),
    )
    expect(trail.list()).toEqual([])
    expect(trail.record(claim, result, 'T').id).toBe('refute-0-T')
  })
})
