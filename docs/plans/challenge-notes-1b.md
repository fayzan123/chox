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

- Claude analysis uses `claude -p --output-format stream-json --verbose --tools ''`.
  Analysis needs no filesystem tools, so it does not inherit the relay runtime's
  permission-bypass flag.
- Codex analysis uses `codex --sandbox read-only --ask-for-approval never exec
  --json -`. This keeps analysis read-only and supplies the prompt on stdin.

`AnalysisEngine` retains the SPEC's `analyze(...): Promise<unknown>` boundary and
adds a read-only `stats()` method for P14 call/token reporting. Findings persist the
number of confirmation calls, so relay drafting enforces P7 per finding rather than
mistaking a shared engine's lifetime call count for one finding's budget.

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
