# Phase 1c — Codex implementer handoff prompt

Paste everything below the rule into the Codex session (or reference this file).
The build packet is canonical; this prompt only sets the working contract around it.

---

You are the sole implementer for **Phase 1c of Chox** (taskable first run — the
installed-package activation gate). You are working in this repository on a fresh
branch.

## Read first, in this order

1. `docs/plans/phase-1c-build-packet.md` — the canonical instructions for this
   phase. Its fixed decisions (Q1–Q10), scope, module guidance, test
   requirements, and MANIFEST bind you. Where this prompt and the packet
   disagree, the packet wins.
2. The packet's listed inputs: `docs/ROADMAP.md` §8 (Milestone 1), §16, §19;
   `docs/SPEC.md` §2, §2.5, §5.4, §5.5, §7, §8 Phase 1c entry;
   `docs/CORRECTNESS.md` C1–C10; the 1a/1a.2/1b/1b.1 build packets (their fixed
   decisions still bind).

## Contract

- Autonomy level **`challenge`** (SPEC §2.1): review the packet critically
  against the roadmap, the spec, and the existing code *before* writing code.
  Every intentional deviation goes in `docs/plans/challenge-notes-1c.md` with
  rationale and a revert path — follow the format of `challenge-notes-1b1.md`.
  Absent or empty notes = the work is incomplete.
- Result handoff in `docs/plans/result-1c.md`, mirroring `result-1b1.md`:
  what was built, verification output, reviewer starting points, known gaps.
- Respect the packet's MANIFEST (§5): `must_not_touch` is hard; anything
  outside `create_or_replace`/`may_touch` needs a flag first. The packet's
  §7 "Flag first" list is the pause-and-ask channel — flag in your running
  notes and stop for input rather than guessing.

## Founder-in-the-loop checkpoints

1. **npm handle:** the package name stays `chox` with `private: true`. If any
   README/onboarding text needs the published install command, use a clearly
   marked placeholder (`<resolved-package-name>`) unless the founder has handed
   you the resolved handle. Never publish, rename, or un-private.
2. **Installed relays are the founder's:** `.chox/relays/**` in this repo and
   anything under a real `~/.chox` are untouchable. The migration path for
   pre-1c relays is the Q2 error message, not a rewrite.
3. **Final acceptance is founder-run:** the packet §6 clean-machine rehearsal is
   judged live by the founder after your work lands. Your mechanical stand-in is
   `npm run verify:pack` (Q10) — build it early so it can harden the journey as
   you go, not as a final chore.

## Hard rules to keep in view the whole time

- Task input is validated **before** any worktree or spawn exists (Q1); the same
  task bytes feed dry-run, real execution, and resume (Q3).
- `{{task}}` substitution happens in the compiler's existing single replacement
  pass — never a second pass over composed output (Q2).
- Built-ins are read-only; no code path writes into the package directory (Q4).
  Resolution order: repo-local → global → built-in.
- Zero production dependencies; `package.json` changes are limited to `files`
  and the `verify:pack` script.
- Tests never touch real `~/.chox`, `~/.claude`, `~/.codex` (C10 — use the
  existing isolation helpers and fake agent binaries).
- Ownership safety on every relay write (C5/C6); foreign directories produce
  warnings, never rewrites.
- `--json` outputs stay one valid JSON document on stdout; progress and notices
  go to stderr in JSON mode (1b precedent).
- Doctor bundles must never contain task text or compiled prompts; document
  that `~/.chox/runs/` does (Q3).

## Definition of done

- Every command in the MANIFEST's `commands_that_must_pass` passes locally and
  on CI (Ubuntu + macOS × Node 22/24) — including `npm run verify:pack`, the
  packed-tarball journey in an isolated prefix.
- All packet §4 test requirements are covered, including interrupt→resume with
  no task loss and the shadowing/precedence cases.
- `challenge-notes-1c.md` and `result-1c.md` are written and non-empty.
- Work is committed on the phase branch with incremental, reviewable commits;
  `.chox-run/` never appears in a commit.
