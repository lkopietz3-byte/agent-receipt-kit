import { afterEach, describe, expect, it, vi } from 'vitest'
import { issuePacket } from '../src/packet.js'
import type { WorkPacket } from '../src/types.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('issuePacket', () => {
  it('uses the supplied id and issuedAt when given', () => {
    const packet = issuePacket({ repo: 'demo' }, 'prepare', ['write-file'], ['finding-1'], {
      id: 'pkt-custom',
      issuedAt: '2026-09-24T12:00:00.000Z',
    })
    expect(packet).toEqual({
      id: 'pkt-custom',
      issuedAt: '2026-09-24T12:00:00.000Z',
      scope: { repo: 'demo' },
      authorityLevel: 'prepare',
      allowedActions: ['write-file'],
      evidenceIds: ['finding-1'],
    })
  })

  it('generates a pkt- prefixed UUID and a current ISO timestamp by default', () => {
    const before = Date.now()
    const packet = issuePacket({}, 'observe', [], [])
    const after = Date.now()

    expect(packet.id).toMatch(/^pkt-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(packet.issuedAt).toBe(new Date(packet.issuedAt).toISOString())
    const issued = Date.parse(packet.issuedAt)
    expect(issued).toBeGreaterThanOrEqual(before)
    expect(issued).toBeLessThanOrEqual(after)
  })

  it('falls back to a timestamp-plus-random id when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', undefined)
    const first = issuePacket({}, 'observe', [], [])
    const second = issuePacket({}, 'observe', [], [])
    expect(first.id).toMatch(/^pkt-[0-9a-z]+-[0-9a-z]+$/)
    expect(first.id).not.toBe(second.id)
  })

  it('copies the action and evidence lists, so later edits to the inputs do not widen the packet', () => {
    const actions = ['log-in']
    const evidence = ['screenshot-1']
    const packet = issuePacket({}, 'local', actions, evidence, { id: 'pkt-copy', issuedAt: 'fixed' })

    actions.push('submit-payment')
    evidence.push('screenshot-99')

    expect(packet.allowedActions).toEqual(['log-in'])
    expect(packet.evidenceIds).toEqual(['screenshot-1'])
  })

  it('keeps scope by reference and does not validate issuedAt (both are caller-owned)', () => {
    const scope = { site: 'shop.example.com' }
    const packet = issuePacket(scope, 'local', [], [], { issuedAt: 'not a date' })
    expect(packet.scope).toBe(scope)
    expect(packet.issuedAt).toBe('not a date')
  })

  it('accepts a caller-defined authority type through the generic parameter', () => {
    type Tier = 'draft' | 'sandbox' | 'production'
    const packet: WorkPacket<{ env: string }, Tier> = issuePacket<{ env: string }, Tier>(
      { env: 'staging' },
      'sandbox',
      ['deploy'],
      [],
      { id: 'pkt-tier', issuedAt: 'fixed' },
    )
    expect(packet.authorityLevel).toBe('sandbox')
  })
})
