// Consumer probe: runs from a clean project that installed the packed
// tarball, imports the package by name, and checks real outputs.
import assert from 'node:assert/strict';
import { createRefutationTrail, issuePacket, verifyReceipt } from 'agent-receipt-kit';

const packet = issuePacket(
  { site: 'shop.example.com' },
  'local',
  ['log-in', 'add-to-cart'],
  ['screenshot-1', 'screenshot-2'],
  { id: 'pkt-probe', issuedAt: '2026-09-24T00:00:00.000Z' },
);
assert.deepEqual(packet, {
  id: 'pkt-probe',
  issuedAt: '2026-09-24T00:00:00.000Z',
  scope: { site: 'shop.example.com' },
  authorityLevel: 'local',
  allowedActions: ['log-in', 'add-to-cart'],
  evidenceIds: ['screenshot-1', 'screenshot-2'],
});
assert.match(issuePacket({}, 'observe', [], []).id, /^pkt-[0-9a-f-]{36}$/);

const claim = {
  packetId: 'pkt-probe',
  claimedActions: ['log-in', 'add-to-cart'],
  citedEvidenceIds: ['screenshot-1'],
  claimedFacts: { cartItemCount: 1, shippedAt: new Date('2026-09-24T00:00:00Z') },
};

const ok = verifyReceipt(packet, claim, { cartItemCount: 1, shippedAt: new Date('2026-09-24T00:00:00Z') });
assert.equal(ok.accepted, true);
assert.equal(ok.reason, "Claim matches the issued packet's authority and evidence and answers the correct packet. 2 claimed fact(s) agree with the supplied current state.");

assert.deepEqual(ok.coverage, {
  stateSupplied: true,
  claimedFactCount: 2,
  comparedFactCount: 2,
  uncheckedFactKeys: [],
});

const unobserved = verifyReceipt(packet, claim);
assert.equal(unobserved.accepted, true);
assert.deepEqual(unobserved.coverage, {
  stateSupplied: false,
  claimedFactCount: 2,
  comparedFactCount: 0,
  uncheckedFactKeys: ['cartItemCount', 'shippedAt'],
});

const bad = verifyReceipt(
  packet,
  { ...claim, packetId: 'pkt-other', claimedActions: ['submit-payment'], citedEvidenceIds: ['screenshot-99'] },
  { cartItemCount: 0, shippedAt: new Date('2020-01-01T00:00:00Z') },
);
assert.equal(bad.accepted, false);
assert.equal(bad.packetMismatch, true);
assert.deepEqual(bad.unauthorizedActions, ['submit-payment']);
assert.deepEqual(bad.droppedEvidenceIds, ['screenshot-99']);
assert.deepEqual(bad.contradictions.map((item) => item.key), ['cartItemCount', 'shippedAt']);
assert.ok(bad.reason.includes('never authorized: "submit-payment".'));
assert.deepEqual(bad.coverage, { stateSupplied: true, claimedFactCount: 2, comparedFactCount: 2, uncheckedFactKeys: [] });

// Malformed input throws instead of being accepted.
assert.throws(() => verifyReceipt({ allowedActions: [], evidenceIds: [] }, { claimedActions: [], citedEvidenceIds: [] }), {
  name: 'TypeError',
  message: 'packet.id must be a non-empty string (got undefined).',
});
assert.throws(() => verifyReceipt(packet, { ...claim, claimedFacts: true }), {
  name: 'TypeError',
  message: 'claim.claimedFacts must be a plain object (got boolean).',
});
const sparse = new Array(3);
sparse[0] = 'log-in';
sparse[2] = 'log-in';
assert.throws(() => verifyReceipt(packet, { ...claim, claimedActions: sparse }), {
  name: 'TypeError',
  message: 'claim.claimedActions[1] is missing (the array has a hole).',
});

assert.throws(() => issuePacket({}, 'local', 'log-in', []), {
  name: 'TypeError',
  message: 'allowedActions must be an array (got string).',
});

const trail = createRefutationTrail();
const entry = trail.record(claim, bad, '2026-09-24T01:00:00.000Z');
assert.equal(entry.id, 'refute-0-2026-09-24T01:00:00.000Z');
assert.equal(trail.find(entry.id), entry);
assert.deepEqual(trail.list(), [entry]);
assert.equal('remove' in trail || 'delete' in trail, false);

console.log('consumer probe passed');
