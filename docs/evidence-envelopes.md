# Evidence envelopes

`agent-receipt-kit` can wrap any JSON-shaped evidence payload in a portable,
deterministically serialized SHA-256 envelope.

```ts
import {
  issueEvidenceEnvelope,
  verifyEvidenceEnvelope,
} from 'agent-receipt-kit'

const envelope = issueEvidenceEnvelope(
  {
    decision: 'REQUIRE_APPROVAL',
    sources: ['ROLE-OPERATOR-7'],
    facts: {
      requestedAmount: 25_000,
      operatorLimit: 5_000,
    },
  },
  {
    packetId: 'PP-AUTHORITY-0001',
    issuedAt: '2026-08-03T00:00:00.000Z',
  },
)

verifyEvidenceEnvelope(envelope)
// {
//   valid: true,
//   expectedDigest: '...',
//   actualDigest: '...',
//   errors: [],
//   issuerAuthenticated: false,
//   truthEstablished: false,
// }
```

If any material header or payload field changes, verification fails:

```ts
envelope.payload.decision = 'ALLOW'

verifyEvidenceEnvelope(envelope)
// valid: false
// errors: ['The current envelope does not reproduce the issued packetDigest.']
```

## What is digested

The digest covers the canonical JSON representation of:

- envelope schema version;
- packet ID;
- issue time;
- complete payload;
- integrity mode;
- canonicalization identifier;
- digest algorithm.

The `packetDigest` itself is excluded to avoid a self-referential hash.

The payload is snapshotted through canonical JSON when issued. Mutating the
caller's original object later does not silently rewrite the envelope.

## Canonical JSON

`canonicalizeJson` implements the RFC 8785 / JSON Canonicalization Scheme rules
needed by this package:

- no insignificant whitespace;
- deterministic UTF-16 property ordering;
- ECMAScript JSON number serialization;
- `-0` normalized to `0`;
- plain JSON objects and arrays only;
- rejection of non-finite numbers;
- rejection of sparse arrays;
- rejection of class instances and non-JSON values;
- rejection of circular references;
- rejection of unpaired UTF-16 surrogates.

```ts
import { canonicalizeJson } from 'agent-receipt-kit'

canonicalizeJson({ z: 3, a: { b: true, a: null } })
// {"a":{"a":null,"b":true},"z":3}
```

## SHA-256

`sha256Hex` is a synchronous, zero-dependency SHA-256 implementation that
accepts a Unicode string and returns lowercase hexadecimal output.

```ts
import { sha256Hex } from 'agent-receipt-kit'

sha256Hex('abc')
// ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
```

The implementation is tested against standard vectors and Unicode input.

## Honest security boundary

A valid envelope means:

> The current header and payload reproduce the digest that accompanies them
> under the declared canonicalization and algorithm.

It does **not** mean:

- the payload is true;
- the evidence is authoritative or complete;
- the action was authorized;
- the observation is independent or fresh;
- the issuer is who they claim to be;
- the packet existed at a particular earlier time;
- a tail of records was not removed;
- the system is safe, compliant, or certified.

That is why `verifyEvidenceEnvelope` always returns:

```ts
{
  issuerAuthenticated: false,
  truthEstablished: false,
}
```

Use the other package primitives for separate questions:

- `issuePacket` — what was authorized before execution;
- `verifyReceipt` — whether an agent's claim stays inside that authority and
  agrees with a supplied independent current state;
- `createRefutationTrail` — preserve rejected claims and their reasons;
- `issueEvidenceEnvelope` — bind a JSON evidence record to a deterministic
  digest;
- `verifyEvidenceEnvelope` — detect later material changes to that record.

## Digest-only versus signed packets

This release intentionally supports `digest-only` envelopes. It does not call a
digest a signature.

A future signed layer should add, at minimum:

- a defined signature payload;
- issuer key ID;
- supported signature algorithm;
- signer identity and signing time;
- key rotation and revocation policy;
- verifier trust configuration;
- negative tests for wrong keys, algorithms, and altered signatures;
- an external timestamp or transparency receipt when prior existence matters.

Do not add a `signature` field that is merely another hash.

## External completeness

A valid individual envelope cannot prove that it is the final record in a
sequence. When complete history matters, combine envelopes with one or more of:

- an external expected count;
- sequence number and previous digest;
- append-only hash-chain log;
- independently retained checkpoint;
- transparency-log receipt;
- recipient acknowledgement;
- signed final manifest.

`audit-chain-kit` provides the adjacent append-only chain pattern. It should
remain a separate primitive rather than being silently implied by one packet.

## Recommended ProofPrism usage

For a consequential evaluation packet:

1. freeze the protocol, corpus, policy, and environment;
2. record stable digests for each manifest;
3. preserve the complete case denominator and unfavorable outputs;
4. adjudicate each dimension separately;
5. construct the JSON evidence payload;
6. issue the digest envelope;
7. distribute an independent verifier;
8. add a signature and external receipt only when the key and trust model are
   fully implemented;
9. issue corrections by referencing, not overwriting, the earlier packet.

The envelope is one layer in a proof system. It is not the whole proof system.
