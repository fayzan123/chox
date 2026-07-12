# Phase 1a Build Packet — The Relay Runtime

**Status:** ready for implementation after PM review gate.
**Inputs (read both before writing code):** `docs/SPEC.md` (canonical; §2, §2.1, §2.2,
§2.5, §2.7, §4, §5.2, §5.4, §5.5, §6, §7, §8 Phase 1a), `docs/CORRECTNESS.md`
(referenced below as C1–C10).
**Implementer contract:** §10 of this packet. You run at autonomy level `challenge`
(SPEC.md §2.1). `docs/plans/challenge-notes-1a.md` is a required deliverable — absent
or empty means the work is incomplete.

---

## 1. Fixed decisions (restated from SPEC.md — not open to change)

| # | Decision | Source |
|---|----------|--------|
| F1 | TypeScript `strict`, ESM, NodeNext; single quotes, no semicolons, `.js` extensions on local imports | §4 |
| F2 | Node >= 22.13; build is `tsc` only; npm + lockfile | §4 |
| F3 | **Zero production dependencies in this phase.** (`croner` enters at Phase 3, `node:sqlite` at 1b.) Any production dep addition is a flag-level deviation | §4 dependency budget |
| F4 | CLI parsing via `node:util` `parseArgs`; no CLI framework | §4 |
| F5 | Agent CLIs are spawned directly (`claude -p`, `codex exec`); no bridge/MCP transport | §2.7 |
| F6 | Persistence is harness-owned: the harness writes/reads every inter-hop artifact; no hop depends on a model remembering anything | §2 principle 1 |
| F7 | Gates default to `all-boundaries`; unattended is per-run opt-in (`--unattended`) | §2 principle 3 |
| F8 | Autonomy semantics exactly per §2.1: `strict` (mechanical manifest diff; degrades to `challenge` with visible warning when no manifest), `challenge` (non-empty `challenge-notes.md` or the gate blocks and re-prompts), `autonomous` (log, don't block). Semantic review is always labeled **advisory** | §2.1 |
| F9 | Gate actions are single-keystroke **a**pprove / **e**dit / **r**edirect / a**b**ort; edit opens `$EDITOR`; redirect re-runs the producing hop with an appended user note; gates are resumable | §2.2 |
| F10 | Storage under `~/.chox/` per §5.5 (`runs/<slug>/`, `worktrees/`); DB and daemon files are later phases. Phase 1a writes **nothing** outside `~/.chox/` except git objects/branches in the user's repo (worktree mechanics) | §5.5, §7.6 |
| F11 | Run events are JSONL | §5 |
| F12 | Privacy contract §7 applies in full; doctor bundles redacted by construction, including dash-encoded home dir (C3) | §7.4 |
| F13 | `--dry-run` output and a real run derive from the **same compiled plan** — this is an acceptance criterion, so it must be true by construction, not by parallel code paths | §2.5, §8 |
| F14 | Tests: Vitest, real-FS temp dirs, fake agent binaries; never touching real `~/.chox`, `~/.claude`, `~/.codex` (C10); CI on Ubuntu + Windows × Node 22/24 from day one (C8) | §4 |

### PM decisions made for this packet (fixed unless you flag with rationale)

| # | Decision |
|---|----------|
| P1 | Runtimes live at `src/runtimes/` (`runtime.ts`, `claude.ts`, `codex.ts`). SPEC §6 places `engines/` (AnalysisEngine — Phase 1b) but never places AgentRuntime implementations; this is the placement |
| P2 | All Chox-home paths resolve through one module (`src/paths.ts`) honoring a `CHOX_HOME` env override — this is the test-isolation mechanism (C10) |
| P3 | Relay definitions are hand-authored directories (format: §4.1 below), resolved by slug: repo-local `.chox/relays/<slug>/` first, then `~/.chox/relays/<slug>/` |
| P4 | Runs are stored per-run under `~/.chox/runs/<slug>/<run-id>/` (still within §5.5's `runs/<slug>/`) |
| P5 | One git worktree per run at `~/.chox/worktrees/<slug>-<run-id>`, branch `chox/<slug>/<run-id>`, created from the HEAD of the repo `chox run` is invoked in. `chox run` requires cwd inside a git repo |
| P6 | Hop artifacts are written by the agent into `<worktree>/.chox-run/` (harness adds `.chox-run/` to the worktree's `.git/info/exclude`; footprint computation ignores it). Prompts reference artifacts by the stable relative path `.chox-run/<name>` — this is what makes F13 achievable |
| P7 | Teardown is uniform for completed and aborted runs: commit any outstanding worktree changes to the run branch, `git worktree remove`, keep the branch, print it with merge guidance. **Uncommitted agent work is never discarded** — orphan sweep (C9) uses the same commit-then-remove procedure |
| P8 | Prompts are delivered to agent CLIs via **stdin** with argv-array spawning — never a shell string, never a long prompt in argv (C1, Windows arg limits) |
| P9 | Relay export as `SKILL.md` is **out of scope** for 1a — it belongs to `chox install` (Phase 1b). The 1a compiler targets execution, not export |
| P10 | No hop timeouts in 1a. Recovery from a hung agent is Ctrl-C + `--resume` |
| P11 | `~/.chox/config.json` is not created or read in 1a; editor resolution is `$VISUAL` → `$EDITOR` → platform fallback (`notepad` on win32, `vi` elsewhere) |
| P12 | Exit codes: `0` run completed / doctor healthy; `1` run failed or aborted / doctor found problems; `2` usage error / relay validation error |

## 2. Scope

### In scope (SPEC §8 Phase 1a, minus scaffold which is already done)

- Relay IR + validation + loader + compiler (execution plan)
- Harness: runner, gates (§2.2), autonomy enforcement (§2.1), worktree isolation,
  run-event stream, run store with resume
- `claude` and `codex` AgentRuntime implementations
- `chox run <slug> [--dry-run] [--resume] [--unattended]`
- `chox doctor [--bundle]` with redaction
- An example relay committed at `.chox/relays/spec-implement-review/` encoding user
  zero's plan→implement→review loop (doubles as the dry-run smoke fixture)
- Tests per §7 of this packet

### Out of scope (do not build, stub, or "prepare for")

- Substrate: `src/substrate/*`, `schema.sql`, watermarks, anything `node:sqlite`
- Sources: `src/sources/*` (claude-code/codex transcript parsers)
- Fixtures: `fixtures/redact.ts`, generated fixtures
- Lenses (`src/lenses/*`), AnalysisEngine (`src/engines/*`), detection of any kind
- CLI: `chox detect`, `chox install`, `chox status`, `chox watch`
- Scheduler/notifier/daemon (`croner`, login items, `chox.pid`)
- Skill compiler, classify, `src/artifacts/export/*` (writer, conflict-detector,
  placement map), ownership markers — 1a writes nothing outside `~/.chox` (F10),
  so C5/C6 have no surface yet
- Relay→SKILL.md export (P9), relay composition via `skillRef` (§2.4 — parse and
  **reject** it with a clear "not supported until composition ships" error)
- npm publish, README marketing, app surface
- Shared-context file (§2 principle 4) — Phase 2

## 3. Execution model (normative walkthrough)

```
chox run <slug>
  → load relay (P3) → validate IR → compile → ExecutionPlan          [--dry-run stops
  → preflight runtimes used by the plan (actionable errors, §5.4)     here: print plan]
  → create run (run store) + worktree (P5) + events.jsonl
  → for each hop i:
      snapshot footprint → resolve prompt (already resolved in plan)
      → spawn runtime (P8) in worktree → stream normalized events to events.jsonl
      → verify declared artifacts exist in .chox-run/
      → autonomy checks (§5.7): deviations list (may auto-re-prompt once, challenge)
      → gate (unless gates 'none' or --unattended):
          present artifacts + summary lines + deviations
          a → snapshot artifacts to run dir, advance
          e → open artifact in $EDITOR, re-present
          r → re-run hop i with appended user note, re-present
          b → abort (uniform teardown, P7)
  → after final gate: mark completed, uniform teardown (P7), print branch + summary
```

A gate follows **every** hop, including the last (final gate = accepting the run).
Interruption at any point leaves `run.json` in a resumable state (§5.6).

## 4. Data formats (normative)

### 4.1 Relay definition on disk (hand-authored)

```
.chox/relays/<slug>/
  relay.json          # Relay object; promptTemplate values are filenames in this dir
  plan.md             # prompt template files, markdown
  implement.md
  review.md
```

`relay.json` matches SPEC §2's interfaces exactly:

```ts
interface Relay {
  slug: string                        // must equal the directory name
  repo?: string
  hops: RelayHop[]                    // >= 1
  gates: 'all-boundaries' | 'none'    // default 'all-boundaries' when absent
}
interface RelayHop {
  runtime: string                     // 'claude' | 'codex' (others: validation error)
  role: 'plan' | 'implement' | 'review' | 'fix' | string
  promptTemplate: string              // filename within the relay dir
  autonomy: 'strict' | 'challenge' | 'autonomous'
  produces: string[]                  // artifact filenames, e.g. 'spec.md'
  skillRef?: string                   // present → validation error (out of scope, §2)
}
```

### 4.2 Template placeholders

Resolved at compile time; unknown placeholders are a validation error, not silent
pass-through:

| Placeholder | Resolves to |
|---|---|
| `{{artifact:<name>}}` | `.chox-run/<name>` — compile-time error if `<name>` is not in any *earlier* hop's `produces` |
| `{{produces}}` | Comma-separated list of this hop's declared artifact paths (`.chox-run/<name>`), so templates can state their own output contract |
| `{{repo}}` | The original repo root path (informational; the hop's cwd is the worktree) |

Paths are relative and stable across runs — required for F13 (dry-run prompt text is
byte-identical to what the real run sends).

### 4.3 Strict-mode manifest (`manifest.json`, produced by a plan hop)

```json
{
  "files": {
    "create": ["src/foo.ts"],
    "modify": ["src/index.ts"],
    "delete": []
  },
  "commands": ["npm test"]
}
```

Paths are worktree-relative, forward slashes (normalize `\` on read — C8).

### 4.4 Run state (`~/.chox/runs/<slug>/<run-id>/run.json`)

```ts
interface RunState {
  runId: string
  slug: string
  repoRoot: string
  worktreePath: string
  branch: string
  status: 'running' | 'awaiting-gate' | 'completed' | 'aborted' | 'failed'
  currentHop: number                  // index into plan.hops
  gate?: { hop: number, deviations: Deviation[] }   // present when awaiting-gate
  createdAt: string                   // ISO
  updatedAt: string
}
```

Written atomically (write temp + rename). This file is the resume source of truth.

### 4.5 Run events (`events.jsonl`, one JSON object per line)

Every event: `{ ts: string (ISO), type: string, ...payload }`. Required types:

| type | payload |
|---|---|
| `run:start` | `slug, runId, worktreePath, branch, dryRun: false` |
| `hop:start` | `hop, runtime, role, autonomy` |
| `agent:event` | `hop, event` — normalized runtime event (§5.4) |
| `artifact:written` | `hop, name, path` |
| `deviation` | `hop, deviation` (§5.7 Deviation shape) |
| `gate:presented` | `hop, artifacts, deviationCount` |
| `gate:action` | `hop, action: 'approve'\|'edit'\|'redirect'\|'abort'` |
| `hop:end` | `hop, exitCode, durationMs` |
| `run:end` | `status` |

Unknown event types must be tolerated by the reader (forward compatibility, spirit
of C2).

## 5. Module breakdown

Interfaces below are the **public contract** between modules — deviations must be
flagged (§9). Internal helpers, private types, and decomposition beyond this list are
your call.

### 5.1 `src/paths.ts`

```ts
export interface ChoxPaths {
  home: string          // $CHOX_HOME or ~/.chox
  runs: string
  worktrees: string
  relays: string        // global relay dir: <home>/relays
}
export function resolvePaths(env?: NodeJS.ProcessEnv): ChoxPaths
export function ensureChoxHome(paths: ChoxPaths): Promise<void>  // mkdir -p the tree
```

Contract: every other module gets paths passed in or calls `resolvePaths` — no module
touches `os.homedir()` for Chox state directly. Edge: `CHOX_HOME` set but not
writable → actionable error. Applies: C10.

### 5.2 `src/slugify.ts`

```ts
export function slugify(input: string): string     // lowercase, [a-z0-9-], collapsed
export function isValidSlug(input: string): boolean
```

Used to validate relay slugs and build run ids (`<utc-timestamp>-<4 random hex>`).

### 5.3 `src/artifacts/ir.ts` + `src/artifacts/relay-loader.ts` + `src/artifacts/relay-compiler.ts`

```ts
// ir.ts — types from §4.1 plus:
export function validateRelay(raw: unknown, ctx: { slug: string }): Relay
// throws ChoxUsageError with ALL problems listed (not first-failure)

// relay-loader.ts
export interface LoadedRelay { relay: Relay, dir: string, templates: Map<string, string> }
export function loadRelay(slug: string, opts: { repoRoot: string, paths: ChoxPaths }): Promise<LoadedRelay>
// resolution order: <repoRoot>/.chox/relays/<slug>/ then <paths.relays>/<slug>/
// not found → error naming BOTH paths searched

// relay-compiler.ts
export interface CompiledHop {
  index: number
  runtime: string
  role: string
  autonomy: 'strict' | 'challenge' | 'autonomous'
  prompt: string                      // fully resolved, final text sent to the agent
  produces: string[]                  // relative paths: .chox-run/<name>
  gated: boolean
}
export interface ExecutionPlan { slug: string, hops: CompiledHop[] }
export function compileRelay(loaded: LoadedRelay): ExecutionPlan
export function renderPlan(plan: ExecutionPlan): string   // the --dry-run output
```

Behavior contract:
- Validation errors are batch-reported, exit code 2.
- `compileRelay` resolves all placeholders (§4.2); `{{artifact:x}}` referencing a
  not-yet-produced artifact is a compile error naming the hop and the artifact.
- `renderPlan` prints, per hop: index, runtime, autonomy, role, the artifacts it
  produces, whether a gate follows, and the **exact prompt text** (F13). Plus a
  header line stating no processes will be spawned.
- Edge cases: duplicate artifact names across hops (error); hop with empty
  `produces` (allowed — e.g. a pure review hop — but `challenge` autonomy still
  implies `challenge-notes.md`, see §5.7); template file missing (error naming the
  file); `skillRef` present (error per scope).

Applies: C4 is not yet in play (no frontmatter written in 1a) — note it in tests as
intentionally uncovered.

### 5.4 `src/runtimes/runtime.ts`, `claude.ts`, `codex.ts`

```ts
// runtime.ts — refines SPEC §5.2 AgentRuntime (PM-approved refinement)
export interface RunOpts { cwd: string, env?: NodeJS.ProcessEnv }
export interface RuntimeProbe { present: boolean, version?: string, problem?: string }
export type RuntimeEvent =
  | { kind: 'message', text: string }
  | { kind: 'command', command: string }       // tool/exec use, when the CLI reports it
  | { kind: 'raw', line: string }              // unrecognized stream line (kept, C2 spirit)

export interface AgentRuntime {
  id: string
  supportsSubagents: boolean
  preflight(): Promise<RuntimeProbe>
  spawnHeadless(invocation: string, opts: RunOpts): ChildProcess   // per SPEC §5.2
  normalizeEvents(stdout: NodeJS.ReadableStream): AsyncIterable<RuntimeEvent>
}
export function getRuntime(id: string): AgentRuntime               // registry
```

Behavior contract:
- **Spawning:** argv array via `child_process.spawn`, `shell: false`; prompt written
  to stdin then stdin closed (P8, C1). cwd = worktree.
- **claude:** headless `-p` mode with `--output-format stream-json --verbose`;
  suggested permission flag for the isolated worktree:
  `--dangerously-skip-permissions`. **Verify exact flags against the installed CLI**
  and record actuals in challenge notes if they differ.
- **codex:** `codex exec --json` with prompt on stdin; suggested sandbox flag:
  `--full-auto`. Same verify-and-record rule.
- **Preflight** runs before any spawn for every runtime the plan uses, and fails with
  an actionable install message naming the binary and where to get it — never a raw
  ENOENT (SPEC §5.4). `--dry-run` skips preflight hard-failure (prints a warning line
  for missing binaries instead).
- `normalizeEvents` maps each CLI's JSON stream to `RuntimeEvent`s; unparseable lines
  become `raw` events, never crashes (C2 spirit).
- Edge cases: binary present but `--version` fails (probe reports `problem`); agent
  exits non-zero (runner handles, §5.8); stream ends mid-JSON-line (tolerate).

Applies: C1, C7 (never report a hop as running without a live child process), C8.

### 5.5 `src/harness/run-events.ts`

```ts
export interface RunEventWriter { append(type: string, payload: object): void, close(): Promise<void> }
export function createEventWriter(eventsPath: string): RunEventWriter
export function readEvents(eventsPath: string): AsyncIterable<{ ts: string, type: string } & Record<string, unknown>>
```

Contract: append-only, one line per event, flushed promptly (a crash must not lose
more than the in-flight line). Reader tolerates unknown types and corrupt trailing
lines (crash artifact) — skips with a diagnostic count, never throws (C2 spirit).

### 5.6 `src/harness/run-store.ts`

```ts
export interface RunHandle { state: RunState, dir: string, events: RunEventWriter }
export function createRun(slug: string, init: Omit<RunState, 'status'|'currentHop'|...>): Promise<RunHandle>
export function saveState(handle: RunHandle, patch: Partial<RunState>): Promise<void>  // atomic (§4.4)
export function findResumableRun(slug: string, paths: ChoxPaths): Promise<RunHandle | undefined>
export function snapshotArtifacts(handle: RunHandle, hop: number, worktree: string, produces: string[]): Promise<void>
```

Contract:
- `findResumableRun` returns the most recent run with status `awaiting-gate` or
  `running`; `running` with a dead process is the crash case (no liveness check
  needed in 1a — if `--resume` finds `running`, the process is gone by definition
  since runs are foreground).
- `snapshotArtifacts` copies approved artifacts from `.chox-run/` into
  `<run-dir>/artifacts/hop-<n>/` **after** gate approval, so the audit copy is the
  approved (possibly user-edited) version.
- Edge cases: two resumable runs for one slug (pick newest, warn about the others);
  run dir exists but `run.json` unreadable (treat as failed, report in doctor).

Applies: C7, C10.

### 5.7 `src/harness/autonomy.ts`

```ts
export interface Deviation {
  kind: 'out-of-manifest-file' | 'unlisted-command' | 'missing-challenge-notes' | 'missing-artifact'
  advisory: boolean                  // true for command comparisons (see below)
  detail: string
}
export interface FootprintSnapshot { /* opaque: capture of git status at hop start */ }
export function snapshotFootprint(worktree: string): Promise<FootprintSnapshot>
export function checkAutonomy(opts: {
  hop: CompiledHop
  worktree: string
  before: FootprintSnapshot
  manifest?: StrictManifest          // most recent manifest.json from an earlier hop
  events: RunEventWriter
}): Promise<{ deviations: Deviation[], blocking: boolean, degradedToChallenge: boolean }>
```

Behavior contract (implements §2.1 exactly):
- **strict:** compare the hop's file footprint (`git status --porcelain` delta vs
  `before`, excluding `.chox-run/`) against `manifest.files`. Out-of-manifest
  creates/modifies/deletes → `out-of-manifest-file` deviations (mechanical, not
  advisory). Commands observed in `command` runtime events not matching a
  `manifest.commands` entry (exact or prefix match after trimming) →
  `unlisted-command` with `advisory: true` — command visibility depends on the CLI's
  event stream, so it is never presented as a guarantee. No manifest available →
  degrade to challenge semantics and set `degradedToChallenge` (runner prints the
  §2.1-required visible warning).
- **challenge:** `.chox-run/challenge-notes.md` must exist and be non-empty after
  trimming whitespace. The compiler auto-adds `challenge-notes.md` to the effective
  `produces` of every challenge hop. Missing/empty → the runner re-prompts the same
  hop **once** automatically with an explicit instruction to produce the file; still
  missing → blocking deviation at the gate (attended: user must redirect or abort;
  unattended: run fails).
- **autonomous:** compute the same deviations, write them all to events, never block.
- `missing-artifact`: any declared `produces` entry absent after the hop — blocking
  under strict/challenge, logged under autonomous.

Applies: C8 (path normalization in manifest comparison on Windows).

### 5.8 `src/harness/gates.ts`

```ts
export interface GateIO {                        // injectable for tests
  print(text: string): void
  readKey(prompt: string, allowed: string[]): Promise<string>
  openEditor(filePath: string): Promise<void>    // $VISUAL → $EDITOR → platform fallback (P11)
  readLine(prompt: string): Promise<string>      // for the redirect note
}
export type GateOutcome =
  | { action: 'approve' }
  | { action: 'redirect', note: string }
  | { action: 'abort' }
export function presentGate(opts: {
  hop: CompiledHop
  artifactPaths: { name: string, path: string, summary: string }[]  // summary: first heading or first non-empty line
  deviations: Deviation[]
  blocking: boolean
  io: GateIO
}): Promise<GateOutcome>
```

Behavior contract (implements §2.2 exactly — and remember gate ergonomics is the top
product risk, SPEC §9; keep the output tight, scannable, and fast):
- Presents: artifact paths + one summary line each, the deviation list (mechanical
  first, advisory clearly labeled `[advisory]`), and the `[a]pprove [e]dit
  [r]edirect a[b]ort` key row. When `blocking`, approve is not offered.
- `e`: if multiple artifacts, ask which; open in editor; re-present the gate after
  the editor exits (edits land in `.chox-run/`, which is what the next hop reads —
  F6/P6 make this automatic).
- `r`: prompt for a note; runner re-runs the hop with `\n\n## User redirect note\n`
  + note appended to the compiled prompt, then presents a fresh gate.
- Requires a TTY: if stdin is not a TTY and `--unattended` was not passed, `chox run`
  fails at startup with an actionable message (before creating the worktree).

### 5.9 `src/harness/isolation.ts`

```ts
export interface Worktree { path: string, branch: string, repoRoot: string }
export function createWorktree(opts: { repoRoot: string, slug: string, runId: string, paths: ChoxPaths }): Promise<Worktree>
export function teardownWorktree(wt: Worktree, opts: { commitMessage: string }): Promise<{ committed: boolean }>
export function sweepOrphans(slug: string, paths: ChoxPaths): Promise<{ swept: string[], warnings: string[] }>
```

Behavior contract:
- Create: `git worktree add -b chox/<slug>/<runId> <paths.worktrees>/<slug>-<runId>`
  from the repo's current HEAD; append `.chox-run/` to the worktree's
  `.git/info/exclude` (P6); never touch the repo's own `.gitignore`.
- Teardown (P7): `git add -A` + commit (only if changes exist) with a message naming
  the run, then `git worktree remove`; the branch survives. Print-ready result so the
  runner can tell the user exactly what branch holds their work.
- `sweepOrphans` (run at `chox run` start for the same slug; reported globally by
  doctor): a worktree dir whose run is terminal (`completed`/`aborted`/`failed`) or
  has no readable run.json is an orphan → same commit-then-remove; **never** plain
  deletion of a dir that may hold uncommitted work (C9 + P7). Also run
  `git worktree prune` on the repo afterwards.
- Edge cases: repo with no commits yet (error: worktrees need a HEAD — actionable
  message); branch name collision (append `-2`, deterministic — spirit of C6);
  worktree dir manually deleted by user (prune handles; warn, don't crash);
  spaces/unicode in repo paths (argv-array spawning of git, C1).

Applies: C1, C8, C9.

### 5.10 `src/harness/runner.ts`

```ts
export interface RunResult { status: 'completed' | 'aborted' | 'failed', runId: string, branch?: string }
export function executeRun(opts: {
  plan: ExecutionPlan
  repoRoot: string
  paths: ChoxPaths
  io: GateIO
  unattended: boolean
  resume?: RunHandle
}): Promise<RunResult>
```

Behavior contract: the §3 walkthrough is normative. Additionally:
- Agent non-zero exit: hop fails → gate is still presented (artifacts may be partial)
  with a failure banner; user can redirect (retry with note) or abort. Unattended:
  run fails.
- `--unattended` = skip gates (auto-approve non-blocking boundaries); blocking
  deviations fail the run. Relays with `gates: 'none'` behave identically. The §2.1
  challenge re-prompt still happens unattended (it re-prompts the *model*, not the
  user).
- Resume: `awaiting-gate` → re-present the persisted gate; `running` → re-run
  `currentHop` in the existing worktree (partial changes from the crashed attempt are
  acceptable in 1a; footprint deltas are computed from the persisted pre-hop
  snapshot, which must therefore live in run.json or a sibling file — your choice,
  flag if you change §4.4's shape). Worktree missing on resume → fail with guidance
  (`the run's worktree is gone; the branch chox/<slug>/<runId> may still hold work`).
- Ctrl-C (SIGINT): flush events, persist state, exit 130 — the run must be resumable
  after it (this is an acceptance criterion). Note SIGINT handling on Windows
  differs (C8) — test what's testable, document the rest.
- Every state transition is evented (§4.5) and persisted before the action it
  describes is user-visible (C7: never claim what hasn't happened).

### 5.11 `src/redact.ts` + `src/doctor.ts`

```ts
// redact.ts
export function redact(text: string, opts: { homeDir: string }): string
// replaces: raw home dir → '~', dash-encoded home dir (per SPEC A.1 encoding,
// '/'→'-' and '.'→'-') → '~(dash-encoded)', current username as a path segment

// doctor.ts
export interface Probe { name: string, ok: boolean, detail: string, critical: boolean }
export function runDoctor(opts: { paths: ChoxPaths, env: NodeJS.ProcessEnv }): Promise<Probe[]>
export function buildBundle(probes: Probe[], opts: { homeDir: string }): string  // redacted JSON
```

Probes (SPEC §5.4, adjusted to 1a): Node version >= 22.13 (critical);
`node:sqlite` importable (critical — it's the 1b floor, verify now); `claude`
binary present + version (non-critical, actionable message); `codex` binary present
+ version (non-critical); `~/.claude/projects` and `~/.codex/sessions` exist +
readable (non-critical, informational for 1b); `~/.chox` writable (critical);
orphaned worktrees / unreadable run dirs (non-critical, counts only); substrate:
fixed informational line "not initialized — ships in Phase 1b".

Bundle contract (§7.4, C3): **allowlist by construction** — the bundle serializes
only enumerated probe fields (name/ok/detail/versions/OS/counts), never prompt text,
shell commands, or raw filesystem paths; then a defense-in-depth `redact()` pass over
the serialized output. Bundle is written to `chox-doctor-bundle.json` in cwd and the
path printed. Exit codes per P12.

### 5.12 `bin/chox.ts` (replaces the scaffold stub)

Shebang `#!/usr/bin/env node`. `parseArgs` (F4) dispatch:
- `chox run <slug> [--dry-run] [--resume] [--unattended]`
- `chox doctor [--bundle]`
- `chox help` / `--help` / no args → usage; `--version` → package version
- Unknown command/flags → usage error, exit 2

Build note: after `tsc`, `dist/bin/chox.js` must carry the shebang; add a trivial
postbuild chmod +x guarded to POSIX (skip on win32) — SPEC §4 "marked executable".
The smoke command uses `node dist/bin/chox.js` so Windows needs no exec bit.

### 5.13 Example relay `.chox/relays/spec-implement-review/`

Three hops encoding user zero's loop (§2): `claude`/plan/`challenge` producing
`spec.md` + `manifest.json`; `codex`/implement/`challenge` (per §2: implementer runs
at challenge) producing implementation + `challenge-notes.md`; `claude`/review/
`autonomous` producing `review.md`. Templates must be **implementer-formatted** per
§2 principle 2 (the plan template demands structured task breakdown + the §4.3
manifest). This is committed to the repo and is the `--dry-run` smoke fixture.

## 6. CLI surface (exact — deviations must be flagged)

```
chox run <slug> [--dry-run] [--resume] [--unattended]
chox doctor [--bundle]
chox --version | --help
```

Nothing else. Adding flags = flag-level deviation.

## 7. Test requirements

### Global rules (all non-negotiable)

- Vitest. Real filesystem via `fs.mkdtemp` under `os.tmpdir()`; cleanup in
  `afterEach`. **Never mock `fs`** (C10).
- Every test sets `CHOX_HOME` to a temp dir (P2). No test may read or write real
  `~/.chox`, `~/.claude`, or `~/.codex` — add a test helper that resolves paths and
  throws if any resolved path is inside `os.homedir()`.
- **Fake agent binaries** for all harness/runtime tests: a temp `bin/` prepended to
  `PATH` containing fake `claude` and `codex` — a POSIX sh script plus a `.cmd` shim
  on Windows (C8), each delegating to a Node script that (a) emits a plausible JSON
  event stream to stdout, (b) writes declared artifacts into `.chox-run/`, and
  (c) exits with a scriptable code. Behavior scripted per-test via env vars or an
  instruction file. The real `claude`/`codex` binaries must never be spawned by tests.
- Gate tests drive `GateIO` with scripted responses — never a real TTY; editor tests
  point `$EDITOR` at a fake editor script that appends a marker line.
- Git tests create real repos (`git init` + config user + commit) in temp dirs.
- CI (already configured) is Ubuntu + Windows × Node 22/24 — write path handling
  and timing assertions to pass on both (C1, C8).

### Required coverage per module (minimum; structure is your call)

| Module | Must-cover |
|---|---|
| ir/loader/compiler | valid relay round-trip; batch validation errors; unknown placeholder; forward `{{artifact:}}` reference; duplicate artifact names; missing template file; `skillRef` rejection; repo-local shadows global resolution; `renderPlan` includes exact prompt text |
| runtimes | argv-array spawning (assert no `shell:true` anywhere — grep-level test is fine); prompt via stdin; normalizeEvents on valid, interleaved-garbage, and truncated streams; preflight missing binary → actionable message, no raw ENOENT |
| run-events | append/read round-trip; corrupt trailing line tolerated; unknown event type tolerated |
| run-store | create/save atomicity (no partial JSON after simulated crash — write-temp-rename); findResumableRun picks newest, warns on multiples; snapshot copies the post-edit artifact version |
| autonomy | strict: in/out-of-manifest create+modify+delete each; `.chox-run/` excluded from footprint; command match exact + prefix + advisory flag; no-manifest → degradedToChallenge; challenge: missing → blocking after one re-prompt (verify exactly one automatic re-prompt); empty-after-trim counts as missing; autonomous: deviations evented, never blocking; Windows path normalization in manifest compare |
| gates | each key action incl. blocking hides approve; edit → next hop receives edited content; redirect → re-run prompt contains appended note; non-TTY without --unattended fails before worktree creation |
| isolation | create+exclude entry; teardown commits dirty work and preserves branch; teardown with clean worktree (no empty commit); orphan sweep commits-then-removes and never discards uncommitted work; repo without HEAD; branch collision suffix |
| runner (integration) | full 2–3-hop run with fake binaries: events sequence, artifact flow hop→hop, gate at every boundary incl. final; --unattended path; agent non-zero exit → gate with failure banner; **interrupt-then-resume at a gate resumes at the same gate** (acceptance); resume of crashed `running` re-runs current hop; **--dry-run prompt text byte-equal to prompts the real run then sends** (acceptance, F13) |
| doctor/redact | probes on a fabricated env (fake binaries, fake source dirs); bundle contains no raw home path **and no dash-encoded home path** (C3 — assert both encodings absent); allowlist: bundle of a run-heavy home contains zero prompt text; exit codes |
| bin | usage errors exit 2; --version; unknown flag |

## 8. MANIFEST (machine-readable)

```yaml
manifest:
  create_or_replace:
    - bin/chox.ts                      # replaces scaffold stub
    - src/paths.ts
    - src/slugify.ts
    - src/redact.ts
    - src/doctor.ts
    - src/artifacts/ir.ts
    - src/artifacts/relay-loader.ts
    - src/artifacts/relay-compiler.ts
    - src/runtimes/runtime.ts
    - src/runtimes/claude.ts
    - src/runtimes/codex.ts
    - src/harness/run-events.ts
    - src/harness/run-store.ts
    - src/harness/isolation.ts
    - src/harness/autonomy.ts
    - src/harness/gates.ts
    - src/harness/runner.ts
    - .chox/relays/spec-implement-review/relay.json
    - .chox/relays/spec-implement-review/plan.md
    - .chox/relays/spec-implement-review/implement.md
    - .chox/relays/spec-implement-review/review.md
    - tests/**                         # structure at your discretion; scaffold.test.ts may be deleted
    - docs/plans/challenge-notes-1a.md # REQUIRED, non-empty (see §10)
  may_touch:
    - package.json                     # scripts only (e.g. postbuild chmod); deps changes must be flagged
  must_not_touch:
    - docs/SPEC.md
    - docs/CORRECTNESS.md
    - docs/plans/phase-1a-build-packet.md
    - src/substrate/ src/sources/ src/lenses/ src/engines/ src/artifacts/export/
  commands_that_must_pass:
    - npm run typecheck
    - npm test
    - npm run build
    - node dist/bin/chox.js doctor          # exit 0 or 1; readable report; never an uncaught exception
    - node dist/bin/chox.js run spec-implement-review --dry-run   # from repo root; exit 0; full plan printed; no processes spawned; works with no agent binaries installed
```

## 9. Judgment guidance

**Yours to decide (no flag needed):** internal decomposition beyond §5's public
interfaces; naming of internals and private types; test file structure and helpers;
error-message wording (as long as actionable); the opaque shape of
`FootprintSnapshot`; where the pre-hop snapshot persists for resume; gate output
formatting details (within §2.2's required elements).

**Flag in challenge-notes before/while deviating (any of these):** public interfaces
in §5; CLI surface (§6) — commands, flags, exit codes; storage layout under
`~/.chox/` (§4.4, P4–P7) or any write outside `~/.chox/` beyond git worktree
mechanics; on-disk formats (§4.1–§4.5); **any dependency addition, dev or prod**
(F3); anything touching the privacy contract (redaction, bundle contents, what gets
spawned or sent where); autonomy/gate semantics (§2.1/§2.2 are spec, not packet);
agent CLI flags that differ from §5.4's suggestions (record the actuals).

**Not asked for:** performance work, logging frameworks, config systems,
abstraction for hypothetical future runtimes beyond the `AgentRuntime` interface,
README content.

## 10. Implementer contract (autonomy: `challenge`)

1. **Critically review this packet before building.** You are expected to find
   problems — a spec-conformance issue, a cleaner interface, an edge case §5 missed.
   Where you can justify an improvement, deviate.
2. **Record every intentional deviation** in `docs/plans/challenge-notes-1a.md`:
   what you changed, what the packet/spec said, why yours is better, and what you'd
   revert if the PM disagrees.
3. If you have **zero** deviations, the file must still exist and contain: a
   statement that you reviewed the packet critically, the specific areas you
   considered deviating on and why you didn't, and anything you recommend for
   Phase 1b planning. An absent or empty file means the work is incomplete and will
   fail review.
4. Verified agent-CLI flags (per §5.4) are recorded there too, even when they match
   the suggestions.
5. Review criteria you'll be held to: manifest commands pass (§8), acceptance
   criteria (§11), CORRECTNESS.md items claimed by §5/§7 are actually covered by
   tests, no scope creep into §2's out-of-scope list.

## 11. Acceptance criteria (verbatim from SPEC.md §8 Phase 1a)

> *Accept:* user zero runs his next real feature through `chox run` with gates and
> prefers it to the manual bounce; a relay interrupted at a gate resumes cleanly;
> `--dry-run` output matches what a real run then does; doctor bundle verified
> redacted.

The first criterion is judged by user zero after delivery; the other three must be
demonstrated by tests in this packet (§7: runner interrupt-resume, F13 byte-equality,
doctor C3 assertions) **and** reproducible manually.
