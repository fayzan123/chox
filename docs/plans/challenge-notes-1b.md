# Phase 1b challenge notes

These are live implementation notes. The Phase 1b packet was reviewed before code
against `SPEC.md`, `CORRECTNESS.md`, both Phase 1a packets, the accepted Phase 1a
implementation, and the installed Claude Code and Codex CLIs. The founder fixture
checkpoint intentionally divides this work into two slices; this file will be
updated as the post-fixture implementation exposes further decisions.

## Intentional deviations

None in the pre-fixture slice. The redactor implementation follows P12 and keeps
all writes inside its explicit fixture output directory. Potential deviations that
need founder input are listed below rather than being guessed at in code.

## Packet conflicts and flag-first items

### 1. The doctor requirement is outside the MANIFEST's writable set

- **Packet:** §6 requires the substrate doctor probe to graduate to a real
  present/readable/queryable health check, and lists `node dist/bin/chox.js doctor`
  as a required command.
- **Conflict:** `src/doctor.ts` owns that probe, but it is absent from both
  `create_or_replace` and `may_touch`. The contract says any file outside those
  lists must be flagged before editing.
- **Current action:** do not touch `src/doctor.ts` during the founder fixture
  checkpoint. Ask the founder to add it to `may_touch` or explicitly approve the
  required edit before the post-fixture slice.
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
the accepted Phase 1a.2 adapters. Exact AnalysisEngine output/schema flags will be
re-verified when those adapters are implemented.

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
