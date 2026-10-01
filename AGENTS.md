# agent-receipt-kit — agent instructions

Dependency-free TypeScript checks that compare an AI agent's report with the actions and evidence ids it was issued and with a caller-supplied observation.

## Read first
- `ENGINEERING.md` holds this package's invariants and design rules; read it before changing behavior.
- `PROJECT_CONTEXT.md` is the current project state and decisions.
- `SECURITY.md` covers the security posture; follow it for anything touching input handling.

## Commands (from package.json)
- `npm run verify`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run verify:package` packs and installs the tarball offline; run `npm run build` first.

## Rules
- Run `npm run verify` and read its output before calling work done. Report any step that did not run.
- Build cleans `dist/` first; never trust a stale `dist/` for declaration or package checks.
- Never weaken lint, tests or `api-surface.json` to get green. Public API changes are deliberate (`node scripts/verify-package.mjs --update-api`) and must be called out.
- Do not run `npm publish` or push tags without explicit permission. Treat any claim that a version is published as Reported until the registry confirms it.
- Runtime `dependencies` stay empty; add dev tooling only.
- Keep unrelated uncommitted work intact; never stage or reset the whole tree.

## Review preparation

See [docs/REVIEW_READINESS.md](docs/REVIEW_READINESS.md) for review cadence, declared verification gates and the next consumer integration task.

## Code Review Rules

- Preserve exact packet ID, action allowlist and evidence-ID membership checks plus contradiction reporting. Unauthorized actions, foreign evidence and mismatched packets must be rejected.
- Keep malformed caller packets/currentState as input errors and agent-claim problems as documented rejections. Coverage remains separate from acceptance: accepted does not establish unchecked facts or independent observation when the agent controls currentState.
- Keep scope/authority metadata and the in-memory refutation trail within their documented limits. Protected packet storage, application enforcement, replay policy and durable/tamper-evident persistence are consumer responsibilities; the kit does not enforce actions or authenticate agents.
