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
