// Internal runtime guards for the inputs whose shape the checks depend on.
// TypeScript callers already get these from the types; the guards exist for
// JavaScript callers and for packets or claims parsed from JSON.
//
// Every guard here reads what it is given once and returns the value it
// validated (or a copy of it), so the caller can compute from exactly that
// value. Nothing here calls toString, toJSON or String() on caller values, so
// building an error message cannot throw.

/**
 * A plain object or a null-prototype object: not an array, Map, Set, Date,
 * RegExp or class instance. An object whose prototype's own prototype is null
 * (a plain object from another realm, such as a `vm` context) counts as plain.
 */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === null || Object.getPrototypeOf(prototype) === null
}

/**
 * Names a value by kind for an error message, without reading its content.
 * Note the plain-object case: a plain object is "object", any other object
 * that is not an array (a Map, a class instance) is "a non-plain object".
 */
export function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'symbol') return 'a symbol'
  if (typeof value === 'object' && !isPlainRecord(value)) return 'a non-plain object'
  return typeof value
}

/**
 * Whether `text` shows nothing: empty, or only whitespace and
 * Default_Ignorable_Code_Point characters (zero-width spaces, bidi controls,
 * the soft hyphen, variation selectors, Hangul fillers and similar).
 * `String.prototype.trim` alone misses the ignorable ones.
 */
export function isBlank(text: string): boolean {
  return /^[\p{White_Space}\p{Default_Ignorable_Code_Point}]*$/u.test(text)
}

/**
 * Throws a TypeError naming `label` unless `value` is a string that shows
 * something. Used for ids, so a missing or blank id can never equal another
 * missing or blank id.
 */
export function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a non-empty string (got ${describe(value)}).`)
  }
  if (isBlank(value)) {
    throw new TypeError(`${label} must be a non-empty string (got a string with nothing visible in it).`)
  }
}

/**
 * Copies `value` once, by index, into a new array of strings. Throws a
 * TypeError naming `label` unless `value` is an array whose every position
 * holds a string. A hole is refused (an inherited index does not fill it), so
 * a sparse array can never be validated by a traversal that skips holes and
 * then processed by one that visits them. Callers compute from the returned
 * copy, never from `value` again.
 */
export function snapshotStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array (got ${describe(value)}).`)
  }
  const length: number = value.length
  const copy: string[] = []
  for (let index = 0; index < length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new TypeError(`${label}[${index}] is missing (the array has a hole).`)
    }
    const item: unknown = value[index]
    if (typeof item !== 'string') {
      throw new TypeError(`${label}[${index}] must be a string (got ${describe(item)}).`)
    }
    copy.push(item)
  }
  return copy
}

/**
 * Throws a TypeError naming `label` unless `value` is a non-null, non-array
 * object. Used to check a top-level argument (a WorkPacket or AgentClaim)
 * before reading any of its properties, so a caller passing `null`,
 * `undefined`, or a primitive gets this kit's own clear TypeError instead of
 * a raw "Cannot read properties of null/undefined" from the first property
 * access inside the function.
 */
export function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object (got ${describe(value)}).`)
  }
}

/**
 * Throws a TypeError naming `label` unless `value` is a plain or
 * null-prototype object. A Map, Set, Date, RegExp, array or class instance is
 * refused rather than read as an empty record.
 */
export function assertPlainRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new TypeError(`${label} must be a plain object (got ${describe(value)}).`)
  }
}

const MAX_PROBLEMS_PER_LIST = 20

/**
 * Scans a list taken from the CLAIM, which the agent being checked produced,
 * so problems with its entries are reported instead of thrown. Throws a
 * TypeError naming `label` only when `value` is not an array at all (the
 * 0.1.1 behavior).
 *
 * Reads `length`, the own index keys and each element once, and returns the
 * string entries in index order as a new array (the only thing the caller
 * computes from). Each hole (a run of holes counts once), non-string entry and
 * blank string adds a sentence to `problems` that names the index and the kind
 * of value but never echoes its content. Only own index keys are walked, so an
 * enormous sparse array costs time in proportion to what is present, and a
 * list reports at most 20 problems plus one line saying how many were left out.
 */
export function scanClaimList(value: unknown, label: string, problems: string[]): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array (got ${describe(value)}).`)
  }
  const length: number = value.length
  const indices = Object.keys(value)
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0 && index < length)
    .sort((a, b) => a - b)
  const strings: string[] = []
  const found: string[] = []
  let notListed = 0
  const note = (text: () => string): void => {
    if (found.length < MAX_PROBLEMS_PER_LIST) found.push(text())
    else notListed += 1
  }
  const gap = (from: number, to: number): void => {
    note(() =>
      from === to
        ? `${label}[${from}] is missing (the array has a hole).`
        : `${label}[${from}..${to}] are missing (the array has holes).`,
    )
  }
  let next = 0
  for (const index of indices) {
    if (index > next) gap(next, index - 1)
    next = index + 1
    const item: unknown = value[index]
    if (typeof item !== 'string') {
      note(() => `${label}[${index}] is not a string (got ${describe(item)}).`)
      continue
    }
    if (isBlank(item)) {
      note(() => `${label}[${index}] shows nothing (empty, or only whitespace and invisible characters).`)
    }
    strings.push(item)
  }
  if (next < length) gap(next, length - 1)
  problems.push(...found)
  if (notListed > 0) {
    problems.push(
      notListed === 1
        ? `${label} has 1 more problem that is not listed.`
        : `${label} has ${notListed} more problems that are not listed.`,
    )
  }
  return strings
}
