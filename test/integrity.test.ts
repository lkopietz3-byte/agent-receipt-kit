import { describe, expect, it } from 'vitest'
import {
  canonicalizeJson,
  issueEvidenceEnvelope,
  sha256Hex,
  verifyEvidenceEnvelope,
  type JsonValue,
} from '../src/integrity.js'

describe('canonicalizeJson', () => {
  it('is invariant to object insertion order', () => {
    const left = { z: 3, nested: { b: true, a: null }, a: [2, 1] }
    const right = { a: [2, 1], nested: { a: null, b: true }, z: 3 }

    expect(canonicalizeJson(left)).toBe(canonicalizeJson(right))
    expect(canonicalizeJson(left)).toBe('{"a":[2,1],"nested":{"a":null,"b":true},"z":3}')
  })

  it('normalizes negative zero and preserves JSON number semantics', () => {
    expect(canonicalizeJson({ negativeZero: -0, fraction: 1.25 })).toBe(
      '{"fraction":1.25,"negativeZero":0}',
    )
  })

  it('rejects non-finite numbers and non-JSON objects', () => {
    expect(() => canonicalizeJson({ value: Number.NaN })).toThrow(/non-finite number/i)
    expect(() => canonicalizeJson(new Date() as unknown as JsonValue)).toThrow(/plain JSON object/i)
  })

  it('rejects sparse arrays, lone surrogates, and circular references', () => {
    const sparse = Array.from({ length: 2 }) as JsonValue[]
    delete sparse[0]
    expect(() => canonicalizeJson(sparse)).toThrow(/sparse array slot/i)

    expect(() => canonicalizeJson({ value: '\ud800' })).toThrow(/unpaired high surrogate/i)

    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => canonicalizeJson(circular as JsonValue)).toThrow(/circular reference/i)
  })
})

describe('sha256Hex', () => {
  it('matches standard SHA-256 test vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(sha256Hex('ProofPrism 🔎')).toHaveLength(64)
  })
})

describe('evidence envelopes', () => {
  it('issues a stable digest and verifies unchanged content', () => {
    const first = issueEvidenceEnvelope(
      { decision: 'REQUIRE_APPROVAL', facts: { limit: 5000, requested: 25000 } },
      { packetId: 'PP-TEST-0001', issuedAt: '2026-08-03T00:00:00.000Z' },
    )
    const second = issueEvidenceEnvelope(
      { facts: { requested: 25000, limit: 5000 }, decision: 'REQUIRE_APPROVAL' },
      { packetId: 'PP-TEST-0001', issuedAt: '2026-08-03T00:00:00.000Z' },
    )

    expect(first.integrity.packetDigest).toBe(second.integrity.packetDigest)
    expect(first.integrity.packetDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(verifyEvidenceEnvelope(first)).toMatchObject({
      valid: true,
      errors: [],
      issuerAuthenticated: false,
      truthEstablished: false,
    })
  })

  it('snapshots the payload instead of retaining the caller mutation', () => {
    const original = { decision: 'BLOCK', facts: { count: 1 } }
    const envelope = issueEvidenceEnvelope(original, {
      packetId: 'PP-TEST-0002',
      issuedAt: '2026-08-03T00:00:00.000Z',
    })

    original.facts.count = 99

    expect(envelope.payload.facts.count).toBe(1)
    expect(verifyEvidenceEnvelope(envelope).valid).toBe(true)
  })

  it('detects a material payload change', () => {
    const envelope = issueEvidenceEnvelope(
      { decision: 'REQUIRE_APPROVAL', facts: { requested: 25000 } },
      { packetId: 'PP-TEST-0003', issuedAt: '2026-08-03T00:00:00.000Z' },
    )

    envelope.payload.decision = 'ALLOW'
    const result = verifyEvidenceEnvelope(envelope)

    expect(result.valid).toBe(false)
    expect(result.actualDigest).not.toBe(result.expectedDigest)
    expect(result.errors).toContain(
      'The current envelope does not reproduce the issued packetDigest.',
    )
  })

  it('detects header changes and malformed digest metadata', () => {
    const envelope = issueEvidenceEnvelope(
      { decision: 'RELEASE' },
      { packetId: 'PP-TEST-0004', issuedAt: '2026-08-03T00:00:00.000Z' },
    )

    envelope.packetId = 'PP-TEST-ALTERED'
    envelope.integrity.packetDigest = 'not-a-digest'
    const result = verifyEvidenceEnvelope(envelope)

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'packetDigest must be 64 lowercase hexadecimal characters.',
        'The current envelope does not reproduce the issued packetDigest.',
      ]),
    )
  })

  it('rejects invalid issue metadata rather than generating a misleading packet', () => {
    expect(() =>
      issueEvidenceEnvelope(
        { decision: 'RELEASE' },
        { packetId: '   ', issuedAt: 'not-a-date' },
      ),
    ).toThrow(/packetId must not be empty/i)
  })
})
