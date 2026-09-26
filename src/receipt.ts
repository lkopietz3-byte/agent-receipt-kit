import type { AgentClaim, Contradiction, CurrentState, ReceiptResult, WorkPacket } from './types.js'
import { assertArray } from './validate.js'

const hasOwn = (target: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(target, key)

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Structural equality with zero dependencies, for comparing a claimed fact
 * with the same-keyed fact in a fresher current-state observation.
 *
 * Only JSON-shaped values are compared by content: primitives (0 equals -0,
 * NaN equals NaN), arrays (element by element, where a hole only matches a
 * hole) and plain or null-prototype objects (own enumerable string keys, any
 * order). Dates are compared by time value. Any other object (Map, Set, RegExp, Error, typed
 * arrays, class instances) matches only itself, so a difference this
 * function cannot see is reported as a contradiction instead of being
 * silently accepted. Circular structures are not supported and overflow the
 * stack (a thrown RangeError, never an acceptance).
 */
function factsMatch(a: unknown, b: unknown): boolean {
  // `===` makes 0 and -0 equal (JSON serializes both as 0); Object.is makes
  // NaN equal to NaN.
  if (a === b || Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let index = 0; index < a.length; index += 1) {
      const present = hasOwn(a, index)
      if (present !== hasOwn(b, index)) return false
      if (present && !factsMatch(a[index], b[index])) return false
    }
    return true
  }
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime())
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false
  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>
  const aKeys = Object.keys(aRecord)
  if (aKeys.length !== Object.keys(bRecord).length) return false
  return aKeys.every((key) => hasOwn(bRecord, key) && factsMatch(aRecord[key], bRecord[key]))
}

/**
 * Formats an untrusted id or key for the human-readable `reason`. JSON
 * quoting escapes quotes, backslashes and C0 control characters (including
 * \n and \r); the extra replace escapes DEL, C1 controls (including U+0085)
 * and U+2028/U+2029, which some log viewers also treat as line breaks. This
 * keeps an agent-supplied string from forging extra log lines or blurring
 * where one id ends and the next begins.
 */
function quote(value: unknown): string {
  if (typeof value !== 'string') return `<${typeof value}>`
  return JSON.stringify(value).replace(
    /[\u007f-\u009f\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

function quoteAll(values: readonly unknown[]): string {
  return values.map(quote).join(', ')
}

/**
 * The reason for an accepted claim. It says how many claimed facts were
 * actually cross-checked, so an accepted receipt never reads as more
 * verified than it was.
 */
function acceptedReason(factCount: number, stateSupplied: boolean, uncheckedKeys: readonly string[]): string {
  const base = "Claim matches the issued packet's authority and evidence and answers the correct packet."
  if (factCount === 0) return `${base} The claim asserts no facts, so there was nothing to cross-check.`
  if (!stateSupplied) {
    return `${base} No current state was supplied, so its ${factCount} claimed fact(s) were not cross-checked.`
  }
  const checked = factCount - uncheckedKeys.length
  let text = `${base} ${checked} claimed fact(s) agree with the supplied current state.`
  if (uncheckedKeys.length) {
    text += ` ${uncheckedKeys.length} claimed fact(s) were not checked because the current state has no value for them: ${quoteAll(uncheckedKeys)}.`
  }
  return text
}

/**
 * The core function. Verifies an AgentClaim against the WorkPacket that was
 * actually issued, and optionally against a fresher currentState.
 *
 * This never trusts the claim by default. It checks, independently:
 *
 * 1. Authority: every action the agent claims to have taken must appear in
 *    packet.allowedActions. Anything else is an unauthorized action.
 * 2. Evidence: every id the agent cites must appear in packet.evidenceIds.
 *    Anything else is dropped and named in droppedEvidenceIds, never
 *    silently accepted as if it had been part of the original grant.
 * 3. Contradiction: if the caller supplies currentState (a fresher,
 *    independent observation), every fact the claim asserts is compared
 *    against the same-keyed fact in currentState. A mismatch is recorded as
 *    a contradiction rather than either trusting the (older) claim or
 *    silently overwriting it with the (newer) observation. Resolving a
 *    contradiction is a decision for the caller, not this function.
 * 4. Identity: the claim must actually be answering this packet (matching
 *    packetId). A claim for a different packet is never accepted.
 *
 * `accepted` is true only when all four checks come back clean.
 */
export function verifyReceipt<Scope = unknown, Authority = unknown, Fact = unknown>(
  packet: WorkPacket<Scope, Authority>,
  claim: AgentClaim<Fact>,
  currentState?: CurrentState<Fact>,
): ReceiptResult<Fact> {
  assertArray(packet.allowedActions, 'packet.allowedActions')
  assertArray(packet.evidenceIds, 'packet.evidenceIds')
  assertArray(claim.claimedActions, 'claim.claimedActions')
  assertArray(claim.citedEvidenceIds, 'claim.citedEvidenceIds')

  const packetMismatch = claim.packetId !== packet.id

  const allowed = new Set(packet.allowedActions)
  const unauthorizedActions = claim.claimedActions.filter((action) => !allowed.has(action))

  const issuedEvidence = new Set(packet.evidenceIds)
  const droppedEvidenceIds = claim.citedEvidenceIds.filter((id) => !issuedEvidence.has(id))

  const contradictions: Contradiction<Fact>[] = []
  const claimedFactEntries = claim.claimedFacts ? Object.entries(claim.claimedFacts) : []
  const uncheckedFactKeys: string[] = []
  const stateSupplied = currentState !== undefined && currentState !== null
  if (stateSupplied) {
    for (const [key, claimedFact] of claimedFactEntries) {
      if (!hasOwn(currentState, key)) {
        uncheckedFactKeys.push(key)
        continue
      }
      const currentFact = currentState[key] as Fact
      if (!factsMatch(claimedFact, currentFact)) {
        contradictions.push({ key, claimedFact, currentFact })
      }
    }
  }

  const accepted =
    !packetMismatch &&
    unauthorizedActions.length === 0 &&
    droppedEvidenceIds.length === 0 &&
    contradictions.length === 0

  const reasons: string[] = []
  if (packetMismatch) {
    reasons.push(`Claim answers packet ${quote(claim.packetId)}, not the packet under review (${quote(packet.id)}).`)
  }
  if (unauthorizedActions.length) {
    reasons.push(`${unauthorizedActions.length} claimed action(s) were never authorized: ${quoteAll(unauthorizedActions)}.`)
  }
  if (droppedEvidenceIds.length) {
    reasons.push(`${droppedEvidenceIds.length} cited evidence id(s) were not part of the issued packet: ${quoteAll(droppedEvidenceIds)}.`)
  }
  if (contradictions.length) {
    reasons.push(`${contradictions.length} claimed fact(s) contradict the supplied current state: ${quoteAll(contradictions.map((item) => item.key))}.`)
  }

  return {
    accepted,
    unauthorizedActions,
    droppedEvidenceIds,
    contradictions,
    packetMismatch,
    reason: accepted
      ? acceptedReason(claimedFactEntries.length, stateSupplied, uncheckedFactKeys)
      : reasons.join(' '),
  }
}
