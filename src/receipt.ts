import type { AgentClaim, Contradiction, CurrentState, ReceiptCoverage, ReceiptResult, WorkPacket } from './types.js'
import { assertId, assertObject, assertPlainRecord, describe, isPlainRecord, scanClaimList, snapshotStringArray } from './validate.js'

const hasOwn = (target: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(target, key)

/**
 * Structural equality with zero dependencies, for comparing a claimed fact
 * with the same-keyed fact in a fresher current-state observation.
 *
 * Only JSON-shaped values are compared by content: primitives (0 equals -0,
 * NaN equals NaN), arrays (element by element, where a hole only matches a
 * hole) and plain or null-prototype objects (own enumerable string keys, any
 * order). Dates are compared by time value. Any other object (Map, Set,
 * RegExp, Error, typed arrays, class instances) matches only itself, so a
 * difference this function cannot see is reported as a contradiction instead
 * of being silently accepted. A value never matches one of a different kind.
 *
 * Two references to the very same object are equal without being walked, so a
 * circular object compared with itself matches. Two separate circular
 * structures, and two separate acyclic structures nested deeper than the
 * runtime's call stack allows, overflow the stack and throw a RangeError,
 * never an acceptance. The depth at which that happens depends on the
 * runtime, so it is not a fixed limit.
 */
function factsMatch(a: unknown, b: unknown): boolean {
  // `===` makes 0 and -0 equal (JSON serializes both as 0); Object.is makes
  // NaN equal to NaN.
  if (a === b || Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (const index of a.keys()) {
      const present = hasOwn(a, index)
      if (present !== hasOwn(b, index)) return false
      if (present && !factsMatch(a[index], b[index])) return false
    }
    return true
  }
  if (a instanceof Date && b instanceof Date) return Object.is(a.getTime(), b.getTime())
  // Everything else, including an array or a Date met by another kind of
  // value, needs two plain records to match by content.
  if (!isPlainRecord(a) || !isPlainRecord(b)) return false
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  return aKeys.every((key) => hasOwn(b, key) && factsMatch(a[key], b[key]))
}

/**
 * Formats an untrusted id or key for the human-readable `reason`. JSON
 * quoting escapes quotes, backslashes and C0 control characters (including
 * \n, \r and the terminal escape U+001B). The extra replace escapes DEL, C1
 * controls (including U+0085), U+2028/U+2029 (which some log viewers also treat
 * as line breaks) and the bidirectional formatting characters (U+061C,
 * U+200E/U+200F, U+202A to U+202E, U+2066 to U+2069) that can reorder the text
 * around an id. That keeps an agent-supplied string from forging extra log
 * lines, sending terminal escapes, or blurring where one id ends and the next
 * begins. Ordinary letters, emoji and invisible joiners are left alone. A
 * value that is not a string (a bad claim.packetId) is shown as its type, such
 * as `<number>`, never as its content.
 */
function quote(value: unknown): string {
  if (typeof value !== 'string') return `<${typeof value}>`
  return JSON.stringify(value).replace(
    /[\p{Cc}\p{Zl}\p{Zp}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

function quoteAll(values: readonly string[]): string {
  return values.map(quote).join(', ')
}

/**
 * The reason for an accepted claim. It says how many claimed facts were
 * actually cross-checked, so an accepted receipt never reads as more
 * verified than it was.
 */
function acceptedReason(coverage: ReceiptCoverage): string {
  const { stateSupplied, claimedFactCount, comparedFactCount, uncheckedFactKeys } = coverage
  const base = "Claim matches the issued packet's authority and evidence and answers the correct packet."
  if (claimedFactCount === 0) return `${base} The claim asserts no facts, so there was nothing to cross-check.`
  if (!stateSupplied) {
    return `${base} No current state was supplied, so its ${claimedFactCount} claimed fact(s) were not cross-checked.`
  }
  let text = `${base} ${comparedFactCount} claimed fact(s) agree with the supplied current state.`
  if (uncheckedFactKeys.length) {
    text += ` ${uncheckedFactKeys.length} claimed fact(s) were not checked because the current state has no value for them: ${quoteAll(uncheckedFactKeys)}.`
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
 * `accepted` is true only when all four checks come back clean. All checks
 * run and report even when an earlier one fails. Action and evidence ids
 * are matched exactly (no case folding, trimming or Unicode normalization),
 * and an empty claim is accepted because nothing in it falls outside the
 * packet. Facts are compared structurally: primitives (0 equals -0, NaN
 * equals NaN), arrays element by element, plain objects by own keys in any
 * order, Dates by time value; any other object (Map, Set, class instance)
 * only matches itself, so the comparison fails closed. The function is
 * synchronous, reads no clock and does not mutate its inputs.
 *
 * Who supplies what decides what happens. The packet and currentState come
 * from the caller's own code, so a malformed one throws a TypeError. The claim
 * is produced by the agent being checked, so a malformed claim is rejected in
 * the result (`accepted: false`, `claimProblems` and `reason`), never thrown
 * and never accepted, with two exceptions kept from 0.1.1: a claim that is not
 * an object, and a claim list that is not an array, throw a TypeError.
 *
 * @param packet The WorkPacket that was actually issued (trusted).
 * @param claim The agent's report. Treated as untrusted.
 * @param currentState Optional fresher observation, keyed like
 *   claim.claimedFacts. Omitted or null means no fact is cross-checked.
 * @returns A ReceiptResult naming every mismatch; see its field docs.
 * @throws TypeError if packet is not a non-null object (a string, an array
 *   and `null` all throw); if packet.id is missing, not a string, or shows
 *   nothing (empty, or only whitespace and invisible characters); if
 *   packet.allowedActions or packet.evidenceIds is not an array of strings, or
 *   has a hole (the message names the index); or if currentState is neither
 *   omitted, `null`, nor a plain or null-prototype object. Also, as in 0.1.1,
 *   if claim is not a non-null object, or claim.claimedActions or
 *   claim.citedEvidenceIds is missing or not an array. Every other problem
 *   with the claim is reported in the result, not thrown: a non-string entry,
 *   hole or blank string in a claim list, a claimedFacts that is not a plain
 *   object, and a missing, non-string or blank claim.packetId (a
 *   packetMismatch). Each field is read once, and the result is computed from
 *   the values that were read.
 * @throws RangeError if a claimed fact and its current-state counterpart
 *   are both circular structures (stack overflow). Never an acceptance.
 */
export function verifyReceipt<Scope = unknown, Authority = unknown, Fact = unknown>(
  packet: WorkPacket<Scope, Authority>,
  claim: AgentClaim<Fact>,
  currentState?: CurrentState<Fact>,
): ReceiptResult<Fact> {
  assertObject(packet, 'packet')
  assertObject(claim, 'claim')
  // Read every field of the caller's objects exactly once, validate what was
  // read, and compute from those same values.
  const packetId: unknown = packet.id
  assertId(packetId, 'packet.id')
  const allowedActions = snapshotStringArray(packet.allowedActions, 'packet.allowedActions')
  const issuedEvidenceIds = snapshotStringArray(packet.evidenceIds, 'packet.evidenceIds')
  const claimPacketId: unknown = claim.packetId
  // The claim comes from the agent being checked, so a malformed claim is
  // rejected in the result (claimProblems and reason), not thrown. A claim that
  // is not an object, or a list that is not an array, still throws (0.1.1).
  const claimProblems: string[] = []
  const claimedActions = scanClaimList(claim.claimedActions, 'claim.claimedActions', claimProblems)
  const citedEvidenceIds = scanClaimList(claim.citedEvidenceIds, 'claim.citedEvidenceIds', claimProblems)
  const rawFacts: unknown = claim.claimedFacts
  let claimedFacts: Record<string, unknown> | undefined
  if (isPlainRecord(rawFacts)) claimedFacts = rawFacts
  else if (rawFacts !== undefined) {
    claimProblems.push(`claim.claimedFacts is not a plain object (got ${describe(rawFacts)}).`)
  }
  const stateSupplied = currentState !== undefined && currentState !== null
  if (stateSupplied) assertPlainRecord(currentState, 'currentState')

  const packetMismatch = claimPacketId !== packetId

  const allowed = new Set(allowedActions)
  const unauthorizedActions = claimedActions.filter((action) => !allowed.has(action))

  const issuedEvidence = new Set(issuedEvidenceIds)
  const droppedEvidenceIds = citedEvidenceIds.filter((id) => !issuedEvidence.has(id))

  const contradictions: Contradiction<Fact>[] = []
  const claimedFactEntries = claimedFacts === undefined ? [] : Object.entries(claimedFacts as Record<string, Fact>)
  const uncheckedFactKeys: string[] = []
  let comparedFactCount = 0
  for (const [key, claimedFact] of claimedFactEntries) {
    if (!stateSupplied || !hasOwn(currentState, key)) {
      uncheckedFactKeys.push(key)
      continue
    }
    comparedFactCount += 1
    const currentFact = currentState[key] as Fact
    if (!factsMatch(claimedFact, currentFact)) {
      contradictions.push({ key, claimedFact, currentFact })
    }
  }
  const coverage: ReceiptCoverage = {
    stateSupplied,
    claimedFactCount: claimedFactEntries.length,
    comparedFactCount,
    uncheckedFactKeys,
  }

  const accepted =
    !packetMismatch &&
    unauthorizedActions.length === 0 &&
    droppedEvidenceIds.length === 0 &&
    contradictions.length === 0 &&
    claimProblems.length === 0

  const reasons: string[] = []
  if (packetMismatch) {
    reasons.push(`Claim answers packet ${quote(claimPacketId)}, not the packet under review (${quote(packetId)}).`)
  }
  if (claimProblems.length) {
    reasons.push(`The claim is malformed, so it cannot be accepted: ${claimProblems.join(' ')}`)
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
    claimProblems,
    coverage,
    reason: accepted ? acceptedReason(coverage) : reasons.join(' '),
  }
}
