# AGENTS.md

Durable guidance for coding agents working in Chox. Keep this file compact and
current. Put genuinely narrower rules in a nested `AGENTS.md`; do not duplicate this
file elsewhere.

## Project Identity

Chox is a local-first TypeScript CLI that runs gated, multi-runtime coding-agent
relays inside isolated Git worktrees. The current implementation is Phase 1a: relay
loading/compilation, Claude and Codex runtimes, the run harness, gates, resume,
autonomy checks, worktree cleanup, and doctor diagnostics.

Trust is a product requirement. Chox has no telemetry, accounts, direct network
calls, or cloud service. Only a local agent CLI explicitly selected by the user may
communicate with its vendor.

## Sources Of Truth

Read these in order when product behavior is unclear:

1. `docs/SPEC.md` — canonical product and architecture intent.
2. `docs/CORRECTNESS.md` — non-negotiable correctness ledger.
3. The applicable `docs/plans/` build packet — phase scope and acceptance criteria.

Do not edit historical specs or build packets to make an implementation appear
conformant. Record intentional packet deviations in the phase challenge notes.

## Commands

Run commands from the repository root. The project uses npm, Node `>=22.13`, strict
TypeScript, ESM, and NodeNext resolution. CI covers Ubuntu and Windows on Node 22/24.

```sh
npm run typecheck
npm test
npm run build

# Focused examples
npx vitest run tests/artifacts/relay.test.ts
npx vitest run tests/harness/runner.integration.test.ts

# Phase 1a smokes
node dist/bin/chox.js run spec-implement-review --dry-run
node dist/bin/chox.js doctor
```

## Repository Structure

- `bin/chox.ts` — thin CLI parsing and dispatch. Product logic belongs in `src/`.
- `src/artifacts/` — relay IR, validation, loading, and compilation.
- `src/runtimes/` — agent runtime contract, registry, spawning, and event adapters.
- `src/harness/` — run orchestration, gates, autonomy, state/events, and isolation.
- `src/system/` — reusable OS/process boundaries; never place domain policy here.
- `src/paths.ts`, `errors.ts`, `slugify.ts` — shared public foundations specified by
  the phase packet.
- `src/doctor.ts`, `redact.ts` — diagnostics and privacy boundary.
- `.chox/relays/` — committed, hand-authored relay definitions.
- `tests/` — mirrors production domains. Process/Git/CLI suites use
  `*.integration.test.ts`; shared setup belongs only in `tests/helpers/`.

When adding a module, place it with the domain that owns its policy. Avoid generic
`utils.ts` files, broad barrels, and cross-domain imports that invert this layering.
Keep public packet interfaces stable; extract private helpers behind them as modules
grow.

## Working Rules

- Read relevant code and tests before editing. Use `rg` / `rg --files` for discovery.
- Preserve unrelated user changes and check `git status --short` before broad edits.
- Use single quotes, no semicolons, and `.js` extensions on local TypeScript imports.
- Keep strict typing; do not bypass `unknown` validation with unchecked casts at file,
  process, or JSON boundaries.
- Do not add dependencies without explicit approval and a documented trust-budget
  justification. Phase 1a has zero production dependencies.
- Prefer small, coherent commits. Keep generated output out of source control.
- Stay inside the requested phase. Do not stub detection, substrate, lenses, export,
  scheduler, daemon, or app work ahead of its packet.

## Safety Invariants

- Resolve all Chox state through `src/paths.ts`; honor `CHOX_HOME` in every test and
  path-sensitive flow.
- Chox-owned writes stay under the selected Chox home. Exceptions are explicit Git
  worktree mechanics and the user-requested cwd doctor bundle.
- Never write unredacted prompts, commands, or raw user paths into doctor bundles.
  Redact raw and dash-encoded home paths.
- Spawn Git, editors, and agent CLIs with argv arrays and `shell: false`. Send agent
  prompts through stdin, never argv.
- Do not report an agent hop as started until the child process emits `spawn`.
- Dry-run and real execution must use the same compiled plan and exact prompt text.
- Gates remain resumable. Persist state before presenting user-visible transitions.
- Never discard worktree changes. Commit dirty work before removal; orphan cleanup
  follows the same path and preserves run branches.
- Treat `.chox-run/` as harness-owned artifact storage, excluded from implementation
  footprints and Git commits.

## Testing Rules

- Use Vitest and real temporary filesystems. Never mock `fs` for filesystem behavior.
- Never touch real `~/.chox`, `~/.claude`, or `~/.codex` from tests. Use
  `tests/helpers/temp.ts` and assert isolated paths.
- Runtime and runner tests use fake binaries from `tests/helpers/fake-agents.ts`; they
  must never spawn the installed Claude or Codex binaries.
- Isolation tests create real temporary Git repositories through
  `tests/helpers/git.ts`.
- Gate tests inject scripted `GateIO`; never require a real TTY or editor.
- Test observable behavior through public interfaces. Add focused tests beside the
  matching domain and use an integration filename when the test crosses processes,
  Git, or the CLI boundary.
- Run the narrowest relevant suite first. Before handing off a broad change, run
  typecheck, the full test suite, build, and relevant smokes.

## Common Pitfalls

- Probing agent binaries during `--dry-run`, which violates its no-process contract.
- Reusing an earlier hop's `challenge-notes.md`; each challenge attempt must produce
  fresh, non-empty notes.
- Mutating the common repository exclude file instead of the linked worktree's
  configured exclude.
- Using current relay contents during resume instead of the persisted execution plan.
- Treating advisory command visibility as a mechanical guarantee.
- Adding flat tests at `tests/` when a matching domain directory exists.
