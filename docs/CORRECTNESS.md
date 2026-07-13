# CORRECTNESS.md — the distilled ledger

Source: `docs/SPEC.md` Appendix B.2. These are hard-won correctness requirements
inherited from the predecessor project (CWC), several of them found post-publish and
paid for by real users. They are **non-negotiable requirements the Chox test suite
must cover** — each item below must eventually be enforced by at least one test, and
build packets reference items by number (C1–C10).

Chox is ground-up new code; this ledger is how the re-earning of correctness stays
cheap instead of user-funded (SPEC.md §6).

## C1. Windows shell quoting

Spawning shell commands via `execFile` with a command *string* loses quoting on
Windows (`cmd` quote-escaping). Use `exec` (or argv-array spawning) for user-supplied
shell commands. Found post-publish in the predecessor.

## C2. Transcript drift tolerance

Unknown JSONL entry types are counted and skipped, never fatal. Literal `null` lines
must not crash parsing — `JSON.parse('null')` succeeds and returns `null`, so guard
the falsy case explicitly.

## C3. Redaction completeness

Diagnostics must redact sensitive values **in derived encodings too** — notably the
dash-encoded home directory inside Claude Code project-directory names
(`/Users/x` → `-Users-x`). Redacting only the literal home path is a known leak class.

## C4. Dispatch naming

Agent/skill frontmatter `name` must be the dispatch slug, not a human title —
dispatch resolves against frontmatter, not filenames. Skills are directory-keyed;
agents are name-keyed.

## C5. Ownership safety

Never overwrite or delete a file without verifying an ownership marker proves this
tool (and this workflow) owns it. Foreign and hand-authored files produce warnings,
never rewrites.

## C6. Rename reconciliation

Renaming an artifact may delete the old file only if owned. Slug collisions are
detected and resolved deterministically.

## C7. Process honesty

Never report a service/run as started without verifying it (health check). On port
collision, name the occupant. `stop` must report what it actually stopped.

## C8. Timing variance

Scheduler and process tests must tolerate timing and path differences across
platforms. CI runs two OS families from day one.

> **Amended 2026-07-13 (platform decision, SPEC.md §4):** supported platforms are
> macOS + Linux (WSL counts); CI matrix is Ubuntu + macOS. Native Windows is
> deferred until first external demand (Phase 5 at the latest). C1's argv-array
> spawning rule and existing path-normalization hygiene are **retained** — they are
> correct on all platforms and keep the Windows door open. The first Windows CI run
> (2026-07-13) confirmed this ledger's predictions: `.cmd` shim spawning failed
> exactly as C1/C8 anticipated; that finding is recorded for whenever Windows
> support is picked up.

## C9. Worktree hygiene

Isolated-run worktrees are cleaned up — **including orphans left by crashed runs**.

## C10. Real-FS testing

Filesystem behavior is tested with temp directories and path overrides, never mocks.
Tests never touch the real `~/.chox`, `~/.claude`, or `~/.codex`.
