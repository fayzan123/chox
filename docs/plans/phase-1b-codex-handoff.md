# Phase 1b — Codex implementer handoff prompt

Paste everything below the rule into the Codex session (or reference this file).
The build packet is canonical; this prompt only sets the working contract around it.

---

You are the sole implementer for **Phase 1b of Chox** (substrate + handoff
detection — the demo gate). You are working in this repository on a fresh branch.

## Read first, in this order

1. `docs/plans/phase-1b-build-packet.md` — the canonical instructions for this
   phase. Its fixed decisions (F1–F13, P1–P14), scope, module contracts, test
   requirements, and MANIFEST bind you. Where this prompt and the packet
   disagree, the packet wins.
2. The packet's listed inputs: `docs/SPEC.md` §1.2, §2.3, §2.5, §2.6, §5, §7,
   §8 Phase 1b, Appendix A + A.3; `docs/CORRECTNESS.md` C1–C10; the 1a/1a.2
   build packets (their fixed decisions still bind).

## Contract

- Autonomy level **`challenge`** (SPEC §2.1): review the packet critically
  against the spec, the code, and the live CLIs *before* writing code. Every
  intentional deviation goes in `docs/plans/challenge-notes-1b.md` with
  rationale and a revert path — follow the format of `challenge-notes-1a.md`.
  Absent or empty notes = the work is incomplete.
- Result handoff in `docs/plans/result-1b.md`, mirroring `result-1a.md`:
  what was built, how to run it, reviewer starting points, known gaps.
- Respect the packet's MANIFEST (§6): `must_not_touch` is hard; anything
  outside `create_or_replace`/`may_touch` needs a flag first. The packet's
  §8 "Flag first" list is the pause-and-ask channel — flag in your running
  notes and stop for input rather than guessing.

## Founder-in-the-loop checkpoint (fixtures)

Committed fixtures must be output of `fixtures/redact.ts` run **by the founder**
against his real `~/.claude`/`~/.codex` (F10, P12). You never read the real
homes and never run the redactor against them. Sequence accordingly:

1. Build `fixtures/redact.ts` + its synthetic-input tests **early**.
2. Stop and hand it to the founder to run locally; develop sources/lens against
   synthetic fixtures in the meantime.
3. When his redacted output lands, verify the redaction invariants (C3: no raw
   or dash-encoded home paths, no usernames, no over-long prompt text) with the
   redactor's own checks before committing it, then re-point the fixture-driven
   tests at the committed set.

The F9 originator verification (what `originator` a Chox-spawned headless codex
run produces) may require one real `codex exec` in a temp `CODEX_HOME` sandbox —
keep it to a single minimal invocation and record the observed string in the
challenge notes.

## Hard rules to keep in view the whole time

- Zero production dependencies (F11); `node:sqlite` is builtin.
- Tests never touch real `~/.chox`, `~/.claude`, `~/.codex` (C10 — use the
  existing `CHOX_HOME`-style isolation helpers).
- The DB stores metadata + derived digests only, never raw content (F2).
- `package.json` keeps `private: true`; no publish, no placeholder publish
  (F13/P13 — the founder flips it after verifying the npm handle).
- Engine spend is visible and skippable (P14); parse failures are per-source
  diagnostics, never scan-fatal (F4); no-findings output is honest per §2.6.

## Definition of done

- Every command in the MANIFEST's `commands_that_must_pass` passes locally and
  on CI (Ubuntu + macOS × Node 22/24).
- The demo-gate rehearsal integration test (packet §5, last bullet) is green.
- `challenge-notes-1b.md` and `result-1b.md` are written and non-empty.
- Work is committed on the phase branch with incremental, reviewable commits;
  nothing under `fixtures/raw/` is ever committed.
