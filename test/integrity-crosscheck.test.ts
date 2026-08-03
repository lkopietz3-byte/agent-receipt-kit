import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalizeJson, sha256Hex } from '../src/integrity.js'

function nodeSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function deterministicText(length: number): string {
  let state = 0x6d2b79f5
  const pieces: string[] = []
  const alphabet = [
    'a', 'Z', '0', '-', '_', ' ', '\n', 'é', '€', '東京', '🔎', '𝄞',
  ]

  while (pieces.join('').length < length) {
    state = Math.imul(state ^ (state >>> 15), state | 1)
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61)
    const index = ((state ^ (state >>> 14)) >>> 0) % alphabet.length
    pieces.push(alphabet[index]!)
  }

  return pieces.join('').slice(0, length)
}

describe('SHA-256 cross-check', () => {
  it('matches Node crypto across block boundaries and Unicode inputs', () => {
    const lengths = [
      0, 1, 2, 3, 7, 31, 55, 56, 57, 63, 64, 65, 127, 128, 129,
      255, 256, 257, 1023, 1024, 1025, 8192,
    ]

    for (const length of lengths) {
      const value = deterministicText(length)
      expect(sha256Hex(value), `length ${length}`).toBe(nodeSha256(value))
    }
  })

  it('matches Node crypto for canonical evidence documents', () => {
    const documents = [
      { decision: 'RELEASE', dimensions: ['truth', 'time'], facts: { value: 0 } },
      {
        decision: 'REQUIRE_APPROVAL',
        facts: { requested: 25_000, limit: 5_000, approved: false },
        sources: ['ROLE-OPERATOR-7'],
      },
      {
        stringEdges: ['é', 'é', '€', '東京', '🔎', '\u000f', '\n', '"', '\\'],
        nested: { z: null, a: [true, false, 1e30, 1e-27] },
      },
    ] as const

    for (const document of documents) {
      const canonical = canonicalizeJson(document)
      expect(sha256Hex(canonical)).toBe(nodeSha256(canonical))
    }
  })
})

describe('canonical JSON interoperability guard', () => {
  it('uses UTF-16 property ordering, including non-BMP keys', () => {
    const document = {
      '\u20ac': 'Euro Sign',
      '\r': 'Carriage Return',
      '\ufb33': 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '😀': 'Emoji: Grinning Face',
      '\u0080': 'Control',
      ö: 'Latin Small Letter O With Diaeresis',
    }

    expect(canonicalizeJson(document)).toBe(
      '{"\\r":"Carriage Return","1":"One","":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
    )
  })

  it('does not normalize canonically distinct Unicode strings', () => {
    const composed = canonicalizeJson({ value: 'é' })
    const decomposed = canonicalizeJson({ value: 'é' })

    expect(composed).not.toBe(decomposed)
    expect(sha256Hex(composed)).not.toBe(sha256Hex(decomposed))
  })
})
