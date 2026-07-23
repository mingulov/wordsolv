/**
 * Offline benchmark against the committed gold fixture. No network.
 * Run: npx tsx bin/evaluate.ts [--lambda N]
 *
 * The fixture is 40 secrets x their true top-300 neighbours, captured from the
 * provider. For a secret S that list IS the answer key, so we can replay
 * "player has N guesses ranked <=300" entirely offline.
 *
 * Reports HELD-OUT numbers: lambda is chosen on the first half of the secrets
 * (sorted alphabetically, so the split is stable across runs) and measured on
 * the second. See spec §10 risk 1 — the spec's own §9 table used the same 40
 * secrets to tune lambda and to measure it; these numbers are not that.
 *
 * `--lambda N` skips the sweep's own choice and reports held-out numbers for
 * a fixed lambda instead (the tuning sweep still runs and prints, for
 * comparison).
 *
 * A second, independent measurement follows: the cold-start probe ladder
 * (spec §6.3) against a deterministic random-common-noun baseline. This one
 * has no lambda and no train/test split — a probe's rank for a secret is just
 * its position in that secret's own gold list, which is provided regardless
 * of the fit.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RankCache } from '../src/ranks'
import { rankCandidates, scoreCandidates, type FitObservation } from '../src/fit'
import { parseVectors } from '../src/vectors'
import { normalizeWord } from '../src/types'
import { nextProbes, parseProbeLadder } from '../src/probe'
import { mulberry32 } from '../src/random'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const HERE = join(import.meta.dirname, '..')
const gold: Record<string, string[]> = JSON.parse(
  readFileSync(join(ROOT, 'docs/superpowers/specs/assets/contextno-gold-40x300.json'), 'utf8'),
)
const vs = parseVectors(new Uint8Array(readFileSync(join(HERE, 'dict/assets/ru.vec.bin'))))
const RANK_UNIVERSE = 21000
const TRIALS = 6

const secrets = Object.keys(gold).map(normalizeWord).filter((s) => vs.index.has(s)).sort()
const half = Math.floor(secrets.length / 2)
const tune = secrets.slice(0, half)
const heldOut = secrets.slice(half)

function positions(group: string[], n: number, lambda: number): number[] {
  const cache = new RankCache(vs, RANK_UNIVERSE)
  const rng = mulberry32(11)
  const out: number[] = []
  for (const secret of group) {
    const neighbours = gold[secret].map(normalizeWord).slice(1).filter((w) => vs.index.has(w))
    if (neighbours.length < n) continue
    for (let t = 0; t < TRIALS; t++) {
      const picked = new Set<number>()
      while (picked.size < n) picked.add(Math.floor(rng() * neighbours.length))
      const obs: FitObservation[] = [...picked].map((i) => ({
        index: vs.index.get(neighbours[i])!,
        rank: gold[secret].map(normalizeWord).indexOf(neighbours[i]) + 1,
      }))
      const scores = scoreCandidates(vs, cache, obs, lambda)
      const order = rankCandidates(scores, new Set(), vs.words.length)
      out.push(order.indexOf(vs.index.get(secret)!) + 1)
    }
  }
  return out
}

function summarise(p: number[]): string {
  const sorted = [...p].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const top10 = (p.filter((x) => x <= 10).length / p.length) * 100
  const top50 = (p.filter((x) => x <= 50).length / p.length) * 100
  return `median ${median}, top-10 ${top10.toFixed(0)}%, top-50 ${top50.toFixed(0)}%`
}

console.log(`secrets: ${secrets.length} (tune ${tune.length}, held-out ${heldOut.length})`)
console.log(`tune split:     ${tune.join(', ')}`)
console.log(`held-out split: ${heldOut.join(', ')}`)

let best = { lambda: 0, score: Infinity }
for (const lambda of [0, 0.1, 0.25, 0.5, 1]) {
  const p = positions(tune, 8, lambda)
  const median = [...p].sort((a, b) => a - b)[Math.floor(p.length / 2)]
  console.log(`  tune  lambda=${lambda}: ${summarise(p)}`)
  if (median < best.score) best = { lambda, score: median }
}

const argIdx = process.argv.indexOf('--lambda')
const overrideLambda = argIdx >= 0 ? Number(process.argv[argIdx + 1]) : undefined
const chosenLambda = overrideLambda !== undefined && Number.isFinite(overrideLambda) ? overrideLambda : best.lambda
console.log(
  `\nchosen lambda: ${chosenLambda}` +
    (overrideLambda !== undefined ? ` (--lambda override; sweep picked ${best.lambda})` : ' (picked on tuning half)'),
)
for (const n of [5, 8, 12, 20]) {
  console.log(`  HELD-OUT N=${n}: ${summarise(positions(heldOut, n, chosenLambda))}`)
}

// ---------------------------------------------------------------------------
// Probe-ladder validation (spec §6.3). No task in the plan measures this —
// added here per Task 9 scope. A probe's rank for a secret is its position in
// that secret's own gold top-300 list, or "outside 300" if absent. There is no
// lambda and no tune/held-out split: the metric doesn't touch scoreCandidates
// at all, so every one of the 40 gold secrets is used.
// ---------------------------------------------------------------------------
console.log('\n--- probe ladder vs random baseline ---')

const ladder = parseProbeLadder(readFileSync(join(HERE, 'dict/assets/ru.probes.json'), 'utf8'))
const LADDER_KS = [5, 10, 20, 30, 40]
const allSecrets = Object.keys(gold).map(normalizeWord)

/** Best (lowest) rank any of `probes` achieves in `list` (secret's own gold order), or Infinity. */
function bestRank(list: string[], probes: string[]): number {
  const rankOf = new Map<string, number>()
  list.forEach((w, i) => rankOf.set(normalizeWord(w), i + 1))
  let best = Infinity
  for (const probe of probes) {
    const r = rankOf.get(probe)
    if (r !== undefined && r < best) best = r
  }
  return best
}

/** Fraction of secrets for which some probe among the first k lands in the top-300, per k. */
function hitRates(probeWords: string[]): Map<number, number> {
  const out = new Map<number, number>()
  for (const k of LADDER_KS) {
    let hits = 0
    for (const secret of allSecrets) {
      const probes = nextProbes(probeWords, new Set(), k)
      if (bestRank(gold[secret], probes) <= 300) hits++
    }
    out.set(k, hits / allSecrets.length)
  }
  return out
}

const ladderRates = hitRates(ladder)
console.log(`ladder (${ladder.length} probes): ${ladder.slice(0, 10).join(', ')}, ...`)

// Random baseline: same candidate pool the ladder was built from (common,
// concrete nouns — mirrors bin/build-probes.ts; keep these three constants in
// sync if that filter changes), averaged over several mulberry32-seeded draws.
const HARRIX = join(ROOT, 'packages', 'solver-core', 'dict', 'raw', 'russian_nouns.txt')
const CANDIDATES = 6000
// Keep in sync with the (extended) ABSTRACT regex in bin/build-probes.ts.
const ABSTRACT =
  /(ость|ение|ание|изм|ция|ство|тие|ика|ура|ота|изна|щина|ирование|ация|гия|фия|метрия|номия|отка|овка|евка)$/
const common = new Set(readFileSync(HARRIX, 'utf8').split('\n').map(normalizeWord).filter((w) => w !== ''))
const candidatePool: string[] = []
for (let i = 0; i < Math.min(CANDIDATES, vs.words.length); i++) {
  const w = vs.words[i]
  if (w.length >= 4 && !ABSTRACT.test(w) && common.has(w)) candidatePool.push(w)
}
console.log(`random-baseline candidate pool: ${candidatePool.length} common concrete nouns`)

function pickDistinct(rng: () => number, count: number, poolSize: number): number[] {
  const chosen = new Set<number>()
  while (chosen.size < count) chosen.add(Math.floor(rng() * poolSize))
  return [...chosen]
}

const DRAWS = 20
const totals = new Map<number, number>(LADDER_KS.map((k) => [k, 0]))
for (let d = 0; d < DRAWS; d++) {
  const rng = mulberry32(9000 + d)
  const drawn = pickDistinct(rng, Math.min(40, candidatePool.length), candidatePool.length).map((i) => candidatePool[i])
  const rates = hitRates(drawn)
  for (const k of LADDER_KS) totals.set(k, totals.get(k)! + rates.get(k)!)
}

console.log(`\n${'k'.padStart(4)}${'ladder'.padStart(10)}${'random (avg of ' + DRAWS + ')'.padStart(24)}`)
for (const k of LADDER_KS) {
  const l = (ladderRates.get(k)! * 100).toFixed(0)
  const r = ((totals.get(k)! / DRAWS) * 100).toFixed(0)
  console.log(`${String(k).padStart(4)}${(l + '%').padStart(10)}${(r + '%').padStart(24)}`)
}
