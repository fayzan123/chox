export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function isValidSlug(input: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input)
}

