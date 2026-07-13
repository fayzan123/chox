# Chox

Turn your coding agents' shared history into runnable, gated cross-agent workflows.
Chox is local-first, has no account, and has no server.

## Privacy and security contract

- Chox itself makes no network calls. There is no telemetry or Chox service. When
  confirmation is enabled, Chox invokes one of your installed agent CLIs; that CLI
  may send derived evidence and short excerpts from only the highest-weighted
  occurrence to its vendor. The chosen engine, model default, and call ceiling are
  shown before analysis. Use `--no-confirm` to make detection fully deterministic
  and spawn no engine.
- `~/.chox/substrate.db` stores session metadata, source-file references, and derived
  intent digests—not raw prompts or responses. Raw content remains in the original
  Claude Code and Codex session files and is read on demand for confirmation.
- Chox reads no vendor memory store today. Future profile sources are opt-in and
  remain local except for analysis explicitly run through your selected agent CLI.
- Diagnostic bundles are redacted by construction: no prompts, shell commands,
  usernames, raw home paths, or dash-encoded home paths.
- Chox opens no network listener. Generated files outside `~/.chox` carry ownership
  metadata, and Chox never overwrites an existing relay directory—it selects a
  deterministic suffix such as `-2`.

## What works now

Chox can scan local Claude Code and Codex session histories, detect recurring
cross-agent handoffs, attach measured occurrence/time evidence, confirm candidates
through your chosen agent CLI, draft a relay, and install it locally or globally. The
relay runtime executes those workflows in isolated Git worktrees with persisted
artifacts and gates.

The Phase 1b implementation is source-ready but intentionally not published yet:
`package.json` remains private until the founder verifies the npm handle. The
two-week detection-quality measurement and demo recording are post-merge founder
acceptance work.

## Quickstart from source

Requirements: Node.js 22.13 or newer, npm, Git, and at least one of Claude Code or
Codex CLI for confirmation and relay execution.

```sh
npm ci
npm run typecheck
npm test
npm run build

# Deterministic local scan; never starts an agent CLI
node dist/bin/chox.js detect --no-confirm

# Confirm candidates through the first available CLI (Claude, then Codex)
node dist/bin/chox.js detect

# Inspect cache and finding status
node dist/bin/chox.js status

# Install a confirmed relay shown by detect
node dist/bin/chox.js install <finding-id>
```

Useful variants:

```sh
node dist/bin/chox.js detect --source claude-code,codex --since 30d
node dist/bin/chox.js detect --engine codex --json
node dist/bin/chox.js install --dismiss <finding-id>
node dist/bin/chox.js run spec-implement-review --dry-run
node dist/bin/chox.js doctor
```

`detect --json` keeps machine-readable JSON on stdout and writes the pre-analysis
engine/spend notice to stderr. Tests isolate `CHOX_HOME`, `HOME`, and fake agent
binaries; they never scan your real session directories.

## Development

The canonical product contract is [docs/SPEC.md](docs/SPEC.md), mandatory invariants
are in [docs/CORRECTNESS.md](docs/CORRECTNESS.md), and the active phase packet is
[docs/plans/phase-1b-build-packet.md](docs/plans/phase-1b-build-packet.md).

Chox is licensed under the [MIT License](LICENSE).
