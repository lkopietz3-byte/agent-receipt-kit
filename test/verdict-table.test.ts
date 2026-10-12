import { describe, expect, it } from 'vitest'
import { issuePacket } from '../src/packet.js'
import { verifyReceipt } from '../src/receipt.js'
import { runInNewRealm } from './realm.js'
import type { AgentClaim, ReceiptResult } from '../src/types.js'

// A verdict table: each named case states the verdict the kit must give. The
// first block holds the regressions found by the 2026-10-10 hunt (live
// objects the comparison could not see through, snapshots, escaping, blank
// text). The second block guards behavior that was checked and found sound,
// so a fix to the first cannot loosen it.

const packet = issuePacket({}, 'local', ['log-in', 'add-to-cart'], ['screenshot-1'], {
  id: 'pkt-verdict',
  issuedAt: '2026-10-10T00:00:00.000Z',
})

function claimWith(facts: unknown, extra: Record<string, unknown> = {}): AgentClaim {
  return {
    packetId: 'pkt-verdict',
    claimedActions: ['log-in'],
    citedEvidenceIds: ['screenshot-1'],
    claimedFacts: facts as Record<string, unknown>,
    ...extra,
  }
}

function check(facts: unknown, state: unknown): ReceiptResult {
  return verifyReceipt(packet, claimWith(facts), state as Record<string, unknown>)
}

describe('verdict table: regressions from the 2026-10-10 hunt', () => {
  it('an array with its own `keys` method is compared by content, so a different array contradicts', () => {
    const claimed = [1, 2, 3]
    Object.defineProperty(claimed, 'keys', { value: () => [][Symbol.iterator](), enumerable: false })
    const result = check({ rows: claimed }, { rows: [9, 9, 9] })
    expect(result.accepted).toBe(false)
    expect(result.contradictions.map((c) => c.key)).toEqual(['rows'])
  })

  it('an array with its own `keys` method still matches a genuinely equal array', () => {
    const claimed = [1, 2, 3]
    Object.defineProperty(claimed, 'keys', { value: () => [][Symbol.iterator](), enumerable: false })
    expect(check({ rows: claimed }, { rows: [1, 2, 3] }).accepted).toBe(true)
  })

  it('claimedFacts that inherit through a null-prototype prototype are rejected, never read as "no facts"', () => {
    const facts = Object.create(Object.create(null, { rows: { value: 5, enumerable: true } }) as object) as unknown
    const result = check(facts, { rows: 6 })
    expect(result.accepted).toBe(false)
    expect(result.claimProblems.join(' ')).toMatch(/claimedFacts is not a plain object/)
  })

  it('currentState that inherits through a null-prototype prototype throws instead of reading as empty', () => {
    const state = Object.create(Object.create(null, { rows: { value: 5, enumerable: true } }) as object) as unknown
    expect(() => check({ rows: 6 }, state)).toThrow(TypeError)
  })

  it('a nested object that inherits through a null-prototype prototype is never silently equal', () => {
    const hidden = Object.create(Object.create(null, { secret: { value: 1, enumerable: true } }) as object) as unknown
    const result = check({ box: hidden }, { box: {} })
    expect(result.accepted).toBe(false)
    expect(result.contradictions.map((c) => c.key)).toEqual(['box'])
  })

  it('a Date with its own getTime is compared by its real time value', () => {
    const claimed = new Date(1_000)
    Object.defineProperty(claimed, 'getTime', { value: () => 5_000 })
    const result = check({ at: claimed }, { at: new Date(5_000) })
    expect(result.accepted).toBe(false)
    expect(result.contradictions.map((c) => c.key)).toEqual(['at'])
  })

  it('a Date with its own getTime still matches a Date with the same real time', () => {
    const claimed = new Date(1_000)
    Object.defineProperty(claimed, 'getTime', { value: () => 5_000 })
    expect(check({ at: claimed }, { at: new Date(1_000) }).accepted).toBe(true)
  })

  it('a cross-realm Date equal in time matches, and one that differs contradicts', () => {
    const foreign = runInNewRealm('new Date(1760000000000)') as Date
    expect(check({ at: foreign }, { at: new Date(1760000000000) }).accepted).toBe(true)
    expect(check({ at: new Date(1760000000000) }, { at: foreign }).accepted).toBe(true)
    expect(check({ at: foreign }, { at: new Date(1760000000001) }).accepted).toBe(false)
  })

  it('an object that only claims to be a Date is not one', () => {
    const fake = { getTime: () => 5_000, [Symbol.toStringTag]: 'Date' }
    expect(check({ at: fake }, { at: new Date(5_000) }).accepted).toBe(false)
  })

  it('the accepted result carries a snapshot that a later getter change cannot alter', () => {
    let calls = 0
    const facts: Record<string, unknown> = {}
    Object.defineProperty(facts, 'count', { enumerable: true, get: () => (calls += 1) })
    const actions = ['log-in']
    const result = verifyReceipt(
      packet,
      { packetId: 'pkt-verdict', claimedActions: actions, citedEvidenceIds: ['screenshot-1'], claimedFacts: facts },
      { count: 1 },
    )
    expect(result.accepted).toBe(true)
    const seen = calls
    actions.push('wipe-disk')
    expect(result.snapshot.claimedActions).toEqual(['log-in'])
    expect(result.snapshot.citedEvidenceIds).toEqual(['screenshot-1'])
    expect(result.snapshot.claimedFacts).toEqual({ count: 1 })
    expect(calls).toBe(seen)
  })

  it('the snapshot is a deep copy, not the agent\'s object', () => {
    const nested = { list: [1, { deep: true }] }
    const result = check({ nested }, { nested: { list: [1, { deep: true }] } })
    expect(result.accepted).toBe(true)
    nested.list.push(2)
    expect(result.snapshot.claimedFacts.nested).toEqual({ list: [1, { deep: true }] })
  })

  it('a zero-width space and a tag character in an id are escaped in the reason text', () => {
    const result = verifyReceipt(packet, {
      packetId: 'pkt-verdict',
      claimedActions: ['wipe​disk', 'a\u{E0041}b'],
      citedEvidenceIds: [],
    })
    expect(result.accepted).toBe(false)
    expect(result.reason).not.toContain('​')
    expect(result.reason).not.toContain('\u{E0041}')
    expect(result.reason).toContain('wipe\\u200bdisk')
    expect(result.reason).toContain('a\\udb40\\udc41b')
    // The structured field keeps the exact text.
    expect(result.unauthorizedActions[0]).toBe('wipe​disk')
  })

  it('an empty string is rejected as an allowed action and as an evidence id at issuePacket', () => {
    expect(() => issuePacket({}, 'local', ['log-in', ''], [])).toThrow(TypeError)
    expect(() => issuePacket({}, 'local', [], ['screenshot-1', ''])).toThrow(TypeError)
  })

  it('U+2800 (Braille blank) counts as blank in a claim list, a packet id and issuePacket input', () => {
    const claim = verifyReceipt(packet, { packetId: 'pkt-verdict', claimedActions: ['⠀'], citedEvidenceIds: [] })
    expect(claim.accepted).toBe(false)
    expect(claim.claimProblems.join(' ')).toMatch(/claimedActions\[0\] shows nothing/)
    expect(() => verifyReceipt({ ...packet, id: '⠀' }, claimWith(undefined))).toThrow(TypeError)
    expect(() => issuePacket({}, 'local', ['⠀'], [])).toThrow(TypeError)
    expect(() => issuePacket({}, 'local', [], [], { id: '⠀' })).toThrow(TypeError)
  })
})

describe('verdict table: behavior that was checked and must stay sound', () => {
  const verify = (claimedActions: string[], citedEvidenceIds: string[] = []): ReceiptResult =>
    verifyReceipt(packet, { packetId: 'pkt-verdict', claimedActions, citedEvidenceIds })

  it.each([
    ['upper case', 'LOG-IN'],
    ['title case', 'Log-in'],
    ['leading space', ' log-in'],
    ['trailing space', 'log-in '],
    ['trailing newline', 'log-in\n'],
    ['Cyrillic look-alike letter', 'lоg-in'],
    ['full-width hyphen', 'log‐in'],
    ['combining mark', 'log-iń'],
    ['path traversal', '../log-in'],
    ['path inside the name', 'log-in/../wipe-disk'],
    ['wildcard star', '*'],
    ['prefix wildcard', 'log-*'],
    ['regex dot', 'log.in'],
    ['__proto__ as an action', '__proto__'],
    ['constructor as an action', 'constructor'],
    ['toString as an action', 'toString'],
    ['hasOwnProperty as an action', 'hasOwnProperty'],
  ])('an action that is not an exact allowed string is unauthorized (%s)', (_name, action) => {
    const result = verify([action])
    expect(result.accepted).toBe(false)
    expect(result.unauthorizedActions).toEqual([action])
  })

  it('an evidence id that was never issued is dropped, with the same exact matching', () => {
    for (const id of ['Screenshot-1', 'screenshot-1 ', '__proto__', 'screenshot-*', '../screenshot-1']) {
      expect(verify([], [id]).droppedEvidenceIds).toEqual([id])
    }
  })

  it('a packet that authorizes __proto__ as a plain string still matches only that exact string', () => {
    const odd = issuePacket({}, 'local', ['__proto__'], [], { id: 'pkt-odd', issuedAt: 'T' })
    const base = { packetId: 'pkt-odd', citedEvidenceIds: [] }
    expect(verifyReceipt(odd, { ...base, claimedActions: ['__proto__'] }).accepted).toBe(true)
    expect(verifyReceipt(odd, { ...base, claimedActions: ['constructor'] }).accepted).toBe(false)
  })

  it('a claim for another packet is never accepted', () => {
    const result = verifyReceipt(packet, { packetId: 'pkt-other', claimedActions: [], citedEvidenceIds: [] })
    expect(result.packetMismatch).toBe(true)
    expect(result.accepted).toBe(false)
  })

  it('a fact key that JSON.parse produced, including __proto__, is compared as an ordinary own key', () => {
    const claimed = JSON.parse('{"__proto__": {"admin": true}, "count": 1}') as unknown
    const same = JSON.parse('{"__proto__": {"admin": true}, "count": 1}') as unknown
    const other = JSON.parse('{"__proto__": {"admin": false}, "count": 1}') as unknown
    expect(check(JSON.parse('{"__proto__": 1}'), JSON.parse('{"__proto__": 1}')).accepted).toBe(true)
    expect(check(JSON.parse('{"__proto__": 1}'), JSON.parse('{"__proto__": 2}')).accepted).toBe(false)
    expect(check({ box: claimed }, { box: same }).accepted).toBe(true)
    expect(check({ box: claimed }, { box: other }).accepted).toBe(false)
  })

  it('an inherited key such as toString is not a fact the state has', () => {
    const result = check({ toString: 'x' }, {})
    expect(result.coverage.uncheckedFactKeys).toEqual(['toString'])
  })

  it('a normal in-scope claim is accepted, with and without a matching state', () => {
    expect(verify(['log-in', 'add-to-cart'], ['screenshot-1']).accepted).toBe(true)
    expect(check({ cartItemCount: 1 }, { cartItemCount: 1 }).accepted).toBe(true)
    expect(check({ cartItemCount: 1 }, undefined).accepted).toBe(true)
  })

  it('facts that are equal in every supported shape are accepted', () => {
    const at = new Date('2026-10-10T00:00:00.000Z')
    const facts = { n: 0, s: 'x', b: true, nil: null, list: [1, [2, 3]], obj: { a: 1, b: { c: 2 } }, at }
    const state = { at: new Date(at.getTime()), obj: { b: { c: 2 }, a: 1 }, list: [1, [2, 3]], nil: null, b: true, s: 'x', n: -0 }
    const result = check(facts, state)
    expect(result.accepted).toBe(true)
    expect(result.coverage.comparedFactCount).toBe(7)
  })

  it('facts that differ in every supported shape contradict', () => {
    expect(check({ list: [1, 2] }, { list: [1, 3] }).accepted).toBe(false)
    expect(check({ list: [1, 2] }, { list: [1, 2, 3] }).accepted).toBe(false)
    expect(check({ obj: { a: 1 } }, { obj: { a: 1, b: 2 } }).accepted).toBe(false)
    expect(check({ at: new Date(1) }, { at: new Date(2) }).accepted).toBe(false)
    expect(check({ m: new Map() }, { m: new Map() }).accepted).toBe(false)
  })

  it('the README quickstart gives the documented verdict', () => {
    const readme = issuePacket(
      { site: 'shop.example.com' },
      'local',
      ['log-in', 'add-to-cart'],
      ['screenshot-1', 'screenshot-2'],
      { id: 'pkt-demo', issuedAt: '2026-09-28T09:00:00.000Z' },
    )
    const result = verifyReceipt(
      readme,
      {
        packetId: readme.id,
        claimedActions: ['log-in', 'add-to-cart', 'submit-payment'],
        citedEvidenceIds: ['screenshot-1'],
        claimedFacts: { cartItemCount: 1, couponApplied: true },
      },
      { cartItemCount: 0 },
    )
    expect(result.accepted).toBe(false)
    expect(result.unauthorizedActions).toEqual(['submit-payment'])
    expect(result.contradictions).toEqual([{ key: 'cartItemCount', claimedFact: 1, currentFact: 0 }])
    expect(result.coverage).toEqual({
      stateSupplied: true,
      claimedFactCount: 2,
      comparedFactCount: 1,
      uncheckedFactKeys: ['couponApplied'],
    })
    expect(result.reason).toBe(
      '1 claimed action(s) were never authorized: "submit-payment". 1 claimed fact(s) contradict the supplied current state: "cartItemCount".',
    )
  })

  it('the README data-pipeline example is accepted with both facts compared', () => {
    const pipeline = issuePacket(
      { dataset: 'orders_2026_07', operation: 'dedupe' },
      'local',
      ['transform-rows', 'write-output'],
      ['row-1042', 'row-1043', 'row-1044'],
      { id: 'pkt-orders-dedupe', issuedAt: '2026-09-28T09:00:00.000Z' },
    )
    const result = verifyReceipt(
      pipeline,
      {
        packetId: pipeline.id,
        claimedActions: ['transform-rows', 'write-output'],
        citedEvidenceIds: ['row-1042', 'row-1043', 'row-1044'],
        claimedFacts: { rowsWritten: 3, duplicatesRemoved: 1 },
      },
      { rowsWritten: 3, duplicatesRemoved: 1 },
    )
    expect(result.accepted).toBe(true)
    expect(result.coverage).toEqual({ stateSupplied: true, claimedFactCount: 2, comparedFactCount: 2, uncheckedFactKeys: [] })
  })

  it('a plain object from another realm is still a plain object', () => {
    const foreignFacts = runInNewRealm('({ rows: 3, tags: ["a"] })')
    const foreignState = runInNewRealm('({ rows: 3, tags: ["a"] })')
    expect(check(foreignFacts, foreignState).accepted).toBe(true)
    expect(check(foreignFacts, { rows: 4, tags: ['a'] }).accepted).toBe(false)
  })

  it('a circular object given on both sides matches, and two separate circular objects throw', () => {
    const loop: Record<string, unknown> = { a: 1 }
    loop.self = loop
    expect(check({ loop }, { loop }).accepted).toBe(true)
    const other: Record<string, unknown> = { a: 1 }
    other.self = other
    expect(() => check({ loop }, { loop: other })).toThrow(RangeError)
  })
})

describe('verdict table: found by breaking the fix (hostile probes must not pass, honest ones must)', () => {
  it('an array whose extra named property differs contradicts', () => {
    const claimed = Object.assign([1], { tag: 'x' })
    expect(check({ x: claimed }, { x: Object.assign([1], { tag: 'y' }) }).accepted).toBe(false)
    expect(check({ x: claimed }, { x: [1] }).accepted).toBe(false)
  })

  it('a Date carrying an extra enumerable property does not match a plain Date', () => {
    const claimed = Object.assign(new Date(5), { extra: 1 })
    expect(check({ x: claimed }, { x: new Date(5) }).accepted).toBe(false)
  })

  it('a Date subclass that overrides getTime, valueOf and toJSON is judged by its real time', () => {
    class Liar extends Date {
      override getTime(): number {
        return 0
      }
      override valueOf(): number {
        return 0
      }
      override toJSON(): string {
        return ''
      }
    }
    expect(check({ x: new Liar(7) }, { x: new Date(0) }).accepted).toBe(false)
    expect(check({ x: new Liar(7) }, { x: new Date(7) }).accepted).toBe(true)
  })

  it('a Proxy around a Date is opaque: it matches only itself', () => {
    const wrapped = new Proxy(new Date(1), {})
    expect(check({ x: wrapped }, { x: new Date(1) }).accepted).toBe(false)
    expect(check({ x: wrapped }, { x: wrapped }).accepted).toBe(true)
  })

  it('a class instance never matches a plain object with the same fields', () => {
    class Box {
      a = 1
    }
    expect(check({ x: new Box() }, { x: { a: 1 } }).accepted).toBe(false)
  })

  it('a JSON __proto__ key nested inside a fact is compared, not dropped', () => {
    const polluted = JSON.parse('{"x":{"__proto__":{"admin":true}}}') as unknown
    expect(check(polluted, { x: {} }).accepted).toBe(false)
    expect(({} as Record<string, unknown>).admin).toBeUndefined()
  })

  it('claim lists with overridden filter or includes methods are still checked by content', () => {
    const actions = Object.assign(['wipe-disk'], { filter: () => [] as string[], includes: () => true })
    const ids = Object.assign(['never-issued'], { filter: () => [] as string[], some: () => false })
    const result = verifyReceipt(packet, { packetId: 'pkt-verdict', claimedActions: actions, citedEvidenceIds: ids })
    expect(result.unauthorizedActions).toEqual(['wipe-disk'])
    expect(result.droppedEvidenceIds).toEqual(['never-issued'])
  })

  it('a getter that answers differently on every read is read once, and the result is stable', () => {
    let reads = 0
    const facts = {
      get n(): number {
        reads += 1
        return reads
      },
    }
    const result = check(facts, { n: 1 })
    expect(result.accepted).toBe(true)
    expect(reads).toBe(1)
    expect(result.snapshot.claimedFacts).toEqual({ n: 1 })
  })

  it('a huge sparse array is compared by what it holds, quickly', () => {
    const empty = new Array<number>(2 ** 32 - 1)
    const one = new Array<number>(2 ** 32 - 1)
    one[5] = 1
    expect(check({ x: empty }, { x: one }).accepted).toBe(false)
    expect(check({ x: empty }, { x: new Array<number>(2 ** 32 - 1) }).accepted).toBe(true)
  })

  it('an array from another realm matches an equal local array', () => {
    const foreign = runInNewRealm('[1, { a: [2] }]')
    expect(check({ x: foreign }, { x: [1, { a: [2] }] }).accepted).toBe(true)
    expect(check({ x: foreign }, { x: [1, { a: [3] }] }).accepted).toBe(false)
  })

  it('two invalid dates match each other, as NaN does', () => {
    expect(check({ x: new Date(Number.NaN) }, { x: new Date(Number.NaN) }).accepted).toBe(true)
  })

  it('the zero-width joiner and non-joiner stay readable in the reason, since emoji and Persian need them', () => {
    const result = verifyReceipt(packet, {
      packetId: 'pkt-verdict',
      claimedActions: ['👩‍💻', 'می‌خواهم'],
      citedEvidenceIds: [],
    })
    expect(result.reason).toContain('"👩‍💻", "می‌خواهم"')
  })

  it('issuePacket still accepts ids that merely contain joiners, tabs or Braille letters', () => {
    expect(() => issuePacket({}, 'local', ['⠁⠃', 'a\tb', 'a‍b', 'é'], ['two words'])).not.toThrow()
  })

  it('the snapshot and the contradiction point at the same copied fact', () => {
    const result = check({ a: { z: 1 } }, { a: { z: 2 } })
    expect(result.snapshot.claimedFacts.a).toBe(result.contradictions[0]?.claimedFact)
  })

  it('a Proxy array that answers length differently on each read is read once, so an empty observed array contradicts', () => {
    let reads = 0
    const lying = new Proxy(new Array<unknown>(1), {
      get(target, key, receiver): unknown {
        if (key === 'length') {
          reads += 1
          return reads === 1 ? 1 : 0
        }
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    const result = check({ x: lying }, { x: [] })
    expect(result.accepted).toBe(false)
    expect(result.contradictions.map((c) => c.key)).toEqual(['x'])
  })

  it('a very deep fact with no current state is accepted without a stack overflow', () => {
    let deep: unknown = 1
    for (let level = 0; level < 100_000; level += 1) deep = { deep }
    expect(verifyReceipt(packet, claimWith({ deep })).accepted).toBe(true)
  })

  it('facts hidden in symbol keys or non-enumerable properties are not compared (documented limit)', () => {
    const hidden = Object.defineProperty({}, 'secret', { value: 1, enumerable: false })
    expect(check({ x: hidden }, { x: {} }).accepted).toBe(true)
  })
})
