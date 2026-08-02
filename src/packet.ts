import type { AuthorityLevel, WorkPacket } from './types.js'

/**
 * Generates a unique packet id with zero runtime dependencies. Prefers the
 * platform's crypto.randomUUID when available (Node 19+, all modern
 * browsers); falls back to a timestamp-plus-random id otherwise so this
 * still works in older or non-standard runtimes.
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
 *   idempotency keys). Optional.
 * @param options.issuedAt Override the generated issuedAt timestamp.
 *   Optional; defaults to now.
 */
export function issuePacket<Scope = unknown, Authority = AuthorityLevel>(
  scope: Scope,
  authorityLevel: Authority,
  allowedActions: string[],
  evidenceIds: string[],
  options: { id?: string; issuedAt?: string } = {},
): WorkPacket<Scope, Authority> {
  return {
    id: options.id ?? generatePacketId(),
    issuedAt: options.issuedAt ?? new Date().toISOString(),
    scope,
    authorityLevel,
    allowedActions: [...allowedActions],
    evidenceIds: [...evidenceIds],
  }
}
