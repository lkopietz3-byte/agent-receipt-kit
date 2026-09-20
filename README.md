# Agent Receipt Kit

Agent Receipt Kit is a small, dependency-free TypeScript library for checking
an AI agent's claimed work against the authorization it received and, when one
exists, a fresher independent observation. It is framework-agnostic: the same
contract can sit behind a coding agent, browser automation, a data pipeline, or
a customer-service workflow.

## Start here

```bash
npm ci
npm test
npm run typecheck
npm run build
```

These commands exercise the contract, its type surface, and the emitted
package. The library is source-available under the MIT license; it is not
published to npm.

## The core idea

**An agent's own claim about what it did is not evidence that it did it.**
A "done" message is not a receipt. Verifying a claim requires two separate
checks: was the claimed action and cited evidence actually inside what was
authorized in the first place, and, if you can get one, does a fresher,
independent observation of the world agree with what the agent says
happened. Neither check trusts the agent's self-report by default, and
neither check silently resolves a disagreement in either direction:
unauthorized claims are flagged instead of accepted, invented evidence is
named instead of dropped quietly, and a contradiction between a claim and
current reality is surfaced instead of letting the newer data silently
overwrite the claim or the claim silently win by default.

## What to review

- [`src/packet.ts`](src/packet.ts) issues the bounded work packet.
- [`src/receipt.ts`](src/receipt.ts) evaluates the agent's claim against that
  packet and an optional independent observation.
- [`src/trail.ts`](src/trail.ts) retains rejected claims instead of dropping
  the disagreement.
- [`test/receipt.test.ts`](test/receipt.test.ts) covers the accepted,
  unauthorized, stale, and contradictory paths.

## Install

```bash
npm install agent-receipt-kit
```

## API

### `issuePacket(scope, authorityLevel, allowedActions, evidenceIds, options?)`

Call this before the agent runs. It returns a `WorkPacket`: the exact
authorization you are handing the agent. Keep it, you need it later to
verify what comes back.

```ts
import { issuePacket } from 'agent-receipt-kit'

const packet = issuePacket(
  { site: 'shop.example.com', checkoutFlow: 'guest' }, // scope: yours to define
  'local',                                              // authority level
  ['log-in', 'add-to-cart'],                             // allowed actions
  ['screenshot-1', 'screenshot-2'],                       // evidence the agent may cite
)
```

### `verifyReceipt(packet, claim, currentState?)`

Call this when the agent reports back. Returns a structured result, never a
boolean shortcut, so you can see exactly what failed and why.

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
//   reason: "Claim matches the issued packet's authority and evidence, ..."
// }
```

If the agent claims an action it was never granted, cites evidence that was
never issued, or the fresher `currentState` disagrees with a claimed fact,
`accepted` is `false` and the specific problem is named:

```ts
// Agent claims it also submitted payment, which was never authorized.
verifyReceipt(packet, { ...claim, claimedActions: [...claim.claimedActions, 'submit-payment'] })
// => { accepted: false, unauthorizedActions: ['submit-payment'], ... }

// Agent cites a screenshot id nobody issued it.
verifyReceipt(packet, { ...claim, citedEvidenceIds: ['screenshot-1', 'screenshot-99'] })
// => { accepted: false, droppedEvidenceIds: ['screenshot-99'], ... }

// A fresh scrape of the cart disagrees with the claim.
verifyReceipt(packet, claim, { cartItemCount: 0 })
// => { accepted: false, contradictions: [{ key: 'cartItemCount', claimedFact: 1, currentFact: 0 }], ... }
```

### `createRefutationTrail()`

A claim that fails verification should not just vanish from your logs. This
gives you an append-only log for exactly that: retain the claim and the
result that explains why it was not accepted, so the disagreement itself
stays inspectable later.

```ts
import { createRefutationTrail } from 'agent-receipt-kit'

const trail = createRefutationTrail()

const result = verifyReceipt(packet, claim, currentState)
if (!result.accepted) {
  trail.record(claim, result)
}

trail.list()        // every retained entry, oldest first
trail.find(entryId) // look up one entry
```

There is no `remove` or `delete` on the returned trail. If a claim was
refuted, it stays refuted in the log; deciding to prune history is a
decision for your own storage layer, not something this library hands you a
shortcut for.

## A second example: a data-pipeline agent

The pattern is identical outside browser automation. Here an agent was
authorized to transform rows in one dataset and cite specific input-row ids
as evidence for its output:

```ts
import { issuePacket, verifyReceipt } from 'agent-receipt-kit'

const packet = issuePacket(
  { dataset: 'orders_2026_07', operation: 'dedupe' },
  'local',
  ['transform-rows', 'write-output'],
  ['row-1042', 'row-1043', 'row-1044'],
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
```

## Authority levels

`AuthorityLevel` ships with three levels that cover the common case:

- `'observe'`: the agent may only report what it sees. No side effects are
  implied.
- `'prepare'`: the agent may stage a proposed action (a plan, a diff, a
  draft) but not execute it.
- `'local'`: bounded execution within whatever the packet's `allowedActions`
  and `scope` define.

You are not locked into these three. `WorkPacket`, `issuePacket`, and
`verifyReceipt` are all generic over the authority type, so you can supply
your own union (for example `'observe' | 'draft' | 'sandbox' | 'production'`)
and everything still type-checks.

## A related, separate concern this library does not handle

If your agent's inputs or outputs pass through a model at any point, you
likely also want to screen for credential-shaped material accidentally
included in a claim (API keys, tokens, connection strings) and for
prompt-injection patterns in anything an agent reads before acting on it.
Those are real, worthwhile, and genuinely separate problems from
verification: they are about what goes INTO an agent's context and OUT of
its mouth, not about whether a completed claim matches what was authorized.
This library deliberately stays out of that lane so it can stay
zero-dependency and single-purpose. Screen for that layer separately,
upstream of `verifyReceipt`.

## Honest limits

- **This is a verification framework, not a sandbox.** It does not stop an
  agent from taking an unauthorized action in the first place. It stops an
  agent's unverified claim about what it did from being silently trusted
  afterward. If you need to prevent an action, enforce that at the tool or
  execution layer; this library only checks the report against the grant
  after the fact.
- **`currentState` is only as good as what you pass in.** This library
  cannot go re-observe reality itself. It has no browser, no filesystem, no
  network access, and no opinion about what counts as a trustworthy fresh
  check for your domain. Supplying a stale, spoofable, or agent-controlled
  `currentState` gives you a false sense of independent verification. The
  freshness and independence of that observation is entirely on you.
- **Contradictions are surfaced, not resolved.** When a claim and
  `currentState` disagree, `verifyReceipt` does not decide who is right. It
  refuses to accept the claim and tells you exactly what disagreed. Deciding
  whether to trust the claim, trust the fresh read, or go look again by hand
  is a call for a human or your own policy layer.
- **Evidence and action ids are opaque strings.** This library does not
  know what `'screenshot-1'` or `'add-to-cart'` mean; it only checks set
  membership against what the packet issued. Garbage in, garbage out: if
  your `allowedActions` list is too broad, a claim that stays inside it will
  still be accepted.

## License

MIT
