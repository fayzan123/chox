# Phase 1b result

Implemented the local session substrate and handoff-detection demo gate end to end.

The implementation now:

- incrementally indexes Claude Code and Codex session metadata into a private
  `node:sqlite` cache, retaining derived intent digests but never raw transcript
  content;
- tolerates source drift per file, records aggregate diagnostics, excludes verified
  Chox-spawned `codex_exec` sessions, and preserves dismiss/export state across
  rescans;
- deterministically finds cross-source, same-repo alternation chains, weights them by
  Git correlation and continuation similarity, stores below-floor patterns, and
  attaches occurrence/date/repo/wall-clock evidence without counterfactual claims;
- confirms candidates and drafts valid relays through the user's selected Claude or
  Codex CLI within the three-call budget, with highest-occurrence excerpts only,
  visible spend, validated Claude JSON schemas, defensive fallback parsing, timeouts,
  and `--no-confirm` bypass;
- exposes `chox detect`, stable JSON output, source/lens/engine/since selection,
  interactive install/dismiss, collision-safe local/global relay installation, and
  substrate-aware `status` and `doctor` output;
- ships the founder-run redactor, 181 Claude + 38 Codex redacted fixtures, privacy
  self-verification, source drift tests, a founder-corpus lens rehearsal, and the
  three-repo confirmed-relay demo rehearsal;
- includes the privacy contract and source quickstart in the README, plus a verified
  npm file allowlist while deliberately retaining `private: true`.

## Run it

```sh
npm ci
npm run typecheck
npm test
npm run build

# No engine call or vendor spend
node dist/bin/chox.js detect --no-confirm

# Shows the engine/model/call ceiling, then confirms and drafts findings
node dist/bin/chox.js detect --engine claude

node dist/bin/chox.js status
node dist/bin/chox.js install <finding-id>
node dist/bin/chox.js run <installed-slug> --dry-run
node dist/bin/chox.js doctor
```

Run `detect --json` for machine-readable stdout; its pre-analysis spend notice uses
stderr. Tests use isolated homes and fake agent binaries. They never read the real
Chox, Claude, or Codex homes.

## Verification

```text
npm run typecheck                                             pass
npm test                                                      pass (140 tests)
npm run build                                                 pass
npm run fixtures:verify                                       pass
isolated node dist/bin/chox.js detect --json                  pass (honest empty output)
isolated node dist/bin/chox.js status                         pass (substrate stats)
isolated node dist/bin/chox.js doctor                         pass (exit 0, DB queried)
node dist/bin/chox.js run spec-implement-review --dry-run     pass
node dist/bin/chox.js run brainstorm-plan-implement --dry-run pass (founder relay)
```

`npm pack` was also run with an isolated cache. Its 78-file tarball contains the
executable and `src/substrate/schema.sql`, has no bundled or production dependencies,
and passed `detect --no-confirm --json` after installation into a separate temporary
prefix.

## Reviewer starting points

1. `docs/plans/challenge-notes-1b.md` for packet conflicts, the verified Codex
   originator, privacy wording, live CLI flags, and implementation clarifications.
2. `fixtures/redact.ts`, `tests/fixtures/redact.integration.test.ts`, and
   `tests/lenses/founder-fixtures.integration.test.ts` for the founder-controlled
   fixture boundary and corpus-level detection rehearsal.
3. `src/substrate/store.ts`, `src/sources/`, and their tests for the content-free DB,
   additive diagnostics migration, watermarks, parsing, and drift containment.
4. `src/lenses/handoff/`, `tests/lenses/handoff.test.ts`, and
   `tests/lenses/confirm.integration.test.ts` for deterministic evidence, weighting,
   recurrence floors, originator exclusion, excerpt selection, and the confirmation
   response schema.
5. `tests/cli/detect.integration.test.ts` for the full CLI surface, spend/no-engine
   behavior, `--since` cache safety, install/dismiss state, collisions, and the
   three-repo confirmed-relay rehearsal.
6. `src/artifacts/draft-relay.ts`, `src/doctor.ts`, and `package.json` for relay write
   safety, real substrate health, and the publish-ready file boundary.

## Remaining founder acceptance

- Push the branch or open its PR and confirm the configured Ubuntu + macOS × Node
  22/24 GitHub Actions matrix. Every matrix command passes locally, but remote CI was
  not triggered from this implementation session.
- Live detection and installation passed on the third founder run: Claude confirmed
  the repeated three-agent chain with 7 occurrences over 21 sessions and 4 repos, and
  the founder installed `brainstorm-plan-implement`. Its first dry-run caught a
  duplicate challenge-notes artifact between an early challenge hop and the autonomous
  implementation hop. The generator now assigns the latter a hop-specific notes file;
  the founder approved repair of the already-installed artifact, whose three-hop
  dry-run now passes.
- Record the cross-agent demo using the installed relay. Real founder confirmation
  used three visible calls; the implementer never read the founder's vendor homes or
  invoked an additional live engine.
- Measure exported/dismissed quality over the specified two-week window.
- Verify the npm `chox` handle, choose the scoped fallback if necessary, then change
  `private` only as part of the founder-controlled first publish. No placeholder
  package was published from this branch.

On Node 22, `node:sqlite` may emit Node's experimental-feature warning on stderr. The
built-in module is the packet's fixed zero-dependency storage choice; Node 24 is also
covered by CI.
