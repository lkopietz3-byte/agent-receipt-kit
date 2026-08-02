export type {
  AuthorityLevel,
  WorkPacket,
  AgentClaim,
  CurrentState,
  Contradiction,
  ReceiptResult,
} from './types.js'

export { issuePacket } from './packet.js'
export { verifyReceipt } from './receipt.js'
export { createRefutationTrail } from './trail.js'
export type { RefutationEntry, RefutationTrail } from './trail.js'
