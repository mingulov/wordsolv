/**
 * Builds the cold-start probe ladder by greedy max-coverage (spec §6.3).
 * Run: npx tsx bin/build-probes.ts
 *
 * A probe covers a secret if it lands inside that secret's top-COVER window —
 * the threshold at which the fit becomes strong. We greedily pick the probes
 * whose covered sets union to the most frequency-weighted mass.
 *
 * IMPORTANT — this deliberately does NOT implement the brief's literal
 * algorithm (threshold per secret against the whole ~86k pool, dense
 * probes x secrets coverage matrix, 40-pass rescan of that matrix). That is
 * ~5.2e11 multiply-adds for the coverage pass alone plus ~1.6e11 greedy
 * re-scans in pure JS -- hours to days. Instead:
 *
 *  - Coverage uses the SYMMETRIC cosine-similarity approximation the solver
 *    already relies on elsewhere (see `predictedRanks` in `ranks.ts`, which
 *    treats sim(a,b) == sim(b,a) rather than modelling directional rank
 *    asymmetry). For each probe candidate we compute its similarity to the
 *    SECRETS proxy secrets only (not the whole pool) and take that probe's
 *    OWN top-COVER as the secrets it covers. This selects effectively the
 *    same probes at ~O(probes * SECRETS * dim) ~= 2.6e10 multiply-adds --
 *    about 20x less work, and the O(probes * pool) term is gone entirely.
 *  - The int8 quantised rows are decoded into a plain Float32Array ONCE up
 *    front; the per-probe dot-product loop below never allocates and never
 *    goes through `similarityTo` (which would re-decode a row every call).
 *  - Coverage is stored as sparse per-probe index arrays (~COVER entries
 *    each), never a dense mask.
 *  - The greedy loop keeps a `remaining` weight array and computes each
 *    probe's gain by summing only over its own sparse list (~COVER adds),
 *    picks the best, zeroes the covered entries, and marks the probe used so
 *    it can't be re-selected (a literal port of the brief's loop has no such
 *    guard and could emit a duplicate ladder entry once remaining mass hits
 *    zero, which `parseProbeLadder` rejects).
 *
 * Farthest-point sampling was tried and is WORSE than random (spec §6.3): it
 * selects outliers far from every plausible secret. Do not "simplify" to it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeWord } from '../src/types'
import { parseVectors } from '../src/vectors'

const HERE = join(import.meta.dirname, '..', 'dict')
const HARRIX = join(import.meta.dirname, '..', '..', 'solver-core', 'dict', 'raw', 'russian_nouns.txt')
const COVER = 300          // spec §6.3
const SECRETS = 20000      // proxy universe of plausible secrets
const CANDIDATES = 6000    // probes are drawn from the most frequent words
const LADDER = 40
// -гия/-фия/-метрия/-номия catch the -огия/-логия/-графия/-метрия/-номия loanword
// family (онкология, религия, география, экономия, ...); -отка/-овка/-евка catch
// the common deverbal action-noun pattern (обработка, установка, тренировка, ...).
// Neither is exhaustive — see bin/evaluate.ts's before/after ladder comparison for
// the abstract words (речь, мечта, совет, капитал, финал, подъем, ...) that carry
// no distinguishing suffix and survive regardless.
const ABSTRACT =
  /(ость|ение|ание|изм|ция|ство|тие|ика|ура|ота|изна|щина|ирование|ация|гия|фия|метрия|номия|отка|овка|евка)$/

function main(): void {
  const t0 = performance.now()
  const vs = parseVectors(new Uint8Array(readFileSync(join(HERE, 'assets', 'ru.vec.bin'))))
  const common = new Set(
    readFileSync(HARRIX, 'utf8').split('\n').map(normalizeWord).filter((w) => w !== ''),
  )

  const probeIdx: number[] = []
  for (let i = 0; i < Math.min(CANDIDATES, vs.words.length); i++) {
    const w = vs.words[i]
    if (w.length >= 4 && !ABSTRACT.test(w) && common.has(w)) probeIdx.push(i)
  }
  console.log(`probe candidates: ${probeIdx.length}`)

  const secretCount = Math.min(SECRETS, vs.words.length)
  const weight = new Float64Array(secretCount)
  for (let s = 0; s < secretCount; s++) weight[s] = 1 / Math.log(s + Math.E)

  // Decode the int8 rows we need (secrets 0..secretCount -- a superset of the
  // probe candidates, since CANDIDATES <= SECRETS) into a plain Float32Array
  // once. The O(probes * secrets * dim) loop below reads only this array.
  const { dim, data, scale } = vs
  const decoded = new Float32Array(secretCount * dim)
  for (let i = 0; i < secretCount; i++) {
    const base = i * dim
    for (let d = 0; d < dim; d++) decoded[base + d] = data[base + d] * scale[d]
  }
  const norms = new Float32Array(secretCount)
  for (let i = 0; i < secretCount; i++) {
    let n = 0
    const base = i * dim
    for (let d = 0; d < dim; d++) n += decoded[base + d] * decoded[base + d]
    norms[i] = Math.sqrt(n) || 1
  }
  console.log(`decoded ${secretCount} rows (${((performance.now() - t0) / 1000).toFixed(1)}s)`)

  // Sparse coverage: coveredIdx[p] holds the (up to) COVER secret indices probe p covers.
  const coveredIdx: Int32Array[] = new Array(probeIdx.length)
  const sims = new Float32Array(secretCount)
  // Bounded min-heap over (value, index), reused across probes -- no per-probe
  // allocation for the top-COVER selection, only the final COVER-sized copy.
  const heapVal = new Float32Array(COVER)
  const heapIdx = new Int32Array(COVER)

  for (let p = 0; p < probeIdx.length; p++) {
    const pRow = probeIdx[p]
    const pBase = pRow * dim
    const normP = norms[pRow]

    for (let s = 0; s < secretCount; s++) {
      let dot = 0
      const sBase = s * dim
      for (let d = 0; d < dim; d++) dot += decoded[pBase + d] * decoded[sBase + d]
      sims[s] = dot / (normP * norms[s])
    }

    let heapSize = 0
    for (let s = 0; s < secretCount; s++) {
      const v = sims[s]
      if (heapSize < COVER) {
        let c = heapSize++
        heapVal[c] = v
        heapIdx[c] = s
        while (c > 0) {
          const parent = (c - 1) >> 1
          if (heapVal[parent] <= heapVal[c]) break
          const tv = heapVal[parent]; const ti = heapIdx[parent]
          heapVal[parent] = heapVal[c]; heapIdx[parent] = heapIdx[c]
          heapVal[c] = tv; heapIdx[c] = ti
          c = parent
        }
      } else if (v > heapVal[0]) {
        heapVal[0] = v
        heapIdx[0] = s
        let c = 0
        for (;;) {
          const l = 2 * c + 1; const r = 2 * c + 2
          let smallest = c
          if (l < COVER && heapVal[l] < heapVal[smallest]) smallest = l
          if (r < COVER && heapVal[r] < heapVal[smallest]) smallest = r
          if (smallest === c) break
          const tv = heapVal[smallest]; const ti = heapIdx[smallest]
          heapVal[smallest] = heapVal[c]; heapIdx[smallest] = heapIdx[c]
          heapVal[c] = tv; heapIdx[c] = ti
          c = smallest
        }
      }
    }
    coveredIdx[p] = heapIdx.slice(0, heapSize)

    if (p % 500 === 0)
      console.log(`  coverage ${p}/${probeIdx.length} (${((performance.now() - t0) / 1000).toFixed(0)}s)`)
  }
  console.log(`coverage done (${((performance.now() - t0) / 1000).toFixed(1)}s)`)

  const remaining = Float64Array.from(weight)
  const used = new Uint8Array(probeIdx.length)
  const ladder: string[] = []
  for (let k = 0; k < LADDER; k++) {
    let bestP = -1
    let bestGain = -1
    for (let p = 0; p < probeIdx.length; p++) {
      if (used[p]) continue
      let gain = 0
      const idx = coveredIdx[p]
      for (let j = 0; j < idx.length; j++) gain += remaining[idx[j]]
      if (gain > bestGain) { bestGain = gain; bestP = p }
    }
    if (bestP < 0) break
    used[bestP] = 1
    const idx = coveredIdx[bestP]
    for (let j = 0; j < idx.length; j++) remaining[idx[j]] = 0
    ladder.push(vs.words[probeIdx[bestP]])
  }

  writeFileSync(join(HERE, 'assets', 'ru.probes.json'), JSON.stringify(ladder, null, 2))
  console.log(
    `ru.probes.json: ${ladder.length} probes -> ${ladder.slice(0, 10).join(', ')} ` +
      `(${((performance.now() - t0) / 1000).toFixed(1)}s total)`,
  )
}

main()
