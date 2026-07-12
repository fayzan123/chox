# Phase 1a challenge notes

This packet was reviewed critically against `SPEC.md`, `CORRECTNESS.md`, the current
Git worktree model, and the locally installed Claude Code and Codex CLIs before
implementation. The notes below are intentional deviations or clarifications. Each
entry includes the packet behavior to revert to if the PM prefers literal conformance.

## 1. Dry-run does not probe runtimes

- **Packet:** §3 says dry-run stops after compilation and F13 says it spawns no
  processes, while §5.4 also asks dry-run to probe binaries and print missing-runtime
  warnings.
- **Implementation:** dry-run performs no preflight at all. It renders only the
  compiled plan, so the command is side-effect free and the rendered prompt is the
  exact prompt later sent by a real run.
- **Why:** even a `--version` probe is a spawned process and contradicts the stronger
  no-process acceptance criterion.
- **Revert:** run non-fatal version probes during dry-run and weaken the output claim
  from “no processes” to “no agent sessions.”

## 2. Run creation accepts the resolved path set

- **Packet:** `createRun(slug, init)` has no `ChoxPaths` argument even though run
  state must be created beneath the `paths` passed to `executeRun`.
- **Implementation:** `createRun` accepts an optional third `paths` argument, defaulting
  to `resolvePaths()` for callers that use the environment contract.
- **Why:** this preserves dependency injection and C10 isolation instead of silently
  ignoring the runner's selected home.
- **Revert:** remove the parameter and require every caller to synchronize
  `process.env.CHOX_HOME` before creating a run.

## 3. Linked-worktree exclude is configured per worktree

- **Packet:** append `.chox-run/` to `<worktree>/.git/info/exclude`.
- **Implementation:** linked worktrees have a `.git` *file*, not a directory. Chox
  enables Git's worktree config and points that worktree's `core.excludesFile` at an
  exclude file in the linked worktree gitdir containing `.chox-run/`.
- **Why:** writing the common repository's `.git/info/exclude` would leak a temporary
  run concern into every worktree and would require unsafe concurrent cleanup.
- **Revert:** append to the common `info/exclude` and add reference-counted cleanup.

## 4. Persist enough gate state to resume failures honestly

- **Packet:** the persisted gate contains only `{ hop, deviations }`, but a non-zero
  agent exit must resume to a blocking gate even when all artifacts exist.
- **Implementation:** the gate object also stores `blocking` and `exitCode`. The
  pre-hop footprint is stored in a sibling `footprint.json`, which §5.10 explicitly
  leaves to implementer judgment.
- **Why:** otherwise a crash/restart can turn a failed, blocking gate into an
  approvable one, violating process honesty (C7).
- **Revert:** add an `agent-failure` deviation kind instead and derive blocking from
  deviations, which would change the normative deviation union rather than gate
  persistence.

## 5. Codex flags follow the installed CLI

- **Packet suggestion:** `codex exec --json --full-auto`.
- **Verified locally:** Codex CLI `0.144.1` supports no `--full-auto` flag. The current
  equivalent used is `codex --sandbox workspace-write --ask-for-approval never exec
  --json -`, with the prompt supplied on stdin. Claude Code `2.1.207` still supports
  `-p --output-format stream-json --verbose --dangerously-skip-permissions`, matching
  the packet.
- **Why:** using a removed flag would make every Codex hop fail at startup. Workspace
  write scope is sufficient because each hop runs inside its isolated worktree.
- **Revert:** restore `--full-auto` if the supported Codex floor is pinned to a version
  that exposes it.

## 6. `challenge-notes.md` is a repeatable per-hop sidecar

- **Packet:** duplicate artifact names across hops are errors, while every challenge
  hop auto-produces the same fixed `.chox-run/challenge-notes.md` path. The example
  relay has two challenge hops, so the two rules cannot both hold literally.
- **Implementation:** duplicates remain errors for every ordinary artifact. The fixed
  challenge-notes sidecar may repeat across challenge hops; the runner clears it before
  each challenge attempt so an earlier hop's notes cannot satisfy a later hop.
- **Why:** this preserves the specified stable filename and actually enforces notes per
  challenge hop.
- **Revert:** define hop-qualified note filenames in the IR, such as
  `challenge-notes-hop-2.md`, and update the spec/template contract.

## 7. Loaded relays retain the invocation repo root

- **Packet:** `{{repo}}` must compile to the original repo root, but `LoadedRelay`
  contains only the relay directory and templates. A globally installed relay's
  directory cannot be used to reconstruct the invocation repo.
- **Implementation:** `LoadedRelay` also carries `repoRoot`, captured by `loadRelay`.
- **Why:** it makes placeholder resolution correct for both repo-local and global
  relays without ambient cwd state.
- **Revert:** add `repoRoot` as a separate `compileRelay` argument instead.

## 8. Execution plans are persisted per run

- **Packet:** `run.json` is the resume source of truth, but it does not contain the
  compiled plan. Reloading a hand-authored relay on resume can change hop indexes or
  prompts after a user edits that relay.
- **Implementation:** a new run stores its compiled `plan.json` beside `run.json`;
  resume executes that immutable plan rather than the current relay definition.
- **Why:** resume must continue the exact protocol and prompts the user originally
  approved, and this also preserves the F13 dry-run/real-run relationship.
- **Revert:** add the full plan to `run.json` itself, or declare relay definitions
  immutable while a run is active.

## 9. `doctor --bundle` is an explicit outside-home write

- **Packet:** F10 says Phase 1a writes nothing outside `~/.chox/` except Git
  mechanics, while §5.11 explicitly requires `doctor --bundle` to write
  `chox-doctor-bundle.json` in cwd.
- **Implementation:** the explicit `--bundle` action is treated as the narrow exception
  to F10. No other Chox-owned file is written outside the selected Chox home and Git
  worktree mechanics.
- **Why:** cwd placement is the more specific user-facing contract and happens only
  after the user requests the bundle.
- **Revert:** store bundles beneath `~/.chox/` and print that location instead.

## Additional packet review findings (handled without contract deviations)

- Relay template and artifact “filenames” are validated as basenames. Absolute paths,
  separators, and traversal are rejected so a relay cannot escape its directory or
  `.chox-run/`.
- Footprint snapshots include content identity, not only porcelain status. This lets a
  strict hop detect a second modification to a file that was already dirty before the
  hop.
- UTC run IDs use a filesystem-safe timestamp (no colons), required on Windows.
- C4–C6 artifact export surfaces remain intentionally uncovered in Phase 1a, as the
  packet requires; C6's deterministic branch collision behavior is covered here.
