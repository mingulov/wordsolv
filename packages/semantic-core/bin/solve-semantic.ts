/**
 * Prints suggestions for a Contexto-family puzzle.
 * Run: npm run solve-semantic -- game.txt [--provider contextno-ru] [--top 10]
 *
 * game.txt is one "слово ранг" per line; "слово не найдено" marks a rejection.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parsePaste } from '../src/gamefile'
import { parseProbeLadder } from '../src/probe'
import { parseProfiles } from '../src/profile'
import { RankCache } from '../src/ranks'
import { suggest } from '../src/suggest'
import { parseVectors } from '../src/vectors'

const DICT = join(import.meta.dirname, '..', 'dict', 'assets')
const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
if (!file) {
  console.error('usage: solve-semantic <game.txt> [--provider <id>] [--top <n>]')
  process.exit(1)
}
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const profiles = parseProfiles(readFileSync(join(DICT, 'profiles.json'), 'utf8'))
const providerId = flag('provider', 'contextno-ru')
const profile = profiles.get(providerId)
if (!profile) {
  console.error(`unknown provider "${providerId}"; known: ${[...profiles.keys()].join(', ')}`)
  process.exit(1)
}

let gameText: string
try {
  gameText = readFileSync(file, 'utf8')
} catch (e) {
  const message = e instanceof Error ? e.message : String(e)
  console.error(`could not read "${file}": ${message}`)
  process.exit(1)
}

const vectors = parseVectors(new Uint8Array(readFileSync(join(DICT, 'ru.vec.bin'))))
const ladder = parseProbeLadder(readFileSync(join(DICT, 'ru.probes.json'), 'utf8'))

let state
let warnings: string[]
try {
  ;({ state, warnings } = parsePaste(gameText, providerId))
} catch (e) {
  const message = e instanceof Error ? e.message : String(e)
  console.error(`could not parse "${file}": ${message}`)
  process.exit(1)
}
for (const w of warnings) console.error(`warning: ${w}`)

const result = suggest({
  state,
  vectors,
  profile,
  ladder,
  cache: new RankCache(vectors, profile.rankUniverse),
  limit: Number(flag('top', '10')),
})

console.log(`regime: ${result.regime}   best rank: ${result.bestRank ?? '—'}   guesses: ${state.observations.length}`)
if (state.rejected.length) console.log(`rejected by provider: ${state.rejected.join(', ')}`)
if (result.unvectorised.length)
  console.log(`not in our model (shown, but not used): ${result.unvectorised.join(', ')}`)
if (result.suggestions.length === 0) console.log('solved — nothing to suggest')
for (const [i, s] of result.suggestions.entries())
  console.log(`${String(i + 1).padStart(2)}. ${s.word.padEnd(20)} ${s.source}`)
