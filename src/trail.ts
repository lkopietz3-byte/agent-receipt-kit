import type { AgentClaim, ReceiptResult } from './types.js'

/**
 * One retained record of a claim that verifyReceipt did not fully accept
 * (unauthorized action, dropped evidence, contradiction, or a mismatched
 * packet). Retained verbatim, alongside the verification result that
 * explains why, so the disagreement itself is auditable later.
 */
export interface RefutationEntry<Fact = unknown> {
  id: string
  packetId: string
  claim: AgentClaim<Fact>
  result: ReceiptResult<Fact>
  recordedAt: string
}

/**
 * An append-only log of refuted/contradicted claims. Mirrors the pattern
 * this library was extracted from: when a claim is challenged (by authority
 * check, evidence check, or a fresher observation), the finding is not
 * deleted, it is retained as refuted, so a full audit trail survives
 * disagreement instead of the evidence quietly disappearing.
 *
 * Deliberately has no remove/delete method. If you need to prune old
 * entries for storage reasons, do it outside this type, explicitly, rather
 * than reaching for an API this library hands you for free.
 */
export interface RefutationTrail<Fact = unknown> {
  /** Record a claim (typically one verifyReceipt did not accept) plus the result that explains why. Returns the stored entry. */
  record(claim: AgentClaim<Fact>, result: ReceiptResult<Fact>, recordedAt?: string): RefutationEntry<Fact>
  /** Every entry recorded so far, oldest first. Returns a snapshot copy, not a live reference. */
  list(): RefutationEntry<Fact>[]
  /** Look up a single retained entry by its id. */
  find(id: string): RefutationEntry<Fact> | undefined
}

/** Creates a new, empty RefutationTrail. */
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
