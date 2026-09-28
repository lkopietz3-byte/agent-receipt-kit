# Engineering contract

## What the kit promises

- `verifyReceipt` never reports `accepted: true` if a claimed action is
  outside `packet.allowedActions`, a cited evidence id is outside
  `packet.evidenceIds`, `claim.packetId !== packet.id`, or a claimed fact
  differs from the same-keyed fact in a supplied `currentState`.
- Every mismatch is named in the result; all four checks always run.
- Input it cannot judge throws a `TypeError` instead of being accepted:
  ids must be non-blank strings; the four lists must be dense arrays of
  strings; `claimedFacts` and `currentState` must be plain (or null-prototype)
  objects. Two missing ids never match each other.
- Every result carries `coverage` (`stateSupplied`, `claimedFactCount`,
  `comparedFactCount`, `uncheckedFactKeys`). It is additive and never changes
  `accepted`.
- Fact comparison fails closed: values it cannot compare by content (anything
  but primitives, arrays, plain objects, and Dates) only match themselves. The
  same object on both sides matches without being walked, including a
  circular one; two separate circular or extremely deep values throw a
  `RangeError`, never an acceptance.
- `verifyReceipt` is synchronous, deterministic, reads no clock, and does not
  mutate its inputs. Each caller field is read once and the result is
  computed from that read. Untrusted strings in `reason` are JSON-quoted with
  control characters, line breaks and bidi formatting characters escaped.
- `issuePacket` copies its lists from one indexed read and rejects non-array,
  non-string or sparse lists and a blank `options.id`.
- The trail has no removal API.
- Zero runtime dependencies. ESM only. Node.js 20 or newer (`engines`); see
  the runtime support policy below.

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
code. The 0.2.0 fix pass measured v8 coverage (100% statements, branches,
functions and lines on `src/`) and a Stryker mutation run (100%: 301 killed, 0
survived; it was 95.4% before, with 12 survivors). Neither tool is a
dependency or a CI step: run them locally with
`npm i -D --no-save @stryker-mutator/core @stryker-mutator/vitest-runner @vitest/coverage-v8@4.1.11`
and an uncommitted `stryker.config.json` (`testRunner: vitest`,
`mutate: ["src/**/*.ts"]`, `coverageAnalysis: perTest`).

## Are the types wrong? (attw)

CI runs [`arethetypeswrong`](https://github.com/arethetypeswrong/arethetypeswrong.github.io)
(`npm run attw`, which is `attw --pack . --ignore-rules cjs-resolves-to-esm`)
against the packed tarball after the build step. The `cjs-resolves-to-esm` rule is ignored on
purpose: this is an ESM-only package (`"type": "module"`, no `require` entry point), so a
CommonJS consumer must use Node's `require(esm)` support (Node >=20.19 or >=22.12 — see
"Runtime support policy" below) rather than a native `require`. A dual CJS+ESM build was
rejected to avoid the dual-package hazard (two separately-identified copies of the same module,
with broken `instanceof` checks and duplicated module state across the CJS and ESM entry
points).

## Release and rollback

`npm run verify` (lint, typecheck, test, build, verify:package) runs automatically before
publish via the `prepublishOnly` script, so a broken build cannot reach the registry by
accident. To release: add a dated entry to `CHANGELOG.md`, bump `version` in
`package.json`, commit, and push a `vX.Y.Z` tag that matches the new version, then let
`.github/workflows/release.yml` install, verify, and publish it. (You can also run
`npm publish` locally; `prepublishOnly` still guards it.)

npm's unpublish policy is deliberately narrow. Within 72 hours of publishing, a version can be
unpublished only if no other published package depends on it. After 72 hours, unpublishing also
requires fewer than 300 downloads in the last week and a single maintainer — most released
versions won't qualify either way. A given `name@version` can never be reused, published or
not, even after an unpublish. Treat unpublish as unavailable: prefer fixing forward with a new
patch version, and use `npm deprecate <name>@"<range>" "<message>"` to warn consumers off a
bad release while it stays installable for anyone already pinned to it.

### Runtime support policy

- **Supported (recommended for production):** Node 22 and 24 LTS; Node 26 current.
- **Compatibility-tested:** Node 20. Node 20 is end-of-life — nodejs.org's release page
  (<https://nodejs.org/en/about/previous-releases>) lists it as `EOL`, with its final release
  dated Mar 24, 2026. The `compat` job in `verify.yml` still runs on Node 20 (latest 20.x and exactly
  20.19.0) to catch regressions, but that runtime gets no security fixes upstream; don't run production traffic
  on it.
- CommonJS `require()` of this package needs Node >=20.19 or >=22.12 (`require(esm)`
  support). ESM `import` works on every version this package tests (20, 20.19.0,
  22, 22.12.0, 24). The exact floors 20.19.0 and 22.12.0 run the tests and the installed-package
  probes, including the CommonJS `require()` probe.
- `engines` in `package.json` is unchanged by this policy.

### Publishing with provenance

`.github/workflows/release.yml` publishes using npm trusted publishing: it triggers on
`workflow_dispatch` or a pushed `v*` tag, requests a short-lived OIDC token instead of
reading a stored npm token (`permissions: id-token: write`), and runs a plain `npm publish`
with no token and no `--provenance` flag, because provenance attestation is generated
automatically under trusted publishing. Both triggers must run on a `v*` tag ref
(a manual run from a branch fails), and the tag must match `package.json`'s `version`.
The workflow then runs the dependency audit, `npm run verify` and `npm run attw`, and checks
whether that version is already on the registry. Only a confirmed E404 counts as "not
published"; a version that is already there makes the run a no-op, and any other registry
error (outage, auth, network) fails the job instead of guessing. Trusted publishing must be configured for this package on npmjs.com (linking it to this
GitHub repository and the `release.yml` workflow) before the first automated release will
work.
