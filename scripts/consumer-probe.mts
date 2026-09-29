// Strict NodeNext type probe: compiled against the installed declarations
// by scripts/verify-package.mjs. It uses the public types the way a
// TypeScript consumer would, including a caller-defined authority type.
import {
  createRefutationTrail,
  issuePacket,
  verifyReceipt,
  type AgentClaim,
  type AuthorityLevel,
  type Contradiction,
  type CurrentState,
  type ReceiptCoverage,
  type ReceiptResult,
  type RefutationEntry,
  type RefutationTrail,
  type WorkPacket,
} from 'agent-receipt-kit';

interface BrowserScope {
  site: string;
}

const level: AuthorityLevel = 'local';
const packet: WorkPacket<BrowserScope> = issuePacket({ site: 'shop.example.com' }, level, ['log-in'], ['shot-1']);

type Tier = 'draft' | 'sandbox' | 'production';
const tiered: WorkPacket<BrowserScope, Tier> = issuePacket<BrowserScope, Tier>({ site: 'x' }, 'sandbox', [], []);
// @ts-expect-error 'root' is not part of the caller-defined Tier union.
issuePacket<BrowserScope, Tier>({ site: 'x' }, 'root', [], []);
// @ts-expect-error allowedActions must be a string array.
issuePacket({ site: 'x' }, 'local', 'log-in', []);

const claim: AgentClaim<number> = {
  packetId: packet.id,
  claimedActions: ['log-in'],
  citedEvidenceIds: ['shot-1'],
  claimedFacts: { cartItemCount: 1 },
};
const state: CurrentState<number> = { cartItemCount: 1 };

const result: ReceiptResult<number> = verifyReceipt(packet, claim, state);
const accepted: boolean = result.accepted;
const problems: string[] = result.claimProblems;
const coverage: ReceiptCoverage = result.coverage;
const compared: number = coverage.comparedFactCount;
const unchecked: string[] = coverage.uncheckedFactKeys;
const observed: boolean = coverage.stateSupplied;
const firstContradiction: Contradiction<number> | undefined = result.contradictions[0];
const claimedCount: number | undefined = firstContradiction?.claimedFact;
verifyReceipt(tiered, claim);

const trail: RefutationTrail<number> = createRefutationTrail<number>();
const entry: RefutationEntry<number> = trail.record(claim, result);
const found: RefutationEntry<number> | undefined = trail.find(entry.id);
const all: RefutationEntry<number>[] = trail.list();

export { accepted, all, claimedCount, compared, found, observed, problems, unchecked };
