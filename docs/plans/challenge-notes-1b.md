# Phase 1b challenge notes

These are live implementation notes. The Phase 1b packet was reviewed before code
against `SPEC.md`, `CORRECTNESS.md`, both Phase 1a packets, the accepted Phase 1a
implementation, and the installed Claude Code and Codex CLIs. The founder fixture
checkpoint intentionally divides this work into two slices; this file will be
updated as the post-fixture implementation exposes further decisions.

## Intentional deviations

### README privacy wording follows F2/P8 rather than §7's "digests only" sentence

- **Conflict:** SPEC §7 says nothing leaves the machine except digests sent through
  the selected analysis engine. F2 says raw source content is read at confirmation
  time, and P8 explicitly permits excerpts from the highest-weighted occurrence to
  be sent to the user's chosen engine. Both statements cannot describe the shipped
  behavior.
- **Implementation:** the README states the actual F2/P8 boundary: Chox has no
  network calls, while the locally installed vendor CLI may send derived evidence
  and bounded highest-occurrence excerpts to its vendor. `--no-confirm` is the fully
  deterministic, no-engine path.
- **Why:** F2/P8 are the more specific Phase 1b instructions and the implementation
  tests enforce that exact excerpt selection. Repeating "digests only" would make a
  false privacy promise.
- **Revert path:** remove excerpts from the confirmation prompt and use metadata plus
  digests only; the literal §7 sentence could then be restored, at the cost of P8's
  "prompt that worked" signal.

## Packet conflicts and flag-first items

### 1. The doctor requirement is outside the MANIFEST's writable set

- **Packet:** §6 requires the substrate doctor probe to graduate to a real
  present/readable/queryable health check, and lists `node dist/bin/chox.js doctor`
  as a required command.
- **Conflict:** `src/doctor.ts` owns that probe, but it is absent from both
  `create_or_replace` and `may_touch`. The contract says any file outside those
  lists must be flagged before editing.
- **Resolution:** the founder explicitly approved the out-of-MANIFEST edit on
  2026-07-13. `src/doctor.ts` now uses the substrate's read-only health boundary:
  missing remains informational, present databases are opened and queried, and a
  corrupt database reports the cache rebuild action without placing raw paths in a
  doctor bundle.
- **Revert path if an edit is approved and later rejected:** restore the Phase 1a
  informational probe; this would knowingly leave the Phase 1b doctor acceptance
  requirement unmet.

### 2. Publish responsibility has two wordings

- **Packet:** F13 says npm publish happens in Phase 1b; P13 says publishing is the
  founder's action and `private: true` remains in the implementation branch.
- **Implementation interpretation:** follow the more specific P13 review decision:
  prepare and verify the package, but do not publish and do not flip `private`.
- **Why:** this is also the only interpretation compatible with the handoff prompt's
  hard rule and definition of done.
- **Revert:** the founder can verify the handle, set `private: false`, and publish in
  a separate explicit action after review.

### 3. Repository platform prose is stale in one place

- **Packet/SPEC/current CI:** Ubuntu + macOS on Node 22/24; native Windows is
  deferred, while Windows-safe argv/path hygiene remains required.
- **Conflict:** `AGENTS.md` still says the CI pair is Ubuntu + Windows.
- **Implementation interpretation:** do not touch `AGENTS.md` (outside the Phase 1b
  MANIFEST); target the packet's existing CI matrix and retain portable tests.
- **Revert:** update the packet/CI instead only if the founder intentionally restores
  native Windows support.

### 4. Publish-prep fields are a flag-first item

- **Packet:** P13 requires `files`, existing `bin`/`engines`, keywords, and
  `private: true`; §8 requires the exact publish-prep fields to be flagged before
  editing.
- **Proposed edit:** add `files: ["dist", "src/substrate/schema.sql", "README.md",
  "LICENSE"]` so the runtime SQL asset ships with compiled output, plus conservative
  local-first/cross-agent CLI keywords. Keep `private: true`, the existing `bin`, and
  Node `>=22.13` unchanged.
- **Resolution:** the founder explicitly approved these fields on 2026-07-13. They
  were added exactly as proposed, with `private: true` unchanged.
- **Revert path:** remove the two additive fields; source development remains
  functional, but the package tarball would omit its required schema asset unless a
  different copy step is approved.

### 5. Live Claude output invalidated prompt-only JSON

- **Packet:** P6 fixes Claude analysis to `-p --output-format stream-json`; response
  parsing is defensive, and engine prompt wording is implementation discretion.
- **Live evidence:** the founder's second acceptance run produced one non-JSON
  confirmation, one JSON object without `confirmed`, and one valid confirmation whose
  incomplete relay required a fallback draft that exhausted its 25-second reserve.
- **Implementation deviation:** calls with a product-owned response schema use
  `--output-format json --json-schema <schema>` and consume the validated
  `structured_output` field. Schema-free calls retain the packet's stream-JSON path.
  Confirmation requires `confirmed`, `reason`, and a complete nullable relay; fallback
  drafting requires a complete relay. The static schemas add no transcript content or
  other user data to P8's highest-occurrence excerpts.
- **Why:** prompt wording did not establish a machine boundary on the founder's live
  CLI. Claude Code 2.1.207 exposes `--json-schema`, and Anthropic's current headless
  contract documents JSON output plus `structured_output` as the validated response
  path. Local validation remains in place for semantic constraints such as non-empty
  slugs and prompts.
- **Revert:** remove `EngineOpts.jsonSchema`, the two schemas, and structured-output
  parsing, then restore `stream-json` for those calls. This recreates the exact live
  malformed/missing-field failures and is not recommended without a different
  constrained-output mechanism.

## Verified live facts

### F9 Codex originator

Verified on 2026-07-13 with Codex CLI `0.144.1` using the exact Chox-style headless
shape (`codex --sandbox read-only --ask-for-approval never exec --json -`) and a
single minimal prompt in an isolated temporary `CODEX_HOME`. The generated first
`session_meta` line recorded:

```json
{"originator":"codex_exec","source":"exec"}
```

The temporary home had no credentials, so the model request ended with HTTP 401;
the CLI persisted `session_meta` before authentication, which is sufficient for
the source-format fact. No real `~/.codex` file was read and no second invocation
is needed. Phase 1b must treat `codex_exec` as tool-invoked rather than a manual
bounce.

Claude Code `2.1.207` and Codex CLI `0.144.1` still expose the headless flags used by
the accepted Phase 1a.2 adapters and the implemented AnalysisEngine adapters.

### AnalysisEngine flags and accounting

Verified against the same installed help parsers before implementation:

- Claude analysis uses `claude -p --output-format json --json-schema <static-schema>
  --safe-mode --no-session-persistence [--model <ANTHROPIC_MODEL>] --tools ''` for
  production confirmation/drafting. Schema-free calls retain `stream-json --verbose`.
  Safe mode keeps project hooks/plugins/settings out of Chox analysis while preserving
  auth and model selection; disabled persistence prevents confirmation sessions from
  feeding future handoff scans. Analysis needs no filesystem tools, so it does not
  inherit the relay runtime's permission-bypass flag.
- Codex analysis uses `codex --sandbox read-only --ask-for-approval never exec
  --json -`. This keeps analysis read-only and supplies the prompt on stdin.

`AnalysisEngine` retains the SPEC's `analyze(...): Promise<unknown>` boundary and
adds a read-only `stats()` method for P14 call/token reporting. Findings persist the
number of confirmation calls, so relay drafting enforces P7 per finding rather than
mistaking a shared engine's lifetime call count for one finding's budget.

`ANTHROPIC_MODEL` is now surfaced through `AnalysisEngine.model`, passed explicitly
to Claude's `--model`, and retained in JSON output. Confirmation gets a 60-second
process timeout and fallback drafting gets 25 seconds. Their maximum combined engine
wall time is therefore 85 seconds, preserving five seconds of headroom under P7's
strictly-under-90-second per-finding budget. A schema-valid confirmation includes a
complete relay, so fallback drafting is now an exceptional recovery path. Revert path:
restore both calls to 30 seconds; the founder acceptance runs below demonstrate why
that setting is not viable.

The fixed `Lens.confirm(candidates, engine)` shape lacks the store it must write to.
No signature was changed: `handoffLens.scan(store, ...)` retains that store for the
paired interface call, while the CLI uses the explicit
`confirmHandoffCandidates({ store, ... })` helper so persistence remains visible and
testable. Revert path: amend the public interface to pass `SubstrateStore` to
`confirm`, which would be cleaner but is a flag-level packet change.

## Pre-fixture redactor decisions (within P12 discretion)

- The committed fixtures retain representative schema-bearing JSONL lines, not
  transcript volume: the first occurrence of each observed entry shape, the first
  user intent, and a terminal timestamp-bearing line.
- Raw paths and opaque identifiers are mapped consistently to synthetic values.
  Message bodies, instructions, commands, and other free text become typed
  placeholders.
- The opening user intent is normalized with P1's token rules, then each token is
  replaced by a keyed per-run HMAC fingerprint. This preserves equality and Jaccard
  relationships across the founder's two sources without committing dictionary-
  recoverable prompt words or the key.
- Redactor output is self-verified before success: no raw or dash-encoded home,
  username, overlong string, malformed JSONL, symlink traversal, or raw-output
  overlap is accepted. Synthetic tests additionally seed known prompt, command,
  instruction, code, and path sentinels and prove none survive.

The first founder run passed those privacy checks, but pre-commit schema inspection
found that a Claude top-level prompt-like field could consume the one intent
fingerprint before canonical `message.content` was visited. No fixture from that run
was committed. The redactor was corrected to target Claude `message.content` and
Codex `payload.content`, and its synthetic test asserts both exact placements.

The founder then reran `npm run fixtures:redact`. Independent verification found 181
Claude Code fixtures and 38 Codex fixtures (219 total), every canonical intent field
carrying its opaque fingerprint, and no raw/dash-encoded home path, username, or
over-long prompt content. `npm run fixtures:verify` passes against the committed set.
An engine-free integration test loads that entire corpus through the public source
and substrate interfaces and confirms that the deterministic handoff lens surfaces
at least one cross-agent candidate.

## Post-fixture implementation clarifications

- `--since` limits the query/reporting window, not what the incremental cache retains.
  Changed files are always indexed before their watermark advances; otherwise a
  narrow first scan would make older sessions permanently invisible to a later full
  scan. An integration test exercises narrow-then-full recovery.
- The additive `sources.diagnostics_json` column retains only the most recent
  per-source parse diagnostics. Status renders aggregate counts and never file paths.
  `openSubstrate` migrates an earlier Phase 1b development database additively, while
  read-only health checks remain compatible before migration.
- In `--json` mode, P14's pre-call engine/model/ceiling notice goes to stderr so stdout
  remains one valid JSON document. Post-call usage stays in the JSON `engine` object.
- An engine rejection is not a user dismissal and does not feed dismissal metrics;
  it is omitted from relay findings with an explicit human summary. Confirmation or
  drafting failures remain candidate diagnostics, never uninstallable `relay` rows.
- Relay installation revalidates every persisted template filename, including
  unreferenced keys, before writing. This closes the path-traversal boundary that
  relay-hop validation alone does not cover.
- `npm pack --dry-run` initially encountered pre-existing root-owned files in the
  founder's global npm cache. No permissions or files there were changed. Re-running
  with an isolated `/private/tmp` cache succeeded; the resulting 78-file tarball was
  installed into another isolated directory, and its packaged CLI completed
  `detect --no-confirm --json` with an isolated home. This verified that the included
  `src/substrate/schema.sql` is found from compiled code.

## Founder acceptance run: first live detect

On 2026-07-13 the founder ran:

```sh
ANTHROPIC_MODEL=sonnet node dist/bin/chox.js detect --engine claude
```

The real scan found 222 sessions (184 Claude Code, 38 Codex) and surfaced three
handoff candidates. All three confirmation calls hit the then-current 30-second
process timeout, so no relay was drafted and no usage was reported. The pasted output
also showed 111 Claude unknown entries; Appendix A.1 defines these dozen-plus
sideband types as counted-and-skipped diagnostics, not parse failures.

No implementer process read either real vendor home. This observation came only from
the founder's pasted terminal output. The resolution is the 60/25-second budget above,
explicit `ANTHROPIC_MODEL` reporting, Claude safe mode, and non-persistent analysis.
The live confirmation/install acceptance step must be rerun from the rebuilt commit.

## Founder acceptance run: second live detect

The founder reran the same command after the timeout/model fix. It scanned 225
sessions (187 Claude Code, 38 Codex), surfaced the same three candidates, and correctly
reported model `sonnet`. None became installable: the engine returned invalid JSON for
one, omitted boolean `confirmed` for another, and the third reached the 25-second
fallback-drafting timeout. Spend was visible: four calls, 6 input tokens, 30,537
cached-input tokens, and 6,858 output tokens.

The 592 Claude and 13 Codex unknown entries remain counted-and-skipped sideband
diagnostics, not scan failures. The three-session increase is consistent with the
earlier pre-`--no-session-persistence` acceptance run; current analysis passes the
documented non-persistence flag. Node's SQLite experimental warning is expected for
the packet-mandated Node 22 built-in.

No implementer process read either real vendor home; all facts above came from the
founder's pasted output. The mixed failures establish that more timeout alone is not
the remedy. Resolution is challenge #5's validated structured-output boundary. A third
founder run is required from the rebuilt commit.

## Founder acceptance run: third live detect and install

The founder reran the same command after challenge #5's structured-output fix. It
scanned 225 sessions and confirmed `claude-code → codex → claude-code` as a repeated
handoff with 7 occurrences, 21 sessions, and 4 repos; the other two candidates were
honestly rejected. Confirmation used exactly three calls and reported 6 input, 32,775
cached-input, and 7,439 output tokens. The founder selected `[i]nstall`, producing the
repo-local `brainstorm-plan-implement` relay and marking the finding exported.

The required runtime rehearsal then caught a generator defect before execution: an
earlier challenge-mode brainstorm hop implicitly claimed `challenge-notes.md`, while
the autonomous implementation hop explicitly claimed the same artifact, so relay
compilation rejected the duplicate. This was not a detection, confirmation, install-
placement, or ownership failure; it was an interaction between the Phase 1a compiler's
challenge-mode contract and Phase 1b's role-based artifact naming.

The Phase 1b generator now preserves the engine-selected autonomy while assigning
non-challenge implementation hops a hop-specific notes artifact such as
`challenge-notes-3.md`; challenge-mode implementation hops retain the harness-owned
canonical `challenge-notes.md`. The generated prompt names the same artifact it
declares. A public `draftRelay` → `compileRelay` regression test reproduces the exact
three-hop live shape. Direct repair of the already-installed Chox-owned relay was
flagged for founder approval because that generated directory is outside the
implementation MANIFEST.

## Critical areas reviewed without deviation so far

- The substrate must remain a rebuildable metadata/digest cache; no raw-content SQL
  column or payload is acceptable.
- Parse drift is source-local and diagnostic. Unknown and literal-null JSONL lines
  cannot abort a scan.
- Engine call accounting must span confirmation and relay drafting so P7's
  per-finding ceiling cannot be bypassed by module boundaries.
- `--no-confirm` and missing-engine behavior must share the same explicitly
  unconfirmed output path, and JSON output must not become interactive.
- Install collision handling and ownership checks must be deterministic before any
  write outside `CHOX_HOME`.
