# Phase 1a.2 result

Implemented interactive-by-default hops, per-hop model control, and the full run
visibility pass without adding dependencies or changing the CLI surface.

The implementation now:

- launches attended hops in each agent's inherited-stdio native session, while
  preserving the headless JSON path for explicit `interaction: "headless"` and
  forcing that path under `--unattended`;
- carries model pins through validation, compilation, runtime argv, dry-run output,
  banners, events, and completion summaries, with actual headless session metadata
  and token usage surfaced when reported;
- prints run/hop banners, live headless progress, model resolution, hop-end status,
  relative artifact summaries, per-hop file footprints, key echoes, action
  consequences, and terminal run summaries;
- restores raw mode, removes gate listeners, and pauses stdin on every gate exit and
  interrupt path so completed runs relinquish the process naturally;
- preserves the original base commit for honest overall diffs, including changes an
  agent committed inside its worktree, and preserves legacy 1a resumes as headless.

## Scripted acceptance transcript

`tests/harness/runner.integration.test.ts` asserts the fake-binary, non-TTY flow
below, including the order and contents of both hop boundaries. Dynamic temp paths,
run ids, commit ids, branches, and sub-second durations are normalized here.

```text
Starting Chox run demo
Worktree: <CHOX_HOME>/worktrees/demo-<run-id>
Branch: chox/demo/<run-id>
Your repo is untouched; agents work in the isolated worktree.
Events: <CHOX_HOME>/runs/demo/<run-id>/events.jsonl
Hop 1/2 · plan · claude 1.0.0 · model CLI default · autonomy autonomous · headless
Hop 1/2 · 0s elapsed · 0 events · waiting for agent output
Hop 1 model resolved · claude-actual
Hop 1 done · 0s · exit 0 · wrote spec.md
Gate after hop 1 (plan)
Artifacts:
  spec.md — # Plan
    .chox-run/spec.md
Files changed this hop: 1 created (plan-output.txt)
[a]pprove [e]dit [r]edirect a[b]ort
Action: a → approve
Approved. Continuing to hop 2/2 (implement)…
Hop 2/2 · implement · codex 1.0.0 · model gpt-pinned · autonomy autonomous · headless
Hop 2/2 · 0s elapsed · 0 events · waiting for agent output
Hop 2 model resolved · gpt-pinned
Hop 2 done · 0s · exit 0 · wrote result.md
Gate after hop 2 (implement)
Artifacts:
  result.md — # Plan
    .chox-run/result.md
Files changed this hop: 1 created (src/implementation.ts)
[a]pprove [e]dit [r]edirect a[b]ort
Action: a → approve
Approved. Completing the run…
Run completed · <duration> · 2 hops
  Hop 1 · plan · claude · model claude-actual · headless · <duration> · tokens 20 in, 5 out
  Hop 2 · implement · codex · model gpt-pinned · headless · <duration> · tokens 30 in, 10 cached, 8 out
Files changed overall: 2 created (plan-output.txt, src/implementation.ts)
Base commit: <base-commit>
Branch: chox/demo/<run-id>
Merge: git merge chox/demo/<run-id>
Artifact snapshots: <CHOX_HOME>/runs/demo/<run-id>/artifacts
```

## Verification

```text
npm run typecheck                                                pass
npm test                                                         pass (81 tests)
npm run build                                                    pass
node dist/bin/chox.js run spec-implement-review --dry-run        pass
node dist/bin/chox.js doctor                                     pass (exit 0 on macOS)
```

Installed flag probes also passed against Claude Code 2.1.207 and Codex CLI
0.144.1; the exact verified forms are recorded in
`docs/plans/challenge-notes-1a.md` under the dated 1a.2 section.

## Handoff

Start review with the scripted lifecycle test, then the runtime argv tests and
terminal GateIO teardown tests. The remaining acceptance step is user zero's real
interactive relay run: fake binaries can prove argv/cwd/stdio and post-exit harness
behavior, but not the subjective native-session experience.
