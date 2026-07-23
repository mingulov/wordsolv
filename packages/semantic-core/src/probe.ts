import { normalizeWord } from './types'

/**
 * The cold-start ladder plus the `dictHash` of the vector asset it was built
 * against (spec §7). `probes` is in greedy max-coverage selection order (spec
 * §6.3) — that order is also descending order of expected usefulness. Callers
 * must preserve it; never sort or otherwise reorder it.
 */
export interface ProbeLadder {
  dictHash: string
  probes: string[]
}

/**
 * Parses and validates the ladder asset's own shape (a `dictHash` string plus a
 * non-empty array of distinct, normalised probe words). This does **not** check
 * the hash against any loaded `VectorSet` — both assets are gitignored and
 * independently regenerable, so a ladder built against a stale `ru.vec.bin` would
 * otherwise load silently. Callers that also load a `VectorSet` must additionally
 * call `assertProbeLadderMatches` before using `probes`.
 */
export function parseProbeLadder(json: string): ProbeLadder {
  const parsed: unknown = JSON.parse(json)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('probe ladder must be a JSON object with dictHash and probes')
  const raw = parsed as Record<string, unknown>
  if (typeof raw.dictHash !== 'string' || raw.dictHash === '')
    throw new Error('probe ladder dictHash must be a non-empty string')
  if (!Array.isArray(raw.probes)) throw new Error('probe ladder probes must be an array')
  if (raw.probes.length === 0) throw new Error('probe ladder must not be empty')
  const seen = new Set<string>()
  const probes = raw.probes.map((entry, i) => {
    if (typeof entry !== 'string') throw new Error(`probe ladder entry ${i} must be a string`)
    const word = normalizeWord(entry)
    if (word === '') throw new Error(`probe ladder entry ${i} must not be empty`)
    if (seen.has(word)) throw new Error(`probe ladder has duplicate "${word}"`)
    seen.add(word)
    return word
  })
  return { dictHash: raw.dictHash, probes }
}

/**
 * Fails loudly (Finding 5) when `ladder`'s recorded `dictHash` does not equal
 * the currently-loaded vector asset's `VectorSet.hash` — i.e. the *word list*
 * the ladder was built against differs from the word list of the vectors
 * loaded now. Both `ru.vec.bin` and `ru.probes.json` are gitignored and
 * independently regenerable, so without this check a ladder built against a
 * since-changed lexicon loads silently.
 *
 * What this does **not** catch (Minor 2): `VectorSet.hash` is computed from
 * the word list alone (`hashWords` in `vectors.ts`), not from the embedding
 * values. A re-quantised `ru.vec.bin`, or a differently-trained embedding
 * built over the identical lexicon, produces the identical hash and passes
 * this check undetected — this guard verifies lexicon agreement only, not
 * "same asset" in any stronger sense.
 */
export function assertProbeLadderMatches(ladder: ProbeLadder, vectorsHash: string): void {
  if (ladder.dictHash !== vectorsHash) {
    throw new Error(
      `probe ladder dictHash "${ladder.dictHash}" does not match the loaded vector asset's word-list hash "${vectorsHash}" ` +
        `— the ladder was built against a different word list; regenerate with "npm run semantic:probes"`,
    )
  }
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
