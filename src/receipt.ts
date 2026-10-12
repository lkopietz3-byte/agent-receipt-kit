import type { AgentClaim, Contradiction, CurrentState, ReceiptCoverage, ReceiptResult, VerifyOptions, WorkPacket } from './types.js'
import { factsMatch, snapshotValue } from './snapshot.js'
import type { SnapshotMemo } from './snapshot.js'
import { assertId, assertObject, assertPlainRecord, describe, isPlainRecord, readVerifyOptions, scanClaimList, snapshotStringArray } from './validate.js'

const hasOwn = (target: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(target, key)

/**
 * Formats an untrusted id or key for the human-readable `reason`. JSON
 * quoting escapes quotes, backslashes and C0 control characters (including
 * \n, \r and the terminal escape U+001B). The extra replace escapes DEL, C1
 * controls (including U+0085), U+2028/U+2029 (which some log viewers also treat
 * as line breaks) and every format (Cf) character: the zero-width space,
 * the soft hyphen, the byte order mark, the bidirectional formatting
 * characters that can reorder the text around an id, and the tag characters
 * (U+E0000 to U+E007F) that can hide text no one can see. That keeps an
 * agent-supplied string from forging extra log lines, sending terminal
 * escapes, hiding text, or blurring where one id ends and the next begins.
 * Each UTF-16 code unit of an escaped character is written as `\uXXXX`.
 * Ordinary letters and emoji are left alone, and so are the zero-width joiner
 * and non-joiner (U+200D, U+200C), which emoji sequences and several scripts
 * need. A value that is not a string (a bad claim.packetId) is shown as its
 * type, such as `<number>`, never as its content.
 */
function quote(value: unknown): string {
  if (typeof value !== 'string') return `<${typeof value}>`
  return JSON.stringify(value).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) => {
    if (character === '\u200c' || character === '\u200d') return character
    let escaped = ''
    for (let index = 0; index < character.length; index += 1) {
      escaped += `\\u${character.charCodeAt(index).toString(16).padStart(4, '0')}`
    }
    return escaped
  })
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
 * Facts are copied once, up front, with every property read once, and the
 * comparison and the result are computed from those copies (`result.snapshot`).
 * The comparison never calls a method found on an agent-supplied value, so an
 * array with its own `keys` or a Date with its own `getTime` cannot change the
 * verdict. A fact it cannot see through is a contradiction, never an
 * acceptance.
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
 * @param options Optional. `requireCoverage: true` refuses acceptance while any
 *   claimed fact was not compared with the current state (see VerifyOptions).
 *   A bad options value throws a TypeError.
 * @returns A ReceiptResult naming every mismatch; see its field docs.
 * @throws TypeError if packet is not a non-null object (a string, an array
 *   and `null` all throw); if packet.id is missing, not a string, or shows
 *   nothing (empty, or only whitespace and invisible characters); if
 *   packet.allowedActions or packet.evidenceIds is not an array of strings, or
 *   has a hole (the message names the index); or if currentState is neither
 *   omitted, `null`, nor a plain or null-prototype object (an object whose
 *   prototype is a bare null-prototype object is not plain). Also, as in 0.1.1,
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
  options?: VerifyOptions,
): ReceiptResult<Fact> {
  assertObject(packet, 'packet')
  assertObject(claim, 'claim')
  const { requireCoverage } = readVerifyOptions(options)
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
  // Every fact is copied once, up front, with each property read once. The
  // comparison and the result are computed from these copies, so a getter or a
  // later edit cannot change what was judged. One memo is shared with the
  // current state so an object present on both sides stays one object.
  const memo: SnapshotMemo = new Map()
  let claimedFacts: Record<string, unknown> = {}
  if (isPlainRecord(rawFacts)) claimedFacts = snapshotValue(rawFacts, memo) as Record<string, unknown>
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
  const claimedFactKeys = Object.keys(claimedFacts)
  const uncheckedFactKeys: string[] = []
  let comparedFactCount = 0
  for (const key of claimedFactKeys) {
    if (!stateSupplied || !hasOwn(currentState, key)) {
      uncheckedFactKeys.push(key)
      continue
    }
    comparedFactCount += 1
    const claimedFact = claimedFacts[key] as Fact
    const currentFact = snapshotValue(currentState[key], memo) as Fact
    if (!factsMatch(claimedFact, currentFact)) {
      contradictions.push({ key, claimedFact, currentFact })
    }
  }
  const coverage: ReceiptCoverage = {
    stateSupplied,
    claimedFactCount: claimedFactKeys.length,
    comparedFactCount,
    uncheckedFactKeys,
  }

  const uncoveredFactKeys = requireCoverage ? [...uncheckedFactKeys] : []

  const accepted =
    !packetMismatch &&
    unauthorizedActions.length === 0 &&
    droppedEvidenceIds.length === 0 &&
    contradictions.length === 0 &&
    uncoveredFactKeys.length === 0 &&
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
  if (uncoveredFactKeys.length) {
    const why = stateSupplied
      ? 'the supplied current state has no value for them'
      : 'no current state was supplied'
    reasons.push(`${uncoveredFactKeys.length} claimed fact(s) are not covered by the supplied current state: ${quoteAll(uncoveredFactKeys)} (${why}), and requireCoverage is set.`)
  }

  return {
    accepted,
    unauthorizedActions,
    droppedEvidenceIds,
    contradictions,
    packetMismatch,
    claimProblems,
    uncoveredFactKeys,
    coverage,
    snapshot: {
      claimedActions,
      citedEvidenceIds,
      claimedFacts: claimedFacts as Record<string, Fact>,
    },
    reason: accepted ? acceptedReason(coverage) : reasons.join(' '),
  }
}
