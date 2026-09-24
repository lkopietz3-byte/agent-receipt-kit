// Internal runtime guards for the few inputs whose shape the checks depend
// on. TypeScript callers already get these from the types; the guards exist
// for JavaScript callers and for packets or claims parsed from JSON.

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value
}

/** Throws a TypeError naming `label` unless `value` is an array. */
export function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array (got ${describe(value)}).`)
  }
}

/** Throws a TypeError naming `label` unless `value` is an array of strings. */
export function assertStringArray(value: unknown, label: string): asserts value is string[] {
  assertArray(value, label)
  const index = value.findIndex((item) => typeof item !== 'string')
  if (index !== -1) {
    throw new TypeError(`${label}[${index}] must be a string (got ${describe(value[index])}).`)
  }
}
