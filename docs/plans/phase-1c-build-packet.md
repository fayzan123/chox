# Phase 1c Build Packet — Taskable First Run

**Status:** ready for founder review (drafted 2026-07-14). Implementation starts only
after approval; this closes the Milestone 0 item "write and approve the Phase 1c
build packet" (ROADMAP §7).
**Why this phase exists:** the runtime and detection are proven on the founder's
machine, but nothing in §3.2 of the roadmap is true yet: no one can install Chox
without cloning the repo, no relay accepts a task without editing a Markdown
template, and the package contains no runnable starter. Phase 1c makes the flagship
useful from an installed package: `chox run <slug> --task-file <task.md>` on a clean
machine, with relays and findings discoverable and inspectable before anything runs.
**Inputs (read before code):** `docs/ROADMAP.md` §8 (Milestone 1 — this packet's
source of truth), §16, §19; `docs/SPEC.md` §2, §2.5, §5.4, §5.5, §7, §8 Phase 1c
entry; `docs/CORRECTNESS.md` C1–C10 (C5/C6 govern every relay write, C10 governs
every test); all fixed decisions from the 1a/1a.2/1b/1b.1 packets still bind.
**Contract:** autonomy `challenge`. Notes: `docs/plans/challenge-notes-1c.md`
(every intentional deviation with rationale + revert path; absent or empty =
incomplete). Result: `docs/plans/result-1c.md`.
**External dependency, not a blocker:** the npm handle decision and the two-week
detection window are founder-owned Milestone 0 work. Implementation proceeds with
the package name `chox` and `private: true` unchanged; publishing is a founder
action after the acceptance rehearsal passes, not part of this packet.

---

## 0. Gaps this phase closes (ROADMAP §3.2)

- **G1 — no task input.** `chox run` takes only a slug; the task lives hard-coded in
  relay templates ("Read the task/project brief…"), so every new task means editing
  relay source files — the exact anti-pattern §16.3 forbids.
- **G2 — no installable starter.** `package.json` ships `dist` + schema only; a
  fresh install has zero relays and no path to value without cloning the repo.
- **G3 — no discovery.** Relays are found by remembering slugs and filesystem
  paths; findings end at "install with: chox install <id>" with no way to inspect
  what would be installed before trusting it.
- **G4 — source-only onboarding.** The README quickstart starts at `npm ci`; there
  is no external activation journey, no per-command help, no uninstall/data story.

## 1. Fixed decisions

### Restated (binding, from SPEC + prior packets)

Zero production dependencies (1b F11); tests never touch real homes (F12/C10);
relay writes respect ownership markers and never overwrite foreign directories
(C5/C6); attended hops stay interactive-native (§2 pr. 6); model choice always
visible (§2 pr. 5); dry-run output is the exact real-run contract (§2.5); persisted
findings are never rewritten; `.chox-run/` stays out of implementation commits.

### PM decisions for this packet (fixed unless flagged with rationale)

| # | Decision |
|---|----------|
| Q1 | **Task flags (G1):** `chox run <slug> --task <text>` and `--task-file <path>`, mutually exclusive; both conflict with `--resume` (the persisted plan is authoritative on resume). Rejected before any worktree or spawn: empty/whitespace-only text, missing/unreadable/empty file, non-UTF-8 bytes (decode with `TextDecoder('utf-8', { fatal: true })`), and tasks over 1 MiB (error names the limit). Relative `--task-file` resolves against cwd. The task is read once; the same bytes feed dry-run, real execution, and resume |
| Q2 | **`{{task}}` placeholder (G1):** added to the compiler's existing single replacement pass in `src/artifacts/relay-compiler.ts` — never a second `.replace` over composed output, so task text containing `{{…}}` or braces cannot re-expand. A relay *consumes* a task iff any hop template contains `{{task}}`. Task supplied to a non-consuming relay → fail before worktree creation, naming the relay's own template file the user may edit (their file, their edit — Chox never rewrites an installed relay, C5). Task-consuming relay with no task → fail listing the exact flags. Relays without `{{task}}` stay valid and runnable |
| Q3 | **Persistence & parity (G1):** compiled prompts already persist per-run in `plan.json` (`src/harness/run-store.ts`) — resume parity comes from there; dry-run must render byte-identical prompts to what `plan.json` would hold. Document that `~/.chox/runs/` contains compiled prompt/task text, distinct from the metadata-only substrate DB; `doctor --bundle` must contain neither |
| Q4 | **Built-in starter (G2):** a canonical `spec-implement-review` (same proven shape as the founder's: claude/plan/`challenge` → codex/implement/`autonomous` → claude/review/`strict`) ships in the package under a new top-level `relays/` directory, added to `package.json` `files`. Its plan-hop template embeds `{{task}}`; no template instructs the user to edit anything before a run. Resolution order in `src/artifacts/relay-loader.ts`: repo-local `.chox/relays/` → `~/.chox/relays/` → built-in (package-relative). Built-ins are read-only — no Chox code path writes into the package directory; copy/customize is Phase 1d |
| Q5 | **Drafted relays become taskable (G1):** `src/artifacts/draft-relay.ts` guarantees the first applicable hop consumes `{{task}}` deterministically — if the engine's drafted template lacks it, the drafter injects a harness-owned task section rather than trusting engine prose (persistence is harness-owned, §2 pr. 1). Already-installed pre-1c relays are untouched; the Q2 failure message is their migration path |
| Q6 | **Agent preflight (G2):** before the first real spawn of a run, verify the required runtime binaries for the whole plan and fail with a per-runtime install/recovery message, never a raw ENOENT. Dry-run needs no binaries |
| Q7 | **`chox relay list` / `chox relay show <slug>` (G3):** `list` shows slug, source (repository/global/built-in), hop count + runtime sequence, gate posture, whether a task is required, and the winner when a slug is shadowed. `show` prints a compact workflow summary (hops, roles, runtimes, models, autonomy, gates, artifacts, task requirement, provenance) by default and full prompt text only behind `--prompts`. Both support `--json` (stdout stays one JSON document, 1b precedent). No other `relay` subcommands this phase |
| Q8 | **Finding inspection (G3):** interactive detect gains `[v]iew` before the existing `[i]nstall [d]ismiss [s]kip` (view renders then re-asks); non-interactive equivalent `chox finding show <finding-id>` works for suggested, covered, subsumed, and dismissed findings. Both show evidence, proposed roles/runtimes/autonomy/gates/artifacts, and prompt summaries, with full prompts behind `--prompts`; engine id, model, ceiling, and actual spend stay visible. Install ends with the exact next command — `Next: chox run <slug> --task-file <task.md> --dry-run` (task flag included only when the relay consumes one). Covered findings point to `chox relay show <slug>` plus the same runnable next command instead of ending at "already automated" |
| Q9 | **Onboarding (G4):** README leads with the installed-package quickstart (source build moves below it); the package name renders as the resolved handle if the founder has decided, else a clearly marked placeholder — publishing stays blocked either way until the rehearsal passes. The privacy boundary is stated immediately before the `detect` step. Per-command help (`chox <cmd> --help`) exists for `run`, `detect`, `relay`, `finding`, `doctor`, `status`. Uninstall/data-removal docs distinguish package, global relays, run records, substrate, and preserved Git branches. Terminology stays task-first (§16.6). The clean-install terminal demo is founder-recorded after acceptance, not implementer work |
| Q10 | **Packed-artifact verification (G2):** a `verify:pack` npm script packs the real tarball, installs it into a fresh temporary prefix outside the source checkout with isolated `CHOX_HOME`/agent homes and fake agent binaries, and drives doctor → relay list/show → dry-run with a task file → run start → gate interrupt → resume. This is the mechanical form of the exit gate and joins the handoff commands |

## 2. Scope

**In:** Q1–Q10; test additions below; README/ONBOARDING rewrite per Q9;
`package.json` changes limited to `files` (built-in relays) and the `verify:pack`
script.
**Out (do not build or stub):** generic relay parameter schemas (one real input
proves the contract first); `relay copy/validate/remove` (Phase 1d); review→fix
loops or conditional graphs (1d); new sources/engines/runtimes/lenses; scheduled
scans/daemon; TUI or app; publishing, package rename, un-privating, version bump,
or any new dependency.

## 3. Module guidance (internals your call)

- Q1 parsing/validation in `bin/chox.ts` (`parseRun`); keep validation ahead of
  `executeRun` so no worktree exists on rejection.
- Q2 in `src/artifacts/relay-compiler.ts` (`compileRelay` gains a task option;
  task-consumption detection can read the loaded templates). Q4's third candidate
  in `src/artifacts/relay-loader.ts`; package-root resolution may mirror
  `packageVersion()`'s walk-up.
- Q5 in `src/artifacts/draft-relay.ts`. Q6 near the spawn boundary in
  `src/harness/runner.ts` or a preflight in `bin/chox.ts` — implementer's call.
- Q7/Q8 command surface in `bin/chox.ts`; rendering helpers may live beside the
  loader. Q8's `[v]iew` extends the existing `readKey` action set in the detect
  flow.
- Built-in starter content under `relays/spec-implement-review/` mirrors the
  founder's proven templates with `{{task}}` replacing the hard-coded brief; keep
  the implementer-formatted output contract (SPEC §2 pr. 2).

## 4. Test requirements

1b rules carry over (real temp FS, fake agent binaries, C10 guard, isolated homes).

- **Q1:** multiline/Unicode/long tasks; special characters including `{{`/`}}` and
  JSON-hostile text landing intact in compiled prompts and `plan.json`; relative
  and absolute `--task-file`; empty text/file, unreadable file, invalid UTF-8, over
  1 MiB, `--task` + `--task-file`, task + `--resume` → usage errors with no
  worktree created.
- **Q2/Q3:** task-consuming relay without a task fails naming both flags; task to
  a non-consuming relay fails with migration guidance before worktree creation;
  dry-run prompt bytes equal the real run's persisted `plan.json` prompts; a run
  interrupted at a gate resumes with the identical compiled plan and no task loss.
- **Q4:** fresh isolated home resolves the built-in; a repo-local or global relay
  with the same slug shadows it; built-in directory is never written; the starter's
  dry-run with a task compiles with no unknown placeholders.
- **Q5:** a drafted relay whose engine output omits `{{task}}` still installs with
  a task-consuming first hop.
- **Q6:** plan requiring a missing runtime binary fails preflight with the recovery
  message before any spawn; dry-run succeeds without binaries.
- **Q7/Q8:** list/show/finding-show human and `--json` outputs (one JSON document
  on stdout); shadowing reported; `[v]iew` renders and re-prompts; install prints
  the exact next command; covered findings print the relay-show pointer.
- **Q10:** the packed-tarball journey (fresh prefix, no prior Chox home, fake
  agents, real task file) passes end-to-end, including interrupt/resume; doctor
  bundle from that journey contains no task text or compiled prompts; `.chox-run/`
  absent from implementation commits.

## 5. MANIFEST

```yaml
create_or_replace:
  - docs/plans/challenge-notes-1c.md
  - docs/plans/result-1c.md
  - relays/spec-implement-review/**          # the packaged built-in starter
may_touch:
  - bin/chox.ts
  - src/artifacts/** src/harness/** src/errors.ts src/paths.ts
  - src/status.ts src/doctor.ts
  - package.json                              # files + verify:pack script ONLY
  - README.md docs/ONBOARDING.md tests/** scripts/**
must_not_touch:
  - docs/SPEC.md docs/CORRECTNESS.md docs/ROADMAP.md docs/plans/phase-*-packet.md
  - fixtures/** src/substrate/schema.sql      # no schema change this phase
  - src/lenses/** src/engines/** src/sources/**   # detection is closed; flag if Q8
                                              #   truly needs a read-only helper here
  - .chox/relays/**                           # founder's installed relay is his
  - package name, private flag, version, dependencies
commands_that_must_pass:
  - npm run typecheck && npm test && npm run build
  - npm run verify:pack                       # Q10 packed-artifact journey
  - node dist/bin/chox.js run spec-implement-review --task-file <tmp task.md> --dry-run
  - node dist/bin/chox.js relay list && node dist/bin/chox.js relay show spec-implement-review
  - node dist/bin/chox.js detect --no-confirm --json   # sandbox home: exit 0, valid JSON
  - node dist/bin/chox.js status && node dist/bin/chox.js doctor
```

## 6. Acceptance

A clean-machine rehearsal (fresh temp prefix, no source checkout on `PATH`, no
prior Chox home) must demonstrate, in order:

1. package installation from the packed tarball without the source repository;
2. `chox doctor` giving accurate guidance;
3. discovery and inspection of the starter relay (`relay list`, `relay show`);
4. a real task supplied from a file;
5. an exact dry-run preview of that task's compiled prompts;
6. the same task reaching the first native agent session;
7. an interrupted run resuming with the same compiled plan; and
8. zero relay-source edits anywhere on the path.

Founder judgment on the rehearsal is the gate (same standard as 1a.2/1b.1: judged
live, not on tests alone). Publishing and the alpha recruitment happen only after
this passes and remain founder actions outside this packet.

## 7. Judgment guidance

**Yours:** flag parsing internals; task-validation error wording; list/show table
formatting and summary layout; built-in template prose (within Q4's shape);
preflight placement; pack-test structure and helper scripts.
**Flag first:** any new flag beyond `--task`, `--task-file`, `--prompts`, `--json`
on the new subcommands; any `package.json` change beyond `files` + one script; any
IR/`relay.json` schema field; touching lenses/engines/sources; any write into the
package or a foreign relay directory; anything that would make built-ins writable.
**Not asked for:** parameter schemas, relay lifecycle beyond list/show, config
files, stdin task input, progress spinners, publish automation.
