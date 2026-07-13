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

## 1a.2 — 2026-07-13

The 1a.2 packet was reviewed against the amended `SPEC.md`, the current
`b793123` resume implementation, both installed CLI parsers, and the first-run UX
findings before implementation. The notes below record the compatibility choices,
on-disk clarification, and delegated judgment made for this phase.

### 10. Legacy persisted plans keep their original headless behavior

- **Packet:** a missing `RelayHop.interaction` compiles to `interactive`.
- **Implementation:** newly compiled plans follow that rule. A persisted 1a
  `plan.json` with no `interaction` field is normalized to `headless` only while
  resuming that existing run.
- **Why:** every 1a plan was compiled and executed headlessly. Reinterpreting an
  in-flight persisted plan as interactive would violate the stronger resume rule:
  resume executes the exact persisted plan and must not silently change execution
  semantics after an upgrade.
- **Revert:** reject legacy plans with upgrade guidance, or reinterpret the missing
  field as `interactive` and accept that old resumes change mode.

### 11. Run state records the base commit used by the visibility summary

- **Packet:** the completion summary reports the overall file footprint versus the
  base commit, but the inherited 1a `RunState` does not retain that commit.
- **Implementation:** new runs persist optional `baseCommit` in `run.json`, and
  `Worktree` carries it from creation. Old runs derive a best-effort merge base on
  resume. The summary diffs tracked, committed, and uncommitted changes plus
  untracked files against this commit before teardown.
- Per-hop `footprint.json` snapshots now also retain the hop-start `HEAD` and Git
  blob identities for dirty paths. This keeps files committed during a native
  session visible without re-attributing unchanged dirt from an earlier hop. A
  legacy snapshot without that metadata falls back visibly to the current retry
  baseline rather than manufacturing a delta.
- **Why:** a final `git status` cannot see changes an agent committed during its
  native session. Persisting the actual worktree origin makes the summary honest and
  stable even if the invocation repo advances during a long gated run.
- **Revert:** remove `baseCommit` and calculate a merge base at completion, with the
  acknowledged risk that concurrent branch movement changes the reported baseline.

### 12. Installed CLI flags and prompt forms were verified

Verified locally on 2026-07-13:

- **Claude Code 2.1.207:** interactive accepts
  `claude [--model <m>] <prompt>`; headless accepts
  `claude -p --output-format stream-json --verbose
  --dangerously-skip-permissions [--model <m>]`. The interactive adapter uses
  inherited stdio and deliberately passes no permission-bypass flag. Both exact
  flag compositions returned exit 0 under a `--version` parser probe.
- **Codex CLI 0.144.1:** interactive accepts
  `codex [--model <m>] <prompt>`; headless accepts
  `codex [--model <m>] --sandbox workspace-write --ask-for-approval never exec
  --json -`, where `-` reads the prompt from stdin. The interactive adapter passes
  neither an approval override nor a sandbox override. Both exact flag compositions
  returned exit 0 under a `--version` parser probe; `codex exec --help` explicitly
  documents `--json`, `--model`, and stdin via `-`.
- Interactive prompts therefore travel as one argv element as the 1a.2 packet
  requires, while headless prompts remain on stdin. This is intentionally bounded by
  macOS/Linux `ARG_MAX`; no alternate bridging protocol was added.

The normalizers handle Claude model metadata on init/assistant events and aggregate
usage on result events, plus Codex usage on `turn.completed` and model metadata when
a thread/session event supplies it. When a CLI does not report the resolved
configured model, Chox continues to display and event `CLI default` rather than
guessing from vendor configuration.

### 13. Manifest command observations remain enabled across eligible hops

- **Delegated judgment (FIX-5):** command comparison remains enabled for every
  strict/autonomous hop when a manifest is available, matching the established 1a
  autonomy semantics. The gate now shows at most two advisory observations and
  points to `events.jsonl` for the rest.
- **Why:** the current manifest has no owner-hop identifier, roles are open strings,
  and review/fix hops may legitimately execute the manifest's verification commands.
  Guessing that only a role literally named `implement` owns commands would silently
  weaken observation. The new collapse removes the user-facing noise without
  discarding the audit data.
- **Revert:** restrict comparison to selected role strings, or add explicit manifest
  ownership metadata in a later IR phase.

### Additional 1a.2 review findings (handled without contract deviations)

- The completion hang was the terminal gate leaving stdin in flowing mode after a
  raw key read. Every key, invalid key, interrupt, line read, editor launch, and
  native-session launch now removes listeners, restores raw mode, and pauses stdin.
  The heartbeat timer is cleared and unreferenced as a second process-egress guard.
- Headless progress prints once immediately after the child emits `spawn`, then at
  five-second TTY intervals or thirty-second non-TTY intervals. Interactive sessions
  emit no Chox heartbeat while the native UI owns the terminal.
- Usage summaries preserve the CLIs' reported input, cached-input, output, and total
  fields rather than inventing a cross-vendor total with incompatible cache
  semantics. Interactive usage is explicitly `n/a (interactive session)`; missing
  headless usage is `n/a (not reported)`.
- No dependency, CLI flag, future-phase stub, model pin in the example relay, or
  native-Windows support was added.
