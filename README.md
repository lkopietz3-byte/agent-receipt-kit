# Agent Receipt Kit

Agent Receipt Kit is a small, dependency-free TypeScript library for checking
what an AI agent says it did. Before the agent runs, you issue a work packet
that lists the actions it may take and the evidence ids it may cite. When the
agent reports back, `verifyReceipt` compares the report with that packet and,
if you have one, with your own fresher observation of the same facts. Every
mismatch is named in a structured result instead of being accepted quietly.

It is framework-agnostic: the same checks work behind a coding agent, browser
automation, a data pipeline, or a support workflow.

## When to use it, and when not to

Use it when an agent reports its own work and you want a plain, testable
rule for which reports you accept: "only actions I allowed, only evidence ids
I issued, and no claimed fact that my own fresh read disagrees with."

Do not use it as:

- **A sandbox or permission system.** It checks a report after the fact. It
  cannot stop an agent from doing something; enforce that where tools run.
- **Proof that the work happened.** It compares lists and values you supply.
  It never looks at a screenshot, file, or database itself.
- **An integrity or identity layer.** Packets and claims are plain objects.
  Nothing is signed or hashed, so the kit cannot tell you who issued a packet
  or whether it was edited after it was issued.
- **Durable audit storage.** The refutation trail lives in memory.

## Install

```bash
npm install agent-receipt-kit
```

Or build from source: clone the repository and run `npm install && npm run build`.

It has no runtime dependencies and ships TypeScript declarations.

It is an ESM package (`"type": "module"`). `import` is the supported way to
load it. `require()` also works where Node can `require(esm)`:

| How you load it | Node 20.19+ | Node 22.12+ | Node 24 and 26 | Older Node 20 or 22 |
| --- | --- | --- | --- | --- |
| `import { verifyReceipt } from 'agent-receipt-kit'` | works | works | works | works |
| `require('agent-receipt-kit')` | works | works | works | fails (no `require(esm)`); use `import()` |

Recommended runtimes are Node 22 and 24 (LTS) and Node 26 (current). Node 20 is
end-of-life. CI still runs the tests and the installed-package probes on Node
20.19.0 and 22.12.0 (the `require(esm)` floors) to catch regressions, but that
is compatibility testing, not a recommendation. `engines` in `package.json` is
`>=20`.

## Quickstart

```js
import { createRefutationTrail, issuePacket, verifyReceipt } from 'agent-receipt-kit'

// 1. Before the agent runs: record what it may do and what it may cite.
const packet = issuePacket(
  { site: 'shop.example.com' },     // scope: yours to define
  'local',                          // authority label
  ['log-in', 'add-to-cart'],        // allowed actions
  ['screenshot-1', 'screenshot-2'], // evidence ids the agent may cite
  { id: 'pkt-demo', issuedAt: '2026-09-28T09:00:00.000Z' }, // pinned so this output is reproducible
)

// 2. The agent reports back. Treat this as untrusted input.
const claim = {
  packetId: packet.id,
  claimedActions: ['log-in', 'add-to-cart', 'submit-payment'],
  citedEvidenceIds: ['screenshot-1'],
  claimedFacts: { cartItemCount: 1, couponApplied: true },
}

// 3. Optional: your own fresh read of the same facts.
const currentState = { cartItemCount: 0 }

const result = verifyReceipt(packet, claim, currentState)
console.log(result.accepted)            // false
console.log(result.unauthorizedActions) // [ 'submit-payment' ]
console.log(result.contradictions)      // [ { key: 'cartItemCount', claimedFact: 1, currentFact: 0 } ]
console.log(result.coverage)
// { stateSupplied: true, claimedFactCount: 2, comparedFactCount: 1, uncheckedFactKeys: [ 'couponApplied' ] }
console.log(result.reason)
// 1 claimed action(s) were never authorized: "submit-payment". 1 claimed fact(s) contradict the supplied current state: "cartItemCount".

// 4. Keep the rejected claim instead of dropping it.
const trail = createRefutationTrail()
if (!result.accepted) trail.record(claim, result, '2026-09-28T09:05:00.000Z')
console.log(trail.list().length)        // 1
console.log(trail.list()[0].id)         // refute-0-2026-09-28T09:05:00.000Z
```

## The core idea

An agent's own claim about what it did is not evidence that it did it. The
kit keeps two questions apart: was the claimed work inside what you
authorized, and does a fresher observation you trust agree with what the
agent says happened? Neither check trusts the agent by default, and neither
settles a disagreement for you. Unauthorized actions are flagged, evidence
ids you never issued are named, and a contradiction between a claim and your
observation is reported rather than resolved in either direction.

## API

The package exports three functions and the types below. Every export has
TSDoc in its declaration.

### `issuePacket(scope, authorityLevel, allowedActions, evidenceIds, options?)`

Call this before the agent runs. It returns a `WorkPacket`: the exact
authorization you are handing the agent. Keep it; you need it to verify what
comes back.

```ts
import { issuePacket } from 'agent-receipt-kit'

const packet = issuePacket(
  { site: 'shop.example.com', checkoutFlow: 'guest' }, // scope: yours to define
  'local',                                            // authority level
  ['log-in', 'add-to-cart'],                          // allowed actions
  ['screenshot-1', 'screenshot-2'],                   // evidence the agent may cite
)
```

- `id` defaults to `pkt-` plus `crypto.randomUUID()`. In a runtime without
  `randomUUID` (for example a browser page served over plain HTTP) it falls
  back to a timestamp plus `Math.random`, which is not guaranteed unique.
  Pass `options.id` if uniqueness matters. Only `undefined` means "generate
  one"; any other value must be a string that shows something.
- `issuedAt` defaults to the current time as an ISO 8601 string. A value you
  pass must be a non-blank string; it is stored as given and is not checked to
  be a date.
- `allowedActions` and `evidenceIds` must be arrays of strings with no holes;
  anything else throws a `TypeError` that names the bad index. Each is read
  once and copied, so editing your arrays later does not change the packet.
  `scope` is stored by reference.
- `options` must be a plain object when given (`null` throws).

### `verifyReceipt(packet, claim, currentState?)`

Call this when the agent reports back. It returns a structured result, not a
bare boolean, so you can see exactly what failed.

```ts
import { verifyReceipt } from 'agent-receipt-kit'

const claim = {
  packetId: packet.id,
  claimedActions: ['log-in', 'add-to-cart'],
  citedEvidenceIds: ['screenshot-1', 'screenshot-2'],
  claimedFacts: { cartItemCount: 1 },
  summary: 'Logged in and added the item to the cart.',
}

// Optional: a fresher, independent read of the same facts, e.g. from a
// second scrape of the cart page, a database query, a re-scan.
const currentState = { cartItemCount: 1 }

const result = verifyReceipt(packet, claim, currentState)
// {
//   accepted: true,
//   unauthorizedActions: [],
//   droppedEvidenceIds: [],
//   contradictions: [],
//   packetMismatch: false,
//   claimProblems: [],
//   coverage: { stateSupplied: true, claimedFactCount: 1, comparedFactCount: 1, uncheckedFactKeys: [] },
//   reason: "Claim matches the issued packet's authority and evidence and answers
//            the correct packet. 1 claimed fact(s) agree with the supplied current state."
// }
```

If the agent claims an action it was never granted, cites evidence that was
never issued, answers a different packet, or your `currentState` disagrees
with a claimed fact, `accepted` is `false` and the problem is named:

```ts
// The agent claims it also submitted payment, which was never authorized.
verifyReceipt(packet, { ...claim, claimedActions: [...claim.claimedActions, 'submit-payment'] })
// => { accepted: false, unauthorizedActions: ['submit-payment'], ... }

// The agent cites a screenshot id nobody issued it.
verifyReceipt(packet, { ...claim, citedEvidenceIds: ['screenshot-1', 'screenshot-99'] })
// => { accepted: false, droppedEvidenceIds: ['screenshot-99'], ... }

// A fresh scrape of the cart disagrees with the claim.
verifyReceipt(packet, claim, { cartItemCount: 0 })
// => { accepted: false, contradictions: [{ key: 'cartItemCount', claimedFact: 1, currentFact: 0 }], ... }
```

How the checks work:

- **Actions and evidence ids** are matched exactly against the packet's
  lists: no case folding, trimming, or Unicode normalization. Every
  non-matching entry is reported, including repeats. A claim with empty lists
  is accepted, because nothing in it falls outside the packet.
- **Facts** are compared only for keys that exist in both
  `claim.claimedFacts` and `currentState` (an own key; an inherited one such
  as `toString` does not count). Plain objects are compared key by key in any
  order, arrays element by element, and `0` equals `-0`. Dates are compared
  by time value. Any other object (a `Map`, `Set`, or class instance) only
  matches itself, so a difference the comparison cannot see is reported as a
  contradiction rather than accepted.
- **`coverage`** says how much of that was done, on every result, accepted or
  not. `stateSupplied` is `true` when you passed a `currentState` object
  (`undefined` and `null` mean none). `claimedFactCount` is how many facts the
  claim asserted. `comparedFactCount` is how many had a same-keyed value in
  `currentState`; a fact that contradicted it still counts as compared, so
  agreements are `comparedFactCount - contradictions.length`.
  `uncheckedFactKeys` lists the rest, spelled exactly as the claim spelled
  them, in the claim's key order (all of them when no state was supplied).
  `comparedFactCount + uncheckedFactKeys.length` always equals
  `claimedFactCount`. It never changes what `accepted` means.
- **All four checks run** even when one fails, so a result can show a packet
  mismatch and unauthorized actions together.
- **`reason`** is a readable summary for logs. Ids and keys from the claim are
  JSON-quoted, and control characters, line breaks and bidirectional
  formatting characters in them are escaped as `\uXXXX`, so an agent cannot
  forge extra log lines, send terminal escapes, or reorder the line. The
  structured fields keep the exact text. For an accepted claim `reason` says
  how many claimed facts were actually cross-checked. Branch on the
  structured fields, not on this wording.
- **Who supplies what decides what happens.** The packet and `currentState`
  come from your own code, so a malformed one **throws** a `TypeError`. The
  claim comes from the agent being checked, so a malformed claim is
  **rejected in the result**: `accepted` is `false`, `claimProblems` and
  `reason` say what is wrong, and nothing is thrown.

  Throws a `TypeError` (your code passed something it should not have):
  - `packet` is not an object, or `packet.id` is missing, not a string, or
    shows nothing (empty, or only whitespace and invisible characters). Before
    0.2.0, two missing ids matched each other;
  - `packet.allowedActions` or `packet.evidenceIds` is not an array of
    strings, or has a hole. The message names the index;
  - `currentState` is anything other than `undefined`, `null`, or a plain or
    null-prototype object (an array, a `Map` or a class instance throws).

  Still throws, as in 0.1.1 (the claim as a whole is unusable, so there is
  nothing to reject entry by entry):
  - `claim` is not an object (`null`, `undefined`, a number, a string, an
    array);
  - `claim.claimedActions` or `claim.citedEvidenceIds` is missing or is not an
    array.

  Rejected, never thrown and never accepted (`claimProblems` names each one):
  - a non-string entry in `claimedActions` or `citedEvidenceIds`
    (`claim.claimedActions[0] is not a string (got number).`), a hole in
    either list, or a blank string (empty, or only whitespace and invisible
    characters). Non-string entries are not copied into
    `unauthorizedActions`; the string entries around them are still checked.
    A list reports at most 20 problems plus one line counting the rest. Only
    canonical index keys count as elements (an own `"00"` or `"0.0"` key does
    not fill a hole at `[0]`), and a list whose `length` is not a non-negative
    safe integer (a Proxy can report `NaN`) is one problem, not an empty list;
  - `claimedFacts` that is present but not a plain or null-prototype object
    (`null`, an array, a `Map`, a class instance, `true`). Its facts are not
    counted in `coverage`;
  - a missing, non-string or blank `claim.packetId`. It is a `packetMismatch`,
    because it can never equal a packet's id.

  `claimProblems` never repeats the claim's content, only field names, indexes
  and kinds of value. Each field is read once and the result is computed from
  what was read, so a getter that changes its answer cannot pass validation and
  then be judged on something else. It does not mutate its inputs and reads no
  clock.
- **Circular and very deep facts.** Two references to the very same object are
  equal without being walked, so one circular object passed on both sides
  matches. Two separate circular values, and two separate acyclic values
  nested deeper than the runtime's call stack allows, make `verifyReceipt`
  throw a `RangeError` (stack overflow). It is never returned as an
  acceptance. Catch it and treat the receipt as unverified. The depth at which
  it happens depends on the runtime (6,000 nested levels overflowed on Node
  26.3.0), so it is not a fixed limit. If facts come from an untrusted
  source, bound their depth and size before calling.

### `createRefutationTrail()`

A claim that fails verification should not just vanish from your logs. This
returns an in-memory, append-only log for exactly that: keep the claim and
the result that explains why it was not accepted.

```ts
import { createRefutationTrail } from 'agent-receipt-kit'

const trail = createRefutationTrail()

const checked = verifyReceipt(packet, claim, { cartItemCount: 0 })
if (!checked.accepted) {
  const entry = trail.record(claim, checked) // optional third argument: recordedAt
  trail.find(entry.id) // the same entry; undefined for an unknown id
}

trail.list() // every retained entry, oldest first (a copy of the array)
```

- `record(claim, result, recordedAt?)` stores both objects by reference and
  returns the entry. Entry ids look like `refute-<sequence>-<recordedAt>` and
  are unique within one trail. `claim` and `result` must be objects and
  `recordedAt`, when given, must be a non-blank string (`TypeError` otherwise).
  `packetId` is copied from the claim as given, so a rejected claim with no
  usable `packetId` is still recorded. It does not check that the result
  belongs to the claim.
- There is no `remove` or `delete`. Pruning history is a decision for your
  own storage layer.

### Types

| Type | What it describes |
| --- | --- |
| `AuthorityLevel` | The built-in labels `'observe' \| 'prepare' \| 'local'`. |
| `WorkPacket<Scope, Authority>` | `id`, `issuedAt`, `scope`, `authorityLevel`, `allowedActions`, `evidenceIds`. |
| `AgentClaim<Fact>` | `packetId`, `claimedActions`, `citedEvidenceIds`, and optional `claimedFacts`, `summary`, `reportedAt` (the last two are not checked). |
| `CurrentState<Fact>` | Your observation: a record of fact key to value. |
| `Contradiction<Fact>` | `key`, `claimedFact`, `currentFact` for one disagreeing fact. |
| `ReceiptCoverage` | `stateSupplied`, `claimedFactCount`, `comparedFactCount`, `uncheckedFactKeys`. |
| `ReceiptResult<Fact>` | `accepted`, `unauthorizedActions`, `droppedEvidenceIds`, `contradictions`, `packetMismatch`, `claimProblems`, `coverage`, `reason`. |
| `RefutationEntry<Fact>` | `id`, `packetId`, `claim`, `result`, `recordedAt`. |
| `RefutationTrail<Fact>` | `record`, `list`, `find`. |

## A second example: a data-pipeline agent

The pattern is the same outside browser automation. Here an agent was
authorized to transform rows in one dataset and cite specific input-row ids
as evidence for its output:

```ts
import { issuePacket, verifyReceipt } from 'agent-receipt-kit'

const packet = issuePacket(
  { dataset: 'orders_2026_07', operation: 'dedupe' },
  'local',
  ['transform-rows', 'write-output'],
  ['row-1042', 'row-1043', 'row-1044'],
  { id: 'pkt-orders-dedupe', issuedAt: '2026-09-28T09:00:00.000Z' },
)

const claim = {
  packetId: packet.id,
  claimedActions: ['transform-rows', 'write-output'],
  citedEvidenceIds: ['row-1042', 'row-1043', 'row-1044'],
  claimedFacts: { rowsWritten: 3, duplicatesRemoved: 1 },
}

// A fresh count against the actual output table, taken independently of
// the agent's own report.
const currentState = { rowsWritten: 3, duplicatesRemoved: 1 }

const result = verifyReceipt(packet, claim, currentState)
// accepted: true, because the actions and evidence were authorized and
// the independent row count agrees with the claim.
// result.coverage: { stateSupplied: true, claimedFactCount: 2, comparedFactCount: 2, uncheckedFactKeys: [] }
```

## Authority levels

`AuthorityLevel` ships with three labels:

- `'observe'`: the agent may only report what it sees.
- `'prepare'`: the agent may stage a proposed action (a plan, a diff, a
  draft) but not execute it.
- `'local'`: bounded execution within whatever the packet's `allowedActions`
  and `scope` define.

These are labels for you and your agent. `verifyReceipt` does not read them;
it checks the explicit `allowedActions` and `evidenceIds` lists. You are not
locked into these three: `WorkPacket`, `issuePacket`, and `verifyReceipt` are
generic over the authority type, so you can supply your own union (for
example `'observe' | 'draft' | 'sandbox' | 'production'`).

## Honest limits

- **`accepted` means the checks found no mismatch, not that the claim is
  true.** Observations are optional, and claimed facts missing from
  `currentState` are not compared, so an accepted receipt can contain facts
  nobody checked. `result.coverage` says how many were compared and which
  keys were not; the accepted `reason` says the same in words.
- **`currentState` is only as good as what you pass in.** The kit has no
  browser, filesystem, or network access and cannot re-observe anything
  itself. A stale, spoofable, or agent-controlled `currentState` gives you a
  false sense of independent verification.
- **Contradictions are surfaced, not resolved.** Deciding whether to trust the
  claim, trust the fresh read, or look again by hand is up to a person or your
  own policy.
- **Ids are opaque strings.** The kit does not know what `'screenshot-1'` or
  `'add-to-cart'` mean; it only checks exact membership in the packet's lists.
  If `allowedActions` is too broad, a claim that stays inside it is accepted.
- **Scope and authority are metadata.** Nothing checks a claim against
  `scope` or `authorityLevel`.
- **It checks the shape it compares, not your data.** The input rules above
  make malformed ids, lists and fact containers throw. The kit still does not
  validate request bodies, the values inside `claimedFacts`, `scope`,
  `authorityLevel`, `issuedAt`, `reportedAt` or any timestamp, and it does not
  defend against a hostile proxy or getter that throws. Keep facts
  JSON-shaped and bound their depth (see "Circular and very deep facts").
- **Nothing stops a replay.** The same accepted claim verifies again every
  time; the kit keeps no record of what it has already accepted.
- **No integrity or authenticity.** Packets and claims are not signed or
  hashed. Store packets somewhere the agent cannot edit them.
- **The trail is in memory and holds references.** It is not durable,
  immutable, or tamper-evident. Copy entries into storage you control. A
  hash-chained log such as
  [`audit-chain-kit`](https://github.com/lkopietz3-byte/audit-chain-kit) adds
  tamper evidence to the records you give it, with limits of its own: see
  "Relationship to sibling kits" below.
- **It is not a sandbox.** It checks the report after the fact and cannot
  prevent an action.

## Relationship to sibling kits

[`audit-chain-kit`](https://github.com/lkopietz3-byte/audit-chain-kit) is a
hash-chained, append-only log of opaque entries. It does not know what a
"receipt" or a "claim" is. A `RefutationEntry` (or a whole `ReceiptResult`) is
a natural payload to append to it: `verifyReceipt` decides whether a claim
holds up, `createRefutationTrail` remembers the rejections in memory for the
current process, and a chain lets anyone who holds it detect an edit made
without recomputing the hashes. The two packages share no code.

What that does not give you, according to that kit's own README:

- **Storage is yours.** Its chains are in-memory arrays. Writing them to disk
  or a database, and coordinating writers, is your application's job. Importing
  it does not make records survive a restart.
- **An anchor is needed to catch a rewrite.** With no key and no signatures,
  anyone who can write the stored chain can recompute it and it still
  verifies. Detecting that needs an `{ index, entryHash }` anchor kept
  somewhere the writer cannot change.
- **Identity and time are claims.** Nothing in the chain proves who wrote an
  entry, and `createdAt` is whatever the writer's clock said.

## A related concern this library does not handle

If an agent's inputs or outputs pass through a model, you probably also want
to screen for credential-shaped material in a claim (API keys, tokens,
connection strings) and for prompt-injection patterns in anything the agent
reads before acting. Those are separate problems from verification, about
what goes into an agent's context and what comes out, and this library stays
out of them. Screen for them separately, upstream of `verifyReceipt`.

## Development

```bash
npm ci
npm run verify
```

`npm run verify` runs lint, typecheck, the Vitest suite, the build, and a
package check that packs the library, installs the tarball into an empty
project, and runs the consumer probes in `scripts/`. Code tour:

- [`src/packet.ts`](src/packet.ts) issues the work packet.
- [`src/receipt.ts`](src/receipt.ts) checks a claim against the packet and an
  optional observation.
- [`src/trail.ts`](src/trail.ts) keeps rejected claims instead of dropping
  them.
- [`test/`](test/) covers accepted, unauthorized, dropped-evidence,
  mismatched-packet, and contradictory claims, fact comparison rules and
  circular or deep input, input checks, coverage, and the reason text.

See [`ENGINEERING.md`](ENGINEERING.md) for the invariants and release notes
and [`CHANGELOG.md`](CHANGELOG.md) for changes.

## License

MIT
