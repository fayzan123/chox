const maxTokens = 24

const stopwords = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can',
  'could', 'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'may', 'my', 'not', 'of',
  'on', 'or', 'our', 'please', 'should', 'so', 'that', 'the', 'their',
  'then', 'there', 'these', 'this', 'to', 'up', 'us', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'will', 'with', 'would', 'you', 'your'
])

export const intentSimilarityThreshold = 0.5

function fixtureFingerprints(text: string): string[] | undefined {
  if (!text.includes('<redacted:user-intent>')) return undefined
  const tokens = text.toLocaleLowerCase('en-US').match(/\bfp[a-f0-9]{10}\b/g) ?? []
  return [...new Set(tokens)].sort()
}

function tokens(text: string): string[] {
  const fixture = fixtureFingerprints(text)
  if (fixture) return fixture.slice(0, maxTokens)

  const withoutCode = text.replace(/```[\s\S]*?```/g, ' ')
  const withoutPaths = withoutCode
    .replace(/(?:[A-Za-z]:[\\/]|\.{0,2}[\\/]|~[\\/]|[\\/])(?:[^\s"'`]+[\\/]?)+/g, ' ')
  const matches = withoutPaths.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) ?? []
  const distinct: string[] = []
  const seen = new Set<string>()
  for (const token of matches) {
    if (token.length < 2 || stopwords.has(token) || seen.has(token)) continue
    seen.add(token)
    distinct.push(token)
    if (distinct.length === maxTokens) break
  }
  return distinct.sort()
}

export function intentDigest(text: string): string {
  return tokens(text).join(' ')
}

export function digestSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(/\s+/).filter(Boolean))
  const rightTokens = new Set(right.split(/\s+/).filter(Boolean))
  if (leftTokens.size === 0 && rightTokens.size === 0) return 1
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  let intersection = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1
  }
  return intersection / (leftTokens.size + rightTokens.size - intersection)
}
