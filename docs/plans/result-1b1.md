# Phase 1b.1 result

Implemented detection hardening Q1–Q7 without changing the substrate schema,
detection floor/digest/chain identity, runtime, dependencies, or JSON schema version.

The implementation now:

- excludes both originator-marked and Chox-worktree-rooted sessions before handoff
  chain construction, while exposing per-scan and accumulated exclusion counts;
- records per-session occurrence timing, marks positive overlap, and renders
  concurrent handoffs without claiming strict sequence;
- retains fully evidenced shorter patterns as stored subsumed findings while
  surfacing only the deterministic longest qualifying pattern;
- recognizes exact ordered runtime shapes from valid repo-local and global installed
  relays, reports matching loops as covered, and spends no engine call drafting a
  rival;
- splits the unchanged transcript character allowance across up to the top three
  weighted occurrences and sends concurrency-honest metadata to only the selected
  engine;
- reports confirmation/drafting progress on human stdout or JSON stderr; and
- accepts `detect --model`, forwarding it as Claude `--model` or Codex
  `-c model=…`, with the selected value visible in the notice and JSON result.

## Verification

```text
npm run typecheck && npm test && npm run build        pass (25 files, 166 tests)
isolated detect --no-confirm --json                   pass (one JSON document)
isolated status                                      pass
isolated doctor                                      exit 1, no exception; only empty-sandbox session-dir warnings
run spec-implement-review --dry-run                   pass
git diff --check                                     pass
```

The isolated detect result reported zero sessions, zero tool-invoked exclusions,
`engine: null`, and no findings. Doctor reported supported platform, Node,
`node:sqlite`, both installed agent CLIs, writable Chox home, and healthy empty run
storage; its repository-allowed exit 1 came from the intentionally absent sandboxed
Claude/Codex session directories. Node 22's expected experimental SQLite warning was
present on stderr.

## Reviewer starting points

1. `src/substrate/store.ts`, `src/paths.ts`, and `src/lenses/handoff/scan.ts` for Q1
   exclusion and Q5 occurrence timing.
2. `src/lenses/handoff/subsume.ts` and `src/lenses/handoff/covered.ts` for Q2/Q3's
   deterministic read-only matchers.
3. `src/lenses/handoff/confirm.ts` and `src/engines/` for bounded excerpts, progress,
   and model argv.
4. `bin/chox.ts`, `src/status.ts`, and `tests/cli/detect.integration.test.ts` for the
   integrated covered/subsumed/exclusion states and JSON channel guarantees.
5. `docs/plans/challenge-notes-1b1.md` for the approved privacy wording adjustment
   and implementation judgments.

## Remaining founder work

- Run live `detect` against the founder-controlled histories and verify the installed
  relay is reported covered without spawning analysis.
- Confirm the concurrent-session rendering against any live overlapping occurrence.
- Continue the Phase 1b two-week exported/dismissed quality measurement and record the
  cross-agent demo; no real vendor history or live analysis was used in this hop.
