import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_CANONICALIZATION,
  EVIDENCE_DIGEST_ALGORITHM,
  EVIDENCE_ENVELOPE_VERSION,
  canonicalizeJson,
  issueEvidenceEnvelope,
  sha256Hex,
  verifyEvidenceEnvelope,
  type EvidenceEnvelope,
  type JsonValue,
} from '../src/integrity.js'

const fixed = {
  packetId: 'PP-EXTENDED-0001',
  issuedAt: '2026-08-03T00:00:00.000Z',
}

function envelope(payload: JsonValue = { decision: 'RELEASE' }) {
  return issueEvidenceEnvelope(payload, fixed)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('canonical JSON primitive contract', () => {
  const cases: Array<[string, JsonValue, string]> = [
    ['null', null, 'null'],
    ['true', true, 'true'],
    ['false', false, 'false'],
    ['zero', 0, '0'],
    ['negative zero', -0, '0'],
    ['integer', 42, '42'],
    ['negative integer', -42, '-42'],
    ['fraction', 1.25, '1.25'],
    ['empty string', '', '""'],
    ['quoted string', 'a"b', '"a\\"b"'],
    ['backslash', 'a\\b', '"a\\\\b"'],
    ['newline', 'a\nb', '"a\\nb"'],
    ['tab', 'a\tb', '"a\\tb"'],
    ['control character', '\u000f', '"\\u000f"'],
    ['BMP Unicode', '東京', '"東京"'],
    ['astral Unicode', '🔎', '"🔎"'],
  ]

  for (const [label, input, expected] of cases) {
    it(`serializes ${label} exactly`, () => {
      expect(canonicalizeJson(input)).toBe(expected)
    })
  }

  it('sorts numeric-looking object keys lexicographically by UTF-16 code units', () => {
    expect(canonicalizeJson({ '2': 'two', '10': 'ten', '1': 'one' })).toBe(
      '{"1":"one","10":"ten","2":"two"}',
    )
  })

  it('sorts deeply nested objects without reordering arrays', () => {
    const input = {
      z: { b: 2, a: 1 },
      a: [{ y: 2, x: 1 }, 3, 2, 1],
    }
    expect(canonicalizeJson(input)).toBe(
      '{"a":[{"x":1,"y":2},3,2,1],"z":{"a":1,"b":2}}',
    )
  })

  it('allows a null-prototype plain JSON object', () => {
    const input = Object.create(null) as Record<string, JsonValue>
    input.z = 2
    input.a = 1
    expect(canonicalizeJson(input)).toBe('{"a":1,"z":2}')
  })

  it('allows a repeated shared object when the graph is not circular', () => {
    const shared = { value: 1 }
    const input = { left: shared, right: shared }
    expect(canonicalizeJson(input)).toBe(
      '{"left":{"value":1},"right":{"value":1}}',
    )
  })

  it('keeps composed and decomposed Unicode distinct', () => {
    expect(canonicalizeJson('é')).not.toBe(canonicalizeJson('é'))
  })
})

describe('canonical JSON rejection matrix', () => {
  const invalidCases: Array<[string, () => unknown, RegExp]> = [
    ['NaN', () => ({ value: Number.NaN }), /non-finite number/i],
    ['positive infinity', () => ({ value: Number.POSITIVE_INFINITY }), /non-finite number/i],
    ['negative infinity', () => ({ value: Number.NEGATIVE_INFINITY }), /non-finite number/i],
    ['undefined property', () => ({ value: undefined }), /unsupported undefined/i],
    ['function property', () => ({ value: () => true }), /unsupported function/i],
    ['symbol property', () => ({ value: Symbol('x') }), /unsupported symbol/i],
    ['bigint property', () => ({ value: 1n }), /unsupported bigint/i],
    ['date instance', () => new Date(), /plain JSON object/i],
    ['map instance', () => new Map([['a', 1]]), /plain JSON object/i],
    ['set instance', () => new Set([1]), /plain JSON object/i],
    ['regexp instance', () => /x/, /plain JSON object/i],
    ['unpaired high surrogate value', () => ({ value: '\ud800' }), /unpaired high surrogate/i],
    ['unpaired low surrogate value', () => ({ value: '\udc00' }), /unpaired low surrogate/i],
    ['unpaired high surrogate key', () => ({ ['\ud800']: 'bad' }), /unpaired high surrogate/i],
  ]

  for (const [label, make, expected] of invalidCases) {
    it(`rejects ${label}`, () => {
      expect(() => canonicalizeJson(make() as JsonValue)).toThrow(expected)
    })
  }

  it('rejects a sparse array at the first missing slot', () => {
    const sparse: JsonValue[] = []
    sparse.length = 4
    sparse[2] = 'present'
    expect(() => canonicalizeJson(sparse)).toThrow(/\$\[0\].*sparse array slot/i)
  })

  it('rejects direct circular references', () => {
    const input: Record<string, unknown> = {}
    input.self = input
    expect(() => canonicalizeJson(input as JsonValue)).toThrow(/circular reference/i)
  })

  it('rejects indirect circular references', () => {
    const left: Record<string, unknown> = {}
    const right: Record<string, unknown> = { left }
    left.right = right
    expect(() => canonicalizeJson(left as JsonValue)).toThrow(/circular reference/i)
  })
})

describe('SHA-256 hardening', () => {
  const knownVectors: Array<[string, string]> = [
    [
      'The quick brown fox jumps over the lazy dog',
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    ],
    [
      'The quick brown fox jumps over the lazy dog.',
      'ef537f25c895bfa782526529a9b63d97aa631564d5d789c2b765448c8635fb6c',
    ],
    [
      'a'.repeat(1_000_000),
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    ],
  ]

  for (const [input, expected] of knownVectors) {
    it(`matches known vector of ${input.length.toLocaleString()} UTF-16 code units`, () => {
      expect(sha256Hex(input)).toBe(expected)
    })
  }

  it('always returns 64 lowercase hexadecimal characters', () => {
    for (const input of ['', 'ProofPrism', '🔎'.repeat(100), '\u0000\u0001']) {
      expect(sha256Hex(input)).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('is deterministic across repeated calls', () => {
    const input = canonicalizeJson({ z: 2, a: [1, true, null, '🔎'] })
    const first = sha256Hex(input)
    for (let index = 0; index < 100; index += 1) {
      expect(sha256Hex(input)).toBe(first)
    }
  })

  it('changes when one bit-equivalent character changes', () => {
    expect(sha256Hex('authority')).not.toBe(sha256Hex('Authority'))
    expect(sha256Hex('25000')).not.toBe(sha256Hex('25001'))
  })
})

describe('evidence envelope issuance contract', () => {
  it('uses explicit stable version, canonicalization, and digest constants', () => {
    const issued = envelope()
    expect(issued.schemaVersion).toBe(EVIDENCE_ENVELOPE_VERSION)
    expect(issued.integrity.canonicalization).toBe(EVIDENCE_CANONICALIZATION)
    expect(issued.integrity.digestAlgorithm).toBe(EVIDENCE_DIGEST_ALGORITHM)
    expect(issued.integrity.mode).toBe('digest-only')
  })

  it('produces the same digest for semantically identical key order', () => {
    const left = issueEvidenceEnvelope(
      { z: 2, a: { y: 2, x: 1 } },
      fixed,
    )
    const right = issueEvidenceEnvelope(
      { a: { x: 1, y: 2 }, z: 2 },
      fixed,
    )
    expect(left.integrity.packetDigest).toBe(right.integrity.packetDigest)
  })

  it('binds packetId and issuedAt into the digest', () => {
    const payload = { decision: 'RELEASE' }
    const base = issueEvidenceEnvelope(payload, fixed)
    const differentId = issueEvidenceEnvelope(payload, {
      ...fixed,
      packetId: 'PP-EXTENDED-0002',
    })
    const differentTime = issueEvidenceEnvelope(payload, {
      ...fixed,
      issuedAt: '2026-08-03T00:00:01.000Z',
    })
    expect(differentId.integrity.packetDigest).not.toBe(base.integrity.packetDigest)
    expect(differentTime.integrity.packetDigest).not.toBe(base.integrity.packetDigest)
  })

  it('deep-snapshots nested objects and arrays', () => {
    const original = {
      sources: [{ id: 'S1', values: [1, 2, 3] }],
      decision: 'RELEASE',
    }
    const issued = issueEvidenceEnvelope(original, fixed)
    original.sources[0]!.id = 'CHANGED'
    original.sources[0]!.values.push(4)
    original.decision = 'BLOCK'

    expect(issued.payload).toEqual({
      decision: 'RELEASE',
      sources: [{ id: 'S1', values: [1, 2, 3] }],
    })
    expect(verifyEvidenceEnvelope(issued).valid).toBe(true)
  })

  it('returns independent payload snapshots for independent issues', () => {
    const original = { nested: { value: 1 } }
    const first = issueEvidenceEnvelope(original, fixed)
    const second = issueEvidenceEnvelope(original, fixed)
    first.payload.nested.value = 9
    expect(second.payload.nested.value).toBe(1)
    expect(verifyEvidenceEnvelope(first).valid).toBe(false)
    expect(verifyEvidenceEnvelope(second).valid).toBe(true)
  })

  it('supports every JSON primitive as the packet payload', () => {
    for (const payload of [null, true, false, 0, 1, 'evidence', [], {}] as JsonValue[]) {
      const issued = issueEvidenceEnvelope(payload, fixed)
      expect(verifyEvidenceEnvelope(issued).valid).toBe(true)
    }
  })

  it('generates distinct bounded packet identifiers when no id is supplied', () => {
    const first = issueEvidenceEnvelope({ value: 1 })
    const second = issueEvidenceEnvelope({ value: 1 })
    expect(first.packetId).toMatch(/^PP-/)
    expect(second.packetId).toMatch(/^PP-/)
    expect(first.packetId).not.toBe(second.packetId)
  })

  it('accepts a 256-character packet id and rejects a 257-character id', () => {
    const allowed = 'P'.repeat(256)
    expect(issueEvidenceEnvelope({ value: 1 }, { ...fixed, packetId: allowed }).packetId).toBe(allowed)
    expect(() => issueEvidenceEnvelope({ value: 1 }, { ...fixed, packetId: 'P'.repeat(257) })).toThrow(/256 characters or fewer/i)
  })

  it('rejects blank packet ids before checking the date', () => {
    expect(() => issueEvidenceEnvelope({ value: 1 }, { packetId: '   ', issuedAt: 'bad' })).toThrow(/packetId must not be empty/i)
  })

  for (const badDate of ['', 'not-a-date', '2026-99-99', '2026-08-03T25:00:00Z']) {
    it(`rejects invalid issuedAt ${JSON.stringify(badDate)}`, () => {
      expect(() => issueEvidenceEnvelope({ value: 1 }, { packetId: fixed.packetId, issuedAt: badDate })).toThrow(/valid ISO-compatible date-time/i)
    })
  }

  it('rejects an invalid payload at issuance rather than emitting a misleading digest', () => {
    expect(() => issueEvidenceEnvelope({ value: undefined } as unknown as JsonValue, fixed)).toThrow(/unsupported undefined/i)
    expect(() => issueEvidenceEnvelope(new Date() as unknown as JsonValue, fixed)).toThrow(/plain JSON object/i)
  })
})

describe('evidence envelope verification mutation matrix', () => {
  const mutations: Array<[string, (value: any) => void, string]> = [
    ['payload decision', (value) => { value.payload.decision = 'ALLOW' }, 'does not reproduce'],
    ['nested payload fact', (value) => { value.payload.facts.count = 2 }, 'does not reproduce'],
    ['packet id', (value) => { value.packetId = 'PP-ALTERED-0001' }, 'does not reproduce'],
    ['issued time', (value) => { value.issuedAt = '2026-08-03T00:00:01.000Z' }, 'does not reproduce'],
    ['schema version', (value) => { value.schemaVersion = '9.9.9' }, 'Unsupported schema version'],
    ['integrity mode', (value) => { value.integrity.mode = 'signed' }, 'Unsupported integrity mode'],
    ['canonicalization', (value) => { value.integrity.canonicalization = 'JSON.stringify' }, 'Unsupported canonicalization'],
    ['digest algorithm', (value) => { value.integrity.digestAlgorithm = 'md5' }, 'Unsupported digest algorithm'],
    ['uppercase digest', (value) => { value.integrity.packetDigest = value.integrity.packetDigest.toUpperCase() }, '64 lowercase hexadecimal'],
    ['short digest', (value) => { value.integrity.packetDigest = 'a'.repeat(63) }, '64 lowercase hexadecimal'],
    ['long digest', (value) => { value.integrity.packetDigest = 'a'.repeat(65) }, '64 lowercase hexadecimal'],
    ['nonhex digest', (value) => { value.integrity.packetDigest = 'g'.repeat(64) }, '64 lowercase hexadecimal'],
    ['wrong but well-formed digest', (value) => { value.integrity.packetDigest = '0'.repeat(64) }, 'does not reproduce'],
  ]

  for (const [label, mutate, expected] of mutations) {
    it(`detects changed ${label}`, () => {
      const issued = issueEvidenceEnvelope(
        { decision: 'RELEASE', facts: { count: 1 } },
        fixed,
      ) as any
      mutate(issued)
      const result = verifyEvidenceEnvelope(issued)
      expect(result.valid).toBe(false)
      expect(result.errors.some((error) => error.includes(expected))).toBe(true)
      expect(result.issuerAuthenticated).toBe(false)
      expect(result.truthEstablished).toBe(false)
    })
  }

  it('reports multiple independent metadata and digest errors together', () => {
    const issued = envelope() as any
    issued.schemaVersion = 'bad'
    issued.integrity.mode = 'signed'
    issued.integrity.canonicalization = 'bad'
    issued.integrity.digestAlgorithm = 'bad'
    issued.integrity.packetDigest = 'bad'

    const result = verifyEvidenceEnvelope(issued)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(5)
  })

  it('fails closed instead of throwing when integrity metadata is missing', () => {
    const issued = envelope() as any
    delete issued.integrity
    expect(() => verifyEvidenceEnvelope(issued)).not.toThrow()
    const result = verifyEvidenceEnvelope(issued)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('fails closed when payload is missing or no longer JSON-shaped', () => {
    const missing = envelope() as any
    delete missing.payload
    expect(verifyEvidenceEnvelope(missing).valid).toBe(false)

    const invalid = envelope() as any
    invalid.payload = { value: undefined }
    const result = verifyEvidenceEnvelope(invalid)
    expect(result.valid).toBe(false)
    expect(result.errors.some((error) => /unsupported undefined/i.test(error))).toBe(true)
  })

  it('does not mutate the envelope while verifying it', () => {
    const issued = envelope({ z: 2, a: [1, 2, 3] })
    const before = JSON.stringify(issued)
    const first = verifyEvidenceEnvelope(issued)
    const second = verifyEvidenceEnvelope(issued)
    expect(first).toEqual(second)
    expect(JSON.stringify(issued)).toBe(before)
  })

  it('survives a JSON transport round-trip', () => {
    const issued = envelope({ decision: 'REQUIRE_APPROVAL', sourceIds: ['S1', 'S2'] })
    const transported = JSON.parse(JSON.stringify(issued)) as EvidenceEnvelope
    expect(verifyEvidenceEnvelope(transported)).toMatchObject({
      valid: true,
      errors: [],
      issuerAuthenticated: false,
      truthEstablished: false,
    })
  })

  it('returns the computed actual digest for comparison', () => {
    const issued = envelope({ value: 1 })
    const result = verifyEvidenceEnvelope(issued)
    expect(result.actualDigest).toBe(issued.integrity.packetDigest)
    expect(result.expectedDigest).toBe(issued.integrity.packetDigest)
  })

  it('never upgrades digest integrity into issuer identity or factual truth', () => {
    const result = verifyEvidenceEnvelope(envelope({ falseClaim: 'The moon is made of cheese.' }))
    expect(result.valid).toBe(true)
    expect(result.issuerAuthenticated).toBe(false)
    expect(result.truthEstablished).toBe(false)
  })
})

describe('package and source boundaries', () => {
  it('keeps the integrity module free of imports and network/runtime dependencies', () => {
    const source = readFileSync(new URL('../src/integrity.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/^import\s/m)
    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).not.toMatch(/XMLHttpRequest|WebSocket|node:/)
  })

  it('exports the full evidence-envelope API from the package root', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    for (const name of [
      'EVIDENCE_ENVELOPE_VERSION',
      'EVIDENCE_CANONICALIZATION',
      'EVIDENCE_DIGEST_ALGORITHM',
      'canonicalizeJson',
      'sha256Hex',
      'issueEvidenceEnvelope',
      'verifyEvidenceEnvelope',
    ]) {
      expect(source).toContain(name)
    }
  })

  it('keeps zero runtime dependencies and includes integrity docs in the publish set', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      files?: string[]
      sideEffects?: boolean
    }
    expect(packageJson.dependencies ?? {}).toEqual({})
    expect(packageJson.files).toContain('docs')
    expect(packageJson.sideEffects).toBe(false)
  })
})
