# Engineering contract

## What the kit promises

- `verifyReceipt` never reports `accepted: true` if a claimed action is
  outside `packet.allowedActions`, a cited evidence id is outside
  `packet.evidenceIds`, `claim.packetId !== packet.id`, or a claimed fact
  differs from the same-keyed fact in a supplied `currentState`.
- Every mismatch is named in the result; all four checks always run.
- Fact comparison fails closed: values it cannot compare by content (anything
  but primitives, arrays, plain objects, and Dates) only match themselves.
- `verifyReceipt` is synchronous, deterministic, reads no clock, and does not
  mutate its inputs. Untrusted strings in `reason` are JSON-quoted with line
  breaks escaped.
- `issuePacket` copies its lists and rejects non-array or non-string entries.
- The trail has no removal API.
- Zero runtime dependencies. ESM only. Node.js 20 or newer.

## What is not certified

- Nothing here checks that a claim is true, that evidence exists, or that an
  observation is fresh or independent. `accepted` means "no mismatch found in
  the data supplied".
- No signing, hashing, or identity. No durable or tamper-evident storage.
- No security review or audit has been done. It is not a sandbox.

## Set up and verify

```bash
npm ci
npm run verify              # lint, typecheck, test, build, verify:package
npm run audit:dependencies  # npm audit of the lockfile, dev deps included
```

`verify:package` packs the build, installs the tarball into an empty project
offline, compares exports with `api-surface.json`, runs
`scripts/consumer-probe.mjs`, and type-checks `scripts/consumer-probe.mts`
under strict NodeNext settings. If you change exports on purpose, run
`node scripts/verify-package.mjs --update-api` and review the diff.

Tests live in `test/`. Every bug fix lands with a test that fails on the old
code.

## Release and rollback

- `npm run verify` (lint, typecheck, test, build, verify:package) runs
  automatically before publish via the `prepublishOnly` script.
- To release: update `CHANGELOG.md`, bump `version`, run `npm run verify`,
  tag the commit, then `npm publish`.
- To roll back: npm allows `npm unpublish` only within 72 hours of
  publishing. After that window, publish a fixed patch version instead.
