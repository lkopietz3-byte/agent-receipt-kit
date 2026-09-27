import type { AgentClaim, ReceiptResult } from './types.js'

/**
 * One retained record of a claim, typically one that verifyReceipt did not
 * accept (unauthorized action, dropped evidence, contradiction, or a
 * mismatched packet), stored next to the result that explains why so the
 * disagreement can be inspected later.
 */
export interface RefutationEntry<Fact = unknown> {
  /** `refute-<sequence>-<recordedAt>`; unique within one trail. */
  id: string
  /** Copied from claim.packetId at record time. */
  packetId: string
  /** The claim as passed to record(): the same object reference, not a copy. */
  claim: AgentClaim<Fact>
  /** The result as passed to record(): the same object reference, not a copy. */
  result: ReceiptResult<Fact>
  /** The timestamp passed to record(), or the ISO time of the call. */
  recordedAt: string
}

/**
 * An in-memory, append-only log of refuted or contradicted claims: when a
 * claim is challenged, the finding is kept instead of quietly disappearing.
 *
 * Deliberately has no remove/delete method. It is not durable, not
 * immutable (entries hold references to the objects you pass in) and not
 * tamper-evident. If you need any of those, copy entries into storage that
 * provides them.
 */
export interface RefutationTrail<Fact = unknown> {
  /**
   * Record a claim (typically one verifyReceipt did not accept) plus the
   * result that explains why. Does not check that the result belongs to the
   * claim or that it was rejected. Returns the stored entry.
   */
  record(claim: AgentClaim<Fact>, result: ReceiptResult<Fact>, recordedAt?: string): RefutationEntry<Fact>
  /** Every entry recorded so far, oldest first. Returns a snapshot copy, not a live reference. */
  list(): RefutationEntry<Fact>[]
  /** Look up a single retained entry by its id; undefined if there is none. */
  find(id: string): RefutationEntry<Fact> | undefined
}

/**
 * Creates a new, empty RefutationTrail. Each trail keeps its own entries and
 * id sequence; nothing is shared between trails or persisted.
 */
export function createRefutationTrail<Fact = unknown>(): RefutationTrail<Fact> {
  const entries: RefutationEntry<Fact>[] = []
  let sequence = 0

  return {
    record(claim, result, recordedAt = new Date().toISOString()) {
      const entry: RefutationEntry<Fact> = {
        id: `refute-${sequence++}-${recordedAt}`,
        packetId: claim.packetId,
        claim,
        result,
        recordedAt,
      }
      entries.push(entry)
      return entry
    },
    list() {
      return [...entries]
    },
    find(id) {
      return entries.find((entry) => entry.id === id)
    },
  }
}
