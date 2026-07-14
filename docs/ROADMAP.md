# Chox Product Roadmap

- **Status:** Active execution roadmap
- **Effective:** 2026-07-14
- **Owner:** Founder
- **Current position:** Phase 1b.1 is accepted and closed; the Phase 1b
  detection-quality window, demo recording, handle verification, and Phase 1c packet
  remain open.

This document turns Chox's product thesis into an ordered path from a strong
technical kernel to a product other developers can install, understand, trust, and
use repeatedly. It is deliberately more operational than `docs/SPEC.md` and more
durable than an individual phase packet.

## How to use this roadmap

- Start with [the roadmap overview](#6-roadmap-overview) to see what is in progress,
  next, and gated.
- Work only from the detailed section for the active milestone.
- Use [the immediate next actions](#20-immediate-next-actions) as the current founder
  checklist.
- Apply [the UX standards](#16-ux-standards-for-every-milestone) and
  [definition of done](#19-definition-of-done) to every build packet.
- At each milestone close, update its checkboxes, the overview status, measured
  baselines, and [the change log](#22-roadmap-change-log).
- Never mark later work active merely because earlier engineering is merged; pass the
  behavioral exit gate first.

The roadmap is organized as:

1. product direction and measures (§1–§6);
2. milestone-by-milestone execution (§7–§15); and
3. permanent UX, operating, prioritization, and completion rules (§16–§22).

## 1. Document authority

The project documents have distinct jobs:

1. `docs/SPEC.md` defines enduring product intent, architecture, privacy, and the
   original phase strategy.
2. `docs/CORRECTNESS.md` defines mandatory correctness requirements. It always wins
   over schedule or convenience.
3. `docs/ROADMAP.md` defines the current product sequence, milestone gates, and the
   evidence required to proceed.
4. `docs/plans/phase-*-build-packet.md` defines the exact scope and interfaces for
   one implementation phase.
5. `docs/plans/challenge-notes-*.md` and `result-*.md` preserve what changed, why,
   how it was verified, and what remains.

Historical specs, packets, challenge notes, and results are records. Do not rewrite
them to make a later decision look inevitable. When this roadmap changes product
intent in `docs/SPEC.md`, add a dated amendment to the spec before implementing the
affected phase.

## 2. North Star

> **Turn the way a developer already uses coding agents into a safe, repeatable
> command that produces reviewed work.**

The complete user promise is:

> Give Chox a real software task. Chox runs the user's proven cross-agent workflow
> in an isolated Git worktree, carries context through durable artifacts, pauses at
> meaningful judgment points, and returns a reviewed branch without making the user
> reconstruct prompts or handoffs.

The intended flagship invocation is:

```sh
chox run <relay> --task-file <task.md>
```

The product journey is:

```text
install
  → understand the privacy boundary
  → run a useful starter or detect a personal workflow
  → inspect what Chox will do
  → provide a real task
  → execute through native agent sessions in an isolated worktree
  → approve, edit, redirect, or stop at each boundary
  → review and, when needed, fix the work
  → keep a reviewed branch and a durable run record
  → reuse and improve the workflow
```

Agent history is the differentiating input, not the first thing users are asked to
care about. The substrate discovers and improves the workflow; the workflow getting
real work done is the product.

### 2.1 Beachhead user

The first external user is:

- an experienced developer on macOS or Linux;
- already using Claude Code and Codex on at least some of the same repositories;
- deliberately choosing different agents for planning, implementation, or review;
- comfortable in a terminal and Git;
- frustrated by re-explaining tasks and manually preserving handoff context;
- interested in human checkpoints, not an opaque autonomous swarm.

User zero remains a required source of conviction, but user-zero success alone no
longer closes a phase after the first public alpha. External usability and repeat use
become required evidence.

### 2.2 Positioning

Use this language:

> **Your best agent workflow, made repeatable.** Chox learns how you already move
> work between coding agents, turns that pattern into a gated relay, and runs each
> task in an isolated worktree with you in control.

Do not lead with:

- orchestration;
- multi-agent swarms;
- transcript mining;
- dashboards or canvases;
- replacing the user's existing agent interface;
- speculative time-saved claims.

### 2.3 North-star metric

The primary product metric is **weekly successful relay runs**.

A successful relay run:

1. starts from a real user task;
2. requires no manual editing of relay source files;
3. reaches its review/completion boundary;
4. preserves every change on a run branch;
5. leaves the user with an understandable next action; and
6. is judged useful enough that the branch is kept, merged, or opened as a PR.

Chox has no telemetry. Early measurement comes from local status summaries, explicit
opt-in exports, founder observation, and short follow-up interviews. Do not weaken
the privacy contract to make measurement easier.

## 3. What is true today

### 3.1 Proven

- The relay runtime can conduct native Claude and Codex sessions through a real
  plan → implement → review workflow.
- Worktree isolation, commit-before-removal safety, gates, resume, exact dry-run
  prompts, autonomy enforcement, and run visibility exist.
- User zero completed real features with the runtime and preferred it to the manual
  bounce.
- Claude Code and Codex histories can be indexed locally without placing raw prompts
  in the substrate database.
- Cross-source handoff patterns can be detected, confirmed, drafted, installed, and
  recognized as already covered.
- The codebase has a strong test and correctness posture with no production
  dependencies today.

### 3.2 Not yet proven

- A developer can install Chox without cloning and building the repository.
- A new user can start a real task without editing a prompt template.
- A published package contains an immediately runnable starter workflow.
- Users can discover, inspect, manage, and understand installed relays without
  remembering slugs or filesystem paths.
- A generated relay is trusted before installation because its roles and prompts are
  visible at the decision point.
- The review boundary can send work back through a fix/re-review cycle cleanly.
- Developers other than user zero complete the journey without live help.
- External users return and use Chox again.
- Enough product state exists to justify a resident daemon or local app.

The next milestones close these gaps in that order.

## 4. Product principles

Every phase and feature is evaluated against these principles.

1. **Task first.** The shortest path begins with work the user wants done, not with
   configuration or product architecture.
2. **Depth before breadth.** Finish the relay journey before adding another lens,
   source, runtime, daemon, or app.
3. **Progressive trust.** Explain what will be read, written, spawned, persisted, and
   sent to a vendor before it happens.
4. **Native sessions remain native.** Chox conducts between the tools developers
   already know; it does not build a worse replacement terminal.
5. **Human judgment is product value.** Gates should make approval easier and more
   informed, not merely interrupt automation.
6. **Persistence is harness-owned.** Tasks, compiled plans, artifacts, decisions, and
   resume state must never depend on a model remembering a convention.
7. **Local-first is visible.** No account, Chox service, telemetry, or hidden network
   activity. Vendor-bound analysis is selected and announced.
8. **Evidence over claims.** Say what happened, what was observed, and what the user
   can do next. Never manufacture savings or confidence.
9. **Safe defaults, explicit power.** The default path is gated and isolated. Expert
   acceleration exists without complicating the first run.
10. **Every output is actionable.** Findings lead to an inspectable artifact; reviews
    lead to a decision; errors lead to recovery steps.
11. **External evidence joins user-zero conviction.** After the alpha, a milestone is
    not complete until at least one target user outside the project demonstrates its
    value.

## 5. Product health measures

These definitions stay stable so phases do not invent convenient success criteria.

| Measure | Definition | Initial target |
|---|---|---|
| Activation | Install → first real relay hop starts | ≥4 of first 5 observed users |
| Time to first value | Elapsed setup time before the first real hop starts, excluding agent execution | Median ≤10 minutes |
| Task entry integrity | Real task starts without editing relay files | 100% of observed runs |
| Run completion | Started real tasks reaching review/completion without product failure | ≥80% in alpha |
| Useful outcome | Completed run whose branch is kept, merged, or opened as a PR | ≥60% in alpha; raise with evidence |
| Seven-day retention | Activated user starts another real relay within 7 days | ≥2 of first 5 users |
| Detection precision | Installed/kept/covered ÷ installed/kept/covered/dismissed | ≥50% with ≤1 dismissal per active week |
| Gate friction | User can explain the artifact, action, and next consequence at each gate | No observed ambiguous gate in release candidate |
| Trust incidents | Lost work, foreign overwrite, silent engine spend, unannounced network behavior | Zero |
| Documentation success | User completes the primary journey without maintainer intervention | ≥4 of first 5 observed users after alpha fixes |

Targets are deliberately small-sample and behavioral. Replace them with stronger
cohort targets only when the project has enough users to make percentages meaningful.

## 6. Roadmap overview

| Order | Status | Milestone | Product outcome | Gate to continue |
|---:|---|---|---|---|
| 0 | In progress | Close Phase 1b follow-through and prepare 1c | Detection is accepted and release prerequisites are known | Demo, measurement, handle decision, and 1c packet are complete |
| 1 | Next | Phase 1c — Taskable First Run | A clean install can start a real task without editing Chox files | Packaged clean-machine journey succeeds |
| 2 | Gated | Phase 1c.1 — Private Alpha | Target developers complete the journey without coaching | Activation, completion, trust, and repeat-use gates pass |
| 3 | Gated | Phase 1d — Complete the Job | Review can lead to fix/re-review and a clear branch outcome | Repeated real tasks finish without terminal choreography |
| 4 | Gated | Phase 2A — Personal Context and Relay Refinement | Repeated runs require less re-explanation and workflows improve safely | Users keep and reuse proposed context/refinements |
| 5 | Gated | Phase 3 — Resident Posture | Useful discovery arrives without manual scans or spam | A quiet week produces useful notification value |
| 6 | Gated | Phase 4 — Adjacent Artifacts | Proven demand expands Chox beyond relays one lens at a time | Each generated artifact remains in use after one week |
| 7 | Gated | Phase 5 — Local Product Surface | A local app makes established workflows easier to operate | App improves completion/understanding and preserves CLI parity |
| 8 | Gated | Phase 6 — Plurality and Platform Expansion | Additional tools/platforms enter from demonstrated demand | Full journey succeeds for the new target environment |

Phase numbers after 1b.1 refine the original sequence in `docs/SPEC.md`. Before an
affected build packet is approved, add a dated spec amendment recording the split and
new order. Do not erase the original phase history.

## 7. Milestone 0 — Close Phase 1b Follow-through and Prepare Phase 1c

### Objective

Phase 1b.1 is accepted. Finish the remaining Phase 1b evidence and release decisions,
then make Phase 1c decision-complete. Do not confuse closed hardening work with a
finished acquisition/release milestone.

### Step-by-step

- [x] Run live detection against founder-controlled histories with the installed
      canonical relay present.
- [x] Verify the canonical loop is reported as `covered` and does not spend a vendor
      call drafting a rival.
- [x] Verify no Chox worktree session contributes to an organic occurrence.
- [ ] Inspect at least one live overlapping occurrence if available and confirm the
      output communicates concurrency rather than a false strict sequence.
- [ ] If no live overlap exists, record that fact; retain the synthetic coverage and
      do not manufacture a live acceptance claim.
- [x] Record the exact live outcome and any remaining caveat in
      `docs/plans/result-1b1.md`.
- [x] Run the repository handoff commands: typecheck, complete tests, build, both
      canonical dry-runs, and doctor.
- [ ] Confirm the configured CI matrix passes on supported Node and OS versions.
- [ ] Record the Phase 1b cross-agent demo showing detect → evidence → covered or
      installed relay → current dry-run. Label it as a source-build demo; Phase 1c
      owns the clean-install, task-input demo.
- [ ] Continue and close the two-week detection-quality measurement.
- [ ] Verify the npm package name or choose the scoped fallback.
- [ ] Record the package decision without publishing a knowingly incomplete first-run
      experience.
- [ ] Write and approve the Phase 1c build packet.

The two-week measurement may run while Phase 1c is planned and implemented. Do not
leave useful engineering idle, but do not mark the broader Phase 1b milestone
complete until its evidence window is honestly closed.

### Exit gate

- Live covered-loop behavior is accepted by user zero.
- No known evidence wording misrepresents concurrency.
- CI and local verification pass.
- Demo exists or has a dated, explicit blocker.
- Detection-quality measurement is underway with a scheduled end date.
- Package name decision is ready.
- Phase 1c packet is decision-complete.

### Out of scope

- New lenses.
- Daemon/watch behavior.
- App or TUI work.
- Broader relay-runtime changes beyond a Phase 1b correctness defect.

## 8. Milestone 1 — Phase 1c: Taskable First Run

### Objective

Make the flagship useful from an installed package. A user should provide a task and
start a workflow without editing a relay template, cloning Chox, or memorizing where
relays live.

### Target journey

```sh
npm install -g <resolved-package-name>
cd <an-existing-git-repository>
chox doctor
chox relay list
chox relay show spec-implement-review
chox run spec-implement-review --task-file task.md --dry-run
chox run spec-implement-review --task-file task.md
```

The precise package name remains founder-controlled. The CLI journey does not.

### Step 1 — Define the task input contract

- Add `chox run <slug> --task <text>` for short tasks.
- Add `chox run <slug> --task-file <path>` for durable or multiline tasks.
- Make the flags mutually exclusive.
- Reject an empty string, empty file, unreadable file, invalid encoding, or missing
  required task before creating a worktree or spawning an agent.
- Resolve the task once. The same bytes feed dry-run, real execution, and resume.
- Add the `{{task}}` template placeholder.
- Require built-in and newly drafted relays to consume the task in their first
  applicable hop.
- Detect whether a relay consumes task input. If `--task`/`--task-file` is supplied
  to a relay that does not, fail before worktree creation with migration/customizing
  guidance; never accept and silently drop a task.
- If a relay requires task input and none is supplied, fail with the exact supported
  flags. Fixed-purpose relays without `{{task}}` remain valid and runnable without a
  task.
- Define an ownership-safe path for pre-1c generated relays to become taskable; do
  not silently rewrite installed relay files.
- Keep replacement single-pass so task text containing braces cannot become a second
  template expansion.
- Treat task contents as untrusted input at the filesystem and JSON boundaries.
- Persist the compiled prompt in the run plan so resume remains exact.
- Document that run plans contain compiled prompt/task text under `~/.chox/runs/`;
  distinguish that from the metadata-only substrate database.
- Add real-FS tests for multiline text, Unicode, long tasks, special characters,
  relative and absolute task-file paths, missing input, conflict flags, dry-run
  parity, and resume.

Do not introduce a generic parameter-schema framework in this phase. One real input
should prove the contract before Chox generalizes it.

### Step 2 — Ship a built-in starter relay

- Package `spec-implement-review` and its templates with the published artifact.
- Resolve relays in this order: repository-local → user-global → built-in. User-owned
  choices override the starter; the starter remains a safe fallback.
- Keep built-ins read-only.
- Provide an explicit copy/customize action later rather than mutating package files.
- Ensure the starter requires `{{task}}` and never instructs the user to edit its
  Markdown before a run.
- Verify both Claude Code and Codex requirements before the first real spawn and give
  a precise recovery message when one is unavailable.
- Test the actual packed tarball in a fresh temporary prefix, outside the source
  checkout, with isolated homes and fake agent binaries.

### Step 3 — Make relays discoverable

Add a stable management namespace. Recommended initial surface:

```sh
chox relay list
chox relay show <slug>
```

`relay list` shows:

- slug;
- source: repository, global, or built-in;
- hop count and runtime sequence;
- gate posture;
- whether a task is required; and
- the shadowing/precedence result when names collide.

`relay show` shows a compact, readable workflow summary first, with an explicit flag
for complete prompt text. Do not dump every prompt by default.

### Step 4 — Make generated findings inspectable

- Add `[v]iew` to the interactive detect decision before install/dismiss/skip.
- Add a non-interactive equivalent such as `chox finding show <finding-id>`.
- Show evidence, proposed roles, runtimes, autonomy, gates, artifacts, and prompt
  summaries before installation.
- Offer full prompt text on demand.
- Keep engine identity, model, call ceiling, and actual spend visible.
- End installation with the exact next command, including a task placeholder:

  ```text
  Next: chox run <slug> --task-file <task.md> --dry-run
  ```

- A covered finding should point to `chox relay show <slug>` and a runnable next
  command instead of ending at “already automated.”

### Step 5 — Build the external onboarding path

- Put an installable quickstart above development-from-source instructions.
- Explain the privacy boundary immediately before `detect`, not only in a long policy
  section.
- Explain that a starter relay works immediately while detection personalizes later.
- Make every quickstart command copyable and runnable as written.
- Add command-specific help for `run`, `detect`, `relay`, `finding`, `doctor`, and
  `status`.
- Keep terminology task-focused. Introduce “relay,” “finding,” “lens,” and
  “substrate” only when the user needs each concept.
- Add uninstall and data-removal instructions that distinguish the package, global
  relays, run records, substrate, and preserved Git branches.
- Record a short terminal demo of the clean-install journey.

### Step 6 — Verify the product journey

- Test source execution.
- Test the packed artifact.
- Test repository-local and global relay precedence.
- Test with no prior Chox home.
- Test with one missing agent binary.
- Test with no history and with enough history for a finding.
- Test a task dry-run followed by real execution and assert exact prompt parity.
- Interrupt at a gate and resume with no task loss.
- Confirm doctor bundles contain no task text or compiled prompts.
- Confirm `.chox-run/` remains excluded from implementation commits.
- Verify the full correctness suite and standard handoff commands.

### Exit gate

A clean-machine rehearsal must demonstrate:

1. package installation without the source repository;
2. successful doctor guidance;
3. discovery and inspection of the starter relay;
4. a real task supplied from a file;
5. an exact dry-run preview;
6. the same task reaching the first native agent session;
7. an interrupted run resuming with the same compiled plan; and
8. no relay-source edits.

The milestone is not complete until the packed artifact passes this journey.

### Out of scope

- Generic relay input schemas.
- Conditional graphs or automatic fix loops.
- New history sources, engines, runtimes, or lenses.
- Scheduled scans.
- A full-screen TUI or local web app.
- Cloud services, accounts, telemetry, or sharing marketplaces.

## 9. Milestone 2 — Phase 1c.1: Private Alpha and UX Hardening

### Objective

Prove that developers other than the founder can install, understand, and complete
the flagship journey without live rescue.

### Participant profile

Recruit five developers who meet the beachhead definition. Do not recruit broad
“AI-curious” users yet; the product has not been designed for them.

At least three participants should have meaningful local history in both Claude Code
and Codex. Up to two may have sparse history so the starter and no-findings path are
tested honestly.

### Step-by-step study

For each participant:

1. Ask them to install from the release instructions without facilitator
   intervention. Observation or screen sharing is allowed with consent.
2. Ask what they believe Chox reads, stores, and sends before they run `detect`.
3. Have them run `doctor` and recover from any real warning.
4. Have them find and inspect the starter relay.
5. Give them a small real task in one of their repositories.
6. Have them preview and start the relay.
7. Interrupt one run at a gate and resume it.
8. Have them interpret artifacts, file changes, and gate actions aloud.
9. Have them decide what to do with the final branch.
10. If they have enough history, run detection, inspect a finding, and decide whether
    to install or dismiss it.
11. Interview them immediately about trust, confusion, unnecessary steps, and the
    point where Chox felt more useful than manual bouncing.
12. Follow up after seven days and ask whether they ran Chox again without prompting.

Record, with consent:

- install failures;
- time to first real hop;
- every command copied incorrectly;
- every unfamiliar term;
- every moment the participant asks “what is happening?” or “what do I do next?”;
- gate decisions and misunderstandings;
- whether the branch was useful;
- whether they returned within seven days; and
- exact reasons for non-return.

Do not record transcript content or proprietary task text in research notes unless
the participant explicitly provides a redacted example.

### Fix order

1. P0: task cannot complete, work can be lost, privacy/spend is misunderstood.
2. P1: user needs maintainer help, installs the wrong thing, or cannot explain the
   next action.
3. P2: unnecessary friction with a known workaround.
4. P3: polish that does not change activation or trust.

Run at least one participant through the revised flow after each P0/P1 batch. Do not
assume a fix works because its copy reads better to the author.

### Exit gate

- At least four of five participants activate.
- At least three complete a real run to review/completion.
- Median setup time to first real hop is ten minutes or less.
- No participant edits a relay source file for the happy path.
- No trust incident occurs.
- At least two participants start another real relay within seven days.
- The final participant can complete the revised journey without intervention.

If fewer than two users return, stop roadmap expansion. Diagnose retention before
building the daemon, new lenses, or app.

### Deliverables

- Dated alpha research notes containing only permitted/redacted evidence.
- An issue list with P0–P3 severity and observed frequency.
- A result document describing fixes and unresolved friction.
- Updated activation/retention baselines in this roadmap.
- A go/iterate/stop decision for Phase 1d.

## 10. Milestone 3 — Phase 1d: Complete the Job

### Objective

Turn a successful sequence of hops into a complete development loop. The user should
not need to manually reconstruct how review findings get fixed or what happens to the
run branch.

### Step 1 — Improve the final review boundary

- Give every final review a clear `ship`, `fix`, or `blocked` conclusion.
- Surface that conclusion in the gate and completion summary without relying on the
  user to open a file first.
- Keep the underlying review artifact visible and authoritative.
- When the review blocks, offer an explicit user-directed fix path that passes the
  review artifact back to an implementation/fix hop.
- Re-review after fixes.
- Bound automatic cycles with a visible maximum and cost/spend implication.
- Never infer approval from an agent's prose alone; the user controls the boundary.

The first version may be a constrained review → fix → review loop. Do not build a
generic DAG engine until repeated workflows require it.

### Step 2 — Clarify branch completion

- Always summarize the base commit, run branch, worktree disposition, and changed
  files.
- Offer safe next actions: leave branch, print merge command, or print PR guidance.
- Add automated merge/PR behavior only after alpha evidence shows that copying the
  command is material friction.
- Preview every mutating Git action and preserve the branch regardless of failure.
- Never offer discard as a path that can lose unmerged agent work.

### Step 3 — Complete relay lifecycle management

Expected surface, subject to its build packet:

```sh
chox relay list
chox relay show <slug>
chox relay copy <slug> --local|--global
chox relay validate <slug>
chox relay remove <slug>
```

- Copying a built-in creates a user-owned editable relay with provenance.
- Validation explains exact files, placeholders, runtimes, and conflicts.
- Removal checks ownership and never deletes a foreign directory.
- Rename/collision behavior follows C5/C6.
- Installed generated relays retain finding provenance.

### Step 4 — Refine gate ergonomics

- Keep no more than four visible decisions at one boundary.
- Show what changed since the previous gate, not only absolute artifact paths.
- Put the recommended/default action first but never hide alternatives.
- Explain the consequence of each key before reading it.
- Preserve edit/redirect/abort/resume behavior.
- Ensure keyboard-only and screen-reader-friendly terminal output; color must never be
  the sole carrier of meaning.

### Exit gate

- A blocked review can be fixed and re-reviewed without starting a separate manual
  workflow.
- A successful run ends with an unambiguous, safe branch outcome.
- Users can discover, inspect, customize, validate, and remove owned relays without
  editing Chox's installation.
- User zero completes at least three real tasks in two weeks through the refined
  loop.
- At least one external alpha user completes and repeats the refined loop.

### Out of scope

- Arbitrary graph composition.
- Parallel swarms.
- Automatic merging by default.
- A visual workflow canvas.

## 11. Milestone 4 — Phase 2A: Personal Context and Relay Refinement

### Objective

Use Chox's cross-source advantage to reduce repeated explanation and improve an
already useful relay. This milestone deepens the flagship before introducing a new
artifact category.

### Step 1 — Shared context

- Define one repo-local shared-context surface that both supported agents reliably
  read.
- Keep Chox content inside an ownership-marked fenced section.
- Preview a diff before every write.
- Never rewrite hand-authored content outside the owned section.
- Allow decline, edit, and later removal.
- Include only durable project/workflow context, not task-specific secrets or raw
  transcript passages.
- Make context use visible in dry-run and run summaries.

### Step 2 — Evidence-backed relay refinement

- Compare installed relay shape and prompts with later high-weight occurrences.
- Propose changes; never silently mutate an installed relay.
- Attach the supporting occurrence evidence and explain why a role, runtime, prompt,
  or gate would change.
- Show a semantic summary and exact diff.
- Version accepted relay changes and preserve rollback/provenance.
- Keep dismissed refinements dismissed unless materially new evidence appears.

### Step 3 — Local outcome feedback

- Record only local, explicit outcome facts: completed, aborted, kept branch, merged,
  redirected, or review-blocked.
- Do not claim code quality from completion alone.
- Let the user correct or remove local outcome labels.
- Use the evidence to improve routing/refinement only after enough observations exist.
- Expose what signal influenced a recommendation.

### Exit gate

- A durable preference/context item learned from one supported tool is safely applied
  in the other.
- A repeated task requires measurably less manual re-explanation in an observed run.
- At least one proposed relay refinement is accepted, used on a real task, and kept.
- No hand-authored content is overwritten.
- External users understand why a refinement was suggested.

### Out of scope

- Broad preference syncing to every agent/tool.
- A new repetition artifact in the same phase.
- Automatic prompt mutation.
- Cloud-synced profiles.

## 12. Milestone 5 — Phase 3: Resident Posture

### Entry trigger

Do not begin because a daemon was in the original roadmap. Begin only when retained
users say manual detection/status checks are easy to forget and they want Chox to
surface useful changes automatically.

### Objective

Make useful discovery ambient without turning a trusted local tool into noisy or
opaque background software.

### Step-by-step

- Add scheduled incremental scans with conservative defaults.
- Default to a weekly digest, not immediate notifications for every candidate.
- Notify only for new qualifying findings, material refinements, and pending gates.
- Persist dismissal and notification state.
- Show the next scheduled scan and last successful scan.
- Provide install, pause, resume, run-now, and uninstall commands.
- Use supported OS-native login mechanisms; verify what actually started.
- Keep logs local, bounded, redacted, and inspectable.
- Keep confirmation engine calls opt-in/configured and announce any potential spend.
- Never open a network listener.
- Make `doctor` able to diagnose scheduler state without exposing prompts/commands.

### Exit gate

- One zero-interaction week yields at least one useful notification for user zero.
- Retained external users report no spam.
- No analysis call occurs contrary to the configured policy.
- Install/uninstall and crash recovery are verified on macOS and Linux.
- Users can always explain why they received a notification.

## 13. Milestone 6 — Phase 4: Adjacent Artifacts

### Entry trigger

The relay product has external repeat use, and research identifies a repeated job
that relays cannot solve cleanly. Add one lens at a time; do not bundle profile sync
and repetition into a single risk surface.

### Candidate A — Profile sync

Build first if users repeatedly report that preferences learned in one agent fail to
apply in another.

- Verify memory locations/formats at planning time.
- Keep vendor memory access opt-in.
- Fall back to correction patterns when a memory store is unavailable.
- Merge/dedupe into an ownership-safe diff.
- Preview, edit, decline, apply, and undo.
- Prove one preference crosses tools and remains useful.

### Candidate B — Minimal repetition to `SKILL.md`

Build first if users repeatedly perform the same task and ask Chox to make it
invocable.

- Prefer cross-source evidence.
- Generate the simplest sufficient flat skill.
- Preview placement and exact contents.
- Install into supported open-standard locations with ownership markers.
- Require the user to keep using the skill after one week.

### Candidate C — Structured artifacts

Build only after flat skills and constrained relay loops reveal real graph needs.

- Classification precedes graph generation.
- A single linear action stays a flat skill.
- Gates/parallel/multi-runtime enter only with observed necessity.
- Set explicit latency, cost, and output-quality budgets in the build packet.

### Exit gate for every adjacent artifact

- The triggering external user problem is recorded.
- The artifact is installed from evidence, not a prose-only report.
- It remains in use after one week.
- It passes ownership, privacy, and removal tests.
- It does not weaken the relay experience or its documentation.

## 14. Milestone 7 — Phase 5: Local Product Surface

### Entry trigger

Do not build an app merely to make Chox look like a product. Begin only when all are
true:

1. at least three external users have repeated successful relay runs;
2. users have enough relays, findings, runs, artifacts, or pending gates that terminal
   browsing is materially slowing them down;
3. research identifies an app-specific job beyond “a nicer CLI”; and
4. the CLI journey is stable enough to serve as a parity contract.

### Design-context checkpoint

Before visual design begins, create and approve `.impeccable.md` with:

- confirmed target audience;
- primary app jobs;
- brand personality and emotional goal;
- visual references and anti-references;
- light/dark theme decision;
- accessibility requirements; and
- the one memorable product characteristic.

Do not infer those decisions from the codebase.

### First app jobs

The initial app is document-first and operational:

1. **Needs attention:** pending gates, failed runs, and new findings.
2. **Start work:** choose a relay, provide a task, inspect, and start.
3. **Relay library:** understand installed workflows and provenance.
4. **Run timeline:** see hops, artifacts, decisions, models, spend, and files changed.
5. **Artifact review:** read and diff specs, challenge notes, reviews, and context.
6. **Local settings:** sources, engine consent, schedule, storage, and removal.

### Explicit non-goals for the first app

- No generic chat client.
- No IDE replacement.
- No tmux/terminal multiplexing.
- No workflow canvas as the default view.
- No marketplace.
- No cloud sync or account.
- No visual metric dashboard without decisions it helps users make.

### UX quality bar

- One obvious primary action per view.
- No more than four visible decisions at a gate.
- Keyboard completion of the entire primary journey.
- WCAG 2.2 AA contrast and semantics.
- Reduced-motion support from the first animation.
- No meaning carried by color alone.
- Responsive layouts that adapt rather than hide critical functions.
- Empty states teach the next useful action.
- Errors name the problem, preserve state, and give a recovery action.
- Destructive actions preview exact impact and verify ownership.
- Long operations acknowledge immediately and never remain silent.

### Security boundary

- Loopback-only server.
- Per-install authentication token.
- Strict origin/CORS policy.
- No raw transcript browser by default.
- Same engine-spend and privacy disclosures as the CLI.
- App and CLI use the same product services and persisted plans; neither invents a
  second execution model.

### Exit gate

- Observed users complete the primary journey faster or with fewer errors than in the
  CLI.
- Every app action has a CLI equivalent.
- The app can remain closed without breaking detection or execution.
- Security review and accessibility audit pass.
- Users describe the app as a clearer view of their workflow, not another generic
  agent dashboard.

## 15. Milestone 8 — Phase 6: Plurality and Platform Expansion

### Entry trigger

Select new sources, engines, runtimes, or platforms from observed external demand.
Do not build a connector to make an architecture diagram look complete.

### Step-by-step

1. Collect at least three credible requests for the same source/runtime/platform or
   one strategic user with a compelling full-journey need.
2. Verify the source format and access boundary with founder/user-controlled fixtures.
3. Decide whether the addition is a source, engine, runtime, or all three.
4. Add fixture redaction and drift tests before product behavior.
5. Add doctor diagnostics and actionable failure handling.
6. Run the complete detect/inspect/task/run/review/finish journey.
7. Re-run privacy, ownership, process, timing, and platform correctness checks.
8. Update positioning only if the supported user segment genuinely expands.

Native Windows follows the same demand trigger. WSL remains the supported Windows
route until a dedicated packet pays and verifies the native `.cmd`/process tax.

### Exit gate

- The complete journey works on a machine whose primary tool/environment is the new
  target.
- Existing Claude/Codex behavior does not regress.
- The new support has real fixtures, diagnostics, and an external user.

## 16. UX standards for every milestone

These are release criteria, not app-only polish.

### 16.1 Every state answers three questions

1. What is happening?
2. What did Chox or my last action do?
3. What can I do next?

No command should end in a status sentence without a next action when a meaningful
next action exists.

### 16.2 Progressive disclosure

- Show a workflow summary before full prompts.
- Show evidence summary before occurrence details.
- Show file-count summary before the full diff.
- Keep advanced engine/model/headless controls available without placing them on the
  novice path.
- Keep each decision point to four or fewer visible actions.

### 16.3 No manual source editing on the happy path

Relay source files are a customization surface for experts, not an input form. Tasks,
redirects, model choices, installation scope, and finish decisions require supported
CLI/app interactions.

### 16.4 Visible trust boundaries

Before an operation, disclose as applicable:

- local paths read;
- local paths written;
- Git branch/worktree effects;
- agent executable and model;
- whether raw excerpts leave the machine through that agent;
- maximum analysis calls;
- persisted task/prompt location; and
- how to abort or undo owned state.

### 16.5 Responsiveness

- A long operation acknowledges input immediately.
- No non-native Chox operation stays silent for more than five seconds.
- Native interactive sessions make the exit/return-to-Chox step explicit.
- Progress is factual; no fake percentages.
- Cancellation leaves resumable or clearly terminal state.

### 16.6 Writing

- Prefer “workflow,” “task,” “step,” “review,” and “branch” on the primary path.
- Introduce “relay,” “finding,” “lens,” “substrate,” and “IR” progressively.
- Errors name the failed boundary and the exact recovery action.
- Avoid hype, anthropomorphism, and unverifiable savings.

## 17. Phase operating loop

Every milestone follows this sequence:

1. **State the riskiest assumption.** Name what must be true for the milestone to
   matter.
2. **Gather evidence.** Use current runs, founder history, external observation, and
   current market/format verification.
3. **Write the build packet.** Fix scope, interfaces, acceptance, tests, privacy, and
   a file/command manifest.
4. **Review before implementation.** Challenge the packet against the spec,
   correctness ledger, existing code, and actual user journey.
5. **Implement at `challenge` autonomy.** Record every justified deviation and revert
   path.
6. **Verify narrowly, then broadly.** Domain tests first; full handoff suite before
   review.
7. **Dogfood on a real task.** Synthetic/fake-agent coverage never substitutes for
   the subjective product gate.
8. **Observe an external target user** once the milestone is externally runnable.
9. **Write the result.** State what shipped, evidence, failures, remaining work, and
   the go/iterate/stop decision.
10. **Update this roadmap.** Check completed steps, revise metrics from evidence, and
    identify the next riskiest assumption without rewriting history.

## 18. Prioritization rules

A proposed feature enters **Now** only if it does at least one of these:

- removes a blocker between task and reviewed branch;
- materially reduces activation time or gate confusion;
- closes a trust/correctness risk;
- is required by the current milestone's evidence gate; or
- has repeated external demand and strengthens Chox's cross-source advantage.

Classify everything else:

- **Next:** likely valuable immediately after the current gate.
- **Later:** valuable only after a named trigger.
- **Not Chox:** generic orchestration, single-vendor coaching, cloud/account features,
  or work another tool already solves without Chox's unique evidence.

When two items compete, prefer in this order:

1. safety and trust;
2. task completion;
3. activation and comprehension;
4. repeat use;
5. differentiation;
6. operational convenience;
7. visual polish.

Visual polish still matters; it simply cannot compensate for an incomplete task
journey.

## 19. Definition of done

A feature is not done because its tests pass. It is done when all applicable items
are true:

- **Useful:** it advances a real task or decision.
- **Correct:** required tests and correctness items pass.
- **Safe:** work, privacy, ownership, and process boundaries hold.
- **Understandable:** the target user can explain what happened and what comes next.
- **Discoverable:** the user does not need source knowledge to find it.
- **Recoverable:** failure preserves work and gives a recovery path.
- **Documented:** install, use, privacy, storage, and removal behavior are current.
- **Measurable:** the milestone has an observable behavioral outcome.
- **Used:** user zero dogfoods it; externally released work has external evidence.
- **Recorded:** result and challenge notes preserve deviations and remaining gaps.

## 20. Immediate next actions

This is the concrete order from the current repository state:

1. Confirm the detection-quality window end date and Phase 1b demo plan.
2. Verify the npm handle or choose the scoped package fallback.
3. Write `docs/plans/phase-1c-build-packet.md` from Milestone 1.
4. Implement `--task`, `--task-file`, and `{{task}}` with dry-run/resume parity.
5. Package the read-only starter relay and test the actual tarball in isolation.
6. Add relay and finding discovery/inspection surfaces.
7. Replace the source-only quickstart with the external activation journey.
8. Publish the first honest alpha only after the packed journey passes.
9. Run the five-person private alpha and stop expansion if repeat use does not
    appear.

The next product decision after those actions comes from observed retention, not from
the remaining length of the original feature list.

## 21. Current fixed decisions

These remain fixed until a dated, evidence-backed amendment:

| Decision | Current answer |
|---|---|
| Product wedge | Taskable, gated relays |
| Differentiator | Cross-source history → personal workflow → isolated execution |
| Next build | Phase 1c — Taskable First Run |
| Primary surface | CLI and native agent sessions |
| First external segment | Experienced macOS/Linux developers using Claude Code + Codex |
| Default trust posture | Local, gated, isolated, inspectable |
| New lenses before alpha | No |
| Daemon before repeat use | No |
| App before app-specific user need | No |
| Cloud, accounts, telemetry | No |
| External evidence after alpha | Required |

## 22. Roadmap change log

Append entries; do not rewrite older ones.

| Date | Change | Evidence/reason |
|---|---|---|
| 2026-07-14 | Created the active post-1b.1 roadmap; inserted taskable first run, private alpha, and flagship depth before broader lenses/daemon/app work | Phase 1a proved the runtime, Phase 1b.1 exposed semantic detection risk, and the product still lacked an installable task-to-reviewed-branch journey |
| 2026-07-14 | Marked Phase 1b.1 accepted and closed; kept the broader Phase 1b demo, measurement, and package preparation open | Founder reran live detection and reported that the hardened covered-loop result returned as expected without a rival draft or semantic repair |
