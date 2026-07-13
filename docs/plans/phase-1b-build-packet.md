# Phase 1b Build Packet — Substrate + Handoff Detection (Demo Gate)

**Status:** ready for implementation after PM review gate.
**North star served:** this is the phase where Chox opens `~/.claude` and
`~/.codex` and earns the thesis — `chox detect` must independently find the
plan→implement→review loop user zero hand-authored in 1a and hand it back as a
drafted relay with honest evidence. SPEC.md §8 calls this the **demo gate**.
**Inputs (read before code):** `docs/SPEC.md` §1.2, §2.3, §2.5, §2.6, §5 (all),
§7, §8 Phase 1b, Appendix A (source-format facts, dated 2026-07-05 — re-verify
against the live dirs while building), Appendix A.3 (the founder-machine dataset
detection is tuned against); `docs/CORRECTNESS.md` (C1–C10);
`docs/plans/phase-1a-build-packet.md` + `phase-1a2-build-packet.md` (their fixed
decisions still bind).
**Contract:** autonomy `challenge`. New notes file: `docs/plans/challenge-notes-1b.md`
(same rules: every intentional deviation with rationale + revert path; absent or
empty = incomplete). Result handoff: `docs/plans/result-1b.md`.

---

## 1. Fixed decisions

### Restated from SPEC (not open to change)

| # | Decision | Source |
|---|----------|--------|
| F1 | Storage is **`node:sqlite`** behind a `SubstrateStore` interface; DB at `~/.chox/substrate.db`, file mode 0600 | §4, §5.1 |
| F2 | **Privacy property:** the DB holds metadata + derived digests only — never raw prompt/file content. Content is read from the original vendor files, by reference, at confirm/draft time only | §5.1, §7.2 |
| F3 | Schema per §5.1 (`sources`, `sessions`, `units`, `findings`, `artifacts`, `watermarks`) — additive columns allowed, renames/removals are flag-level | §5.1 |
| F4 | `SessionSource`, `Lens`, `AnalysisEngine` interfaces per §5.2; parse failures are per-source diagnostics, **never scan-fatal**; every source ships fixtures + a schema-drift test | §5.2 |
| F5 | Source-format facts per Appendix A: claude-code `~/.claude/projects/<enc>/*.jsonl`; codex `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (`session_meta.cwd` is the join key; `session_index.jsonl` is advisory only); tolerate literal `null` lines and unknown entry types (C2) | App. A |
| F6 | Detection heuristics per §2.3: git-commit correlation (weight, never filter), continuation-vs-backtrack digest similarity (tunable threshold, validated on founder data), recurrence floor **≥3 sessions or ≥2 repos** (below-floor patterns stored, not surfaced) | §2.3 |
| F7 | Evidence per §2.5: occurrence count, dates, repos, total/median wall-clock session time. **No counterfactual claims** | §2.5 |
| F8 | Quality targets + sparse-data behavior per §2.6, including the honest no-findings output (scanned counts, why, what helps) — silence and garbage are both failures | §2.6 |
| F9 | `originator` distinguishes human bounces (automation candidates) from tool-invoked runs (evidence automation already exists) — codex sessions spawned by Chox relays must not be detected as manual bounces | App. A.2 |
| F10 | Fixtures are generated fresh by `fixtures/redact.ts` from the founder's real homes; raw material never committed (`fixtures/raw/` is gitignored); redaction covers dash-encoded home dirs (C3) | §6 |
| F11 | Dependency budget unchanged: **zero production dependencies** (`node:sqlite` is builtin; `croner` is Phase 3) | §4 |
| F12 | Tests never touch real `~/.chox`, `~/.claude`, `~/.codex` (C10); CI Ubuntu + macOS × Node 22/24 (platform note §4) | §4 |
| F13 | npm publish happens this phase: verify the `chox` handle at publish time; scoped fallback `@<owner>/chox` acceptable; **no placeholder publish** (founder decision in Open Question 1) | §10.1, §8 |

### PM decisions for this packet (fixed unless flagged with rationale)

| # | Decision |
|---|----------|
| P1 | **`intent_digest` definition** (deterministic, no LLM): from a unit's first user-message text — lowercase, strip code blocks/paths/punctuation, drop stopwords, keep the first ~24 distinct content tokens sorted, join with spaces. It is *derived from* content but is not raw content (F2 holds); similarity = Jaccard over the token sets. Threshold default 0.5, exposed as a constant, tuned against Appendix A.3 examples before trust (F6) |
| P2 | **Units in 1b are session-level.** One `units` row per session (the session's opening intent). Turn-level task segmentation is future work; the schema supports it, the code doesn't pretend to |
| P3 | **No separate `scan` command.** `chox detect` runs the incremental scan (watermarks make it cheap) then the lens; `chox status` reports substrate stats read-only |
| P4 | **Handoff candidate shape:** ≥2 sessions on the same `repo_root` from *different* sources within a 6h window, ordered by start time, collapsed into alternation chains (e.g. claude→codex→claude). Pattern identity = the source-role chain shape; occurrences accumulate across repos and weeks. Floors and weighting per F6 |
| P5 | **Git correlation** reads `git log` timestamps from the repo at its recorded `repo_root` if it still exists; missing/moved repos degrade that occurrence's weight to neutral, never error |
| P6 | **Engine confirm:** the deterministic scan yields candidates; confirmation + relay drafting call the user's own agent CLI headlessly (`AnalysisEngine`: claude via `-p --output-format stream-json`, codex via `exec --json`). Engine selection: `--engine claude|codex` flag, default = first available binary (claude, then codex). If neither is available: print candidates clearly labeled **unconfirmed**, with the §5.4-style actionable install message — never a raw ENOENT, never a silent drop |
| P7 | **Generation budget (generation-first, §4):** confirming + drafting one finding uses ≤3 engine calls and must complete in <90s on the founder's machine; the drafted relay's templates must be implementer-formatted per §2 principle 2 (structured breakdown + manifest demand — reuse the 1a example templates as the seed skeleton). Budget overrun is a finding-level failure with a clear message, not a hang |
| P8 | **Drafting inputs:** at confirm time the engine may receive *excerpts* of the original transcripts (read via `sessions.ref`, per F2) from the **highest-weighted** occurrence — that is §2.3's "the prompt that worked." Excerpts go only to the user's own chosen engine (§7.1) |
| P9 | **`chox install <finding-id>`** for a relay finding writes `.chox/relays/<slug>/` in the current repo when the finding's evidence is repo-local to cwd, else `~/.chox/relays/<slug>/`; refuses to overwrite an existing slug (deterministic `-2` suffix, spirit of C6); marks generated files with a `generatedBy: chox@<version>, finding: <id>` metadata field; updates the finding's status to `exported`. `dismiss` is `chox detect` interactive `[d]` or `chox install --dismiss <id>`; dismissals persist in `findings.status` (feeds §2.6 metrics) |
| P10 | **`chox status` extension** (builds on the 1a status module): substrate stats (sessions per source, last scan time), findings by status, plus the existing runs/worktrees sections |
| P11 | **`--json`** on `chox detect` emits machine-readable findings (stable field names); human output is the default. `--since 30d` limits the scan window (default: everything) |
| P12 | **Redactor CLI** (`fixtures/redact.ts`, run via `node --experimental-strip-types` or a small npm script): reads real homes **only when run explicitly by the founder locally**, writes redacted JSONL fixtures to `fixtures/claude-code/` and `fixtures/codex/`; a committed fixture must never contain the raw or dash-encoded home path, usernames, or prompt text longer than schema-shape needs (replace message content with shape-preserving placeholders + the derived token fingerprints needed by lens tests). CI never runs the redactor |
| P13 | **Publish checklist is a deliverable, publishing is the founder's action:** README.md with the §7 privacy contract above the fold, `package.json` prepared (`files`, `bin`, engines, keywords, `private` flag left **true** in the PR — the founder flips it at publish after verifying the handle per F13) |

## 2. Scope

**In:** substrate store + schema + watermarks; claude-code + codex sources;
fixture redactor + committed redacted fixtures + drift tests; AnalysisEngine
(claude, codex); handoff lens (correlate → weight → floor → engine confirm);
evidence assembly; relay drafting from findings; `chox detect` (+`--json`,
`--since`, `--source`, `--lens handoff`, `--engine`); `chox install <finding-id>`
(+ dismiss); `chox status` extension; README + publish prep.

**Out (do not build or stub):** profile + repetition lenses (accept `--lens`
values but error "ships in Phase 2/4"); vendor memory stores; shared-context
file; `chox watch`/daemon/scheduler/notifier; structured skills/classify/export
placement map beyond P9; Cursor/OpenClaw sources; app; `--task` runtime feature
(queued separately); any relay-runtime changes except those P9 requires.

## 3. Data flow (normative)

```
chox detect
  → ensure substrate schema → incremental scan:
      per source: discover() (paths+mtimes) → diff vs watermarks →
      parse() changed files (drift-tolerant, per-source diagnostics) →
      upsert sessions/units → advance watermarks
  → handoff lens scan (deterministic, no LLM):
      cross-source same-repo chains (P4) → weight (git correlation P5,
      continuation similarity P1) → recurrence floor (F6)
      → below floor: store, report honestly (§2.6 wording)
  → engine confirm (P6/P7): candidate + excerpts (P8) → engine judges
      "is this a coherent repeated workflow?" + drafts hop roles/templates
  → findings persisted (status 'suggested') with evidence (F7)
  → interactive: per finding → [i]nstall / [d]ismiss / [s]kip
chox install <id>  → draft relay written per P9 → status 'exported'
```

## 4. Module breakdown (public contracts; internals your call)

| Module | Public interface (shape) | Key contracts / correctness |
|---|---|---|
| `src/substrate/schema.sql` | §5.1 schema verbatim + indices you need | additive-only vs F3 |
| `src/substrate/store.ts` | `openSubstrate(paths): SubstrateStore` — typed upsert/query methods used by scan/lens/status (sessions, units, findings, watermarks); `close()` | DB 0600 at creation; WAL ok; no raw content columns (F2); corrupt DB → actionable "delete ~/.chox/substrate.db to rebuild (it is a cache)" |
| `src/substrate/watermarks.ts` | `needsScan(store, sourceId, ref, stat): boolean` + advance | (source_id,file_ref) PK; mtime+size change → reparse whole file (files are append-only in practice; full reparse is correct and simple) |
| `src/sources/source.ts` | §5.2 `SessionSource`, `SessionRef`, `ParsedSession`, `SessionMeta`, `TaskUnit`, `SourceDiagnostics { unknownTypes: Record<string,number>, nullLines: number, failedFiles: string[] }` | diagnostics surfaced in detect output and status |
| `src/sources/claude-code.ts` | `discover(homeDir)`, `parse(ref)` | App. A.1: decode `<enc>` dirs; ISO timestamps; unknown types counted+skipped, `null` lines guarded (C2); repoRoot from cwd (walk up to `.git` at parse time; absent → cwd) |
| `src/sources/codex.ts` | same | App. A.2: `session_meta` first line (cwd, originator, git); `event_msg`/`response_item`; skip `originator` values produced by Chox-spawned runs when flagging manual bounces (F9 — verify the actual originator string a `chox` headless run produces and record it in challenge notes) |
| `src/digest.ts` | `intentDigest(text): string`, `digestSimilarity(a, b): number` | P1 exactly; pure functions, heavily unit-tested |
| `src/engines/engine.ts` + `claude.ts`, `codex.ts` | §5.2 `AnalysisEngine` + `pickEngine(pref, env)` | headless spawn rules from 1a runtimes (argv-array, stdin prompt, C1); response parsed defensively; timeout per P7 |
| `src/lenses/lens.ts` + `handoff/*` | `scan(store, opts): Candidate[]`, `confirm(candidates, engine): Finding[]` | P4/P5/P1 weighting; floor F6; evidence F7 computed from substrate timestamps; candidate + finding payloads carry the occurrence list (session ids + refs) |
| `src/artifacts/draft-relay.ts` | `draftRelay(finding, engine): DraftedRelay` (relay.json + templates content) | P7 budget; P8 inputs; output validates against the 1a `validateRelay`; templates implementer-formatted |
| `src/cli` wiring in `bin/chox.ts` | `detect`, `install`, extended `status` | §5.4 surface + P11; exit codes: 0 ok (including honest no-findings), 1 failure, 2 usage |
| `fixtures/redact.ts` | standalone script | P12; its own tests run against synthetic "real-shaped" input in temp dirs, then assert redaction invariants (C3) |
| `README.md` | §7 contract above the fold, quickstart, honest status | P13 |

## 5. Test requirements

1a rules carry over (real temp FS, fake binaries for engines, scripted IO, C10
guard helper). Additions:

- **Fixture-driven source tests:** committed redacted fixtures parse to expected
  session/unit counts; drift tests feed mutated fixtures (unknown types, null
  lines, truncated tail, missing session_meta) and assert diagnostics-not-crash.
- **Substrate:** schema creation idempotent; 0600 mode asserted (POSIX);
  watermark incrementality (second scan parses nothing when unchanged; touch one
  file → only it reparses); corrupt-DB recovery message.
- **Digest:** P1 determinism + similarity properties (identity=1, disjoint=0,
  case/punct/path insensitivity).
- **Lens:** synthetic substrate builders covering: a 3-occurrence cross-source
  loop (detected); same shape with 2 occurrences on 1 repo (stored, not
  surfaced, honest output); single-source alternation (not a candidate);
  tool-invoked codex sessions excluded (F9); evidence numbers (count, repos,
  median minutes) computed correctly; git-correlation weight applied when a
  synthetic repo has commits near session end, neutral when repo missing.
- **Engine + drafting:** fake engine binaries returning scripted JSON; budget
  overrun → clean failure; drafted relay passes `validateRelay` and installs.
- **CLI:** detect happy path (fake engines + fixtures in fake home), `--json`
  schema stability, no-findings wording includes scanned counts + why + what
  helps (assert the three elements, not exact prose), install/dismiss status
  transitions, install collision suffix, status shows substrate stats.
- **The demo-gate rehearsal (integration):** a fabricated home with fixture
  histories shaped like Appendix A.3 (3 shared repos, hour-level alternation)
  must yield ≥1 confirmed handoff finding whose drafted relay validates — this
  test is the mechanical proxy for the founder-machine demo.

## 6. MANIFEST

```yaml
create_or_replace:
  - src/substrate/{schema.sql,store.ts,watermarks.ts}
  - src/sources/{source.ts,claude-code.ts,codex.ts}
  - src/digest.ts
  - src/engines/{engine.ts,claude.ts,codex.ts}
  - src/lenses/lens.ts
  - src/lenses/handoff/**        # internal layout your call
  - src/artifacts/draft-relay.ts
  - fixtures/redact.ts
  - fixtures/claude-code/** fixtures/codex/**   # redacted, committed
  - README.md
  - docs/plans/challenge-notes-1b.md
  - docs/plans/result-1b.md
  - tests/**                     # structure your call
may_touch:
  - bin/chox.ts                  # detect/install/status wiring only
  - src/status.ts                # P10 extension
  - src/paths.ts                 # substrate path helper
  - package.json                 # publish prep per P13 (private stays true)
must_not_touch:
  - docs/SPEC.md docs/CORRECTNESS.md docs/plans/phase-*-packet.md
  - src/harness/** src/runtimes/** (except nothing — flag if you believe otherwise)
commands_that_must_pass:
  - npm run typecheck && npm test && npm run build
  - node dist/bin/chox.js detect --json      # in a CHOX_HOME/fake-home sandbox: exit 0, honest empty output
  - node dist/bin/chox.js status             # shows substrate section
  - node dist/bin/chox.js doctor             # substrate probe now reports real health
```

(Doctor's substrate probe graduates from "not initialized" to real health checks —
DB present/readable/queryable — keep the old wording only when no DB exists yet.)

## 7. Acceptance (verbatim SPEC §8 Phase 1b + §2.6)

> *Accept:* on user zero's machine, `chox detect` independently finds the loop he
> hand-authored in 1a and drafts a comparable relay with honest evidence attached;
> the quality targets in §2.6 hold over two weeks of use; the cross-agent demo
> recording exists (the artifact no single-vendor tool can produce). npm handle
> verified and first publish happens here.

§2.6 targets (measured from the findings table): ≤1 dismissed finding/week;
precision ≥50% (`exported ÷ (exported+dismissed)`); cold-start ≥1 finding in 7
days for 20+ cross-tool sessions on 2+ repos; sparse data → explanation, never
silence or garbage. The two-week window and the demo recording are founder
actions after ship; everything else must be demonstrated by tests + a live run
on the founder's machine.

## 8. Judgment guidance

**Yours:** handoff-lens internal decomposition; SQL indices/pragmas; candidate/
finding payload internals beyond the documented fields; engine prompt wording
(within P7/P8); test structure; README prose (privacy contract content is fixed
by §7).
**Flag first:** schema changes beyond additive; any new CLI flag; digest
definition changes (P1); threshold/floor changes (F6); anything sent to an
engine beyond P8's excerpts; placement/ownership behavior (P9); any dependency;
publish-prep fields.
**Not asked for:** daemon hooks, cross-lens abstractions, perf work beyond the
watermark design, config.json.
