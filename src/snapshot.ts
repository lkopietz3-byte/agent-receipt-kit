// Fact snapshots and the structural comparison that runs on them.
//
// A claimed fact comes from the agent being checked, so this module never calls
// a method found on a value it was handed. It reads values with property
// access and the static Object functions, and it brand-checks a Date with the
// built-in Date.prototype.getTime, so an object that carries its own `keys`,
// `getTime` or `[Symbol.iterator]` cannot change what is compared.

import { isPlainRecord } from './validate.js'

// eslint-disable-next-line @typescript-eslint/unbound-method -- always called with .call
const dateGetTime = Date.prototype.getTime
const MAX_ARRAY_LENGTH = 4_294_967_295

/** Maps each source object to its copy, so shared and circular references survive. */
export type SnapshotMemo = Map<object, unknown>

/**
 * The time value of a real Date (from any realm), or `undefined` for anything
 * else. A real Date is recognized by the built-in getTime throwing for other
 * values, not by `instanceof`, a method on the value, or its toStringTag.
 */
function timeOf(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  try {
    return dateGetTime.call(value as Date)
  } catch {
    return undefined
  }
}

function isArrayLength(length: unknown): length is number {
  return typeof length === 'number' && Number.isInteger(length) && length >= 0 && length <= MAX_ARRAY_LENGTH
}

type Kind = 'array' | 'date' | 'record'

// The length kindOf read for the array it just classified (single-threaded, read at once).
let lastLength = 0

/** Which comparable container a value is, or `undefined` for everything compared by identity. */
function kindOf(value: unknown): Kind | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (Array.isArray(value)) {
    const length: unknown = value.length
    if (!isArrayLength(length)) return undefined
    lastLength = length
    return 'array'
  }
  // Plain objects first: the Date brand check throws for every non-Date, and a
  // throw per object is slow on large facts.
  if (isPlainRecord(value)) return 'record'
  return timeOf(value) === undefined ? undefined : 'date'
}

function define(target: object, key: string, value: unknown): void {
  // A JSON key named __proto__ must become an own property of the copy, never
  // change its prototype, so only that key needs defineProperty (which is slow
  // on large facts); plain assignment makes the same enumerable property.
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
  } else {
    ;(target as Record<string, unknown>)[key] = value
  }
}

/**
 * Copies `root` into snapshot values the comparison can trust, without
 * recursion (so an arbitrarily deep fact costs no stack here). Arrays, Dates
 * and plain or null-prototype objects are copied, with their own enumerable
 * string keys; each property is read exactly once. Shared references map to one
 * copy through `memo`, which is how a circular object passed on both sides
 * still compares equal to itself. Anything else (a Map, a class instance, a
 * Proxy-wrapped oddity) is kept by reference and can only match itself.
 */
export function snapshotValue(root: unknown, memo: SnapshotMemo): unknown {
  const work: [source: object, copy: object][] = []
  const resolve = (value: unknown): unknown => {
    const kind = kindOf(value)
    if (kind === undefined) return value
    const source = value as object
    const seen = memo.get(source)
    if (seen !== undefined) return seen
    let copy: object
    // kindOf validated one read of the length; allocate from that same read
    // (kindOf stores it) so a Proxy cannot answer differently the second time.
    if (kind === 'array') copy = new Array<unknown>(lastLength)
    else if (kind === 'date') copy = new Date(timeOf(source) as number)
    else copy = {}
    memo.set(source, copy)
    work.push([source, copy])
    return copy
  }
  const result = resolve(root)
  for (let next = work.pop(); next !== undefined; next = work.pop()) {
    const [source, copy] = next
    for (const key of Object.keys(source)) {
      define(copy, key, resolve((source as Record<string, unknown>)[key]))
    }
  }
  return result
}

function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key)
}

/**
 * Structural equality for snapshot values (zero dependencies).
 *
 * Primitives compare with 0 equal to -0 and NaN equal to NaN. Arrays, Dates
 * and plain or null-prototype objects compare by content: same kind, same own
 * enumerable string keys (so a hole only matches a hole and key order is
 * free), equal values, plus equal length for arrays and equal time value for
 * Dates. Any other object matches only itself, so a difference this function
 * cannot see is a contradiction, never an acceptance. A value never matches
 * one of a different kind.
 *
 * Two references to the very same object are equal without being walked, so a
 * circular object compared with itself matches. Two separate circular
 * structures, and two separate acyclic structures nested deeper than the
 * runtime's call stack allows, overflow the stack and throw a RangeError,
 * never an acceptance.
 */
export function factsMatch(a: unknown, b: unknown): boolean {
  // `===` makes 0 and -0 equal (JSON serializes both as 0); Object.is makes
  // NaN equal to NaN.
  if (a === b || Object.is(a, b)) return true
  const kind = kindOf(a)
  if (kind === undefined || kind !== kindOf(b)) return false
  if (kind === 'array' && (a as unknown[]).length !== (b as unknown[]).length) return false
  if (kind === 'date' && !Object.is(timeOf(a), timeOf(b))) return false
  const aKeys = Object.keys(a as object)
  if (aKeys.length !== Object.keys(b as object).length) return false
  return aKeys.every(
    (key) =>
      hasOwn(b as object, key) &&
      factsMatch((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  )
}
