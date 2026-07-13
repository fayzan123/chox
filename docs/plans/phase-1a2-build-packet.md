# Phase 1a.2 Build Packet — Interactive Hops, Model Control & Run Visibility

**Status:** ready for implementation after PM review gate.
**Why:** the first real acceptance run (user zero, 2026-07-13, run
`spec-implement-review/2026-07-13t04-06-09-925z-19dc`) completed and produced a
correct, test-passing implementation — the protocol validated — but surfaced three
findings, now recorded as spec amendments:
1. Headless-only execution replaces the developer's native agent environment.
   → SPEC.md §2 **principle 6**: interactive hops by default; Chox conducts
   *between* native sessions, never replaces them.
2. Model selection was silently inherited from each CLI's default.
   → SPEC.md §2 **principle 5 amendment**: per-hop `model`, always surfaced.
3. Run visibility failed: silent multi-minute hops, no gate input echo, unreadable
   artifact lists, no file-change display — and the process did not exit after
   completion (defect).

**Inputs:** `docs/SPEC.md` §2 (principles 5–6, updated RelayHop), §2.1, §2.2, §8
Phase 1a.2; `docs/plans/phase-1a-build-packet.md` (its fixed decisions still bind
unless amended here); `docs/CORRECTNESS.md`.
**Contract:** autonomy `challenge`, as before. Append a dated **"1a.2"** section to
`docs/plans/challenge-notes-1a.md` recording every intentional deviation and every
verified-against-installed-CLI flag. Zero new dependencies. No TUI frameworks —
plain stdout/ANSI.

---

## Part A — Interactive hop mode (the big change)

### A1. IR + compiler

- `RelayHop` gains `model?: string` and `interaction?: 'interactive' | 'headless'`
  (SPEC §2, already amended — mirror it in `src/artifacts/ir.ts`).
- Validation: `interaction` must be one of the two values when present; `model` is
  an opaque non-empty string (no allowlist — model ids drift too fast; a bad id
  fails at the CLI with its own error surfaced).
- `CompiledHop` carries the resolved `model` (or undefined) and the resolved
  interaction mode. Resolution rule: hop value → default `'interactive'`.
  `--unattended` (or relay `gates: 'none'`… no — gates and interaction are
  orthogonal; only `--unattended`) **forces headless for every hop** at execution
  time; the dry-run without `--unattended` shows the declared modes.
- `renderPlan` shows per hop: interaction mode and `model: <id>` or
  `model: CLI default`.

### A2. Runtime interface

Extend `AgentRuntime` (public interface change, pre-approved):

```ts
spawnInteractive(invocation: string, opts: RunOpts & { model?: string }): ChildProcess
// stdio: 'inherit'; cwd = worktree. Returns when the user ends the session.
spawnHeadless(invocation: string, opts: RunOpts & { model?: string }): ChildProcess
```

- **claude interactive:** launch `claude` with the compiled prompt as the initial
  prompt argument and `--model <m>` when pinned, cwd = worktree, stdio inherited.
  **No `--dangerously-skip-permissions`** — native permission UX is the point.
- **codex interactive:** `codex` with prompt argument, `--model <m>` when pinned,
  same stdio/cwd rules, native approvals (no `--ask-for-approval never`).
- **Headless (both):** unchanged from 1a except `--model <m>` when pinned.
- Verify all flags against the installed CLIs (Claude Code 2.1.207, Codex CLI
  0.144.1 or current) and record actuals in challenge notes, as in 1a.
- Prompt length: interactive mode passes the prompt via argv (stdin is the TTY).
  Fine on macOS/Linux ARG_MAX; note it, don't engineer around it.

### A3. Runner semantics for interactive hops

- Before launch, print the hop banner (Part C) and one line:
  `Opening your claude session in the isolated worktree — exit the session when
  the hop's outputs are written.`
- While the session runs, Chox prints **nothing** (the native UI owns the
  terminal). No heartbeat in interactive mode.
- On session exit: same pipeline as 1a — verify `produces`, footprint diff,
  autonomy checks, gate. Missing artifacts → the standard blocking gate with
  redirect available (redirect **re-opens** an interactive session with the note
  appended to the prompt).
- Honesty constraints (per SPEC §2 principle 6, state them in events/gate output
  rather than pretending): interactive sessions expose no event stream, so
  advisory command observation and token accounting are **unavailable** —
  deviations of kind `unlisted-command` are simply not computed; the mechanical
  footprint check is identical in both modes.
- Challenge re-prompt (missing challenge-notes) in interactive mode: re-open the
  session once with the explicit instruction appended, same as headless.
- Gate IO and the interactive session share the TTY: ensure gate raw-mode state is
  established only *after* the child exits and released before any next spawn
  (interacts with FIX-1 below — same root cause family).

## Part B — Per-hop model control

- Wire `model` end to end: IR → compiler → runtime flags → hop banner → dry-run →
  `hop:start` event payload.
- When unset, the banner and dry-run print `model: CLI default`; when a headless
  event stream reports the actual model id (claude stream-json init / codex --json
  session meta), update the display and record it in an `agent:event`
  (`{ kind: 'session', model }` — extend `RuntimeEvent`).
- **Token usage (headless only):** parse usage events from both CLIs' streams into
  `{ kind: 'usage', ... }` runtime events; the completion summary (Part C) reports
  per-hop tokens when available, `n/a (interactive session)` otherwise.
- The example relay (`.chox/relays/spec-implement-review/`) stays model-unset
  (defaults surfaced) — user zero edits his own pins; do not hardcode model ids
  that will drift.

## Part C — Visibility fixes (carried from the retired 1a-ux packet)

### FIX-1 (P0, defect): process must exit after the run ends

Observed: "Run completed…" printed, then a hang until Ctrl-C. Root-cause the
terminal GateIO stdin handling (raw mode / `resume()` without `pause()`).
Requirements: after the final output line of any `chox run` outcome the process
exits on its own (no `process.exit()` force-kill); terminal state restored on every
path including interrupt; unit-test GateIO teardown (listeners removed, stdin
paused) and assert scripted-IO paths unaffected.

### FIX-2 (P0): live progress during **headless** hops

Hop banner (all modes): `Hop 1/3 · plan · claude 2.1.207 · model claude-sonnet-5 ·
autonomy challenge · interactive|headless`. Headless only: heartbeat status line
≥ every 5s (elapsed, event count, last meaningful event, truncated), in-place
`\r` updates on TTY, plain line ≤ every 30s otherwise. Hop end line:
`Hop 1 done · 4m12s · exit 0 · wrote spec.md, manifest.json, challenge-notes.md`.
Run banner before hop 1: worktree path, branch, "your repo is untouched", events
path. Tests: fake-agent non-TTY run asserts banner/progress/hop-end lines.

### FIX-3 (P0): gate input echo and confirmation

Echo the key (`Action: a → approve`), print the consequence line (`Approved.
Continuing to hop 2/3 (implement)…` / `Opening spec.md in $EDITOR…` / `Re-running
hop 1 with your note…` / `Aborting; work preserved on branch <b>…`). Invalid key →
short hint. Tests: scripted transcript per action + invalid key.

### FIX-4 (P1): gate readability + file footprint

Worktree absolute path printed once (run banner); gates use worktree-relative
paths. Artifact summaries: first heading or first non-empty line, ~80 cols;
`manifest.json` summarized as counts (`3 create, 1 modify, 0 delete, 2 commands`);
generic JSON fallback: byte size. **Every gate lists the hop's file footprint**
(reuse the autonomy delta): `Files changed this hop: 2 modified (…), 1 created
(…)`, capped ~10 with `+N more`. Tests: gate snapshot via scripted IO.

### FIX-5 (P1): advisory-deviation noise control

Blocking-relevant deviations always in full. Advisory: print ≤2 then collapse to
`…and N more advisory command observations — full list in events.jsonl`. Strip the
worktree path prefix from displayed commands. Delegated judgment (record choice in
challenge notes): whether manifest-command comparison should run at all for hops
other than the manifest's implementing hop.

### FIX-6 (P2): completion summary

On completed: total + per-hop durations, per-hop model + token usage (headless;
`n/a` interactive), overall files changed vs base commit, branch, merge command,
artifact snapshot dir. On aborted/failed: same minus merge suggestion, plus
resume/inspect hint.

## Out of scope

Detection/substrate (1b), `chox status`, model routing *recommendations* (later
phases; only manual pinning ships now), token budgets/caps, relay IR changes beyond
`model`/`interaction`, mid-session bidirectional bridging, TUI frameworks, any new
dependency.

## Testing rules

Unchanged from 1a (real temp FS, fake binaries, scripted GateIO, no real homes —
C10). Interactive-mode tests: fake binaries with `stdio: 'inherit'` can't be
keystroke-driven in CI — test interactive spawns by asserting the spawn arguments,
cwd, absence of headless-only flags, and the post-exit pipeline (artifact
verification → autonomy → gate) using fake binaries that write artifacts and exit.
The genuinely-interactive experience is user zero's acceptance run.

## Commands that must pass

```
npm run typecheck
npm test
npm run build
node dist/bin/chox.js run spec-implement-review --dry-run   # shows interaction + model per hop
node dist/bin/chox.js doctor                                # exit 0 on macOS
```

Plus a scripted fake-binary run transcript (headless mode) demonstrating banner →
progress → echo → confirmation → footprint → summary, asserted in a test and
pasted into the result notes for PM review.

## Acceptance (from SPEC §8 Phase 1a.2)

The original 1a criteria re-judged by user zero on an **interactive-mode** run,
plus: at every moment the terminal answers *what is happening, what did my
keypress do, and what files changed* — and the process exits on its own.
