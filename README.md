# Chox

Turn a real task into a gated Claude→Codex→Claude workflow without copying prompts
between tools. Chox is local-first: it has no account, server, telemetry, or Chox
network call.

## Installed-package quickstart

The npm handle is still founder-controlled and the package remains private. Replace
the clearly marked `<resolved-package-name>` placeholder only after the founder has
chosen the handle and accepted the packed journey; do not publish from this branch.

Requirements: Node.js 22.13 or newer, npm, Git, Claude Code, and Codex CLI.

```sh
npm install -g <resolved-package-name>
cd <an-existing-git-repository>

chox doctor
chox relay list
chox relay show spec-implement-review

printf '%s\n' 'Add the requested feature, tests, and documentation.' > task.md
chox run spec-implement-review --task-file task.md --dry-run
chox run spec-implement-review --task-file task.md
```

The packaged `spec-implement-review` starter is read-only and immediately runnable.
Repository relays in `.chox/relays/` override global relays in `~/.chox/relays/`,
which override the built-in. Use `--task <text>` for a short task or
`--task-file <path>` for a durable/multiline task; resume takes no task flag because
it uses the persisted compiled plan.

## Personalize from local history

Privacy boundary before detection: `chox detect` reads local Claude Code and Codex
session files. `--no-confirm` is deterministic and starts no agent. With confirmation
enabled, Chox invokes the agent CLI you select; that CLI may send derived evidence and
bounded excerpts from up to the three highest-weighted occurrences to its vendor. The
engine, model (or CLI default), call ceiling, and actual spend remain visible.

```sh
# Local scan only; no analysis agent starts
chox detect --no-confirm

# Confirm through the first available CLI (Claude, then Codex)
chox detect

# Inspect before trusting or installing
chox finding show <finding-id>
chox finding show <finding-id> --prompts
chox install <finding-id>
```

Detection is optional personalization, not an activation prerequisite. It scans
recurring cross-agent handoffs, attaches measured occurrence/time evidence, and
either proposes a relay or reports that an installed relay already covers the loop.

Useful inspection and machine-readable forms:

```sh
chox relay list --json
chox relay show spec-implement-review --prompts
chox finding show <finding-id> --json
chox detect --engine codex --model <model-name> --json
chox status
```

JSON commands emit one JSON document on stdout; progress and notices use stderr.
Run `chox <command> --help` for `run`, `detect`, `relay`, `finding`, `doctor`, or
`status` help.

## Privacy, storage, and ownership

- `~/.chox/substrate.db` stores session metadata, source-file references, and
  derived intent digests—not raw prompts or responses. Raw source content stays in
  the vendor files.
- `~/.chox/runs/` is different: `plan.json`, events, and approved artifacts are the
  resumable execution record, so compiled prompts and task text are stored there.
- `doctor --bundle` is allowlisted and redacted by construction. Bundles contain no
  task text, compiled prompts, shell commands, usernames, raw home paths, or
  dash-encoded home paths.
- Chox opens no network listener. Only the user-selected local agent CLI may contact
  its vendor.
- Generated relay files carry ownership metadata. A foreign relay directory is
  never rewritten; Chox chooses a deterministic suffix such as `-2`.
- Every run uses an isolated Git worktree and preserves agent changes on a
  `chox/<relay>/<run-id>` branch before removing the worktree.

## Uninstall and data removal

These are separate choices; uninstalling the package does not silently delete work:

- **Package:** `npm uninstall -g <resolved-package-name>` removes the CLI only.
- **Global relays:** review and remove selected directories under
  `~/.chox/relays/`. Repository relays under each repo's `.chox/relays/` are
  separate user-owned files.
- **Run records:** remove selected directories under `~/.chox/runs/` only after any
  pending run is finished or aborted and its branch is inspected.
- **Substrate:** remove `~/.chox/substrate.db`; it is a rebuildable metadata cache.
- **Worktrees:** let Chox finish or abort runs so it can commit-before-remove. Do not
  delete a worktree directory that may contain uncommitted agent work.
- **Preserved Git branches:** `chox/...` branches live in the original repositories.
  Neither package uninstall nor Chox-home deletion removes them; merge, archive, or
  delete each branch explicitly with normal Git review.

## Build from source

Source development comes after the installed activation path. Clone the repository,
then run:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run verify:pack
```

The pack verifier creates the real tarball, installs it into a fresh temporary
prefix, isolates Chox and agent homes, uses fake agent binaries, and exercises doctor,
relay discovery, task dry-run, gate interruption, resume, bundle privacy, and built-in
immutability.

To exercise the compiled source CLI against a separate Git repository:

```sh
cd <an-existing-git-repository>
node <path-to-chox>/dist/bin/chox.js relay show spec-implement-review
node <path-to-chox>/dist/bin/chox.js run spec-implement-review --task-file task.md --dry-run
```

Tests isolate `CHOX_HOME`, `HOME`, and fake agent binaries; they never scan real
`~/.chox`, `~/.claude`, or `~/.codex` data.

The canonical product contract is [docs/SPEC.md](docs/SPEC.md), the active sequence
and gates are in [docs/ROADMAP.md](docs/ROADMAP.md), mandatory invariants are in
[docs/CORRECTNESS.md](docs/CORRECTNESS.md), and phase packets/results are in
[docs/plans/](docs/plans/).

Chox is licensed under the [MIT License](LICENSE).
