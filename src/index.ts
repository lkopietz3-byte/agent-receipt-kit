export type {
  AuthorityLevel,
  WorkPacket,
  AgentClaim,
  CurrentState,
  Contradiction,
  ReceiptResult,
} from './types.js'

export type {
  JsonPrimitive,
  JsonValue,
  EvidenceEnvelopeIntegrity,
  EvidenceEnvelope,
  EvidenceEnvelopeVerification,
  IssueEvidenceEnvelopeOptions,
} from './integrity.js'

export {
  EVIDENCE_ENVELOPE_VERSION,
  EVIDENCE_CANONICALIZATION,
  EVIDENCE_DIGEST_ALGORITHM,
  canonicalizeJson,
  sha256Hex,
  issueEvidenceEnvelope,
  verifyEvidenceEnvelope,
} from './integrity.js'

export { issuePacket } from './packet.js'
export { verifyReceipt } from './receipt.js'
export { createRefutationTrail } from './trail.js'
export type { RefutationEntry, RefutationTrail } from './trail.js'
