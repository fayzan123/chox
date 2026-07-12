import { basename } from 'node:path'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function redact(text: string, opts: { homeDir: string }): string {
  const normalizedHome = opts.homeDir.replaceAll('\\', '/')
  const rawVariants = new Set([opts.homeDir, normalizedHome])
  let result = text
  for (const home of [...rawVariants].filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.replace(new RegExp(escapeRegExp(home), 'gi'), '~')
  }

  const encodedVariants = new Set(
    [...rawVariants].map((home) => home.replace(/[\\/.]/g, '-'))
  )
  for (const encoded of [...encodedVariants].filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.replace(new RegExp(escapeRegExp(encoded), 'gi'), '~(dash-encoded)')
  }

  const username = basename(normalizedHome)
  if (username) {
    result = result.replace(
      new RegExp(`([/\\\\])${escapeRegExp(username)}(?=([/\\\\]|$))`, 'gi'),
      '$1<user>'
    )
  }
  return result
}

