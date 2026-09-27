import { describe, expect, it } from 'vitest'
import { issuePacket } from '../src/packet.js'
import { verifyReceipt } from '../src/receipt.js'
import { createRefutationTrail } from '../src/trail.js'
import type { AgentClaim } from '../src/types.js'

const packet = issuePacket({}, 'local', ['log-in'], ['screenshot-1'], {
  id: 'pkt-trail',
  issuedAt: '2026-09-24T00:00:00.000Z',
})

function refuted(action: string): { claim: AgentClaim; result: ReturnType<typeof verifyReceipt> } {
  const claim: AgentClaim = { packetId: 'pkt-trail', claimedActions: [action], citedEvidenceIds: [] }
  return { claim, result: verifyReceipt(packet, claim) }
}

describe('createRefutationTrail', () => {
  it('starts empty and returns undefined for an unknown id', () => {
    const trail = createRefutationTrail()
    expect(trail.list()).toEqual([])
    expect(trail.find('refute-0-anything')).toBeUndefined()
  })

  it('stores the claim, its result, the claim packet id and the supplied timestamp', () => {
    const trail = createRefutationTrail()
    const { claim, result } = refuted('delete-account')
    const entry = trail.record(claim, result, '2026-09-24T01:00:00.000Z')

    expect(entry).toEqual({
      id: 'refute-0-2026-09-24T01:00:00.000Z',
      packetId: 'pkt-trail',
      claim,
      result,
      recordedAt: '2026-09-24T01:00:00.000Z',
    })
  })

  it('gives entries recorded with the same timestamp distinct ids, in insertion order', () => {
    const trail = createRefutationTrail()
    const first = trail.record(refuted('a').claim, refuted('a').result, 'same')
    const second = trail.record(refuted('b').claim, refuted('b').result, 'same')

    expect(first.id).not.toBe(second.id)
    expect(trail.list().map((entry) => entry.id)).toEqual([first.id, second.id])
    expect(trail.find(second.id)).toBe(second)
  })

  it('defaults recordedAt to the current ISO time', () => {
    const trail = createRefutationTrail()
    const before = Date.now()
    const entry = trail.record(refuted('a').claim, refuted('a').result)
    const recorded = Date.parse(entry.recordedAt)
    expect(entry.recordedAt).toBe(new Date(recorded).toISOString())
    expect(recorded).toBeGreaterThanOrEqual(before)
    expect(recorded).toBeLessThanOrEqual(Date.now())
  })

  it('returns a snapshot from list(), so editing the returned array cannot remove entries', () => {
    const trail = createRefutationTrail()
    trail.record(refuted('a').claim, refuted('a').result, 't1')
    const snapshot = trail.list()
    snapshot.length = 0
    expect(trail.list()).toHaveLength(1)
  })

  it('keeps references, not copies: later edits to a recorded claim show up in the trail', () => {
    // Documented limit: the trail is an in-memory log, not immutable storage.
    const trail = createRefutationTrail()
    const { claim, result } = refuted('a')
    const entry = trail.record(claim, result, 't1')
    claim.claimedActions.push('edited-later')
    expect(entry.claim.claimedActions).toContain('edited-later')
  })

  it('records whatever it is given, including an accepted result', () => {
    const trail = createRefutationTrail()
    const claim: AgentClaim = { packetId: 'pkt-trail', claimedActions: ['log-in'], citedEvidenceIds: [] }
    const result = verifyReceipt(packet, claim)
    expect(result.accepted).toBe(true)
    expect(trail.record(claim, result, 't1').result.accepted).toBe(true)
  })
})
