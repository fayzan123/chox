# v0.1.0 publish audit result

- **Date:** 2026-07-14
- **Package:** `chox-cli@0.1.0`
- **CLI command:** `chox`
- **Disposition:** repository corrected; `chox-cli@0.1.1` published and verified

## Original v0.1.0 registry and Git state

- At the start of this audit, npm exposed exactly one version, `0.1.0`, and the
  `latest` dist-tag resolved to it.
- Registry metadata has the intended MIT license, Node `>=22.13` engine, zero
  production dependencies, `bin.chox = dist/bin/chox.js`, registry signature, and
  integrity `sha512-cHk0dvdz0cDu/E/jiWTJm8t19s14jGsqo7mziUhG8BjaOsR4Pxq4YE+J40YnH6Cs6ruAapIpRItP5TNxRKZYNQ==`.
- GitHub `main` and the public lightweight `v0.1.0` tag both point to release commit
  `0d2253f20127acd7df75254fa4e13ef34963309e`.
- npm recorded `gitHead` as the prior merge commit
  `4e686b3164a6519f92320d6e05bd35db4a787eff` because the package was published
  before the version/package-name/README changes were committed. This is a provenance
  mismatch, not a source-content mismatch: the published source-bearing files match
  the tagged release bytes.

## v0.1.0 published artifact comparison

The registry tarball was downloaded independently, extracted, and compared with a
clean build of `v0.1.0`:

- `package.json`, README, license, built-in relay, schema, and every current compiled
  module/source map are byte-identical to the tag.
- The executable has mode `0755`, installs as a `chox` symlink, and resolves its
  package-relative built-in relay correctly.
- No source-checkout path, maintainer home path, fixture, test, internal plan, or
  production dependency is present.
- The tarball has 90 entries instead of the clean build's 88. The only extras are
  stale, unreferenced `dist/src/harness/git.js` and `git.js.map` outputs for a source
  file deleted before the release. They do not affect runtime behavior, but they make
  the artifact an inexact build of its tag.

## v0.1.0 fresh installed-package journey

A real `npm install --global chox-cli@0.1.0` was performed in an isolated prefix with
isolated npm, Chox, Claude, and Codex homes and fake vendor binaries. The installed
binary then passed:

1. `chox --version` and command-specific help;
2. healthy `doctor`, built-in `relay list`/`show`, and JSON output;
3. a Unicode, multiline task dry-run containing literal `{{repo}}` text with no
   second template expansion;
4. `detect --no-confirm --json` with empty histories and `status`;
5. a real attended three-hop run in an isolated Git worktree;
6. Ctrl-C at the first gate, task-file mutation, and `--resume` from the persisted
   original plan without rereading the changed task;
7. final branch preservation and worktree cleanup;
8. doctor-bundle checks excluding the task, compiled prompt, and raw/dash-encoded
   home paths, plus packaged built-in immutability; and
9. isolated global uninstall removing the package/binary while leaving the run
   record and preserved Git branch intact.

Node 22 emits its upstream `ExperimentalWarning` when the CLI loads `node:sqlite`.
The warning is on stderr and does not corrupt JSON stdout; it is not a package
dispatch or execution failure.

## Repository defects found and corrected

- `package-lock.json` still identified the root package as `chox@0.0.0`.
- the CLI version test still expected `0.0.0` and made the tagged test suite fail;
- `verify:pack` hard-coded the installed directory `node_modules/chox`, so it failed
  after the package was renamed to `chox-cli`;
- builds did not remove `dist/`, allowing deleted-source output into the tarball;
- no npm lifecycle gate forced a clean build and full verification before publish;
- current roadmap/onboarding state still described Phase 1c, handle selection, and
  publishing as pending; and
- package metadata omitted repository, issue, homepage, and author fields, while the
  packaged README linked relatively to planning documents excluded from the tarball.

The repository now derives the installed package directory from the validated
manifest name, cleans before every build, rebuilds on `prepack`, runs the full release
gate on `prepublishOnly`, verifies compiled output exactly matches TypeScript source,
keeps the version test synchronized with the manifest, fixes lockfile identity and
public metadata, uses durable README links, and records the accepted/published state.

## Maintainer-approved patch release

npm package versions are immutable. Correcting the live artifact's stale files,
metadata, README links, or `gitHead` requires a new version; moving or republishing
`0.1.0` is not an acceptable fix. The maintainer approved `0.1.1` on 2026-07-14.
The release must commit and tag the exact tree first, run the complete
`prepublishOnly` gate from a clean checkout, publish from that commit, and verify
registry metadata plus a fresh installed journey again. The verified release outcome
is appended only after those steps pass.

## Verified v0.1.1 release outcome

`chox-cli@0.1.1` was published on 2026-07-14 local time after the maintainer's
explicit approval. npm's `latest` dist-tag resolves to `0.1.1`, while immutable
`0.1.0` remains available as the first public release.

- Release commit and lightweight tag `v0.1.1` both identify
  `618962fa1bbcb5a50fb23559d39b63207b70c0a7`.
- npm records that exact commit as `gitHead`; the tag, package provenance metadata,
  and published source therefore agree.
- The published tarball has 88 files, no stale `dist/src/harness/git.js` output,
  unpacked size 490,852 bytes, shasum
  `1ac92d3eb038e11bb706ad82baf2929f3ce272a5`, and integrity
  `sha512-d7Z8+N8TU0QR9zxRuL4lUf93iy3vq66pqXhyMrgj4DorbQnybTjZgFEPGJyeED9vDFFnzPOK2JfhjItJSe/U4Q==`.
- `prepublishOnly` passed strict typechecking, all 186 tests, a clean production
  build, and installed-package verification before npm accepted the publish.
- A fresh, unpinned `npm install --global chox-cli` in an isolated prefix resolved
  to `0.1.1`. Its `chox` symlink targeted the packaged executable, `chox --version`
  returned `0.1.1`, built-in relay list/show resolved package-relative assets, and a
  task-file dry-run compiled all three documented prompts in a new Git repository.
  Isolated `doctor` and empty-state `status` also exited successfully.

The patch release corrects every publish-integrity defect found here without moving
or replacing `0.1.0` and without changing the installed CLI command from `chox`.
