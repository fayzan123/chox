# Phase 1b.1 challenge notes

These notes record the approved detection-hardening judgments and any implementation
deviations. They do not rewrite the historical Phase 1b packet.

## Intentional deviations

### README privacy wording reflects the expanded Q4 evidence boundary

- The earlier Phase 1b contract said confirmation sends excerpts from only the
  highest-weighted occurrence, while Q4 intentionally sends bounded excerpts from up
  to the top three occurrences without increasing the total character allowance.
- The README now states the shipped boundary instead of retaining the narrower, false
  promise. No other privacy-contract sentence changed.
- Revert path: restore single-occurrence excerpt selection in confirmation and then
  restore the prior README sentence.

There were no other intentional deviations from the approved Q1–Q7 spec or strict
manifest.

## Approved implementation judgments

### Path containment is lexical

- `isPathInside` resolves and compares path strings without filesystem access or
  `realpath`.
- A symlink can therefore make two filesystem-equivalent locations compare as
  different strings. This is the approved Q1 tradeoff: detection remains read-only,
  deterministic, and independent of whether recorded paths still exist.
- Revert path: introduce an explicitly approved filesystem-aware boundary and define
  missing-path behavior before replacing the lexical predicate.

### Broken installed relays do not count as coverage

- Coverage discovery uses the canonical relay loader and silently skips an installed
  relay whose definition or referenced templates fail validation.
- Reporting broken automation as coverage would suppress a usable draft even though
  the existing relay cannot run. The read-only matcher therefore treats only fully
  loadable relays as working automation.
- Revert path: add a distinct broken-coverage diagnostic state if product policy later
  wants invalid installations surfaced without treating them as successful coverage.
