# AGENTS.md

Chox is a local-first TypeScript CLI for gated agent relays in isolated Git
worktrees. This file contains repository-wide execution rules; product detail belongs
in the canonical docs, not here.

## Before Changing Code

1. Read the relevant code and tests.
2. Use `docs/SPEC.md` for product intent and `docs/CORRECTNESS.md` as mandatory
   correctness requirements.
3. Follow the applicable `docs/plans/` packet for scope, interfaces, and acceptance
   criteria. Record justified deviations in its challenge notes; do not rewrite
   historical specs or packets to match code.
4. Check `git status --short` and preserve unrelated work.

## Non-Negotiables

- Node `>=22.13`, npm, strict TypeScript, ESM/NodeNext; single quotes, no semicolons,
  and `.js` extensions on local imports.
- No telemetry, accounts, Chox network calls, or unapproved dependencies. Only the
  user-selected local agent CLI may contact its vendor.
- Resolve Chox state through `src/paths.ts` and honor `CHOX_HOME`. Chox-owned writes
  stay there except Git worktree mechanics and an explicitly requested cwd doctor
  bundle.
- Validate `unknown` data at JSON, filesystem, and process boundaries. Doctor bundles
  never contain prompts, commands, or raw/dash-encoded home paths.
- Spawn Git, editors, and agents with argv arrays and `shell: false`; send agent
  prompts through stdin.
- Dry-run and real execution use the same compiled plan and exact prompt text. Resume
  uses the persisted plan.
- Persist state before user-visible transitions. Report a hop started only after the
  child emits `spawn`.
- Never discard worktree changes: commit before removal and preserve run branches,
  including orphan recovery.
- `.chox-run/` is harness-owned artifact storage; exclude it from Git commits and
  implementation footprints.
- Stay inside the requested phase. Do not add future-phase stubs or infrastructure.

## Code Placement

- `bin/chox.ts`: thin CLI parsing and dispatch.
- `src/artifacts/`: relay IR, validation, loading, and compilation.
- `src/runtimes/`: runtime contract, process adapters, and event normalization.
- `src/harness/`: orchestration, gates, autonomy, persistence, and isolation.
- `src/system/`: reusable OS/process boundaries; no product policy.
- Root `src/*.ts`: packet-defined shared APIs and diagnostics.
- `.chox/relays/`: committed relay definitions.
- `tests/`: mirrors production domains; shared setup only in `tests/helpers/`.

Put policy with its owning domain. Avoid generic `utils.ts`, broad barrel exports,
and layering inversions. Keep packet-defined public interfaces stable; extract private
modules when an implementation becomes difficult to navigate.

## Testing

- Use Vitest, real temporary filesystems, and real temporary Git repositories. Never
  mock `fs` for filesystem behavior.
- Tests must never touch real `~/.chox`, `~/.claude`, or `~/.codex`.
- Runtime/runner tests use `tests/helpers/fake-agents.ts`; never invoke installed agent
  binaries. Gate tests inject `GateIO` and require no real TTY.
- Test observable behavior through public interfaces. Mirror the source domain and use
  `*.integration.test.ts` for process, Git, or CLI boundaries.
- CI covers Ubuntu and Windows on Node 22/24; keep paths, argv handling, and timing
  assertions portable.

Run the narrowest relevant test first. Before broad handoff, run:

```sh
npm run typecheck
npm test
npm run build
node dist/bin/chox.js run spec-implement-review --dry-run
node dist/bin/chox.js doctor  # exit 0 or 1; never an uncaught exception
```
