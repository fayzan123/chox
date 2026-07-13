# Chox — Partner Onboarding

Welcome. This doc takes you from zero to fully oriented: where this project came
from, what it's trying to be, how it's built, and where it stands today. The
canonical reference is `docs/SPEC.md` — everything here is the readable tour of it.

---

## 1. The elevator pitch

Every coding agent you use — Claude Code, Codex, Cursor — keeps its full session
history on your local disk, and none of them will ever read a competitor's. **Chox
is a local-only tool that indexes the history of *all* of them**, runs analyses
("lenses") over that combined substrate, and turns what it finds into **installable
artifacts** — never reports. Its flagship artifact is the **relay**: your own
cross-model workflow (plan in Claude → implement in Codex → review in Claude),
formalized into a runnable, gated, resumable pipeline.

One rule shapes everything: every lens output ends in something you can install and
run, with evidence attached. Prose-only insights are explicitly banned.

A second rule matters just as much: **Chox never assumes your workflow — it reads
it.** Cross-model loops are the flagship, not a requirement. If your history shows
you bouncing work between agents, Chox surfaces that connection; if you use each
agent for entirely separate things, Chox builds per-agent automations from each
one's own patterns instead. Detection is precision-biased by design (a pattern
needs ≥3 sessions or ≥2 repos before it's suggested), and "no findings, here's
what I saw and why" is a first-class output. Connections are found, never forced.

## 2. Backstory — how we got here

The predecessor is **Claude Workflow Composer (CWC)** (npm: `claude-cwc`) — a
published, Claude-only tool that mines Claude Code history for repeated work and
promotes it to multi-agent workflows on a canvas. Building and shipping CWC taught
three expensive lessons:

1. **Install friction and generation latency/quality leak users.** One full user
   interview and one remote install failure were enough to prove it.
2. **Single-vendor mining is a commodity.** Claude Code's own `/insights` now
   generates ready-to-paste rules and skill suggestions from Claude-only history.
   Any feature that works on one vendor's data alone gets sherlocked within
   quarters.
3. **Correctness is bought with real bugs.** ~630 tests' worth of hard-won fixes —
   Windows shell quoting, transcript format drift, redaction leaks — were paid for
   by real users.

In July 2026 the founder decided: CWC stays in maintenance mode; **Chox is a
ground-up, agent-agnostic successor in a fresh repo**. No code is copied over.
Instead, the knowledge transfers three ways: `docs/CORRECTNESS.md` (a distilled
ledger of ten non-negotiable correctness requirements, C1–C10, that our tests must
cover), fixtures regenerated from real local history, and the CWC repo as read-only
reference. The name was decided 2026-07-12 (previously working-titled "seam").

## 3. The vision — why this can win

**The thesis:** your agent history is a substrate. Vendors mine their own silo;
none can mine each other's. A neutral, local tool is the *only* thing that can see
across sources — and ~70% of engineers now run 2–4 AI tools simultaneously, so
cross-tool users are the majority, not a niche.

**The open intersection** (verified by live competitive research, 2026-07-12 —
SPEC.md Appendix C): nobody combines cross-source history indexing → detection of
your own cross-model loop → a drafted, gated relay → executed through an isolated
harness with evidence attached. Bridges exist (transport between agents), history
viewers exist (reports), parallel-run managers exist (many agents, separate tasks).
Each neighbor holds one or two components; none holds the chain. **The chain is the
product.** Chox sits *above* bridges (we're the protocol: which hop, which prompt,
which autonomy, where the gates fall) and *beside* parallel-run managers (they do
parallelism; we do sequential cross-model collaboration on one task).

**Positioning constraint:** ~68% of developers prefer predictable single-agent
setups over complex multi-agent configs. So the pitch is never "orchestration" —
it's *"not a swarm: your own loop, formalized, with a human checkpoint at every
boundary."*

**The three lenses**, in build order:

1. **Handoff lens → relays** (flagship). Detects cross-tool work loops in your
   history and drafts them as runnable relays.
2. **Profile lens → cross-tool preference sync.** Reads what each vendor's agent
   has learned about you, merges it, and proposes a diff to your user-owned
   AGENTS.md/CLAUDE.md — a preference learned in one tool applies in all of them.
3. **Repetition lens → SKILL.md.** Repeated work becomes a skill — this is the
   per-agent automation path: it works on a single agent's history and serves users
   who never bounce between models at all. It stays defensible against vendors'
   own mining (`/insights` etc.) two ways: repetition detected *across* sources
   where present, and output that **executes through the gated harness** rather
   than being a paste-in suggestion. (`SKILL.md` is an open standard supported by
   ~30+ tools, so the output side is solved.)

Which lens fires for you depends entirely on what your history contains: heavy
cross-tool alternation feeds the handoff lens; single-agent repetition feeds the
repetition lens; both feed profile sync. Relays themselves are model-count-agnostic
— a relay whose every hop runs the same agent is valid and useful (you still get
the tuned prompts, gates, isolation, and resume).

**Business stance:** OSS + portfolio, not a venture. No pricing, cloud, or accounts
anywhere. Local-first is a headline feature.

## 4. The flagship: relays

The observed loop (the founder's own, confirmed in his history — hour-level
Claude→Codex→Claude alternation on shared repos): brainstorm/spec in Claude → hand
to Codex to implement with autonomy to challenge the plan → back to Claude for
review. The pain is **not** switching tools (that's free). The pain is the handoff
boundary: not knowing the right prompt, the right context, the right autonomy level
— and no persistent shared context, because models are unreliable at remembering
file conventions.

A **relay** formalizes that loop. Design principles:

- **Persistence is harness-owned, never model-remembered.** Chox deterministically
  writes and reads every inter-hop artifact (`spec.md`, `challenge-notes.md`,
  `review.md`). No hop depends on a model's memory.
- **Every hop carries a tuned prompt and an autonomy dial:**
  - `strict` — the plan hop must emit a machine-readable manifest (files it expects
    created/modified/deleted, commands to run); the harness mechanically diffs the
    implementer's actual footprint against it. Semantic review is always labeled
    advisory — we never pretend a harness can diff code against prose.
  - `challenge` — the implementer must produce non-empty `challenge-notes.md`
    listing every intentional departure, or the harness automatically re-prompts
    it. This is the founder's default mode (and how we build Chox itself — see §8).
  - `autonomous` — deviations are logged, never blocking.
- **Gated by default.** The run pauses at every boundary; you press one key:
  **a**pprove / **e**dit (opens the artifact in `$EDITOR`; your edit is what the
  next hop receives) / **r**edirect (re-run the hop with a note) / a**b**ort.
  Gates are resumable across Ctrl-C and reboots (`--resume`).
- **Isolated.** Each run gets its own git worktree and branch
  (`chox/<slug>/<run-id>`). Agents never touch your working tree, and agent work is
  never discarded — teardown always commits before removing, even for crashed runs.
- **Trust-builders:** `--dry-run` prints the exact prompts, gates, and artifacts
  before anything spawns; detection findings (Phase 1b) carry historical-cost
  evidence ("this loop occurred 6 times across 2 repos; median 38 minutes each") —
  never counterfactual claims.

Gate ergonomics is the **top product risk**: if approving at a boundary is clunkier
than manually pasting between two terminals, the flagship fails.

## 5. Who it's for

**Strategy, stated plainly: user-zero conviction.** Chox is built because the
founder has the problem. Every phase gate asks "does user zero use this weekly?" —
interviews size demand but don't gate. Pre-committed pivot triggers exist (written
down so they can't be rationalized away later): if people with the same pain
wouldn't install a transcript-reading daemon, the trust posture is wrong; if user
zero himself stops using it for 2+ weeks, the flagship doesn't work; if vendor
formats become unreadable with no fallback, the input side is structurally fragile.

Target beyond user zero: developers already running 2+ coding agents on the same
repos. Posture: CLI first, then a resident daemon (`chox watch`), then a local app.

## 6. Architecture

```
SOURCES (per-agent parsers)  →  SUBSTRATE (local index)  →  LENSES  →  ARTIFACTS  →  HARNESS
claude-code, codex, …           SQLite via node:sqlite      handoff     relay          gates,
JSONL transcripts on disk       metadata + digests only     profile     AGENTS.md diff worktree
                                raw content stays put       repetition  SKILL.md, …    isolation,
                                                                                       run events
```

- **Sources** parse each vendor's on-disk session format (documented with dates in
  SPEC.md Appendix A — formats drift, so every source ships fixtures and
  drift tests; parse failures are per-source diagnostics, never scan-fatal).
- **Substrate** is a SQLite index at `~/.chox/substrate.db` (mode 0600) holding
  metadata and derived intent digests — never raw prompt or file content. The
  cross-source join key is the repo root.
- **Lenses** run a cheap deterministic pre-pass, then confirm candidates through an
  **AnalysisEngine** — which is the user's own agent CLI. Nothing novel sees your
  data: analysis goes to a vendor already processing your sessions.
- **Artifacts** compile findings into the simplest sufficient form (relay, skill,
  profile diff, shell alias, VS Code task), with ownership markers and conflict
  safety on every write.
- **Harness** executes relays: by default each attended hop opens the agent's own
  **interactive** CLI session in the isolated worktree with the compiled prompt
  injected — your normal Claude/Codex environment, native permission prompts,
  mid-session steering (SPEC §2 principle 6, from the first acceptance run: *Chox
  conducts between native sessions; it never replaces them*). Headless spawning
  (`claude -p`, `codex exec`) is the per-hop opt-in and powers `--unattended` and
  the Phase 3 daemon. Either way the harness enforces autonomy, presents gates,
  isolates in worktrees, streams JSONL run events, and persists everything under
  `~/.chox/runs/`. Hops can pin a model (`--model`); unset means the CLI's default,
  always displayed, never silently assumed.

**The privacy contract** (README-above-the-fold material, SPEC.md §7): nothing
leaves the machine except digests to the engine the user chose; the substrate never
stores raw content; diagnostics are redacted by construction — including sneaky
derived encodings like the dash-encoded home directory inside Claude Code project
names, a real leak class found in CWC; no network listener until the app phase;
every write outside `~/.chox/` passes ownership checks so hand-authored files are
never rewritten. **The dependency budget is part of this contract**: production
deps ≈ `croner` (Phase 3) and little else. Phase 1a shipped with **zero** — a
transcript-reading tool must be boring and auditable.

## 7. Tech stack (decisions, not options)

TypeScript strict/ESM/NodeNext, single quotes, no semicolons, `.js` extensions on
local imports. Node **>= 22.13** (that's the `node:sqlite` floor — zero native
deps). CLI parsing via built-in `parseArgs`. Vitest with **real temp-dir
filesystems and fake agent binaries** — never fs mocks, never the real `~/.chox`,
`~/.claude`, or `~/.codex` (ledger item C10). Build is plain `tsc`. CI runs
Ubuntu + macOS × Node 22/24. **Supported platforms: macOS and Linux (WSL counts)**
— native Windows is deferred by decision (2026-07-13) until real external demand;
the Windows-safe hygiene in the code (argv-array spawning, path normalization)
is kept so the door stays open. MIT license.

## 8. How we build — the meta-loop

This project is built *using* the workflow it productizes, deliberately:

- **`docs/SPEC.md` is canonical.** Decisions recorded there (name, stack, privacy
  contract, phase ordering) don't get re-litigated in threads.
- Each phase gets a **build packet** (`docs/plans/phase-*-build-packet.md`) before
  implementation: fixed decisions, module-by-module interfaces, test requirements,
  a machine-readable manifest of files and commands that must pass, and explicit
  judgment guidance (what's implementer discretion vs. what must be flagged).
- **Planning/review and implementation are separate agents.** Claude acts as
  PM/tech lead (writes packets, reviews results); Codex implements. The implementer
  runs at autonomy **`challenge`**: it must critically review the packet, may
  deviate where it can justify improvement, and must record every deviation in
  `docs/plans/challenge-notes-*.md` — an absent or empty file means the work is
  incomplete. (Phase 1a produced nine recorded deviations; several caught real
  packet bugs. The mechanism works.)
- **`docs/CORRECTNESS.md` (C1–C10)** is the inherited ledger; packets bind modules
  to specific items and review checks that tests actually cover them.

## 9. Roadmap and where we are right now

| Phase | What ships | Gate |
|---|---|---|
| **1a — Relay runtime** ✅ built | Relay IR/compiler, harness (gates, autonomy, isolation, events), claude+codex runtimes, `chox run` (+`--dry-run`, `--resume`), `chox doctor`. User zero **hand-authors** his relay — no detection needed to deliver value | User zero prefers `chox run` to the manual bounce; interrupted relays resume; dry-run matches real runs; doctor bundle verified redacted |
| **1b — Substrate + detection** (next) | SQLite substrate, claude-code + codex sources, fixture redactor, handoff lens with outcome-weighted detection, `chox detect/install/status`. First npm publish | `chox detect` independently finds the loop user zero hand-authored in 1a, with honest evidence. Quality targets: ≤1 dismissed finding/week, ≥50% of suggestions kept |
| **2 — Profile sync + minimal repetition** | Vendor memory readers, merged preference diffs to AGENTS.md/CLAUDE.md, repo-local shared-context file, simplest repetition→SKILL.md | A preference learned in one tool demonstrably applies in the other |
| **3 — Resident posture** | `chox watch` daemon, scheduled scans, notifications | A zero-interaction week yields ≥1 useful notification, no spam |
| **4 — Repetition, full rebuild** | Generation-first structured skills (gates, parallel, multi-runtime) | A generated skill still in use a week later |
| **5 — Plurality + app** | Third source (Cursor vs OpenClaw by demand), local app with loopback-only server | Full loop works on a machine whose only agent isn't Claude Code |

**Current status (2026-07-13):**

- Phase 1a is implemented and reviewed: 63 tests across 12 suites, zero production
  dependencies, all manifest commands pass locally. The PM review accepted all nine
  challenge-note deviations.
- **Platform decision (2026-07-13): macOS + Linux only for now; WSL counts.** The
  first-ever CI run was Ubuntu-green / Windows-red, failing on Windows `.cmd`
  spawning (Node's `spawn` with `shell: false` refuses `.cmd` shims — which is what
  npm-installed `claude`/`codex` are on Windows). Rather than pay a recurring
  Windows tax on every phase with zero Windows users, native Windows is deferred
  until real external demand (Phase 5 at the latest). The finding is recorded in
  CORRECTNESS.md C8; the CI matrix is now Ubuntu + macOS; Windows-safe code hygiene
  is retained. Notably, this bug class was predicted by the correctness ledger and
  caught on the first CI run — the day-one matrix did its job.
- **Open item 2 — the real acceptance run.** No live-agent relay has been executed
  yet (tests use fakes by design). Phase 1a's gate closes when user zero runs a
  real feature through `chox run` and prefers it to manual bouncing.
- **npm:** the handle is deliberately unclaimed. Decision on record: no placeholder
  publish; the package stays `private: true` until Phase 1b, and a scoped fallback
  is acceptable if `chox` is taken by then.

## 10. Getting started

```sh
git clone https://github.com/fayzan123/chox.git && cd chox
node --version        # must be >= 22.13
npm ci
npm run typecheck && npm test && npm run build

node dist/bin/chox.js doctor                              # environment probes
node dist/bin/chox.js run spec-implement-review --dry-run # see a relay plan, zero spawns
```

The dry run prints the full execution plan of the example relay — the founder's
plan→implement→review loop — including the exact prompts each agent would receive.
It's the fastest way to *get* the product.

**Reading order:** this doc → `docs/SPEC.md` (skim §1–§3, read §2 and §7 closely)
→ `docs/CORRECTNESS.md` → `docs/plans/phase-1a-build-packet.md` +
`docs/plans/challenge-notes-1a.md` (packet-and-challenge is how all work happens
here) → the code, starting at `bin/chox.ts` → `src/harness/runner.ts`.

**Repo map:**

```
bin/chox.ts            CLI entry (run, doctor)
src/artifacts/         relay IR, loader, compiler (→ later: skill compiler, export)
src/harness/           runner, gates, autonomy, isolation, run store/events
src/runtimes/          claude + codex agent adapters
src/substrate|sources|lenses|engines/   empty until Phase 1b+
.chox/relays/          the example relay (repo-local relays live in .chox/relays/<slug>/)
docs/                  SPEC.md, CORRECTNESS.md, plans/ (packets, challenge notes, results)
tests/                 real-FS, fake-binary suites; helpers in tests/helpers/
```
