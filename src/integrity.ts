// Portable evidence-envelope integrity with zero runtime dependencies.
//
// This module deliberately separates two questions:
//
// 1. Integrity: does the current JSON payload reproduce the digest that was
//    issued with it?
// 2. Truth: are the payload's claims actually correct, complete, authorized,
//    and based on trustworthy evidence?
//
// A valid digest answers only the first question. Use verifyReceipt and an
// independent current-state observation for the second.

/** JSON values accepted by the canonicalizer and evidence envelope. */
export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export const EVIDENCE_ENVELOPE_VERSION = '1.0.0' as const
export const EVIDENCE_CANONICALIZATION = 'RFC8785-JCS' as const
export const EVIDENCE_DIGEST_ALGORITHM = 'sha256' as const

export interface EvidenceEnvelopeIntegrity {
  /** Digest-only is explicit: this is not a signature or identity assertion. */
  mode: 'digest-only'
  canonicalization: typeof EVIDENCE_CANONICALIZATION
  digestAlgorithm: typeof EVIDENCE_DIGEST_ALGORITHM
  /** Lowercase SHA-256 hex of the canonical unsigned envelope. */
  packetDigest: string
}

/**
 * A portable, self-contained JSON envelope. The payload is snapshotted at
 * issue time, then the envelope header and payload are canonically serialized
 * and SHA-256 digested.
 */
export interface EvidenceEnvelope<Payload extends JsonValue = JsonValue> {
  schemaVersion: typeof EVIDENCE_ENVELOPE_VERSION
  packetId: string
  issuedAt: string
  payload: Payload
  integrity: EvidenceEnvelopeIntegrity
}

export interface EvidenceEnvelopeVerification {
  valid: boolean
  expectedDigest: string
  actualDigest?: string
  errors: string[]
  /**
   * Always false for this module. Digest verification does not authenticate an
   * issuer; a later signed-envelope layer must do that explicitly.
   */
  issuerAuthenticated: false
  /**
   * Always false. A coherent packet may still contain false or incomplete
   * claims, weak evidence, or an inappropriate policy decision.
   */
  truthEstablished: false
}

export interface IssueEvidenceEnvelopeOptions {
  packetId?: string
  issuedAt?: string
}

interface UnsignedEvidenceEnvelope<Payload extends JsonValue = JsonValue> {
  schemaVersion: typeof EVIDENCE_ENVELOPE_VERSION
  packetId: string
  issuedAt: string
  payload: Payload
  integrity: Omit<EvidenceEnvelopeIntegrity, 'packetDigest'>
}

function generateEnvelopeId(): string {
  const cryptoObject = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoObject?.randomUUID) return `PP-${cryptoObject.randomUUID()}`
  const random = Math.random().toString(36).slice(2, 14)
  return `PP-${Date.now().toString(36)}-${random}`
}

function describePath(parent: string, key: string | number): string {
  return typeof key === 'number' ? `${parent}[${key}]` : `${parent}.${key}`
}

/** Reject lone UTF-16 surrogates, which are not valid Unicode scalar values. */
function assertUnicodeString(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`${path} contains an unpaired high surrogate at UTF-16 index ${index}.`)
      }
      index += 1
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`${path} contains an unpaired low surrogate at UTF-16 index ${index}.`)
    }
  }
}

function sortUtf16(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function canonicalizeInternal(value: unknown, path: string, stack: Set<object>): string {
  if (value === null) return 'null'

  if (typeof value === 'string') {
    assertUnicodeString(value, path)
    return JSON.stringify(value)
  }

  if (typeof value === 'boolean') return value ? 'true' : 'false'

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} contains a non-finite number, which is not valid canonical JSON.`)
    }
    // JSON.stringify follows ECMAScript's shortest round-trippable number
    // serialization, which RFC 8785 adopts. It also normalizes -0 to 0.
    const serialized = JSON.stringify(value)
    if (serialized === undefined) {
      throw new TypeError(`${path} could not be serialized as canonical JSON.`)
    }
    return serialized
  }

  if (typeof value !== 'object') {
    throw new TypeError(
      `${path} contains unsupported ${typeof value}; canonical evidence must be JSON-shaped.`,
    )
  }

  if (stack.has(value)) throw new TypeError(`${path} contains a circular reference.`)
  stack.add(value)

  try {
    if (Array.isArray(value)) {
      const items: string[] = []
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError(`${describePath(path, index)} is a sparse array slot.`)
        }
        items.push(canonicalizeInternal(value[index], describePath(path, index), stack))
      }
      return `[${items.join(',')}]`
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must be a plain JSON object, not a class instance.`)
    }

    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort(sortUtf16)
    const members: string[] = []
    for (const key of keys) {
      assertUnicodeString(key, `${path} key`)
      const member = canonicalizeInternal(record[key], describePath(path, key), stack)
      members.push(`${JSON.stringify(key)}:${member}`)
    }
    return `{${members.join(',')}}`
  } finally {
    stack.delete(value)
  }
}

/**
 * Canonically serializes plain JSON according to the RFC 8785 / JCS rules this
 * package supports: no whitespace, ECMAScript number serialization, UTF-16
 * property ordering, and rejection of non-I-JSON values and lone surrogates.
 */
export function canonicalizeJson(value: JsonValue): string {
  return canonicalizeInternal(value, '$', new Set<object>())
}

function utf8Bytes(value: string): Uint8Array {
  assertUnicodeString(value, '$canonical')
  const output: number[] = []

  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index)
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const low = value.charCodeAt(index + 1)
      codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00)
      index += 1
    }

    if (codePoint <= 0x7f) {
      output.push(codePoint)
    } else if (codePoint <= 0x7ff) {
      output.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f))
    } else if (codePoint <= 0xffff) {
      output.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      )
    } else {
      output.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      )
    }
  }

  return Uint8Array.from(output)
}

const SHA256_CONSTANTS = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotateRight(value: number, distance: number): number {
  return (value >>> distance) | (value << (32 - distance))
}

function add32(...values: number[]): number {
  let sum = 0
  for (const value of values) sum = (sum + value) >>> 0
  return sum
}

/** Zero-dependency SHA-256 over a Unicode string, returned as lowercase hex. */
export function sha256Hex(value: string): string {
  const message = utf8Bytes(value)
  const bitLength = BigInt(message.length) * 8n
  const paddedLength = Math.ceil((message.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(message)
  padded[message.length] = 0x80

  for (let index = 0; index < 8; index += 1) {
    const shift = BigInt(index * 8)
    padded[paddedLength - 1 - index] = Number((bitLength >> shift) & 0xffn)
  }

  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19

  const words = new Uint32Array(64)

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const base = offset + index * 4
      words[index] = (
        (padded[base]! << 24) |
        (padded[base + 1]! << 16) |
        (padded[base + 2]! << 8) |
        padded[base + 3]!
      ) >>> 0
    }

    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15]!
      const previous2 = words[index - 2]!
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3)
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10)
      words[index] = add32(words[index - 16]!, sigma0, words[index - 7]!, sigma1)
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let h = h7

    for (let index = 0; index < 64; index += 1) {
      const upper1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choose = (e & f) ^ (~e & g)
      const temporary1 = add32(h, upper1, choose, SHA256_CONSTANTS[index]!, words[index]!)
      const upper0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temporary2 = add32(upper0, majority)

      h = g
      g = f
      f = e
      e = add32(d, temporary1)
      d = c
      c = b
      b = a
      a = add32(temporary1, temporary2)
    }

    h0 = add32(h0, a)
    h1 = add32(h1, b)
    h2 = add32(h2, c)
    h3 = add32(h3, d)
    h4 = add32(h4, e)
    h5 = add32(h5, f)
    h6 = add32(h6, g)
    h7 = add32(h7, h)
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('')
}

function assertPacketId(packetId: string): void {
  if (!packetId.trim()) throw new TypeError('packetId must not be empty.')
  if (packetId.length > 256) throw new TypeError('packetId must be 256 characters or fewer.')
}

function assertIssuedAt(issuedAt: string): void {
  if (!issuedAt.trim() || Number.isNaN(Date.parse(issuedAt))) {
    throw new TypeError('issuedAt must be a valid ISO-compatible date-time string.')
  }
}

function unsignedEnvelope<Payload extends JsonValue>(
  envelope: EvidenceEnvelope<Payload>,
): UnsignedEvidenceEnvelope<Payload> {
  return {
    schemaVersion: envelope.schemaVersion,
    packetId: envelope.packetId,
    issuedAt: envelope.issuedAt,
    payload: envelope.payload,
    integrity: {
      mode: envelope.integrity.mode,
      canonicalization: envelope.integrity.canonicalization,
      digestAlgorithm: envelope.integrity.digestAlgorithm,
    },
  }
}

function digestUnsignedEnvelope<Payload extends JsonValue>(
  envelope: UnsignedEvidenceEnvelope<Payload>,
): string {
  return sha256Hex(canonicalizeJson(envelope))
}

/**
 * Issues a digest-only evidence envelope. The input payload is deep-snapshotted
 * through canonical JSON so later mutations to the caller's original object do
 * not rewrite the issued packet silently.
 */
export function issueEvidenceEnvelope<Payload extends JsonValue>(
  payload: Payload,
  options: IssueEvidenceEnvelopeOptions = {},
): EvidenceEnvelope<Payload> {
  const packetId = options.packetId ?? generateEnvelopeId()
  const issuedAt = options.issuedAt ?? new Date().toISOString()
  assertPacketId(packetId)
  assertIssuedAt(issuedAt)

  const canonicalPayload = canonicalizeJson(payload)
  const snapshot = JSON.parse(canonicalPayload) as Payload
  const unsigned: UnsignedEvidenceEnvelope<Payload> = {
    schemaVersion: EVIDENCE_ENVELOPE_VERSION,
    packetId,
    issuedAt,
    payload: snapshot,
    integrity: {
      mode: 'digest-only',
      canonicalization: EVIDENCE_CANONICALIZATION,
      digestAlgorithm: EVIDENCE_DIGEST_ALGORITHM,
    },
  }

  return {
    ...unsigned,
    integrity: {
      ...unsigned.integrity,
      packetDigest: digestUnsignedEnvelope(unsigned),
    },
  }
}

/**
 * Recomputes a digest from the envelope's current header and payload. A valid
 * result means the packet is internally unchanged under this canonicalization.
 * It does not authenticate the issuer and does not establish factual truth.
 */
export function verifyEvidenceEnvelope<Payload extends JsonValue>(
  envelope: EvidenceEnvelope<Payload>,
): EvidenceEnvelopeVerification {
  const errors: string[] = []
  const expectedDigest = envelope.integrity?.packetDigest ?? ''
  let actualDigest: string | undefined

  if (envelope.schemaVersion !== EVIDENCE_ENVELOPE_VERSION) {
    errors.push(`Unsupported schema version: ${String(envelope.schemaVersion)}.`)
  }
  if (envelope.integrity?.mode !== 'digest-only') {
    errors.push(`Unsupported integrity mode: ${String(envelope.integrity?.mode)}.`)
  }
  if (envelope.integrity?.canonicalization !== EVIDENCE_CANONICALIZATION) {
    errors.push(`Unsupported canonicalization: ${String(envelope.integrity?.canonicalization)}.`)
  }
  if (envelope.integrity?.digestAlgorithm !== EVIDENCE_DIGEST_ALGORITHM) {
    errors.push(`Unsupported digest algorithm: ${String(envelope.integrity?.digestAlgorithm)}.`)
  }
  if (!/^[a-f0-9]{64}$/.test(expectedDigest)) {
    errors.push('packetDigest must be 64 lowercase hexadecimal characters.')
  }

  try {
    assertPacketId(envelope.packetId)
    assertIssuedAt(envelope.issuedAt)
    actualDigest = digestUnsignedEnvelope(unsignedEnvelope(envelope))
    if (expectedDigest && actualDigest !== expectedDigest) {
      errors.push('The current envelope does not reproduce the issued packetDigest.')
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Envelope canonicalization failed.')
  }

  return {
    valid: errors.length === 0,
    expectedDigest,
    ...(actualDigest === undefined ? {} : { actualDigest }),
    errors,
    issuerAuthenticated: false,
    truthEstablished: false,
  }
}
