import { normalizeWord } from './types'

/**
 * The cold-start ladder, in greedy max-coverage selection order (spec §6.3) —
 * that order is also descending order of expected usefulness. Callers must
 * preserve it; never sort or otherwise reorder the returned array.
 */
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

/**
 * The next probes to offer: walks `ladder` in its stored selection order
 * (descending expected usefulness) and returns the first `limit` entries not
 * present in `used`, skipping over used ones without reordering the rest.
 *
 * Precondition: `used` must already contain normalised words (trim ->
 * lowercase -> 'ё' -> 'е'; see `normalizeWord`). This function does not
 * normalise its inputs itself — the caller owns normalisation — so passing
 * raw-cased or otherwise unnormalised entries in `used` will silently fail to
 * skip already-played probes.
 */
export function nextProbes(ladder: string[], used: Set<string>, limit: number): string[] {
  const out: string[] = []
  for (const word of ladder) {
    if (out.length >= limit) break
    if (!used.has(word)) out.push(word)
  }
  return out
}
