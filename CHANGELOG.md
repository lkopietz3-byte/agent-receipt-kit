# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

First release. Not published to npm; install from GitHub.

### Added

- `issuePacket` to record, before an agent runs, the actions it may take and
  the evidence ids it may cite. Action and evidence lists are copied and must
  be arrays of strings (`TypeError` otherwise).
- `verifyReceipt` to check an agent's claim against the issued packet and an
  optional caller-supplied `currentState`. It reports unauthorized actions,
  evidence ids that were never issued, a mismatched packet id, and claimed
  facts that contradict `currentState`, and sets `accepted` only when all
  four checks are clean.
- `createRefutationTrail`, an in-memory, append-only log of rejected claims
  and the results that explain them.
- Public types: `AuthorityLevel`, `WorkPacket`, `AgentClaim`, `CurrentState`,
  `Contradiction`, `ReceiptResult`, `RefutationEntry`, `RefutationTrail`.

### Changed (compared with earlier commits on the default branch)

- Facts are compared structurally only for plain objects, arrays, and
  primitives (`0` equals `-0`). Dates are compared by time value. Other
  objects (`Map`, `Set`, class instances) only match themselves, so they are
  reported as contradictions instead of being treated as equal. Array holes
  only match holes.
- Ids and keys from the claim appear JSON-quoted in `reason`, with line
  breaks escaped. The accepted `reason` now says how many claimed facts were
  actually cross-checked. `reason` wording is not a stable API.
- `verifyReceipt` throws a named `TypeError` when one of the four lists it
  reads is not an array.
