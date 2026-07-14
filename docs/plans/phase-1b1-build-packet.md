# Phase 1b.1 Build Packet — Detection Hardening (Demo Gate, second pass)

**Status:** ready for implementation after PM review gate (reviewed 2026-07-13).
**Why this phase exists:** the first live acceptance run passed the demo gate
*mechanically* (loop found, confirmed, installed, dry-run compiles) but failed it
*semantically*: the founder judged the drafted relay's roles not comparable to his
actual workflow, and hand-editing a generated relay defeats the product's purpose.
The 1b demo gate stays open until `chox detect` produces a draft that needs no
semantic correction — editing must be optional taste, not repair.
**Inputs (read before code):** `docs/SPEC.md` §2.3, §2.5, §2.6, §8 Phase 1b/1b.1;
`docs/plans/phase-1b-build-packet.md` (all its fixed decisions still bind);
`docs/plans/challenge-notes-1b.md`; `docs/CORRECTNESS.md` C1–C10.
**Contract:** autonomy `challenge`. Notes: `docs/plans/challenge-notes-1b1.md`
(every intentional deviation with rationale + revert path; absent or empty =
incomplete). Result: `docs/plans/result-1b1.md`.

---

## 0. Evidence from the acceptance run (what we are fixing)

- **E1 — self-detection.** The exported finding `handoff-cd139200d693a8e8` counted
  a Chox relay run as a manual occurrence (repo_root
  `~/.chox/worktrees/spec-implement-review-*`). F9 excludes only headless
  `codex_exec` sessions; interactive hops (the 1a.2 default) record normal
  originators for both CLIs.
- **E2 — prefix redundancy.** `claude→codex` (12 sessions) surfaced alongside
  `claude→codex→claude` (18 sessions) built from overlapping evidence.
- **E3 — mislabeled roles.** The engine's excerpts came from one exemplar
  (2026-06-20, dayforce-screening) whose sessions **overlapped** (claude
  00:59–05:44, codex 01:07–04:16, claude 05:41–06:29) but were presented as a
  sequence; combined with session-level opening-intent units (1b P2), Sonnet
  authored plausible-but-wrong roles (brainstorm/plan/implement vs the founder's
  plan/implement/review).
- **E4 — rival drafting.** The candidate's shape matched the founder's installed
  `spec-implement-review` relay; Chox drafted a competitor instead of recognizing
  the loop was already automated.

## 1. Fixed decisions

### Restated (binding, from SPEC + 1b packet)

DB stays metadata/digest-only (1b F2); floors and weighting stand (F6); evidence
carries no counterfactuals (F7); honest no-findings/sparse output stands (F8);
zero production dependencies (F11); tests never touch real homes (F12/C10);
per-finding engine budget ≤3 calls, <90s (P7); excerpts go only to the user's
chosen engine (P8, amended by Q4 below); engine spend visible and skippable (P14).
Persisted findings from prior scans are never rewritten by these changes.

### PM decisions for this packet (fixed unless flagged with rationale)

| # | Decision |
|---|----------|
| Q1 | **Tool-invoked marking by worktree root (E1):** any session whose recorded cwd/repo_root resolves under the Chox worktrees root (via `src/paths.ts`, honoring `CHOX_HOME`) is tool-invoked — indexed, never counted toward handoff-candidate occurrences; same treatment as `codex_exec`. An additive `sessions` column (e.g. `tool_invoked`) is allowed if needed. Detect/status diagnostics report the excluded count so the exclusion is visible, not silent |
| Q2 | **Prefix subsumption (E2):** a candidate whose every occurrence is a contiguous subchain of some occurrence of a longer surfaced candidate on the same sessions is *subsumed*: stored, not surfaced, visible in `--json` with `subsumedBy: <finding-id>`. Non-contained occurrences keep a pattern alive on its own evidence. Already-persisted findings untouched |
| Q3 | **Existing-relay awareness (E4):** before engine confirm, resolve installed relays (repo-local `.chox/relays/`, then `~/.chox/relays/`, including previously generated ones). If a candidate's source-chain shape matches an installed relay's hop-runtime sequence, the finding is reported as **covered** — human output names the relay ("this loop is already automated by `<slug>`"), `--json` carries `coveredBy: <slug>`, no engine calls are spent, no rival relay is drafted, and evidence/occurrence counting continues (continued-use evidence is §2.6 signal, and covered findings count as successes, not dismissals). Reuse the existing 1a relay loader read-only; if that requires touching a `must_not_touch` module, flag first |
| Q4 | **Multi-occurrence excerpts (E3):** confirm/draft excerpts come from the top **min(3, available)** occurrences by weight, within the same total excerpt size and P7 budgets (split the existing excerpt allowance across occurrences; do not grow what is sent). P8's privacy boundary is unchanged — excerpts still go only to the user's chosen engine |
| Q5 | **Concurrency honesty (E3):** compute pairwise overlap between a chain occurrence's sessions. Any positive overlap marks the occurrence `interleaved`; evidence and human output must not present interleaved sessions as a strict sequence (render concurrency explicitly, e.g. `claude ⇄ codex (concurrent) → claude`), and the engine prompt states start/end times and the overlap fact, instructing the engine not to invent sequential roles. Chain *identity* (P4 shape) is unchanged — this changes presentation and engine inputs, not detection |
| Q6 | **Confirm-phase visibility:** during confirmation, one progress line per candidate (`confirming 2/3: claude→codex→claude … call 1`), and completion lines with per-finding calls/elapsed. In `--json` mode these go to stderr (1b precedent). No spinners, no TUI |
| Q7 | **`--model <name>` on detect:** passed through to the engine (claude `--model`, codex `-c model=…`), shown in the P14 notice, recorded in `--json` engine object. Unset keeps today's behavior (CLI default, `ANTHROPIC_MODEL` still honored and surfaced per 177a95b). Invalid model = the CLI's own error surfaced actionably, not a hang |

## 2. Scope

**In:** Q1–Q7; test additions below; README additions for `--model` and covered
findings (privacy contract text unchanged).
**Out (do not build or stub):** turn-level task segmentation (Phase 4); any new
lens; changes to digest definition, thresholds, or floors; daemon/watch;
relay-runtime changes; fixture regeneration (the committed corpus stays as-is);
publish/version changes.

## 3. Module guidance (internals your call)

- Q1 belongs at scan/upsert or lens filter — implementer's placement call; the
  worktrees root must come from `src/paths.ts`, never a hardcoded path.
- Q2/Q3/Q5 live in `src/lenses/handoff/*`; Q3's relay-shape matching needs only
  each relay's ordered hop `runtime` list.
- Q4 in `src/lenses/handoff/confirm.ts` excerpt assembly; Q6/Q7 in `bin/chox.ts`
  + `src/engines/*` (engines already expose `model` since 177a95b).

## 4. Test requirements

1b rules carry over (real temp FS, fake engine binaries, C10 guard, fake homes).

- **Q1:** a synthetic chox-worktree session triple forms no candidate; an organic
  pattern's occurrence count is not inflated by an added chox-worktree triple;
  excluded count appears in diagnostics.
- **Q2:** prefix candidate fully contained → stored with `subsumedBy`, not
  surfaced; partially independent occurrences → still surfaced.
- **Q3:** fake home with an installed relay matching the candidate shape →
  finding reported covered, zero engine spawns, `coveredBy` in `--json`; no
  matching relay → drafting path unchanged.
- **Q4:** fake engine records its prompt; assert excerpts from ≥2 distinct
  occurrences when available and total excerpt size within the 1b allowance.
- **Q5:** synthetic overlapping sessions → occurrence marked interleaved, human
  output renders concurrency, engine prompt contains both timestamps and the
  overlap statement; disjoint sessions render as today.
- **Q6/Q7:** progress lines present (stderr under `--json`); `--model` reaches the
  fake binary's argv and the P14 notice; stdout stays one valid JSON document.
- **Demo-gate rehearsal, updated:** the founder-corpus test gains an installed
  `spec-implement-review`-shaped relay in the fake home and must now report the
  claude→codex→claude loop as covered instead of drafting.

## 5. MANIFEST

```yaml
create_or_replace:
  - docs/plans/challenge-notes-1b1.md
  - docs/plans/result-1b1.md
may_touch:
  - src/lenses/** src/engines/** src/artifacts/draft-relay.ts
  - src/sources/*.ts src/substrate/store.ts src/substrate/schema.sql   # additive only
  - bin/chox.ts src/status.ts src/paths.ts
  - README.md tests/**
must_not_touch:
  - docs/SPEC.md docs/CORRECTNESS.md docs/plans/phase-*-packet.md
  - fixtures/** (committed corpus is frozen)
  - src/harness/** src/runtimes/** (relay loader is read-only reuse — flag if that is impossible)
  - package.json (no publish/version/dep changes this phase)
commands_that_must_pass:
  - npm run typecheck && npm test && npm run build
  - node dist/bin/chox.js detect --no-confirm --json   # sandbox home: exit 0, valid JSON
  - node dist/bin/chox.js status && node dist/bin/chox.js doctor
```

## 6. Acceptance

On the founder's machine, a fresh `chox detect`:

1. surfaces **no** occurrence rooted in `~/.chox/worktrees/` (Q1);
2. surfaces **one** finding per underlying loop — the prefix chain is subsumed (Q2);
3. reports the claude→codex→claude loop as **covered by `spec-implement-review`**
   (Q3) — or, for a genuinely un-automated pattern, drafts a relay whose roles the
   founder accepts **without semantic edits**;
4. shows progress during confirmation and honors `--model` (Q6/Q7).

Then, and only then: the cross-agent demo recording and the §2.6 two-week window
(covered findings count toward precision as successes). Founder judgment on (3) is
the gate — same standard as 1a.2: re-judged on a live run, not on tests alone.

## 7. Judgment guidance

**Yours:** placement of Q1's filter; subsumption algorithm internals; excerpt
splitting; prompt wording for Q5; progress-line format; test structure.
**Flag first:** any schema change beyond one additive column; any new flag beyond
`--model`; any change to digest/threshold/floor; anything sent to the engine
beyond Q4's excerpts and Q3/Q5's metadata; touching harness/runtimes.
**Not asked for:** turn-level units, cross-lens abstractions, occurrence-model
rewrites, config files.
