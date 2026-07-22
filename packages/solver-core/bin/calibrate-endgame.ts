/**
 * Endgame engagement calibration.
 *
 *   npx tsx bin/calibrate-endgame.ts --lang ru --len 5 --boards 4
 *   npx tsx bin/calibrate-endgame.ts --positions real --lang ru --len 5 --boards 4 --games 30
 *
 * `endgameSearch` returns null when it runs out of budget, and `suggest` then
 * falls through to entropy having spent the whole budget for nothing. So
 * `endgameJointLimit` should sit where searches actually finish. This tool
 * measures where that is, in two complementary ways:
 *
 * - `--positions synthetic` (default): per-board candidate lists drawn at random
 *   from T1, sized so the joint product lands just under each bucket. Worst case
 *   by construction — unrelated words split into the maximum number of distinct
 *   patterns, so the cartesian walk branches as widely as it ever can.
 * - `--positions real`: plays seeded games and measures the endgame positions
 *   that actually arise. Real candidate sets all satisfy the same guess history,
 *   so they are far more correlated (and cheaper) than random ones. This is the
 *   distribution the constant is really being chosen against.
 *
 * Node counts are measured without touching `src/`: `endgameSearch`'s `tick()`
 * reads `opts.endgameNodeBudget` exactly once per node, so an accessor on that
 * property counts nodes exactly. The accessor costs a little speed, so in the
 * synthetic sweep timings and node counts are measured in two separate passes
 * over the same (seeded, hence identical) positions.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDictAsset, type Dictionary } from '../src/dictionary'
import { endgameSearch } from '../src/endgame'
import { boardCandidatesOf } from '../src/entropy'
import { scoreGuess } from '../src/pattern'
import { mulberry32, pickDistinct } from '../src/random'
import { suggest } from '../src/solver'
import { defaultOptions, newGame, solvedWordOf, type Language, type SolverOptions } from '../src/types'

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? dflt : process.argv[i + 1]
}

const lang = arg('lang', 'ru') as Language
const len = Number(arg('len', '5'))
const boards = Number(arg('boards', '4'))
const trials = Number(arg('trials', '25'))
const seed = Number(arg('seed', '20260722'))
const positions = arg('positions', 'synthetic')
const games = Number(arg('games', '30'))
const buckets = arg('buckets', '100,300,1000,3000,10000,30000,100000').split(',').map(Number)

const dict: Dictionary = parseDictAsset(
  readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', `${lang}-${len}.txt`), 'utf8'),
)

/** Options object that counts every read of `endgameNodeBudget`, i.e. every node. */
function countingOpts(base: SolverOptions, ceiling: number): { opts: SolverOptions; nodes: () => number } {
  let n = 0
  const opts = Object.create(base) as SolverOptions
  Object.defineProperty(opts, 'endgameNodeBudget', { get: () => { n++; return ceiling } })
  return { opts, nodes: () => n }
}

const pct = (xs: number[], q: number): number => xs[Math.min(xs.length - 1, Math.floor(xs.length * q))]
const NODE_CEILING = 200_000_000
const nodeTimeBudgetMs = Number(arg('node-time-budget', '20000'))

function synthetic(): void {
  /** Per-board candidate lists whose joint product lands just under `cap`. */
  const position = (cap: number, rng: () => number): string[][] => {
    const per = Math.max(1, Math.floor(Math.pow(cap, 1 / boards)))
    return Array.from({ length: boards }, () =>
      pickDistinct(rng, Math.min(per, dict.t1Count), dict.t1Count).map((i) => dict.words[i]))
  }

  // Pass A: wall-clock, unmodified options object (no accessor overhead).
  const timeOpts: SolverOptions = { ...defaultOptions('lite'), endgameNodeBudget: Number.MAX_SAFE_INTEGER }

  console.log(`# synthetic ${lang}-${len} x${boards}  trials=${trials}  seed=${seed}  timeBudgetMs=${timeOpts.timeBudgetMs}`)
  console.log('jointBucket | perBoard | trials | completed | p50 ms | p95 ms | p50 nodes | p95 nodes | maxNodes | nodesTrunc')
  for (const cap of buckets) {
    const rngA = mulberry32(seed)
    const times: number[] = []
    let completed = 0
    for (let t = 0; t < trials; t++) {
      const cands = position(cap, rngA)
      const t0 = performance.now()
      const r = endgameSearch(cands, boards + 3, dict, timeOpts)
      times.push(performance.now() - t0)
      if (r) completed++
    }

    // Pass B only matters for buckets that are candidates for the limit, i.e. buckets
    // where every search finished. Elsewhere the node total is unbounded by definition
    // and measuring it would cost minutes for a number nobody uses.
    const nodeCounts: number[] = []
    let truncated = 0
    if (completed === trials) {
      const rngB = mulberry32(seed)
      for (let t = 0; t < trials; t++) {
        const cands = position(cap, rngB)
        const { opts, nodes } = countingOpts(
          { ...defaultOptions('lite'), timeBudgetMs: nodeTimeBudgetMs, endgameNodeBudget: NODE_CEILING },
          NODE_CEILING,
        )
        if (!endgameSearch(cands, boards + 3, dict, opts)) truncated++
        nodeCounts.push(nodes())
      }
    }

    times.sort((a, b) => a - b)
    const ns = [...nodeCounts].sort((a, b) => a - b)
    const n = (q: number) => (ns.length === 0 ? '-' : pct(ns, q).toString())
    const perBoard = Math.max(1, Math.floor(Math.pow(cap, 1 / boards)))
    console.log(
      `${String(cap).padStart(11)} | ${String(perBoard).padStart(8)} | ${String(times.length).padStart(6)} | ` +
      `${String(completed).padStart(9)} | ${pct(times, 0.5).toFixed(0).padStart(6)} | ${pct(times, 0.95).toFixed(0).padStart(6)} | ` +
      `${n(0.5).padStart(9)} | ${n(0.95).padStart(9)} | ` +
      `${(ns.length === 0 ? '-' : String(ns[ns.length - 1])).padStart(8)} | ${String(truncated).padStart(10)}`,
    )
  }
}

interface Obs { joint: number; ms: number; nodes: number; done: boolean }

function real(): void {
  // Games are played with the production options so the trajectories are the real
  // ones; each turn's endgame position is then measured separately, under a node-
  // counting options object, so measuring cannot perturb play.
  const playOpts = defaultOptions('lite')
  const rng = mulberry32(seed)
  const obs: Obs[] = []
  const measureCap = Number(arg('max-joint', '1000000'))

  for (let g = 0; g < games; g++) {
    const answers = pickDistinct(rng, boards, dict.t1Count).map((i) => dict.words[i])
    const state = newGame(lang, len, boards)
    while (state.guesses.length < state.maxGuesses) {
      const bc = boardCandidatesOf(state, dict)
      const active = bc.filter((b) => b.solvedWord === null)
      if (active.length === 0) break
      let joint = 1
      for (const b of active) {
        joint *= Math.max(1, b.candidates.length)
        if (joint > measureCap) break
      }
      if (joint <= measureCap) {
        const { opts, nodes } = countingOpts(
          { ...playOpts, endgameNodeBudget: NODE_CEILING },
          NODE_CEILING,
        )
        const t0 = performance.now()
        const r = endgameSearch(active.map((b) => b.candidates), state.maxGuesses - state.guesses.length, dict, opts)
        obs.push({ joint, ms: performance.now() - t0, nodes: nodes(), done: r !== null })
      }
      const word = suggest(state, dict, playOpts, null).suggestions[0]?.word
      if (!word) break
      state.guesses.push(word)
      for (let b = 0; b < boards; b++) state.boards[b].feedback.push(scoreGuess(word, answers[b]))
      if (answers.every((_, b) => solvedWordOf(state, b) !== null)) break
    }
  }

  console.log(`# real ${lang}-${len} x${boards}  games=${games}  seed=${seed}  timeBudgetMs=${playOpts.timeBudgetMs}  observations=${obs.length}`)
  console.log('jointRange | observed | completed | p50 ms | p95 ms | max ms | p50 nodes | p95 nodes | maxNodes')
  let lo = 1
  for (const hi of [...buckets, Infinity]) {
    const inBucket = obs.filter((o) => o.joint >= lo && o.joint < hi)
    const label = hi === Infinity ? `>=${lo}` : `<${hi}`
    lo = hi
    if (inBucket.length === 0) continue
    const times = inBucket.map((o) => o.ms).sort((a, b) => a - b)
    const ns = inBucket.map((o) => o.nodes).sort((a, b) => a - b)
    console.log(
      `${label.padStart(10)} | ${String(inBucket.length).padStart(8)} | ` +
      `${String(inBucket.filter((o) => o.done).length).padStart(9)} | ` +
      `${pct(times, 0.5).toFixed(0).padStart(6)} | ${pct(times, 0.95).toFixed(0).padStart(6)} | ` +
      `${times[times.length - 1].toFixed(0).padStart(6)} | ` +
      `${pct(ns, 0.5).toString().padStart(9)} | ${pct(ns, 0.95).toString().padStart(9)} | ` +
      `${ns[ns.length - 1].toString().padStart(8)}`,
    )
  }
  const allDone = obs.filter((o) => o.done)
  const dn = allDone.map((o) => o.nodes).sort((a, b) => a - b)
  const dt = allDone.map((o) => o.ms).sort((a, b) => a - b)
  if (dn.length) {
    console.log(`# completed searches: ${dn.length}/${obs.length}  p95 nodes=${pct(dn, 0.95)}  max nodes=${dn[dn.length - 1]}  p95 ms=${pct(dt, 0.95).toFixed(0)}`)
  }
  // Node distribution for the band a candidate `endgameJointLimit` would retain — this
  // is what `endgameNodeBudget` has to clear if it is to stay a backstop and not become
  // the gate that decides which positions get an endgame answer.
  const limit = Number(arg('limit', '100'))
  const kept = obs.filter((o) => o.joint < limit && o.done).map((o) => o.nodes).sort((a, b) => a - b)
  if (kept.length) {
    console.log(
      `# completed with joint<${limit}: n=${kept.length}  p50=${pct(kept, 0.5)}  p90=${pct(kept, 0.9)}  ` +
      `p95=${pct(kept, 0.95)}  p99=${pct(kept, 0.99)}  max=${kept[kept.length - 1]}`,
    )
  }
}

if (positions === 'real') real()
else synthetic()
