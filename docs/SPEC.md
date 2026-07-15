# Chox — Product & Technical Spec (v3)

**Date:** 2026-07-12 (v3)
**Status:** Canonical product and architecture spec. This document is written to stand
alone: it is the reference a fresh repository is built from, and it should be copied
into that repository as `docs/SPEC.md`. Everything needed to build Chox is in this
document or its appendices; the predecessor project is context (Appendix B), not a
dependency. Each phase gets its own plan doc before implementation.
**Name:** **Chox** (decided 2026-07-12; previously working-titled "seam"). CLI binary
`chox`, home directory `~/.chox/`. npm handle availability to be verified before first
publish (Open Question 1).

**v3 changes from v2:**
1. Product renamed Chox; document made standalone (source-format facts, security model,
   redaction rules, and correctness ledger are now spelled out inline or in appendices
   instead of referencing the predecessor project).
2. Reality-check fixes (each explained where it lands):
   - **Shadow mode removed** — replaying old sessions through a drafted relay and
     judging "equivalent or better output" requires a correctness oracle and historical
     repo state that don't exist. Replaced with two honest, buildable trust-builders:
     `--dry-run` previews and **historical-cost evidence** on findings (§2.5).
   - **`strict` autonomy enforcement grounded** — a harness cannot mechanically diff an
     implementation against a prose spec. Strict mode now works from a structured plan
     manifest, with engine-assisted deviation review clearly labeled advisory (§2.1).
   - **Phase 1 split into 1a/1b** — the relay runtime (user zero's value) no longer
     waits on detection. A hand-authored relay ships and gets used before any lens
     exists; detection follows as the acquisition surface (§8).
   - **Detection-risk framing corrected** — detection quality is the acquisition
     surface, not "the product"; the relay runtime is the retention surface (§9).
   - Cold-start message no longer promises a daemon that doesn't ship until Phase 3;
     unverifiable claims ("triples the audience", counterfactual timing claims)
     removed or replaced with measurable statements.
3. Autonomy level `harden` renamed **`challenge`** (same semantics; avoids collision
   with an unrelated "harden" skill in the founder's tooling that has caused repeated
   mis-dispatch).

**v3.1 (2026-07-12, same day):** live competitive/demand research folded in (full
landscape: Appendix C). Material consequences: the single-vendor report→artifact gap
has closed (§1.1 updated — `/insights` now emits rules and skill suggestions), the
repetition lens is cross-source-or-nothing (§1.2), relays gain an ecosystem posture
(§2.7: protocol above existing bridge plumbing), routing gains a cost signal, hop
templates gain an implementer-formatting requirement, and positioning targets the
documented majority preference for predictable single-agent setups (§3).

---

## 1. Product Thesis

> Your agent history is a **substrate**. Chox is a resident, local-only tool that
> indexes the session history of *every* coding agent on your machine and runs
> **lenses** over it — each lens ends in an **installable artifact**, never a report.

```
SOURCES (per-agent parsers)  →  SUBSTRATE (local index)  →  LENSES  →  ARTIFACTS  →  HARNESS
claude-code, codex, …           SQLite, incremental         handoff      relay         install,
                                                            profile      AGENTS.md     schedule,
                                                            repetition   sync diff     gated &
                                                                         SKILL.md      isolated
                                                                         alias/task    runs
```

### 1.1 Background facts this rests on (dated; re-verify if building much later)

- **Coding agents keep full session history on local disk.** Claude Code writes JSONL
  transcripts per project; Codex writes JSONL rollouts per session (formats:
  Appendix A). Cursor, OpenClaw, and others keep comparable local state.
- **Vendors mine their own history — and have started closing the report→artifact gap
  on their own silo.** As of mid-2026, Claude Code's `/insights` no longer stops at a
  friction report: it generates ready-to-paste CLAUDE.md rules from repeated
  instructions and suggests custom skills and hooks, and community tooling
  (`claude-insights`) compiles the report into skill/rule/settings files. Codex
  maintains local memory stores. Each remains silo-bound: no vendor reads a
  competitor's local data, for structural business reasons. The consequences for Chox:
  single-vendor mining is a commodity Chox must not compete on; cross-source indexing
  — only available to a neutral local tool — is the durable advantage, and it applies
  specifically to users running 2+ agents.
- **`SKILL.md` (Agent Skills) is an open standard** (Anthropic spec, 2025-12-18),
  supported by roughly 30+ tools as of early 2026 (Claude Code, Codex CLI, Cursor,
  Gemini CLI, VS Code/Copilot, OpenClaw, and others). The portable-artifact question
  is therefore solved on the output side; per-tool differences are placement paths and
  small frontmatter quirks.
- **The report is commoditized, and the single-silo artifact is following it.** What
  remains structurally open: artifacts that require *cross-source* evidence (relays,
  synced preferences, comparative routing) and artifacts that *execute* through a
  gated, isolated harness rather than being pasted. Chox's rule stands — every lens
  output terminates in something installable, with evidence attached, never prose-only
  — but the rule alone is no longer differentiation; the cross-source input and the
  execution back-half are.

### 1.2 The lenses (build order = this order)

1. **Handoff lens → relays** (flagship; §2). Detects cross-tool work loops — e.g.
   plan-in-Claude → implement-in-Codex → review-in-Claude — and formalizes them into
   **relays**: the user's loop as a runnable, gated, multi-runtime artifact.
   *Evidence (2026-07-05, founder's machine):* 3 repos present in both Claude Code and
   Codex histories; hour-level Claude→Codex→Claude alternation within one afternoon on
   the same repo; 32/33 Codex sessions carried `originator: codex_vscode` — manual
   human bounces, not tool-invoked runs. Founder-confirmed pain: not knowing the right
   prompt, context, and autonomy level for the handoff; context loss and
   re-explanation; no persistent shared context between tools; models forgetting
   file-persistence conventions.
2. **Profile lens → cross-tool preference sync** (§8 Phase 2). Vendors already extract
   per-silo memory natively; the defensible move is the **sync**: read what each
   vendor's agent has learned (memory stores + correction patterns in raw history),
   merge and dedupe, and propose the durable subset as a fenced-section diff to the
   user-owned cross-tool standard (AGENTS.md / CLAUDE.md) — a preference learned in
   one tool applies in all of them. Delivers first-scan value at any history depth.
3. **Repetition lens** (§8 Phases 2 and 4). Repeated work → `SKILL.md` by default.
   Sherlocking status (2026-07): `/insights` already suggests skills and rules from
   Claude-only history, so this lens earns its place **only** where the vendor
   cannot follow — repetition detected *across* sources, and output that runs through
   the gated harness rather than being pasted. Phase 2 ships the simplest version:
   single-agent, flat skill, no graph — it validates the generation pipeline and
   serves single-agent users. Phase 4 rebuilds it generation-first with structured
   artifacts (gates, parallel, multi-runtime).
   A structured artifact whose graph has one node and no gate/trigger needs is a
   classification bug by definition — the compiler collapses it to a flat skill.

**Explicit non-lens:** single-vendor usage coaching ("prompt Claude better") — that is
the vendor's turf. The only coaching Chox does is cross-vendor comparative routing
("tasks like X land better in Codex on your machine"), and it lands inside relay
defaults, not as a report.

## 2. Relays (the flagship)

The observed loop this formalizes: brainstorm/spec in Claude → hand to Codex to
implement, *with* autonomy to challenge the plan, suggest improvements, and flag edge
cases → back to Claude for review. The user deliberately plays to each model's
strengths.

The pain is **not** the switch (the tools sit side by side; switching is free). The
pain is the handoff boundary itself:

- not knowing the right prompt to give the implementer for optimal results
- not knowing the right context to include (context loss → re-explanation every time)
- not knowing the right autonomy level to grant on the plan
- no persistent shared context between the tools — and models are unreliable at
  maintaining file-persistence conventions when asked to ("save this as a convention"
  gets forgotten)

Therefore a **relay** is the user's loop, formalized — not headless automation. The
user's judgment at the boundaries is where the loop's value lives, so the human stays
in it by default.

Design principles:

1. **Persistence is harness-owned, never model-remembered.** Chox writes and reads the
   inter-hop artifacts (`spec.md`, `challenge-notes.md`, `review.md`, …) and the
   shared-context file deterministically. No hop depends on a model remembering a
   convention.
2. **Each hop carries a tuned prompt and an autonomy dial** (§2.1). Hop prompt
   templates encode "the right thing to ask" once, so it stops being re-invented per
   bounce. Templates are **implementer-formatted**: community experience reports that
   prose-heavy plans with embedded reasoning execute poorly in Codex — so the plan
   hop's template requires structured output (task breakdown + the §2.1 manifest),
   which does double duty as the strict-mode contract.
3. **Gated by default** (§2.2). A relay pauses at each boundary; the user reviews the
   outgoing artifact and approves, edits, or redirects. Fully unattended relays are
   opt-in per relay, not the pitch.
4. **Shared context is a repo-local file** both tools read, written only inside a
   fenced Chox-owned section — the durable answer to "inconsistent context between my
   agents." The profile lens lands its synced preferences in the same mechanism.
5. **Strengths-routing defaults are encoded, evolvable.** Which runtime plans and
   which implements ships as opinionated defaults, is editable per relay, and is later
   informed by observed outcomes in the user's own history. Routing considers **cost
   as well as quality**: community benchmarks report large token-usage differences
   between runtimes for equivalent work (Codex commonly cited at 2–3× fewer tokens on
   implementation), so a hop's default runtime is a quality×cost judgment, surfaced
   to the user, never hidden. **Amended 2026-07-13 (first acceptance run):** routing
   extends inside a runtime — a hop may pin a **model** (`RelayHop.model`, passed as
   the CLI's `--model` flag). Unset means the CLI's own configured default, which is
   then *displayed*, never silently assumed: which model ran a hop must always be
   visible in the dry-run, the hop banner, and the run events. Model choice is a
   token-burn/usage-limit lever the user owns; later phases inform it from observed
   outcomes the same way runtime routing is informed.
6. **Native sessions are preserved; Chox conducts between them.** (Founder decision,
   2026-07-13, from the first acceptance run.) By default an attended hop launches
   the agent's own **interactive** CLI session — the developer's familiar
   environment, native permission prompts, mid-session steering — in the isolated
   worktree with the compiled prompt injected; when the session ends, the harness
   collects artifacts, runs the same autonomy checks, and gates as usual. Headless
   execution (`claude -p` / `codex exec`) is the **opt-in** mode per hop
   (`RelayHop.interaction`), and the required mode for `--unattended` runs and the
   Phase 3 daemon. Chox enhances the developer's existing environment; it never
   replaces it. Honesty note: interactive sessions expose no machine-readable event
   stream, so advisory command observation and token accounting are headless-only
   capabilities — the mechanical footprint check (worktree diff) works identically
   in both modes.

```ts
interface Relay {
  slug: string
  repo?: string                       // repo-local or global
  hops: RelayHop[]
  gates: 'all-boundaries' | 'none'    // default 'all-boundaries'
}
interface RelayHop {
  runtime: string                     // 'claude' | 'codex' | ...
  role: 'plan' | 'implement' | 'review' | 'fix' | string
  promptTemplate: string              // receives prior hop artifacts as file paths
  autonomy: 'strict' | 'challenge' | 'autonomous'
  produces: string[]                  // artifact filenames the harness persists
  model?: string                      // pin the runtime's model (--model); unset =
                                      //   CLI default, always surfaced (§2 pr. 5)
  interaction?: 'interactive' | 'headless'  // default 'interactive' when attended;
                                      //   --unattended forces headless (§2 pr. 6)
  skillRef?: string                   // optional: slug of an installed skill to invoke
                                      //   instead of promptTemplate (§2.4)
}
```

A relay is exported as a structured `SKILL.md` + metadata — portable, inspectable
text, not a proprietary format.

### 2.1 Autonomy enforcement (mechanical where possible, engine-assisted where not)

The autonomy dial is enforced structurally, not left to prompt phrasing the model can
ignore. Honesty note: a harness cannot mechanically diff an implementation against a
*prose* spec — so strict mode is defined around what CAN be checked mechanically, and
everything semantic is labeled advisory.

- **`strict`** — requires the plan hop to emit, alongside the prose spec, a
  machine-readable **manifest**: the files it expects to be created/modified/deleted
  and the commands it expects to run. The harness then compares the implementer hop's
  actual footprint (touched files from the run worktree's `git status`, commands from
  the run event log) against the manifest — a purely mechanical check. Out-of-manifest
  changes are surfaced at the gate as a deviation list with the raw diff attached.
  Deeper semantic review ("does this implementation match the spec's intent?") is
  optionally delegated to a reviewer hop or the analysis engine and is **always
  labeled advisory**, never presented as a mechanical guarantee. If the plan hop
  produced no manifest, strict degrades to `challenge` with a visible warning.
- **`challenge`** — the implementer hop must produce a `challenge-notes.md` listing
  every intentional departure from the spec, with rationale. Mechanically enforced:
  if the file is absent or empty, the gate blocks and re-prompts the implementer to
  produce it. The user reviews the notes plus the implementation at the gate. This is
  the founder's observed default mode.
- **`autonomous`** — deviations are logged to the run-events stream but do not block
  the gate. The harness still persists all hop artifacts and the deviation log for
  audit.

### 2.2 Gate UX (minimum requirements)

Gate ergonomics is a top product risk (§9): if approving at a boundary is clunkier
than bouncing manually, the flagship fails. Terminal-first requirements:

- A gate presents: the hop's produced artifacts (paths), a summary line per artifact,
  the deviation list if any, and single-keystroke actions — **a**pprove / **e**dit /
  **r**edirect / a**b**ort.
- **Edit** opens the boundary artifact in `$EDITOR`; the edited version is what the
  next hop receives.
- **Redirect** re-runs the producing hop with an appended user note.
- Gates are resumable: a relay interrupted at a gate (Ctrl-C, reboot) resumes from the
  same gate via `chox run <slug> --resume`; pending gates are visible in `chox status`
  and surfaced by daemon notifications from Phase 3.

### 2.3 Outcome-weighted detection

Detection does not just find alternation patterns — it weights them by observed
success. All three signals are heuristics, tuned on the founder's data first,
precision-biased:

1. **Git-correlated sessions (strong signal):** a session whose end timestamp falls
   within 15 minutes of a commit on the same repo is weighted higher — the commit
   is treated as the artifact of a successful session. Known noise sources, accepted:
   commit authorship is ambiguous (agent-made vs user-made), and rebases/squashes
   rewrite timestamps. This is a weighting, never a filter.
2. **Continuation vs backtrack (moderate signal):** when hop N is followed by hop N+1
   that continues the work rather than redoing it — approximated by intent-digest
   similarity staying below a "same work re-attempted" threshold — the N→N+1 pair is
   weighted higher. The threshold is a tunable, validated against labeled examples
   from the founder's history before it's trusted.
3. **Recurrence floor (minimum bar):** a pattern must appear in ≥3 sessions or across
   ≥2 repos before it is surfaced. Below-threshold patterns are stored, not suggested.

The drafted relay's prompt templates are seeded from the **highest-weighted**
occurrences, not the most frequent ones — the difference between "the prompt you used"
and "the prompt that worked."

### 2.4 Relay composition

A hop may reference an installed skill by slug (`skillRef`); the harness then invokes
that skill through the hop's runtime instead of the hop's own prompt template:

- a repetition-lens skill ("run the test suite and fix failures") can serve as the
  `review` hop inside a spec→implement relay;
- an installed relay can be wrapped as a single hop inside a larger relay.

Composition is opt-in: hops default to their own prompt template, and the user
promotes a hop to a skill reference explicitly during relay refinement.

### 2.5 Trust-builders: dry-run and historical cost (replaces v2 "shadow mode")

v2 proposed replaying past sessions through a drafted relay and claiming the relay
"would have done better." That is not buildable honestly — it needs the repo's
historical state and an output-quality oracle. What ships instead:

- **`chox run <slug> --dry-run`** prints the full execution plan without spawning
  anything: hops in order, resolved runtimes and autonomy levels, the exact prompts
  that would be sent (with artifact placeholders resolved), the artifacts each hop
  produces, and where the gates fall. The user sees precisely what they are approving
  before the first real run.
- **Historical-cost evidence on findings.** Every handoff finding carries measurable
  history: occurrence count, dates, repos, and total/median wall-clock session time
  spent on the loop (computable from substrate timestamps). Example: *"this loop
  occurred 6 times across 2 repos since June; median 38 minutes of session time per
  occurrence."* No counterfactual claims — the evidence says what the loop costs,
  not what the relay would have saved.

### 2.6 Detection quality targets

If detection produces noise, users uninstall the daemon and never come back — so
targets are concrete and measured from the substrate's own `findings` table:

| Metric | Phase 1b target | Measurement |
|--------|----------------|-------------|
| False-positive rate | ≤1 dismissed finding per week of active use | `dismissed` count ÷ active days |
| Precision floor | ≥50% of suggested findings installed or kept | `exported` ÷ (`exported` + `dismissed`), weekly |
| Cold-start yield | ≥1 finding within 7 days for a user with 20+ cross-tool sessions on 2+ repos | verified on founder's machine |
| Sparse-data behavior | zero findings when below threshold — with an explanation, never silence and never garbage | output inspection |

The no-findings output must prove the scan ran, show what it saw, and give the user
agency (silence is a trust-killer for a tool that reads your history):

```
$ chox detect
Scanned 47 sessions across claude-code (31) and codex (16).
No relays detected yet.

Why: 11 cross-tool session pairs found, but no pattern met the confidence
threshold (≥3 sessions or ≥2 repos with the same shape).

What helps: keep using your planning agent and implementing agent on the same
repos — alternation on a shared repo is the strongest signal.
```

(A "next auto-scan" line appears only when the Phase 3 daemon is actually installed.)

### 2.7 Ecosystem posture: the protocol layer above existing plumbing

Live research (2026-07-12, Appendix C) found a thriving ecosystem of Claude↔Codex
**bridges** — 8+ independent open-source projects (MCP servers exposing `codex()`
tools, bidirectional live-session bridges, review bridges) — and community
conventions that pass `PLAN.md`/`RESULT.md` files between agents on the filesystem.
Two conclusions:

1. **This validates the design.** The filesystem-artifact handoff Chox specifies
   (§2, principle 1) is what practitioners already converge on by hand; harness-owned
   persistence formalizes an existing folk practice rather than inventing one.
2. **Chox does not compete with bridges — it sits above them.** Bridges are transport;
   Chox is the protocol (which hop, which prompt, which autonomy, where the gates
   fall) plus the detection that drafts it and the evidence that justifies it.
   **Decision:** Phase 1a spawns agent CLIs directly (`claude -p`, `codex exec`) —
   zero dependencies, full control of the event stream. The `AgentRuntime` interface
   leaves room for a bridge-backed transport later if a bridge offers something
   spawning can't (e.g. mid-session bidirectionality). Chox also does not compete
   with parallel-run managers (Conductor, Claude Squad, Vibe Kanban, Nimbalyst) —
   those manage many agents doing *separate* tasks; Chox formalizes *sequential
   cross-model collaboration on one task*. A user can run Chox relays inside a
   worktree that a parallel-run manager created.

## 3. Users & Posture

- **Strategy, stated plainly: user-zero conviction.** Chox is built because the
  founder has the problem — first for him, adoption evidence later. Consequences
  accepted: funnel work is deprioritized, and every phase gate asks *"does user zero
  use this weekly?"*, not whether interviewees nod. Interviews size demand; they do
  not gate.
  **Pre-committed pivot triggers** (defined upfront so they can't be dismissed
  reactively): (a) ≥2 interviewees independently say "same pain, but I would not
  install a local daemon that reads my transcripts" — the trust posture is wrong, not
  the problem; (b) user zero himself stops using it for 2+ weeks after Phase 1a ships
  — the flagship doesn't solve the pain it was built for; (c) vendor formats become
  unreadable within one release cycle with no stable fallback — the input side is
  structurally fragile.
- **Target user beyond user zero:** a developer already running 2+ coding agents on
  the same repos — the segment where the cross-source advantage is real. This segment
  is the *majority*, not a niche: 2026 surveys report ~70% of engineers using two to
  four AI tools simultaneously and most productive developers pairing an IDE tool
  with a terminal agent. Single-agent users are served (repetition, profile) but are
  not the beachhead.
- **Positioning against the complexity objection:** the same surveys report ~68% of
  developers *prefer predictable single-agent setups over complex multi-agent
  configurations*. Chox's pitch is built for exactly that majority: **not a swarm —
  your own loop, formalized, with a human checkpoint at every boundary.** Gated
  relays are the anti-complexity multi-agent product; marketing copy should never
  lead with "orchestration."
- **Posture:** CLI-first, then resident daemon, then app. Local-first is a headline
  feature, not a limitation.
- **Business stance:** OSS and portfolio, not a venture. No pricing, cloud, or
  accounts anywhere in this spec.

## 4. Tech Stack (decisions, not options)

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript, `strict`, ESM, NodeNext, single quotes / no semicolons | Founder fluency; conventions carry even where code doesn't |
| Runtime | Node **>= 22.13** (verify exact floor at scaffold; recommend current LTS) | `node:sqlite` available unflagged from 22.13 |
| Storage | **`node:sqlite`** behind a `SubstrateStore` interface | Incremental, queryable, cross-source indexing with zero native deps — matters for `npx` friction and for the trust story of a transcript-reading tool |
| CLI parsing | `node:util` `parseArgs` | Built-in; no CLI framework dependency |
| Scheduling | `croner` | Small, no transitive deps, proven in the predecessor |
| Tests | Vitest; real-FS temp dirs; fake agent binaries; fixtures generated from real local history | Filesystem behavior is tested against real filesystems, never mocks (Appendix B, ledger) |
| Build | `tsc` only; `dist/bin/chox.js` marked executable | No bundler until proven needed |
| Package mgr | npm + `package-lock.json` | Continuity |
| CI | GitHub Actions: Ubuntu + macOS × Node 22, 24 (amended 2026-07-13; originally Ubuntu + Windows — see platform note below) | Cover the supported platforms; macOS is user zero's machine |
| App surface (Phase 5) | Vite + React 19; local server bound to loopback with per-install token auth and strict CORS (§7.5) | Deferred; CLI/daemon carry Phases 1–4 |
| License | MIT | Portfolio + adoption |

**Platform support (founder decision, 2026-07-13):** supported platforms are
**macOS and Linux — WSL counts as Linux**. Native Windows is deferred: the first
Windows CI run confirmed the known-paid-for bug class immediately (Node's
`spawn`/`shell:false` refuses the `.cmd` shims that npm-installed `claude`/`codex`
are on Windows), and paying that tax on every phase serves no current user — user
zero is on macOS and there are no external users before the Phase 1b publish.
Consequences: `windows-latest` is out of the CI matrix (never left in as
allowed-to-fail — perpetually red CI is worse than absent CI); the cheap Windows
hygiene already in the codebase (argv-array spawning per ledger item 1, path
normalization) is kept, since it costs nothing and keeps the door open; `chox
doctor` on `win32` reports native Windows as unsupported and points to WSL.
**Revisit trigger:** first credible external Windows demand, or Phase 5 plurality
at the latest. Ledger items 1 and 8 are amended accordingly (see
`docs/CORRECTNESS.md`).

**Dependency budget:** production deps ≈ `croner` and little else. `package.json` is
part of the privacy posture — every dependency is a trust cost for a tool that reads
all your transcripts.

**Generation-first note:** artifact generation (relay drafting, skill generation) is a
first-class subsystem designed before the surfaces that call it — prompt budgets,
latency targets, and output-quality checks are phase-level acceptance criteria, not
afterthoughts. (This is a direct correction of the predecessor's shape, where
generation was bolted onto a canvas product.)

## 5. Architecture

```
┌──────────────────────── SOURCES (plugins, fixture-tested) ────────────────────────┐
│ claude-code: ~/.claude/projects/<enc>/*.jsonl          (format: Appendix A.1)     │
│ codex:       ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl  (format: Appendix A.2) │
│ vendor memory stores (profile lens, opt-in): ~/.codex/memories*, Claude memory    │
│ (later: cursor state.vscdb, openclaw logs, …)                                     │
└──────────────┬────────────────────────────────────────────────────────────────────┘
               │ discover() + parse() → SessionMeta + TaskUnit[]
               │ (per-source diagnostics; drift never scan-fatal)
               ▼
        ┌──────────────────┐
        │    SUBSTRATE      │  ~/.chox/substrate.db (0600) — sessions, units, repos,
        │  (SQLite index)   │  watermarks. Metadata + derived digests only; raw
        └──────┬───────────┘  transcript content stays in source files, by reference.
               │  incremental: watermark per source
               ▼
        ┌──────────────────┐   Lens = deterministic pre-pass (cheap, no LLM) →
        │      LENSES       │   candidates → engine confirmation via AnalysisEngine
        │ 1 handoff         │   (the user's own local agent CLI) → Finding[]
        │ 2 profile-sync    │
        │ 3 repetition      │
        └──────┬───────────┘
               ▼
        ┌──────────────────┐   simplest sufficient artifact:
        │    ARTIFACTS      │   relay │ AGENTS.md sync diff │ SKILL.md │ structured
        │ compiler + export │   skill │ shell alias │ VS Code task — ownership
        └──────┬───────────┘   markers + conflict safety on every write (§7.6)
               ▼
        ┌──────────────────┐   AgentRuntime plugins: claude -p │ codex exec │ …
        │     HARNESS       │   gates (default), worktree isolation, harness-owned
        └──────────────────┘   artifact persistence, JSONL run events, croner, notifier

SURFACES:  1. CLI  `chox detect|install|run|doctor|status`
           2. Daemon  `chox watch` (+ --install login item) → notifications
           3. App (Phase 5)  one artifact list; document view; Diagram tab on structured artifacts
```

### 5.1 Substrate schema (SQLite)

```sql
sources    (id TEXT PK, kind TEXT, root_path TEXT, last_scan_at TEXT)
sessions   (id TEXT PK, source_id TEXT, ref TEXT,          -- path into original file
            repo_root TEXT, cwd TEXT, originator TEXT,
            started_at TEXT, ended_at TEXT, meta_json TEXT)
units      (id TEXT PK, session_id TEXT, started_at TEXT, ended_at TEXT,
            intent_digest TEXT, meta_json TEXT)
findings   (id TEXT PK, lens TEXT, kind TEXT, created_at TEXT,
            status TEXT CHECK(status IN ('suggested','dismissed','exported')),
            payload_json TEXT)
artifacts  (id TEXT PK, finding_id TEXT, kind TEXT,        -- 'relay'|'skill'|'profile-diff'|...
            slug TEXT, placed_paths_json TEXT, created_at TEXT)
watermarks (source_id TEXT, file_ref TEXT, mtime INTEGER, size INTEGER,
            PRIMARY KEY (source_id, file_ref))
```

Privacy property: the DB holds metadata and derived `intent_digest` strings, never raw
prompt/file content. Content-level analysis reads the original transcript at confirm
time via `sessions.ref`. DB file mode is 0600.

### 5.2 Key interfaces

```ts
export interface SessionSource {
  id: string                                        // 'claude-code' | 'codex' | ...
  discover(homeDir: string): Promise<SessionRef[]>  // cheap: paths + mtimes
  parse(ref: SessionRef): Promise<ParsedSession>    // { meta: SessionMeta; units: TaskUnit[] }
}
// SessionMeta: { cwd, repoRoot, originator, startedAt, endedAt } — repoRoot is the
// cross-source join key (verified present in both known formats; Appendix A).
// Contract: parse failures are per-source diagnostics, never scan-fatal.
// Every source ships fixtures + a schema-drift test.

export interface Lens {
  id: 'handoff' | 'profile' | 'repetition'
  scan(store: SubstrateStore, opts: LensOpts): Promise<Candidate[]>   // deterministic
  confirm(candidates: Candidate[], engine: AnalysisEngine): Promise<Finding[]>
}

export interface AnalysisEngine {
  id: string                                        // 'claude' | 'codex' | ...
  analyze(digest: string, opts: EngineOpts): Promise<unknown>
}

export interface AgentRuntime {
  id: string
  spawnHeadless(invocation: string, opts: RunOpts): ChildProcess
  supportsSubagents: boolean
}
```

### 5.3 IR (generation-first)

- Artifact kinds: `relay` (§2), `skill` (flat SKILL.md), `structured-skill` (graph
  with gates/parallel/multi-runtime), `profile-diff`, `shell-alias` (a named command
  installed into the user's shell rc inside a fenced Chox-owned block), `vscode-task`
  (a `.vscode/tasks.json` entry). The simpler kinds lower install friction: a shell
  alias from a detected repetition is easier to trust than a multi-hop relay.
- Graph nodes carry `runtime` per step from day one. View data (canvas positions) is
  never a required IR field — layout is derived.
- Agent/skill naming rule: frontmatter `name` is always the dispatch slug — agent
  tools resolve dispatch against this field, not the filename (Appendix B, ledger).
  Slugs are collision-checked; renames are reconciled and only Chox-owned files are
  ever cleaned up.
- Hop/edge context artifacts are files written by the harness (§2 principle 1), never
  state a model is asked to remember.

### 5.4 CLI surface

```
chox detect   [--source claude-code,codex] [--lens handoff,profile,repetition]
              [--json] [--since 30d]        # scan → findings + evidence → "install? [y/N]"
chox install  <finding-id>                  # compile + place artifact (placement map)
chox run      <slug> [--dry-run] [--resume] [--unattended]
chox doctor   [--bundle]                    # env probes + redacted diagnostics bundle (§7.4)
chox watch    [--install|--uninstall]       # daemon: scheduled scans + notifications
chox status                                 # substrate stats, last scan, pending findings/gates
```

`doctor` probes: Node version and `node:sqlite` availability, presence and versions of
agent binaries (`claude`, `codex`), source directory existence and readability, and
substrate health. Agent-binary preflight runs before any engine-dependent stage and
fails with an actionable install message — never a raw ENOENT.

### 5.5 Storage layout

```
~/.chox/
  substrate.db          # the index (0600)
  config.json           # sources, engine choice, thresholds, notification prefs
  findings/             # exported finding payloads (JSON, audit/undo)
  runs/<slug>/          # JSONL run events + hop artifacts (spec.md, review.md, …)
  worktrees/            # isolation
  logs/                 # daemon logs, rotated
  chox.pid
```

Installable artifacts land where the target agent reads them (`~/.claude/skills`,
`~/.codex/skills`, project `.claude/`, repo-local shared-context file, shell rc,
`.vscode/tasks.json`) via the placement map, with ownership markers — never inside
`~/.chox/`.

## 6. Knowledge Inheritance Without Code Inheritance

Chox is ground-up new code (founder decision, 2026-07-05 — see Appendix B for the
predecessor context). Fresh code re-earns correctness; three mechanisms make the
re-earning cheap instead of user-funded:

1. **`docs/CORRECTNESS.md` — the distilled ledger** (full initial content: Appendix
   B.2), enumerating hard-won correctness requirements from the predecessor as
   requirements the new tests must cover, written at repo creation.
2. **Fixtures generated fresh, not copied.** `fixtures/redact.ts` runs against the
   founder's real `~/.claude` and `~/.codex`, emitting redacted session fixtures.
   Real data, no code motion, regenerable as formats drift.
3. **The predecessor repo as read-only reference** when writing the new parser/
   exporter/harness: consult, never copy.

Repo layout:

```
chox/
  bin/chox.ts
  src/
    substrate/      store.ts, watermarks.ts, schema.sql
    sources/        source.ts, claude-code.ts, codex.ts
    lenses/         lens.ts, handoff/, profile/, repetition/
    engines/        engine.ts, claude.ts, codex.ts
    artifacts/      ir.ts, classify.ts, relay-compiler.ts, skill-compiler.ts,
                    export/ (writer, conflict-detector, placement-map)
    harness/        runner.ts, gates.ts, isolation.ts, run-store.ts,
                    scheduler.ts, notifier.ts, run-events.ts
    slugify.ts
  tests/
  fixtures/         redact.ts + generated redacted sessions
  docs/             SPEC.md (this document), CORRECTNESS.md, plans/
```

## 7. Privacy & Security Contract (headline feature — README, above the fold)

1. **Nothing leaves the machine** except digests sent to the analysis engine the user
   explicitly chose — their *own* agent CLI, i.e. a vendor already processing their
   sessions. No Chox servers, no telemetry, no accounts.
2. **The substrate stores metadata + derived digests**; raw content stays in vendor
   files and is read on demand at analysis time.
3. **Vendor memory stores are opt-in per source** (profile lens) and local-only like
   everything else.
4. **Diagnostics are redacted by construction.** The `doctor --bundle` output never
   contains prompt text, shell commands, or raw filesystem paths. Redaction includes
   non-obvious encodings of sensitive values — e.g. the user's home directory appears
   dash-encoded inside Claude Code project-directory names and must be redacted in
   that form too (a real leak class found in the predecessor).
5. **No network listener until the app phase.** When the app ships, its server binds
   to loopback only, requires a per-install token (set as a cookie by the packaged
   server, required on every API call), and restricts CORS to its own origin. Dev-mode
   convenience bypasses must never ship in the packaged path.
6. **Write safety.** Every file write/delete outside `~/.chox/` goes through ownership
   checks: Chox-generated files carry an ownership marker comment; files without the
   marker (or with another workflow's marker) are never overwritten or deleted —
   conflicts produce warnings, not silent rewrites. Shared-context, shell-rc, and
   profile writes stay inside fenced Chox-owned sections and are applied only after
   explicit user approval. Rename cleanup deletes only files Chox owns.

## 8. Phases

Each phase ships something user zero runs that week; each gate = "does user zero use
it weekly?" Each phase gets a plan doc first.

**Execution-roadmap note (2026-07-14):** `docs/ROADMAP.md` is the active sequencing
and product-gates document after Phase 1b.1. It inserts taskable first-run, external
alpha, and flagship-depth milestones before the broader lenses/daemon/app work below.
It also defers the first public package until the Phase 1c packed, taskable journey
passes; Phase 1b still owns the handle decision and detection evidence.
The phase descriptions in this section remain the canonical intent and historical
record. Before implementing an affected later phase, add a dated amendment here that
reconciles its build packet with the evidence-backed order in the roadmap; do not
rewrite the earlier phase history.

**Phase 1a — The relay runtime (no detection yet).**
Scaffold + CI; relay IR + compiler; harness with gates (§2.2), autonomy enforcement
(§2.1), worktree isolation, run events; `claude` and `codex` runtimes; `chox run`
(+ `--dry-run`, `--resume`), `chox doctor`. User zero **hand-authors** the relay for
his spec→implement→review loop — detection is not needed to deliver the flagship's
value to someone who already knows his loop.
*Accept:* user zero runs his next real feature through `chox run` with gates and
prefers it to the manual bounce; a relay interrupted at a gate resumes cleanly;
`--dry-run` output matches what a real run then does; doctor bundle verified redacted.

**Phase 1a.2 — Hardening from the first acceptance run (added 2026-07-13).**
The first real run (user zero, 2026-07-13) completed and produced a correct,
mergeable implementation — the protocol validated — but surfaced three findings:
headless-only execution replaces the developer's native agent environment
(§2 principle 6 is the response: interactive hops by default); model selection was
silently inherited from CLI defaults (§2 principle 5 amendment: per-hop `model`,
always surfaced); and run visibility failed (silent hops, no gate input echo, no
file-change display, process failed to exit on completion). Scope: interactive hop
mode, per-hop model pinning, run/gate visibility, per-hop token-usage reporting on
headless hops. Plan: `docs/plans/phase-1a2-build-packet.md`.
*Accept:* the original 1a criteria, re-judged on an interactive-mode run, plus: at
every moment the terminal answers *what is happening, what did my keypress do, and
what files changed* — and the process exits on its own.

**ACCEPTED (2026-07-13).** User zero ran a real feature (`chox status`, merged from
the relay's branch) through an interactive-mode relay: native Claude/Codex sessions
throughout ("I was in my own developer environments the entire time"), full
visibility, gates approved, process exited cleanly. Verdict: "worked like a charm."
One friction recorded and fixed in the default templates: the exit-the-session
handoff wasn't discoverable once the native TUI owned the screen — templates now
instruct the agent to announce the exit step in its final message. Caveat: gate
interrupt→resume was demonstrated by tests, not manually exercised in this run.
Phase 1a is closed; Phase 1b (substrate + detection) is next.

**Phase 1b — The substrate + handoff detection. (Demo gate.)**
Substrate store + watermarks; claude-code + codex sources; fixture redactor; handoff
lens (correlate → outcome-weight per §2.3 → engine confirm), historical-cost evidence
on findings (§2.5); `chox detect`, `chox install`, `chox status`.
*Accept:* on user zero's machine, `chox detect` independently finds the loop he
hand-authored in 1a and drafts a comparable relay with honest evidence attached; the
quality targets in §2.6 hold over two weeks of use; the cross-agent demo recording
exists (the artifact no single-vendor tool can produce). npm handle verified and
first publish happens here.

**Publish amendment (2026-07-14):** Phase 1b still verifies the handle and completes
the detection/demo evidence, but the first public package moves to Phase 1c. The
packed artifact must accept a real task and include an immediately runnable starter
relay; a source-ready detector without that activation path is not the first release.

**Phase 1b.1 — Detection hardening from the first acceptance run (added 2026-07-13).**
The first live run (user zero, 2026-07-13) passed the demo gate mechanically — the
loop was found with honest evidence, confirmed, installed, and its dry-run compiled —
but user zero judged the drafted relay's role semantics not comparable to his actual
workflow, and hand-editing a generated relay defeats the product's purpose. Four
evidence-quality causes were identified from the run: interactive Chox-spawned
sessions counted as manual bounces (F9 covered only headless `codex_exec`); a prefix
chain surfaced alongside its longer pattern; role labels were authored from a single
exemplar whose overlapping sessions were flattened into a false sequence; and the
candidate's shape matched an already-installed relay that the system drafted a rival
to instead of recognizing. Scope: worktree-rooted tool-invoked exclusion, prefix
subsumption, existing-relay coverage reporting, multi-occurrence excerpts,
concurrency-honest evidence and engine inputs, confirm-phase progress, `--model` on
detect. Plan: `docs/plans/phase-1b1-build-packet.md`.
*Accept:* the original 1b criteria re-judged on a fresh live run — no self-detected
occurrences, one finding per underlying loop, the hand-authored loop reported as
covered by its installed relay (or a draft user zero runs without semantic edits).
The 1b demo recording and two-week §2.6 window begin only after this passes.

**ACCEPTED (2026-07-14).** The founder reran live `detect` and reported that the
hardened result returned as expected: the installed canonical loop was recognized as
covered and required no rival draft or semantic repair. Phase 1b.1 is closed. The
Phase 1b demo, two-week detection-quality window, and handle verification remain
follow-through work and do not reopen 1b.1.

**Phase 1c — Taskable first run (added 2026-07-14; `docs/ROADMAP.md` Milestone 1).**
Inserted between 1b.1 and Phase 2 per the execution-roadmap note above; the first
public package moves here per the 2026-07-14 publish amendment. Scope: `chox run
<slug> --task <text>|--task-file <path>` with a `{{task}}` template placeholder
(single-pass substitution, validated before worktree creation, persisted in the run
plan for exact dry-run/resume parity); a read-only built-in `spec-implement-review`
starter shipped in the package with resolution order repo-local → global →
built-in; `chox relay list|show` and `chox finding show` (+ interactive `[v]iew`)
discovery/inspection surfaces; the external installed-package onboarding path; and
verification of the actual packed tarball in an isolated prefix. Explicitly out:
generic parameter schemas, relay lifecycle beyond list/show, fix loops, new
sources/engines/lenses, daemon, app. Plan: `docs/plans/phase-1c-build-packet.md`.
*Accept:* a clean-machine rehearsal installs the packed artifact without the source
repo, discovers and inspects the starter, supplies a real task from a file, previews
the exact compiled prompts, reaches the first native agent session with that task,
resumes an interrupted run on the same compiled plan, and edits no relay source
files. Founder-judged live; publish and alpha recruitment follow only after it
passes.

**ACCEPTED AND PUBLISHED (2026-07-14).** The founder completed the clean-machine
rehearsal and accepted Phase 1c. npm rejected the unclaimed `chox` handle under its
anti-squatting similarity policy, so the founder chose the public package name
`chox-cli`; its `bin.chox` entry preserves `chox` as the product and command name.
Version 0.1.0 is the first public release. The post-publish integrity audit is
recorded in `docs/plans/result-0.1.0-publish-audit.md`; its findings were corrected in
the verified `chox-cli@0.1.1` patch release, which is the current npm `latest`.

**Phase 2 — Profile sync + shared context + minimal repetition.**
Vendor memory-store readers (`~/.codex/memories*`, Claude Code memory — location/
format verified at planning time, Open Question 2) + correction-pattern extraction
from raw history; merge/dedupe against existing AGENTS.md/CLAUDE.md; fenced diff
proposals with CLI approval; the repo-local shared-context file that relays and both
tools read. **Minimal repetition lens:** digest → detect → flat `SKILL.md`,
single-agent only — the simplest shippable version; expands Chox beyond multi-agent
users and validates the generation pipeline on real data before Phase 4.
*Accept:* a preference learned in one tool demonstrably applies in the other via the
synced file; a thin-history machine gets first-scan value; no hand-authored line is
ever rewritten; a linear repetition detection exports exactly one `SKILL.md`; user
zero installs one generated skill and still uses it a week later.

**Phase 3 — Resident posture.**
`chox watch`: scheduled incremental scans (watermarks make them cheap), notifications
on new findings and pending gates, `--install` login item, weekly digest default,
persisted dismissals.
*Accept:* a zero-interaction week ends with ≥1 genuinely useful notification and no
false-positive spam.

**Phase 4 — Repetition lens, full rebuild (generation-first).**
The full detect capability on the substrate, informed by Phase 2's minimal version:
digest → detection → classification (flat skill default; single-node lint) →
structured artifacts (gates, parallel, multi-runtime) via the generation subsystem,
with explicit latency and quality budgets set in the phase plan.
*Accept:* a non-trivial detection exports a structured skill with gates; user zero
installs a generated skill and still uses it a week later (output-quality bar, not
shape bar); the placement map writes one skill invocable from two different agents.

**Phase 5 — Plurality + app surface.**
Additional sources/engines/runtimes by observed demand (Cursor `state.vscdb` vs
OpenClaw); the local app: one artifact list, document-first detail view, Diagram tab
only on structured artifacts, security model per §7.5.
*Accept:* the full loop completes on a machine whose only agent is not Claude Code;
the loop also completes with the app never opened (CLI-parity guard).

## 9. Risks

- **Fresh-code correctness debt (accepted).** Ground-up code re-earns what the
  predecessor's test suite encoded. Mitigation: §6 (ledger + fresh fixtures +
  reference repo) plus two-platform CI (Ubuntu + macOS; Windows deferred per the §4
  platform note) from day one. Residual risk consciously accepted.
- **Gate ergonomics (top product risk).** If approving at a boundary is clunkier than
  bouncing manually, the flagship fails its own Phase 1a gate — before detection even
  exists. §2.2 is a floor, not a ceiling; the Phase 1a plan treats gate UX as a
  first-class design problem.
- **Detection quality (acquisition risk, not existential).** The relay runtime retains
  user zero regardless (1a precedes detection); but noisy detection kills adoption
  beyond user zero. Mitigations: §2.3 weighting, §2.6 targets, cold-start honesty,
  precision-biased thresholds, persisted dismissals.
- **Format drift (permanent).** All vendors change local formats without notice —
  including memory-store formats, which are less stable than transcripts. Fixtures +
  drift tests per source, per-source graceful degradation, doctor bundles for async
  debugging. Appendix A facts carry dates for exactly this reason.
- **Sparse data.** Detection must work on thin histories (user zero's own Codex volume
  is ~33 sessions over 6 months) — session-level correlation, precision over recall,
  and the §2.6 sparse-data behavior (explain, never garbage).
- **Vendor sherlocking — partially realized already.** `/insights` crossed the
  report→artifact line on Claude-only data in 2026 (ready-to-paste rules, skill/hook
  suggestions), and VS Code is building native multi-agent surfaces. The remaining
  defense is strictly structural: cross-source input only a neutral tool can have,
  plus gated isolated execution. Any Chox feature that works on one vendor's data
  alone should be assumed sherlockable within quarters.
- **OSS fast-follow.** The bridge ecosystem (Appendix C) shows how quickly this
  community replicates plumbing; any of those projects could add history mining. The
  moat is executing the *intersection* (substrate + detection + protocol + evidence)
  fast and visibly, not any single component.
- **Transient behavior.** Model convergence could dissolve plan-here-implement-there.
  Accepted: Chox is built first for a user who has the problem today, and the
  substrate/lens architecture survives any single lens dying.
- **Trust.** A resident transcript-reading daemon must be boring, auditable, and
  dependency-light. §7 ships in the README above the fold.

## 10. Open Questions

1. **npm handle** — `chox` was unclaimed on the npm registry as of 2026-07-12
   (404 on `npm view chox`). Re-verify at Phase 1b publish time; pick a scoped
   fallback (`@<owner>/chox`) if taken by then. **Founder decision (2026-07-12):
   do NOT claim the handle early with a placeholder publish — prior attempts to
   register `chox` on npm hit issues, and the handle choice is deferred entirely
   to Phase 1b. The package stays `private: true` until then; `chox` remains the
   internal/CLI name regardless of what the eventual npm handle is.**
   **Resolved (2026-07-14):** the registry again rejected `chox` under its
   anti-squatting similarity policy despite the handle remaining unclaimed. The
   founder declined a personal scope and published `chox-cli@0.1.0`; the CLI command
   remains `chox`.
2. **Claude Code memory location/format** for the profile lens — verify on the
   founder's machine at Phase 2 planning. **Fallback:** if a vendor memory store is
   unreadable or drifts, the profile lens degrades to correction-pattern extraction
   from raw history only — slower, but structurally stable.
3. **Third source** — Cursor vs OpenClaw, by observed demand at Phase 5.
4. **Daemon packaging beyond login item** — revisit after Phase 3 retention evidence.
5. **Artifact sharing** — whether installed relays/skills can be exported as shareable
   templates (with redacted paths and prompts). Out of scope for Phases 1–4, but the
   placement-map format should not preclude it.

---

## Appendix A — Known Source Formats (observed 2026-07-05; drift expected, all facts fixture-tested)

### A.1 Claude Code

- **Location:** `~/.claude/projects/<encoded-cwd>/*.jsonl` — one directory per
  project, one JSONL file per session. `<encoded-cwd>` is the session's working
  directory with `/` and `.` replaced by `-` (e.g.
  `/Users/x/Documents/GitHub/repo` → `-Users-x-Documents-GitHub-repo`). This encoding
  means the user's home directory appears dash-encoded in directory names — a
  redaction-relevant fact (§7.4).
- **Content:** one JSON object per line; entries carry `type` and ISO `timestamp`
  fields. Parsers MUST tolerate: literal `null` lines (`JSON.parse('null')` returns
  null, not an error — guard it), and unknown entry types — a dozen-plus types beyond
  user/assistant messages have been observed (`last-prompt`, `ai-title`,
  `file-history-snapshot`, …). Unknown types are counted in diagnostics and skipped,
  never scan-fatal.
- **Join key:** the working directory (encoded in the project dir name; also present
  in entries).
- **Related state (profile lens):** Claude Code maintains per-project auto-memory;
  location/format to be verified at Phase 2 planning (Open Question 2).

### A.2 Codex

- **Location:** `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO-timestamp>-<uuid>.jsonl` —
  one file per session, sharded by date. A top-level index exists at
  `~/.codex/session_index.jsonl` with `{ id, thread_name, updated_at }` per line
  (useful for cheap discovery; treat as advisory, the session files are the truth).
- **Line schema:** `{ timestamp, type, payload }`. Observed `type` values:
  - `session_meta` (always the first line) — payload keys observed:
    `base_instructions`, `cli_version`, `cwd`, `git`, `id`, `model_provider`,
    `originator`, `source`, `thread_source`, `timestamp`. **`cwd` is the join key**;
    `git` carries repo info.
  - `event_msg` — turn-level events (payload includes `turn_id`,
    `model_context_window`, etc.).
  - `response_item` — message content (`{ content, role, type }`).
- **`originator` values observed:** `codex_vscode` (VS Code extension; 32/33 sessions
  on the reference machine) and `exec`-sourced runs. This field distinguishes
  human-driven sessions from tool-invoked ones — required by the handoff lens
  (§1.2): a human bounce is an automation candidate; a tool-invoked hop is evidence an
  automation already exists.
- **Memory stores (profile lens, opt-in):** `~/.codex/memories/` directory and
  `memories_1.sqlite` observed; format unverified — treat as Phase 2 verification
  work with the raw-history fallback (Open Question 2).

### A.3 Founder-machine evidence snapshot (2026-07-05)

33 Codex session files (Jan–Jul 2026) vs ~17 active Claude Code days on the primary
repo alone; 3 repos present in both histories; 6 same-day overlap days on the primary
repo; verified hour-level alternation (Claude 16:24 → Codex 16:49 → Claude 17:13,
2026-06-23, same repo). This is the dataset Phase 1b's detection is tuned against.

## Appendix B — Provenance & Correctness Ledger

### B.1 Provenance

Chox's predecessor is **Claude Workflow Composer (CWC)** — a published, Claude-only
tool (npm: `claude-cwc`) that scans Claude Code history for repeated work and promotes
it to runnable multi-agent workflows on a canvas. Decisions that shaped Chox:

- **Two products permanently** (2026-07-05): CWC stays as-is in maintenance mode
  (bug fixes + diagnostics only); Chox is the agent-agnostic successor in a fresh
  repo. No shared library, no cross-repo dependency, no code motion. CWC's README
  points to Chox once the Phase 1b demo exists.
- **Ground-up new code** (founder decision, 2026-07-05, reversing an earlier
  transplant plan): AI-assisted rebuilds are cheap and code-copying overhead isn't
  wanted. The cost — re-earning ~630 tests' worth of encoded correctness — is
  mitigated by this appendix's ledger, fresh fixtures, and CWC-as-reference.
- CWC's user-research history (one full user interview, one remote install failure)
  produced two durable lessons baked into this spec: install friction and generation
  latency/quality leak users (hence generation-first + quality bars in phase
  acceptance), and detect-style output moments land ("worked like a chart" — hence
  evidence attached to every finding).

### B.2 `CORRECTNESS.md` initial ledger (requirements the new tests must cover)


1. **Windows shell quoting:** spawning shell commands via `execFile` with a command
   string loses quoting on Windows (`cmd` quote-escaping); use `exec` (or argv-array
   spawning) for user-supplied shell commands. Found post-publish in the predecessor.
2. **Transcript drift tolerance:** unknown JSONL entry types are counted and skipped,
   never fatal; literal `null` lines must not crash parsing (`JSON.parse('null')`
   succeeds and returns null — guard the falsy case).
3. **Redaction completeness:** diagnostics must redact sensitive values in derived
   encodings too — notably the dash-encoded home directory inside Claude Code project
   names.
4. **Dispatch naming:** agent/skill frontmatter `name` must be the dispatch slug, not
   a human title — dispatch resolves against frontmatter, not filenames. Skills are
   directory-keyed; agents are name-keyed.
5. **Ownership safety:** never overwrite or delete a file without verifying an
   ownership marker proves this tool (and this workflow) owns it; foreign and
   hand-authored files produce warnings, never rewrites.
6. **Rename reconciliation:** renaming an artifact may delete the old file only if
   owned; slug collisions are detected and resolved deterministically.
7. **Process honesty:** never report a service/run as started without verifying it
   (health check); on port collision, name the occupant; `stop` must report what it
   actually stopped.
8. **Timing variance:** scheduler and process tests must tolerate Windows timing and
   path differences; CI runs both OS families from day one.
9. **Worktree hygiene:** isolated-run worktrees are cleaned up including orphans from
   crashed runs.
10. **Real-FS testing:** filesystem behavior is tested with temp directories and path
    overrides, never mocks; tests never touch real `~/.chox`, `~/.claude`, or
    `~/.codex`.

## Appendix C — Competitive & Demand Landscape (live research, 2026-07-12; re-verify before major bets)

### C.1 Demand evidence

- Community analysis of **500+ Reddit comments** (r/codex, r/ClaudeCode,
  r/ChatGPTCoding) converges on running Claude Code + Codex together: Claude plans,
  Codex implements, Claude reviews — with the handoff done by **manually pasting** the
  plan. This is precisely the loop relays formalize.
- Documented pain points in that community match §2's list one-for-one: context
  discontinuity at handoff, docs fragmentation (CLAUDE.md vs AGENTS.md), plan
  formatting for the implementer, cost-aware tool selection.
- Adoption surveys (2026): ~70% of engineers use 2–4 AI tools simultaneously; ~59%
  run 3+ in parallel; Claude Code (~28%) and Cursor (~24%) lead primary-tool share;
  ~68% prefer predictable single-agent setups over complex multi-agent configs (the
  positioning constraint in §3).

### C.2 Adjacent categories and threat levels

| Category | Examples (2026) | What they do | Threat to Chox |
| --- | --- | --- | --- |
| Parallel-run managers | Conductor, Claude Squad, Vibe Kanban, Nimbalyst, aizen, amux | Run many agents on separate tasks in worktrees; dashboards/kanban | **Low-moderate.** Different job (parallelism vs sequential protocol); complementary (§2.7); could add handoff features |
| Claude↔Codex bridges | xiaocang/claude-codex-bridge, abhishekgahlot2/codex-claude-bridge (bidirectional), AmirShayegh/codex-claude-bridge (review), eLyiN/codex-bridge, hampsterx/claude-mcp-bridge, helix-codex | MCP transport between agents; some parse JSONL traces; filesystem PLAN.md/RESULT.md conventions | **Moderate.** Commoditizes the transport half of relays; validates the artifact-handoff design; any could add history mining (fast-follow risk) |
| History viewers/analyzers | claude-code-history-viewer (27 assistants), claude-session-analyzer, claude-history, claude-code-sessions | Browse/search/quantify local session history | **Low.** Reports and browsing only; no artifacts, no execution — but proves multi-source parsing is replicable |
| Vendor native | Claude Code `/insights` + auto-memory + orchestration; Codex multi-agent orchestration; VS Code multi-agent development | `/insights` now emits CLAUDE.md rules + skill/hook suggestions (single-silo report→artifact loop closing); platforms adding agent-coordination surfaces | **High on any single-silo feature; structurally blocked from cross-source.** Assume single-vendor features are sherlocked within quarters |
| Insights-to-artifact CLIs | yahav10/claude-insights | Parses `/insights` HTML → skills, CLAUDE.md rules, settings | **Moderate for repetition lens (Claude-only).** Confirms artifact demand; Claude-silo only, no execution harness |
| Cross-tool memory | agentmemory, symlink/@-reference conventions | Shared runtime memory layer across coding agents (MCP/hooks) | **Moderate for profile lens.** Different mechanism (runtime service vs proposed diffs to user-owned files); overlapping promise — differentiate on derived-from-history evidence + user-owned output |

### C.3 The open intersection

No tool found (2026-07-12) combines: cross-source local history indexing → detection
of a user's own cross-model loop → a drafted, gated, autonomy-dialed relay → executed
through an isolated harness with evidence attached. Every neighbor holds one or two
components; none holds the chain. That intersection is the product; each component
alone is contested.
