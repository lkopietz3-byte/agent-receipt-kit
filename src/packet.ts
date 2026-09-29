import type { AuthorityLevel, WorkPacket } from './types.js'
import { assertId, assertPlainRecord, snapshotStringArray } from './validate.js'

/** `fallback()` for `undefined`; otherwise `value`, which must be a non-blank string. */
function optionalId(value: unknown, label: string, fallback: () => string): string {
  if (value === undefined) return fallback()
  assertId(value, label)
  return value
}

/**
 * Generates a packet id with zero runtime dependencies. Uses
 * globalThis.crypto.randomUUID when present (Node 20+, and browsers in
 * secure contexts). Otherwise falls back to a timestamp plus Math.random,
 * which is unlikely to collide but is neither guaranteed unique nor
 * unpredictable; pass options.id if either matters.
 */
function generatePacketId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoObj?.randomUUID) return `pkt-${cryptoObj.randomUUID()}`
  const random = Math.random().toString(36).slice(2, 12)
  return `pkt-${Date.now().toString(36)}-${random}`
}

/**
 * Issues a WorkPacket: the authorization a human or orchestrator hands to an
 * agent BEFORE it runs. Call this first, hand the returned packet (or its
 * id, scope, and authority) to the agent as its instructions, and keep the
 * packet around so a later verifyReceipt call can check the agent's report
 * against exactly what this call authorized.
 *
 * @param scope Caller-defined description of what this authority applies to
 *   (a repo and path allowlist, a browser session and domain, a dataset id,
 *   a support ticket id, anything). Opaque to this library.
 * @param authorityLevel How much the agent is authorized to do. Defaults to
 *   the three-level AuthorityLevel union, but callers may supply their own
 *   authority type via the generic parameter.
 * @param allowedActions Action identifiers the agent may perform or later
 *   claim it performed.
 * @param evidenceIds Ids of evidence/references the agent may cite in
 *   support of a claim.
 * @param options.id Override the generated packet id (useful for tests or
 *   idempotency keys). Optional. Only `undefined` means "generate one"; any
 *   other value must be a string that shows something (not empty, not only
 *   whitespace or invisible characters). Stored as given.
 * @param options.issuedAt Override the generated issuedAt timestamp.
 *   Optional; defaults to `new Date().toISOString()`. Only `undefined` means
 *   "use the clock"; any other value must be a non-blank string. It is
 *   stored as given and is not checked to be a date.
 * @returns A new WorkPacket. allowedActions and evidenceIds are copies made
 *   from a single read of each input, so later edits to the input arrays do
 *   not change the packet; scope is stored by reference. The packet itself is
 *   a plain mutable object.
 * @throws TypeError if allowedActions or evidenceIds is not an array whose
 *   every position holds a string (a string would otherwise be spread into
 *   single characters and authorize them; a hole is refused), if `options`
 *   is not a plain object, or if `options.id` or `options.issuedAt` is given
 *   but is not a non-blank string.
 */
export function issuePacket<Scope = unknown, Authority = AuthorityLevel>(
  scope: Scope,
  authorityLevel: Authority,
  allowedActions: string[],
  evidenceIds: string[],
  options: { id?: string; issuedAt?: string } = {},
): WorkPacket<Scope, Authority> {
  const actions = snapshotStringArray(allowedActions, 'allowedActions')
  const evidence = snapshotStringArray(evidenceIds, 'evidenceIds')
  assertPlainRecord(options, 'options')
  const id = optionalId(options.id, 'options.id', generatePacketId)
  const issuedAt = optionalId(options.issuedAt, 'options.issuedAt', () => new Date().toISOString())
  return { id, issuedAt, scope, authorityLevel, allowedActions: actions, evidenceIds: evidence }
}
