/** CLI: npx tsx bin/simulate.ts --lang ru --len 5 --boards 4 --games 500 --seed 42 --mode lite */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDictAsset } from '../src/dictionary'
import { buildPatternTable } from '../src/patternTable'
import { simulateGames, type Suggester } from '../src/simulate'
import { suggest } from '../src/solver'
import { defaultOptions } from '../src/types'

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? dflt : process.argv[i + 1]
}

const lang = arg('lang', 'ru')
const len = Number(arg('len', '5'))
const boards = Number(arg('boards', '4'))
const games = Number(arg('games', '500'))
const seed = Number(arg('seed', '42'))
const mode = arg('mode', 'lite') as 'lite' | 'deep'

const dict = parseDictAsset(readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', `${lang}-${len}.txt`), 'utf8'))
const opts = defaultOptions(mode)
const table = mode === 'deep' ? buildPatternTable(dict) : null
const suggester: Suggester = (state, d) => suggest(state, d, opts, table)

const t0 = performance.now()
const r = simulateGames(dict, boards, games, seed, suggester)
const secs = ((performance.now() - t0) / 1000).toFixed(1)
console.log(`${lang}-${len}x${boards} mode=${mode} games=${games} seed=${seed} (${secs}s)`)
console.log(`winRate=${(r.winRate * 100).toFixed(2)}% avgGuesses=${r.avgGuesses.toFixed(3)}`)
console.log('histogram:', r.histogram)
if (r.losses.length) console.log(`losses (${r.losses.length} shown): first =`, r.losses[0])
