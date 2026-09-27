// Proves CommonJS require() works against the packed tarball, on a Node
// version that supports require(esm) (>=20.19.0 or >=22.12.0). This file is
// plain CommonJS regardless of the consumer project's "type": "module",
// because a .cjs extension always forces CommonJS. Run by verify-package.mjs.
const assert = require('node:assert/strict');

const { issuePacket, verifyReceipt, createRefutationTrail } = require('agent-receipt-kit');

const packet = issuePacket({ site: 'shop.example.com' }, 'local', ['log-in'], ['screenshot-1'], {
  id: 'pkt-cjs-probe',
  issuedAt: '2026-09-24T00:00:00.000Z',
});
assert.deepEqual(packet.allowedActions, ['log-in']);

const claim = {
  packetId: 'pkt-cjs-probe',
  claimedActions: ['log-in'],
  citedEvidenceIds: ['screenshot-1'],
  claimedFacts: {},
};
const ok = verifyReceipt(packet, claim);
assert.equal(ok.accepted, true);

const trail = createRefutationTrail();
assert.deepEqual(trail.list(), []);

console.log('CommonJS require() probe passed');
