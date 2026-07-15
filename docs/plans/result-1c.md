# Phase 1c result

Implemented taskable first run Q1-Q10 without changing the relay IR/schema,
substrate schema, detection lens/source/engine/runtime code, dependency sets, package
name/version/private flag, or any founder-owned relay.

The implementation now:

- accepts mutually exclusive `run --task` / `--task-file`, validates UTF-8 and the
  1 MiB boundary before worktree creation, detects task consumption, and substitutes
  `{{task}}` inside the compiler's existing single pass;
- preserves task-bearing compiled prompts in the existing `plan.json` authority, so
  dry-run, real execution, gate interruption, and resume stay byte-consistent;
- ships a read-only `spec-implement-review` starter and resolves relays in repository
  → global → built-in order without any package-directory write path;
- makes every newly drafted relay taskable in its first hop while leaving installed
  pre-1c relays untouched;
- exposes `relay list`, `relay show`, and `finding show` with summary-first human
  output, opt-in full prompts, JSON-safe stdout, provenance/shadowing, task posture,
  evidence, workflow details, and honestly scoped engine spend;
- adds interactive finding `[v]iew`, runnable post-install/covered next commands, and
  command-specific help for the required command families;
- leads README/onboarding with the installed activation journey, the unresolved npm
  placeholder, the detect privacy boundary, task-bearing run storage, and separate
  package/data/branch removal guidance; and
- packs and installs the real artifact into a fresh prefix for an end-to-end journey
  with isolated npm/Chox/agent homes, fake binaries, task dry-run, first agent spawn,
  gate interruption, persisted resume, doctor-bundle privacy, and built-in hashing.

The first packed run caught and fixed an installed-only activation defect: npm's
global `chox` entry is a symlink, so the previous unresolved entrypoint comparison
silently skipped `main()`. Installed dispatch now compares real paths.

## Verification

```text
npm run typecheck && npm test && npm run build        pass (28 files, 185 tests)
npm run verify:pack                                  pass
isolated built-in task-file dry-run                  exit 0; exact task present
isolated relay list/show                             exit 0; built-in provenance
isolated detect --no-confirm --json                  exit 0; one JSON document
isolated status                                      exit 0
isolated doctor                                      exit 0
git diff --check                                     pass
implementation commit manifest review                pass; no forbidden paths
.chox-run/ in implementation commits                 absent
```

The packed verifier additionally asserted three real fake-agent invocations across
interrupt/resume, no reread of a changed task file, no task or compiled prompt in the
post-run doctor bundle, no source-checkout path on the installed journey `PATH`, and
no byte change under the packaged built-in relay directory.

The literal source-root task smoke is the one intentional verification exception:
it exits 2 with the required Q2 migration message because the founder-owned
repo-local `spec-implement-review` is a pre-1c shadow. The identical built CLI/task
command exits 0 from a clean temporary Git repository and in `verify:pack`. Details
and the revert path are in `challenge-notes-1c.md`.

## Reviewer starting points

1. `bin/chox.ts`, `src/artifacts/relay-compiler.ts`, and
   `tests/cli/run-task.integration.test.ts` for Q1-Q3 parsing, validation,
   single-pass compilation, parity, and resume.
2. `src/artifacts/relay-loader.ts`, `src/artifacts/relay-catalog.ts`, and
   `relays/spec-implement-review/` for Q4/Q7 precedence, provenance, discovery, and
   read-only starter content.
3. `src/artifacts/draft-relay.ts`, `src/artifacts/finding-inspection.ts`, and the
   detect/finding CLI tests for Q5/Q8 taskable drafts, view/re-prompt, prompt
   disclosure, JSON channels, next commands, and legacy findings.
4. `src/harness/runner.ts` (unchanged) plus its new preflight test for Q6's existing
   whole-plan preflight boundary.
5. `scripts/verify-pack.mjs` and `package.json` for Q10's real packed-artifact
   installation and journey.
6. `README.md`, `docs/ONBOARDING.md`, and
   `docs/plans/challenge-notes-1c.md` for Q9 and the implementation judgments.

## Known gaps and founder gates

- The packet's clean-machine live rehearsal remains founder-run acceptance. This
  result provides the passing mechanical stand-in but does not claim the live gate.
- The npm handle is unresolved. Documentation deliberately retains
  `<resolved-package-name>`; `name: "chox"` and `private: true` are unchanged, and
  nothing was published.
- The founder-owned repo-local starter shadow remains non-taskable by design. Chox
  reports its exact template migration path and never rewrites it. The founder may
  independently add `{{task}}`, rename it, or remove it when ready.
- Per-finding call counts are exact. Token totals exposed by the current engine
  contract are cumulative for the detect run and are labeled as such rather than
  falsely allocated per finding.

## Deferred product finding (recorded 2026-07-14, live rehearsal)

During the packet §6 clean-machine rehearsal, running the real three-hop plan on a
genuine task, the founder judged that model selection across the relay feels
under-controlled: every hop displayed `Model: CLI default`, and there is no lever to
choose a model for a run without either setting the underlying CLI's own environment
variable for the whole invocation or hand-editing a relay's `hop.model` field — the
latter impossible for the packaged (read-only) built-in.

This is not a Phase 1c regression. Per-hop model pinning (`RelayHop.model`, passed as
the runtime's `--model` flag, always surfaced in dry-run/banner/events) shipped in
Phase 1a.2 (SPEC §2, principle 5 amendment); Phase 1c's scope was task input, the
built-in starter, discovery, and onboarding, and did not touch model routing. The
founder-owned installed relay and the new built-in both leave every hop unpinned by
design (Q4 mirrors the founder's proven shape), which is why the gap was only visible
once a real run was rehearsed end to end.

**Founder decision:** defer. Not a merge/publish blocker for Phase 1c. Candidate for
either a small standalone `chox run --model <name>` override (symmetric with the
existing `detect --model`) or Phase 1d's gate-ergonomics work (`docs/ROADMAP.md`
Milestone 3, Step 4) — scoping that choice is future work, not part of this result.

## Founder acceptance

**ACCEPTED (2026-07-14).** The founder ran the packet §6 live clean-machine
rehearsal end to end from a packed, isolated install: doctor, relay discovery
(`relay list`/`show` resolving the built-in with correct provenance), a real task
from an external repository supplied via `--task-file`, an exact dry-run preview
with the task substituted verbatim, and the first native interactive agent session
opening inside the isolated worktree with that compiled prompt. The one finding
from the rehearsal (model-selection control, above) is recorded and explicitly
deferred by founder decision rather than blocking this result. Publishing and alpha
recruitment follow per `docs/plans/phase-1c-rehearsal-playbook.md` Steps 5-8.

## Post-phase release record

The known gaps above record the state at the Phase 1c implementation handoff and are
intentionally not rewritten. The later handle decision, publish, and post-publish
verification are recorded in `docs/plans/result-0.1.0-publish-audit.md`.
