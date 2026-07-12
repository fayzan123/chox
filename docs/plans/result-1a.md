# Phase 1a result

Implemented the relay runtime end to end:

- strict relay IR validation, repo-local/global loading, placeholder compilation, and
  byte-identical dry-run prompt rendering;
- Claude Code and Codex CLI runtimes with stdin prompts, argv-array spawning,
  preflight diagnostics, and tolerant JSONL normalization;
- atomic run state, append-only events, resumable gates, challenge/strict/autonomous
  enforcement, artifact snapshots, worktree creation/cleanup, and orphan recovery;
- `chox run`, `--dry-run`, `--resume`, `--unattended`, `chox doctor`, redacted doctor
  bundles, version/help/usage handling, and the example `spec-implement-review` relay.

## Run it

```sh
npm ci
npm run typecheck
npm test
npm run build
node dist/bin/chox.js run spec-implement-review --dry-run
node dist/bin/chox.js doctor
```

The test suite uses real temporary filesystems and Git repositories plus fake Claude
and Codex binaries. It never invokes the installed agents or uses the real Chox,
Claude, or Codex homes.

## Reviewer starting points

1. `docs/plans/challenge-notes-1a.md` for the packet contradictions and intentional
   interface/on-disk clarifications.
2. `tests/harness/runner.integration.test.ts` for prompt parity, gate/resume,
   redirect/edit, unattended, failure, and challenge-repair acceptance coverage.
3. `src/harness/isolation.ts` and `tests/harness/isolation.integration.test.ts` for
   the commit-before-remove worktree safety path.
4. `src/doctor.ts`, `src/redact.ts`, and their tests for the diagnostics allowlist and
   dash-encoded home redaction.

## Known gaps

- No paid/networked real-agent relay was run during implementation; runtime behavior
  is covered with fake binaries, while installed CLI flags were verified locally
  against Claude Code 2.1.207 and Codex CLI 0.144.1.
- Gate interruption/resume is integration-tested through the same interruption error
  path. OS-level SIGINT delivery during a live agent process, especially on Windows,
  remains a manual smoke check; state is persisted as `running` before the child is
  presented as active, so the run remains resumable after process termination.
- C4/C5 and artifact-export portions of C6 intentionally have no Phase 1a surface;
  deterministic run-branch collision handling covers the in-scope part of C6.
