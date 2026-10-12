# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - unreleased

Minor release: stricter comparison and validation, plus an opt-in coverage
rule. Verdicts move toward rejection, or from a wrong contradiction to a right
match (a cross-realm Date with an equal time used to contradict and now
matches). Some malformed input that used to be accepted is now thrown or
rejected.

### Breaking changes

- **`issuePacket` throws a `TypeError` for an empty or blank entry in `allowedActions` or `evidenceIds`.** Migration: drop blank entries from both lists before issuing; fix whatever produced the blank id. A hand-built packet still verifies; the blank entry matches nothing.
- **A fact object whose prototype is a bare `Object.create(null)` object is no longer plain.** As `claimedFacts` the claim is rejected (`claimProblems`); as `currentState` it throws a `TypeError`; nested inside a fact it matches only itself. Migration: pass plain objects or `Object.create(null)` objects directly, not objects layered on a null-prototype prototype.
- **Arrays and Dates are compared on their own enumerable string keys as well**, so an extra property on an array or a Date is now a difference. Migration: keep facts JSON-shaped, or delete the extra property before comparing.
- **`Contradiction.claimedFact` and `currentFact` are now copies** (equal in content; a `Map` or class instance is still the same reference). Migration: compare by value, not by reference to the original claim object.
- **Claimed facts are copied before they are compared**, so a deep fact with no `currentState` now costs time proportional to its size. Migration: bound the depth and size of untrusted facts before calling.
- **Some claims that used to pass now get the verdict their content earns:** an array with its own `keys` method, a Date with its own `getTime`, or an inherited key hidden behind a null-prototype prototype. Migration: none needed for honest input.
- **`ReceiptResult` has two new fields, `snapshot` and `uncoveredFactKeys`.** Migration: code that compares a whole result with a deep-equality assertion needs the new fields in its expected value.

### Added

- **`requireCoverage` option** (fourth argument of `verifyReceipt`, type `VerifyOptions`, also exported). With `{ requireCoverage: true }`, a claim is not accepted while any claimed fact was not compared with the current state, either because no state was supplied or because the state has no own key for it. The keys are in the new `ReceiptResult.uncoveredFactKeys` (always `[]` when the option is off) and named in `reason`. A claim that asserts no facts is still accepted. A bad options value throws a `TypeError`, including an unknown key. Default is off, so existing verdicts do not change.

### Fixed

- **An array with its own `keys` method no longer matches any array of the same length.** The comparison called `keys()` on the claimed array, so an agent could hand it an empty iterator. Arrays are now compared by their own keys and values, without calling any method on the value. The same change removes a hang on a sparse array with a huge `length`.
- **Facts inherited through a null-prototype prototype can no longer vanish.** An object whose prototype was a bare `Object.create(null)` object counted as plain, so inherited keys were invisible to the comparison and to `coverage` ("asserts no facts"). Plain now means a prototype of `null` or an `Object.prototype` (any realm, recognized by structure). Anything else is not plain.
- **A Date with its own `getTime` is compared by its real time value.** The built-in `Date.prototype.getTime` is used after a brand check, so the claimed value cannot answer for itself. A Date from another realm (a `vm` context or an iframe) with an equal time now matches instead of producing a false contradiction. Two invalid Dates still match each other.
- **`reason` escapes the zero-width space, the soft hyphen, the byte order mark and tag characters** (every format character except the zero-width joiner and non-joiner, which emoji sequences and several scripts need). Characters outside the Basic Multilingual Plane are written as two `\uXXXX` escapes.
- **`issuePacket` rejects an empty or blank entry in `allowedActions` and `evidenceIds`.** A claim naming one was always rejected as blank, so the entry could never be used.
- **The Braille blank (U+2800) and control characters count as blank** in ids, claim lists and `issuePacket` input.
- **A Proxy-wrapped array can no longer shorten itself between the length check and the copy.** The array length is now read once, so a claimed array that reported a length of 1 and then 0 can no longer be copied as empty and match an empty observed array.

### Changed

- **`ReceiptResult.snapshot`** (type `ReceiptSnapshot`, also exported): the string entries of `claimedActions` and `citedEvidenceIds` and a deep copy of the claimed facts, made while the claim is read. Use it instead of the claim object after an acceptance; a getter or later edit can no longer change what you accepted.

### Documented

- The README opening says who the kit is for and what it does not do, and says that free-text agent logs need claim extraction before this kit can compare anything. Hedged wording is the caller's decision at that step.
- Limits added: comparison is exact equality (no tolerance or normalization; `undefined` versus a missing key), packet lists are exact membership (no prefix or glob), repeated entries are reported each time, and an unusable claim list throws, so wrap raw agent output.
- The ENGINEERING coverage and mutation numbers are marked as measured at 0.2.0.
- Symbol keys and non-enumerable properties are not compared, on either side. Keep facts JSON-shaped.
- A blank entry in a hand-built packet's lists is not checked by `verifyReceipt` (the packet is your own input); it can never match a valid claim.

## [0.2.1] - 2026-10-07

No change to the library's behavior or API.

### Changed

- The README links to the [in-browser playground](https://lkopietz3-byte.github.io/honesty-kits/#agent-receipt-kit) and the honesty kits family, and the npm homepage now points to the playground.
- Added the `honesty-kits` npm keyword so the family shows up together in search.

### Security

- Development lockfile: `source-map-js` 1.2.2 (GHSA-68fv-2mgg-jv7q). Development tooling only; the published package has no runtime dependencies.

## [0.2.0] - 2026-09-28

Minor release: malformed input that used to be accepted is now thrown or
rejected, and every result gains `claimProblems` and `coverage`. The four
mismatch fields, the meaning of `accepted` for well-formed claims, the export
names and the valid-input results are unchanged, except that `reason` now
escapes bidi formatting characters.

**The rule:** the packet and `currentState` come from your own code, so a
malformed one **throws** a `TypeError`. The claim comes from the agent being
checked, so a malformed claim is **rejected in the result** (`accepted: false`,
`claimProblems`, `reason`), never thrown and never accepted. Two cases keep
0.1.1's throw: a claim that is not an object, and a claim list that is not an
array.

### Changed (breaking)

- **A malformed packet throws (ARK-001, OBS-01, OBS-02).** `packet.id` that is
  missing, not a string, empty, whitespace-only or invisible-only (zero-width,
  bidi controls, soft hyphen) throws a `TypeError`. `packet.allowedActions` and
  `packet.evidenceIds` must be arrays of strings with no holes; a non-string
  entry or hole throws, naming the index. Before, two missing ids matched each
  other and a numeric action present in both a stored packet and a claim
  matched, both returning `accepted: true`. `issuePacket` applies the same
  rules to its lists and to `options.id` and `options.issuedAt` when given
  (`null` used to mean "use the default"; only `undefined` does now), and
  requires `options` to be a plain object.
- **`currentState` must be a plain object (ARK-001, OBS-03).** Anything other
  than `undefined`, `null` (both still mean "no observation"), or a plain or
  null-prototype object throws a `TypeError`. Before, a `Map` or a `Date` was
  read as an empty observation and left every fact unchecked.
- **A malformed claim is rejected, with a reason (ARK-001, OBS-03, OBS-04).**
  Each of these now gives `accepted: false` and a sentence in `claimProblems`
  and `reason`, and none throws:
  - a non-string entry in `claimedActions` or `citedEvidenceIds`
    (`claim.claimedActions[0] is not a string (got number).`). It used to be
    copied into `unauthorizedActions` or `droppedEvidenceIds`; it no longer is,
    and the string entries around it are still checked;
  - a hole in either list (a run of holes is one problem). Before,
    `filter()` skipped holes, so a sparse list could be accepted. Only
    canonical index keys (`String(Number(key)) === key`, below `length`) count
    as elements: an own `"00"` key used to be read as index 0, so a hole at
    `[0]` filled from the prototype was accepted;
  - a list whose `length` is not a non-negative safe integer (a Proxy over an
    array can report `NaN`), which used to be read as empty and accepted:
    `claim.claimedActions has a length that is not a non-negative safe integer.`;
  - a blank string in either list, even one the packet also lists;
  - `claimedFacts` that is present but is not a plain or null-prototype object
    (`true`, `null`, an array, a `Map`, a class instance). Before, `true` or a
    `Map` was read as zero facts and accepted. Its facts are not counted in
    `coverage`;
  - a missing, non-string or blank `claim.packetId`: a `packetMismatch`, as in
    0.1.1 for a non-string id (the reason shows `<number>`, never the content).
  `claimProblems` names fields, indexes and kinds of value, never the claim's
  content, and lists at most 20 problems per list plus one line counting the
  rest. An enormous sparse array is scanned in time proportional to what is
  present, not to its length.
- **Kept from 0.1.1:** `verifyReceipt` still throws a `TypeError` for a claim
  that is not an object and for a `claimedActions` or `citedEvidenceIds` that
  is missing or not an array.
- **`trail.record` checks its own arguments.** `claim` and `result` must be
  objects, and `recordedAt`, when given, a non-blank string (`TypeError`). A
  failed call no longer uses up a sequence number. `packetId` is still copied
  from the claim as given, so a rejected claim with no usable `packetId` is
  recorded.
- **Each caller field is read once.** `verifyReceipt` reads `packet.id`, the
  two packet lists, `claim.packetId`, the two claim lists and
  `claim.claimedFacts` once, and computes from that read; `issuePacket` copies
  each list from one indexed read. Before, a getter or proxy could pass
  validation with one value and be judged on another.
- **`reason` escapes bidirectional formatting characters** (U+061C, U+200E,
  U+200F, U+202A to U+202E, U+2066 to U+2069) as `\uXXXX`, in addition to the
  control characters, line breaks and U+2028/U+2029 it already escaped. The
  structured fields keep the exact text.
- **A plain object from another realm counts as plain** when comparing facts
  (its prototype's prototype is `null`), where before it only matched itself.
- TypeScript: `ReceiptResult` has required `claimProblems` and `coverage`
  fields, so code that builds a `ReceiptResult` by hand must add them, and code
  that compares a whole result with `toEqual` sees two more keys.

### Added

- **`result.claimProblems`**: `string[]`, empty for a well-formed claim, present
  on every result. `accepted` requires it to be empty.
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
  runtime's stack, throw a `RangeError`. Both are now documented and tested,
  with the depth stated as runtime-dependent.
- **Sibling-kit wording (ARK-003).** The README and the 0.1.1 entry below said
  `audit-chain-kit` gives durability across restarts. It does not: its chains
  are in-memory, storage and writer coordination are the caller's, and catching
  a rewrite needs an anchor kept outside the writer's control.
- The `PROJECT_CONTEXT.md` purpose line no longer says the kit checks work
  against a "fresh independent observation"; it compares a report with
  caller-supplied data and cannot tell whether that data is fresh or
  independent.
- Mutation testing (Stryker, run locally, not committed): 95.4% before, 100%
  after. Line, branch, function and statement coverage is 100%.

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
