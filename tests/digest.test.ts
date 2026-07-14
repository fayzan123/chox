import { describe, expect, test } from 'vitest'

import { digestSimilarity, intentDigest } from '../src/digest.js'

describe('intent digest', () => {
  test('is deterministic and insensitive to case, punctuation, paths, and code blocks', () => {
    const left = intentDigest('Please PLAN the Widget! at /Users/demo/repo/src/a.ts\n```ts\nsecretCode()\n```')
    const right = intentDigest('plan, widget at C:\\Users\\demo\\repo\\src\\b.ts')
    expect(left).toBe(right)
    expect(left).toBe('plan widget')
    expect(left).not.toContain('secret')
    expect(left).not.toContain('users')
  })

  test('keeps the first 24 distinct content tokens and sorts them', () => {
    const input = Array.from({ length: 30 }, (_, index) => `token${String(index).padStart(2, '0')}`).join(' ')
    const digest = intentDigest(input)
    expect(digest.split(' ')).toHaveLength(24)
    expect(digest.split(' ')).toEqual([...digest.split(' ')].sort())
    expect(digest).not.toContain('token24')
  })

  test('preserves only opaque fingerprints from redacted fixture intents', () => {
    expect(intentDigest(
      '<redacted:user-intent> fpbbbbbbbbbb fpaaaaaaaaaa <redacted:user-message>'
    )).toBe('fpaaaaaaaaaa fpbbbbbbbbbb')
  })
})

describe('digest similarity', () => {
  test('has identity one, disjoint zero, and Jaccard overlap', () => {
    expect(digestSimilarity('alpha beta', 'alpha beta')).toBe(1)
    expect(digestSimilarity('', '')).toBe(1)
    expect(digestSimilarity('alpha', 'beta')).toBe(0)
    expect(digestSimilarity('alpha beta', 'beta gamma')).toBeCloseTo(1 / 3)
  })
})
