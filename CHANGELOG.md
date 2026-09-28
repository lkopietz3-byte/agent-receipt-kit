# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-09-28

Minor release: input that used to be accepted now throws, and every result gains
a `coverage` object. The four mismatch fields, `accepted`, the export names and
the valid-input results are unchanged, except that `reason` now escapes bidi
formatting characters.

### Changed (breaking)

- **Ids must be present strings that show something (ARK-001, OBS-01).**
  `packet.id` and `claim.packetId` that are missing, not strings, empty,
  whitespace-only or invisible-only (zero-width, bidi controls, soft hyphen)
  throw a `TypeError`. Before, two missing ids matched each other and
  `verifyReceipt` returned `accepted: true`. `issuePacket` applies the same rule
  to `options.id` and `options.issuedAt` when given (`null` used to mean "use
  the default"; only `undefined` does now) and requires `options` to be a plain
  object.
- **The four lists must be dense arrays of strings (ARK-001, OBS-02, OBS-04).**
  `packet.allowedActions`, `packet.evidenceIds`, `claim.claimedActions` and
  `claim.citedEvidenceIds` throw a `TypeError` naming the index for a
  non-string entry or a hole. Before, a numeric action present on both sides
  matched, and a hole in a claim list was skipped and accepted. A non-string
  entry in a claim list used to be reported as unauthorized or dropped; it now
  throws.
- **Fact containers must be plain objects (ARK-001, OBS-03).** `claimedFacts`,
  when present, and `currentState`, when not `undefined` or `null`, must be a
  plain or null-prototype object. `true`, `null` (for `claimedFacts`), an
  array, a `Map`, a `Date` or a class instance throws a `TypeError`. Before,
  `claimedFacts: true` or a `Map` was read as zero facts and accepted, and a
  `Map` as `currentState` left every fact unchecked. A plain object from another
  realm is accepted.
- **`claim` and `result` given to `trail.record` must be objects, `claim.packetId`
  a non-blank string and `recordedAt`, when given, a non-blank string** (all
  `TypeError`). A failed call no longer uses up a sequence number.
- **Each caller field is read once.** `verifyReceipt` reads `packet.id`, the two
  packet lists, `claim.packetId`, the two claim lists and `claim.claimedFacts`
  once, and computes from that read; `issuePacket` copies each list from one
  indexed read. Before, a getter or proxy could pass validation with one value
  and be judged on another.
- **`reason` escapes bidirectional formatting characters** (U+061C, U+200E,
  U+200F, U+202A to U+202E, U+2066 to U+2069) as `\uXXXX`, in addition to the
  control characters, line breaks and U+2028/U+2029 it already escaped. The
  structured fields keep the exact text.
- **A plain object from another realm counts as plain** when comparing facts
  (its prototype's prototype is `null`), where before it only matched itself.
- TypeScript: `ReceiptResult` has a required `coverage` field, so code that
  builds a `ReceiptResult` by hand must add it, and code that compares a whole
  result with `toEqual` sees one more key.

### Added

- **`result.coverage` (ARK-004)** on every result, accepted or rejected:
  `{ stateSupplied, claimedFactCount, comparedFactCount, uncheckedFactKeys }`.
  A contradicted fact counts as compared, so agreements are
  `comparedFactCount - contradictions.length`; `comparedFactCount +
  uncheckedFactKeys.length === claimedFactCount`. Only an own key of
  `currentState` counts. The `ReceiptCoverage` type is exported.
- A compatibility table in the README, and compatibility jobs pinned to exactly
  Node 20.19.0 and 22.12.0 (the `require(esm)` floors).
- `release.yml` gates: both triggers must run on a `v*` tag that matches
  `package.json`, the dependency audit and `npm run attw` run before publish,
  and only a confirmed E404 counts as "not published".

### Fixed

- **Documentation of circular and deep facts (ARK-005).** The README and TSDoc
  claimed circular structures always overflow. Two references to the same
  object match without being walked (so one cyclic object on both sides
  matches); separate cycles, and separate acyclic values nested past the
  runtime's stack, throw a `RangeError`. Both are now documented and tested, with
  the depth stated as runtime-dependent.
- **Sibling-kit wording (ARK-003).** The README and the 0.1.1 entry below said
  `audit-chain-kit` gives durability across restarts. It does not: its chains are
  in-memory, storage and writer coordination are the caller's, and catching a
  rewrite needs an anchor kept outside the writer's control.
- The `PROJECT_CONTEXT.md` purpose line no longer says the kit checks work
  against a "fresh independent observation"; it compares a report with
  caller-supplied data and cannot tell whether that data is fresh or independent.
- Mutation testing (Stryker, run locally, not committed): 95.4% before, 100%
  after (301 killed, 0 survived). Line, branch, function and statement coverage
  is 100%.

## [0.1.1] - 2026-09-27

### Fixed

- `verifyReceipt(null, claim)` (or a non-object `claim`, e.g.
  `verifyReceipt(packet, 123)`) threw a raw native "Cannot read properties of
  null" error instead of this kit's own named `TypeError`. Both `packet` and
  `claim` are now checked up front.
- The shipped `.js.map` pointed at `../src/*.ts`, which isn't in the
  published tarball. `tsconfig.build.json` now sets `inlineSources`, so the
  map embeds the original source. `.d.ts.map` generation is turned off
  instead of shipping `src/`.

### Added

- CommonJS `require()` support: `package.json` `exports` now has a
  `"default"` condition alongside `"import"`, so
  `require("agent-receipt-kit")` works on Node versions that support
  `require(esm)` (>=20.19.0, >=22.12.0). `scripts/consumer-probe.cjs`, run by
  `verify-package.mjs`, guards it in CI.
- A "Relationship to sibling kits" section in the README, cross-linking
  `audit-chain-kit` for hash-chained records of rejected claims. (The first
  wording promised durable storage across restarts; that was wrong and is
  corrected in 0.2.0.)

## [0.1.0] - 2026-09-27

First release.

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
