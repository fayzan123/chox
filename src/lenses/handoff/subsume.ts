import type { Candidate, CandidateOccurrence } from '../lens.js'

export function isContiguousSubsequence<T>(
  shorter: readonly T[],
  longer: readonly T[]
): boolean {
  if (shorter.length === 0 || shorter.length > longer.length) return false
  const finalStart = longer.length - shorter.length
  for (let start = 0; start <= finalStart; start += 1) {
    let matches = true
    for (let index = 0; index < shorter.length; index += 1) {
      if (shorter[index] !== longer[start + index]) {
        matches = false
        break
      }
    }
    if (matches) return true
  }
  return false
}

function occurrenceContained(
  shorter: CandidateOccurrence,
  longer: CandidateOccurrence
): boolean {
  return shorter.repoRoot === longer.repoRoot
    && isContiguousSubsequence(shorter.sessionIds, longer.sessionIds)
}

export function applySubsumption(candidates: Candidate[]): void {
  const surfaced = candidates
    .filter((candidate) => candidate.surfaced)
    .sort((left, right) => left.chain.length - right.chain.length || left.id.localeCompare(right.id))

  for (const shorter of surfaced) {
    if (shorter.subsumedBy !== undefined) continue
    const qualifying = surfaced.filter((longer) => (
      longer.subsumedBy === undefined
      && longer.chain.length > shorter.chain.length
      && isContiguousSubsequence(shorter.chain, longer.chain)
      && shorter.occurrences.every((occurrence) => (
        longer.occurrences.some((longerOccurrence) => occurrenceContained(occurrence, longerOccurrence))
      ))
    )).sort((left, right) => (
      right.chain.length - left.chain.length || left.id.localeCompare(right.id)
    ))
    const subsumer = qualifying[0]
    if (subsumer) shorter.subsumedBy = subsumer.id
  }
}
