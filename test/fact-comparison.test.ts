import { describe, expect, it } from 'vitest'
import { issuePacket } from '../src/packet.js'
import { verifyReceipt } from '../src/receipt.js'
import type { ReceiptResult } from '../src/types.js'

// These tests pin down how verifyReceipt compares a claimed fact with the
// same-keyed fact in currentState. The rule the kit promises: a mismatch is
// reported as a contradiction, never silently accepted.

const packet = issuePacket({}, 'local', ['act'], ['ev'], {
  id: 'pkt-facts',
  issuedAt: '2026-09-24T00:00:00.000Z',
})

function compare(claimed: unknown, current: unknown): ReceiptResult {
  return verifyReceipt(
    packet,
    { packetId: 'pkt-facts', claimedActions: ['act'], citedEvidenceIds: ['ev'], claimedFacts: { fact: claimed } },
    { fact: current },
  )
}

function expectContradiction(claimed: unknown, current: unknown): void {
  const result = compare(claimed, current)
  expect(result.contradictions).toEqual([{ key: 'fact', claimedFact: claimed, currentFact: current }])
  expect(result.accepted).toBe(false)
}

function expectMatch(claimed: unknown, current: unknown): void {
  const result = compare(claimed, current)
  expect(result.contradictions).toEqual([])
  expect(result.accepted).toBe(true)
}

describe('fact comparison: JSON-shaped values', () => {
  it('matches equal primitives, nested plain objects and arrays regardless of key order', () => {
    expectMatch('confirmed', 'confirmed')
    expectMatch(42, 42)
    expectMatch(true, true)
    expectMatch(null, null)
    expectMatch({ a: 1, b: [1, { c: 'x' }] }, { b: [1, { c: 'x' }], a: 1 })
    expectMatch([], [])
    expectMatch({}, {})
  })

  it('treats 0 and -0 as the same number, since JSON cannot tell them apart', () => {
    expectMatch(0, -0)
    expectMatch(-0, 0)
    expectMatch({ balance: [-0] }, { balance: [0] })
  })

  it('treats NaN as matching NaN, and nothing else', () => {
    expectMatch(Number.NaN, Number.NaN)
    expectContradiction(Number.NaN, 0)
    expectContradiction(Number.NaN, null)
  })

  it('treats a null-prototype object like a plain object', () => {
    const current = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 })
    expectMatch({ a: 1 }, current)
  })

  it('reports a contradiction for every kind of mismatch', () => {
    expectContradiction('confirmed', 'pending')
    expectContradiction(1, '1')
    expectContradiction(null, 0)
    expectContradiction(null, {})
    expectContradiction([1, 2], [2, 1])
    expectContradiction([1], [1, 1])
    expectContradiction([], {})
    expectContradiction({ a: 1 }, { a: 1, b: 2 })
    expectContradiction({ a: 1 }, { b: 1 })
    expectContradiction({ a: undefined }, {})
    expectContradiction({ nested: { deep: [1, 2, 3] } }, { nested: { deep: [1, 2, 4] } })
  })
})

describe('fact comparison: values that are not plain JSON', () => {
  it('compares Dates by their time value', () => {
    expectMatch(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))
    expectContradiction(new Date('2020-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))
    expectContradiction(new Date('2026-01-01T00:00:00Z'), '2026-01-01T00:00:00.000Z')
    expectContradiction(new Date('2026-01-01T00:00:00Z'), {})
  })

  it('does not treat Maps, Sets or other built-ins with different contents as equal', () => {
    expectContradiction(new Map([['a', 1]]), new Map([['a', 2]]))
    expectContradiction(new Set([1]), new Set([2]))
    expectContradiction(/a/, /b/)
    expectContradiction(new Error('a'), new Error('b'))
  })

  it('does not treat a class instance as equal to a different object with the same fields', () => {
    class Money {
      constructor(readonly cents: number) {}
    }
    expectContradiction(new Money(100), { cents: 100 })
    expectContradiction(new Money(100), new Money(100))
    const same = new Money(100)
    expectMatch(same, same)
  })

  it('does not let an array hole match a value in either direction', () => {
    // eslint-disable-next-line no-sparse-arrays -- the hole is the input under test
    expectContradiction([, 1], [2, 1])
    // eslint-disable-next-line no-sparse-arrays -- the hole is the input under test
    expectContradiction([2, 1], [, 1])
    // eslint-disable-next-line no-sparse-arrays -- the hole is the input under test
    expectContradiction([, 1], [undefined, 1])
    // eslint-disable-next-line no-sparse-arrays -- the hole is the input under test
    expectMatch([, 1], [, 1])
  })
})

describe('fact comparison: mixed kinds never match', () => {
  it('reports a contradiction, not a crash, when undefined meets an object or the reverse', () => {
    expectContradiction(undefined, {})
    expectContradiction({}, undefined)
    expectContradiction(undefined, [])
    expectContradiction(undefined, null)
    expectMatch(undefined, undefined)
  })

  it('reports a contradiction when a Date meets a plain object, in either order', () => {
    expectContradiction(new Date(0), {})
    expectContradiction({}, new Date(0))
    expectContradiction(new Date(0), { getTime: 0 })
  })

  it('reports a contradiction when an array meets a plain object or the reverse', () => {
    expectContradiction([], {})
    expectContradiction({}, [])
    expectContradiction({ 0: 'a', length: 1 }, ['a'])
    expectContradiction(['a'], { 0: 'a' })
  })

  it('reports a contradiction when arrays differ in length, whichever is longer', () => {
    expectContradiction([1], [1, 2])
    expectContradiction([1, 2], [1])
    expectMatch([1, 2], [1, 2])
  })

  it('reports a contradiction when null meets an object, in either order, and when an object meets a primitive', () => {
    expectContradiction(null, {})
    expectContradiction({}, null)
    expectContradiction([], null)
    expectContradiction({ a: 1 }, 'a')
    expectContradiction('a', { a: 1 })
    expectContradiction(1, [1])
  })

  it('reports a contradiction when two plain objects have the same number of keys but different names', () => {
    expectContradiction({ a: 1 }, { b: 1 })
    expectContradiction({ a: 1, b: 2 }, { a: 1 })
    expectContradiction({ a: 1 }, { a: 1, b: 2 })
  })

  it('reports a contradiction when two Dates hold different times, and never treats an invalid date as an ordinary one', () => {
    expectContradiction(new Date(0), new Date(1))
    expectMatch(new Date(Number.NaN), new Date(Number.NaN))
    expectContradiction(new Date(Number.NaN), new Date(0))
  })
})

// ARK-005: what circular and very deep facts do. Nothing here is ever a
// quiet acceptance of two different structures.
describe('fact comparison: circular and deep structures', () => {
  it('accepts the very same object on both sides, cycle or not, because a reference is equal to itself', () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expectMatch(cycle, cycle)
    expectMatch({ inner: cycle }, { inner: cycle })
    const list: unknown[] = []
    list.push(list)
    expectMatch(list, list)
  })

  it('throws a RangeError for two separate cycles instead of accepting or rejecting them', () => {
    const first: Record<string, unknown> = {}
    first.self = first
    const second: Record<string, unknown> = {}
    second.self = second
    expect(() => compare(first, second)).toThrow(RangeError)
    const firstList: unknown[] = []
    firstList.push(firstList)
    const secondList: unknown[] = []
    secondList.push(secondList)
    expect(() => compare(firstList, secondList)).toThrow(RangeError)
  })

  it('throws a RangeError for two separate, acyclic values nested far deeper than the stack allows', () => {
    const nest = (depth: number): unknown => {
      let value: unknown = 1
      for (let level = 0; level < depth; level += 1) value = { value }
      return value
    }
    expect(() => compare(nest(200_000), nest(200_000))).toThrow(RangeError)
  })

  it('compares the same deeply nested object by reference without recursing', () => {
    let value: unknown = 1
    for (let level = 0; level < 200_000; level += 1) value = { value }
    expectMatch(value, value)
  })

  it('compares moderately nested values by content', () => {
    const nest = (leaf: number): unknown => {
      let value: unknown = leaf
      for (let level = 0; level < 200; level += 1) value = { value }
      return value
    }
    expectMatch(nest(1), nest(1))
    expectContradiction(nest(1), nest(2))
  })
})
