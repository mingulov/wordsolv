import { normalizeWord } from './types'

export function parseProbeLadder(json: string): string[] {
  const parsed: unknown = JSON.parse(json)
  if (!Array.isArray(parsed)) throw new Error('probe ladder must be a JSON array')
  if (parsed.length === 0) throw new Error('probe ladder must not be empty')
  const seen = new Set<string>()
  return parsed.map((entry, i) => {
    if (typeof entry !== 'string') throw new Error(`probe ladder entry ${i} must be a string`)
    const word = normalizeWord(entry)
    if (word === '') throw new Error(`probe ladder entry ${i} must not be empty`)
    if (seen.has(word)) throw new Error(`probe ladder has duplicate "${word}"`)
    seen.add(word)
    return word
  })
}

export function nextProbes(ladder: string[], used: Set<string>, limit: number): string[] {
  const out: string[] = []
  for (const word of ladder) {
    if (out.length >= limit) break
    if (!used.has(word)) out.push(word)
  }
  return out
}
