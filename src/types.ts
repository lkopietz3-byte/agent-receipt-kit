// Core types for agent-receipt-kit.
//
// The pattern: before an agent (a coding agent, a browser-automation agent, a
// data-processing agent, a customer-service agent, anything that acts and
// then reports back) does any work, a human or orchestrator issues a
// WorkPacket describing exactly what was authorized. When the agent reports
// back what it did, that report (an AgentClaim) is untrusted by default. It
// is only accepted once it has been checked against the packet that was
// actually issued, and optionally against a fresher independent observation
// of reality.

/**
 * The three built-in authority levels:
 *
 * - 'observe': the agent may only report what it sees. No side effects are
 *   implied or permitted.
 * - 'prepare': the agent may stage a proposed action (a plan, a diff, a
 *   draft) but may not execute it.
 * - 'local': bounded execution within a scope the packet defines (a file
 *   count, a path allowlist, a set of allowed actions) with nothing implied
 *   beyond what the packet lists.
 *
 * These are labels only. verifyReceipt never reads the authority level; it
 * checks the packet's explicit allowedActions and evidenceIds lists. Callers
 * are not locked into these three: WorkPacket, issuePacket and verifyReceipt
 * are generic over the authority type, so a caller can supply their own
 * union (e.g. `'observe' | 'draft' | 'sandbox' | 'production'`).
 */
export type AuthorityLevel = 'observe' | 'prepare' | 'local'

/**
 * A machine-readable handoff: what a human or orchestrator authorized an
 * agent to do, issued BEFORE the agent runs.
 *
 * `scope` is intentionally an opaque, caller-defined generic. A coding agent
 * might scope this to a repo and path allowlist; a browser agent might scope
 * it to a domain and a set of allowed pages; a data-pipeline agent might
 * scope it to a dataset id and a date range. This library does not know or
 * care what scope means; it only compares the claim against the packet's
 * allowedActions and evidenceIds.
 */
export interface WorkPacket<Scope = unknown, Authority = AuthorityLevel> {
  /**
   * Id a claim must echo in its packetId. issuePacket generates
   * `pkt-<random UUID>` unless the caller supplies one.
   */
  id: string
  /**
   * When the packet was issued. issuePacket defaults this to an ISO 8601
   * string; a caller-supplied value is stored as given, not validated.
   */
  issuedAt: string
  /** Caller-defined description of what this packet's authority applies to. */
  scope: Scope
  /** The authority level granted for this packet. */
  authorityLevel: Authority
  /**
   * Action identifiers the agent is authorized to perform or claim it
   * performed. Caller-defined strings (e.g. 'click', 'submit-form',
   * 'write-file', 'send-email', 'transform-rows'), matched exactly (no case
   * folding, trimming or Unicode normalization). An agent claim naming any
   * action outside this list is flagged, never silently accepted.
   */
  allowedActions: string[]
  /**
   * Ids of evidence, references, or sources the agent may cite in support of
   * a claim (e.g. a screenshot id, a scan finding id, a document id, a row
   * id), matched exactly. An agent claim citing an id that is not in this
   * list is flagged in droppedEvidenceIds, never silently accepted. The kit
   * does not look at the evidence itself.
   */
  evidenceIds: string[]
}

/**
 * What the agent/worker reports it did, after running. This is UNTRUSTED
 * input. Nothing in this shape is assumed true until verifyReceipt checks it
 * against the packet that was actually issued (and, if supplied, a fresher
 * observation of current state).
 */
export interface AgentClaim<Fact = unknown> {
  /** The id of the WorkPacket this claim responds to. */
  packetId: string
  /** Action identifiers the agent claims to have taken. */
  claimedActions: string[]
  /** Evidence/reference ids the agent cites in support of its claim. */
  citedEvidenceIds: string[]
  /**
   * Optional key/value facts the agent asserts about the world as a result
   * of its work (e.g. { orderStatus: 'confirmed' }, { rowsUpdated: 42 },
   * { pageUrl: '/checkout/success' }). Each fact whose key also exists in a
   * supplied `currentState` is compared with it; facts without a matching
   * key are not checked. Keep values JSON-shaped (plain objects, arrays,
   * primitives); Dates are compared by time value, and any other object only
   * matches itself.
   */
  claimedFacts?: Record<string, Fact>
  /** Optional free-text summary of what the agent believes it did. Not checked. */
  summary?: string
  /** When the agent reported this claim. Not checked. */
  reportedAt?: string
}

/**
 * A fresher, independent observation of reality, supplied by the caller, to
 * cross-check an AgentClaim against. This library does not go get this
 * itself: it is only as trustworthy as whatever the caller passes in. See
 * the README's limits section.
 *
 * Shape mirrors AgentClaim.claimedFacts: a flat map of fact key to value.
 */
export type CurrentState<Fact = unknown> = Record<string, Fact>

/** One fact where a claim and the supplied current state disagree. */
export interface Contradiction<Fact = unknown> {
  /** The fact key that disagreed (matches a key in claimedFacts / currentState). */
  key: string
  /** What the agent claimed this fact was. */
  claimedFact: Fact
  /** What the fresher current-state check found instead. */
  currentFact: Fact
}

/** The structured result of verifying an AgentClaim against a WorkPacket. */
export interface ReceiptResult<Fact = unknown> {
  /**
   * True only when there are zero unauthorized actions, zero dropped
   * evidence ids, zero contradictions, and the claim's packetId matches the
   * packet under review. It means these checks found no mismatch, not that
   * the claim is true: facts with no matching currentState key, and all
   * facts when no currentState is supplied, are never compared.
   */
  accepted: boolean
  /** Claimed actions that were not in the issued packet's allowedActions. */
  unauthorizedActions: string[]
  /**
   * Cited evidence ids that were not in the issued packet's evidenceIds.
   * Never silently dropped from the result: their absence from the packet
   * is exactly what gets flagged here.
   */
  droppedEvidenceIds: string[]
  /** Facts the claim asserted that a supplied currentState reads differently. */
  contradictions: Contradiction<Fact>[]
  /**
   * True when the claim's packetId does not match the packet passed to
   * verifyReceipt. A claim answering a different packet than the one under
   * review is never accepted, regardless of its other contents.
   */
  packetMismatch: boolean
  /**
   * Human-readable explanation of the decision, for logs. Untrusted ids and
   * keys appear JSON-quoted with line breaks escaped. For an accepted claim
   * it says how many claimed facts were actually cross-checked. The wording
   * is not a stable API; branch on the structured fields instead.
   */
  reason: string
}
