import type { AuthorityLevel, WorkPacket } from './types.js'
import { assertStringArray } from './validate.js'

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
 *   idempotency keys). Optional; stored as given.
 * @param options.issuedAt Override the generated issuedAt timestamp.
 *   Optional; defaults to `new Date().toISOString()`. Stored as given, not
 *   validated.
 * @returns A new WorkPacket. allowedActions and evidenceIds are shallow
 *   copies, so later edits to the input arrays do not change the packet;
 *   scope is stored by reference. The packet itself is a plain mutable
 *   object.
 * @throws TypeError if allowedActions or evidenceIds is not an array of
 *   strings. (A string would otherwise be spread into single characters and
 *   authorize them.)
 */
export function issuePacket<Scope = unknown, Authority = AuthorityLevel>(
  scope: Scope,
  authorityLevel: Authority,
  allowedActions: string[],
  evidenceIds: string[],
  options: { id?: string; issuedAt?: string } = {},
): WorkPacket<Scope, Authority> {
  assertStringArray(allowedActions, 'allowedActions')
  assertStringArray(evidenceIds, 'evidenceIds')
  return {
    id: options.id ?? generatePacketId(),
    issuedAt: options.issuedAt ?? new Date().toISOString(),
    scope,
    authorityLevel,
    allowedActions: [...allowedActions],
    evidenceIds: [...evidenceIds],
  }
}
