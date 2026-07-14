# Phase 1c challenge notes

These notes record the Phase 1c packet review, intentional deviations, and
implementation judgments. They do not rewrite the historical specification or build
packets.

## Intentional deviations

### The repository-root smoke is rehearsed in a clean temporary repository

- The packet lists a source-root command using `spec-implement-review` with a task.
  This repository already contains a founder-owned repo-local relay with that slug;
  it intentionally shadows the built-in and, as a pre-1c relay, does not consume
  `{{task}}`. Q2 requires Chox to reject the task and name that template, while the
  founder checkpoint forbids modifying it. Making the literal source-root command
  pass would therefore violate either Q2, Q4 precedence, or the ownership rule.
- Verification runs the same built CLI and task command from a fresh temporary Git
  repository, where the read-only built-in is the correct winner. The literal
  source-root invocation is also checked and expected to produce the Q2 migration
  error; it is not misreported as a passing activation smoke.
- Revert path: once the founder independently adds `{{task}}` to his owned local
  relay or removes/renames that shadow, restore the literal source-root invocation as
  the manual smoke. No Chox code change is needed.

There are no other intentional deviations from Q1-Q10, the Phase 1c manifest, or
the inherited correctness requirements.

## Packet challenges considered and retained as written

### Task persistence stays in the compiled plan

- I considered adding a task field to `run.json` so resume could recover the input
  independently.
- That would create a second source of truth and an unnecessary persisted format
  change. The existing `plan.json` already owns the exact prompts used by resume, so
  Q3 is best satisfied by substituting once during compilation and retaining the
  current plan-only authority.
- Revert path: none needed; this follows Q3. If task metadata later needs a separate
  UI, add only a derived/redacted display field after defining its authority.

### Finding inspection metadata stays inside the finding payload

- I considered an additive substrate column for engine/model/spend inspection.
- The packet forbids schema work and the existing finding payload is already the
  versioned boundary for finding-specific evidence and drafted relay data. Phase 1c
  can enrich new payloads and render explicit "not recorded" values for older
  findings without rewriting them.
- Revert path: remove the optional inspection metadata and retain the legacy fallback
  renderer; no database migration is involved.

### Built-in discovery remains read-only package traversal

- The built-in root is located by walking from `import.meta.url` to the package's
  `package.json`, then resolving `relays/` beneath that root. This works in both the
  source tree and the packed installation without a writable cache or copied relay.
- Repository and global candidates stay ahead of that path, preserving the exact Q4
  precedence. Catalog commands enumerate those same roots instead of maintaining a
  second resolution policy.
- Revert path: replace the package-root walk with an explicitly injected built-in
  root if packaging later supplies one; keep the ordered candidate list unchanged.

### Packed verification drives the installed module with injected gate I/O

- A portable pseudo-terminal dependency would violate the zero-dependency rule. The
  packed verifier therefore imports the installed package's compiled CLI entry from
  the fresh prefix and injects the same `GateIO` boundary used by production and
  integration tests. It still uses the packed code, a temp Git repository, isolated
  homes, and fake binaries; interruption and resume exercise the persisted run and
  gate paths without a source-tree CLI import.
- Revert path: switch only the gate-driving layer to a platform-provided PTY if Chox
  later adopts one within the dependency and platform policy.

### npm state is isolated with the rest of the pack rehearsal

- `verify:pack` points npm's cache at the same temporary root used for the tarball and
  installation prefix. This prevents the verification command from depending on or
  mutating the developer's real npm cache and makes permission failures reproducible.
- Revert path: remove the temporary `npm_config_cache` override if npm later offers a
  stronger no-cache pack/install mode with the same isolation property.

### Installed bin dispatch compares real paths

- The first tarball rehearsal exposed that npm's global `bin` entry is a symlink.
  The previous direct string comparison between `process.argv[1]` and
  `import.meta.url` therefore skipped `main()` and exited silently when installed.
- The entrypoint now resolves both paths before deciding whether it was invoked as
  the executable. Direct `node dist/bin/chox.js` execution and test imports retain
  their existing behavior.
- Revert path: remove the realpath comparison only if packaging stops using a symlink
  and an installed-artifact test proves the replacement dispatch mechanism.

### Finding token usage is labeled at its honest scope

- The engine interface exposes cumulative detect-run token usage, while per-finding
  call counts are exact. Persisted inspection metadata therefore labels tokens as
  detect-run totals at the point of persistence instead of presenting them as a
  fabricated per-finding allocation.
- Revert path: add per-call/per-finding usage accounting at the engine boundary, then
  persist and render that narrower value.

## Scope boundaries deliberately preserved

- No relay IR/schema field is needed for task input; consumption is derived from the
  existing templates.
- No lens, source, engine, runtime, fixture, or substrate-schema edit is needed.
- Built-ins are never considered a write destination, and pre-1c installed relays
  are never migrated in place.
- The package name, version, `private: true`, and dependency sets remain unchanged.
