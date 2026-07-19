/** CLI: npx tsx bin/build-openers.ts --config all --games 200 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDictAsset } from '../src/dictionary'
import { entropyOf, suggestEntropy, weightsFor } from '../src/entropy'
import { filterCandidates } from '../src/filter'
import { scoreGuess } from '../src/pattern'
import { buildPatternTable } from '../src/patternTable'
import { djb2, mulberry32 } from '../src/random'
import { simulateGames, type Suggester } from '../src/simulate'
import { suggest } from '../src/solver'
import { defaultOptions, newGame, type Language } from '../src/types'

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? dflt : process.argv[i + 1]
}

const games = Number(arg('games', '200'))
const configArg = arg('config', 'all')
const configs = configArg === 'all' ? ['ru-5x4', 'ru-5x1', 'en-5x4', 'en-5x1'] : [configArg]

const openersPath = join(import.meta.dirname, '..', 'src', 'openers.json')
const openers = JSON.parse(readFileSync(openersPath, 'utf8')) as Record<string, string[]>

for (const config of configs) {
  const m = /^(en|ru)-(\d+)x(\d+)$/.exec(config)
  if (!m) throw new Error(`bad config: ${config}`)
  const [, lang, lenS, boardsS] = m
  const boards = Number(boardsS)
  const dict = parseDictAsset(
    readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', `${lang}-${lenS}.txt`), 'utf8'),
  )
  const opts = defaultOptions('deep')
  const table = buildPatternTable(dict)
  // disableOpeners: true so every evaluation run below (baseline, variants, incumbent) is
  // structurally immune to openers.json at EVERY turn, not just the forced-opener turns. Without
  // this, evalSeq only forces `seq.length` turns via simOpts.forcedOpeners (see simulate.ts's
  // playGame: opts.forcedOpeners?.[turn] is only defined for turn < seq.length); any later turn
  // falls through to this suggester, i.e. solver.suggest, whose Phase 1 re-reads the *currently
  // committed* openers.json and re-triggers whenever the guesses so far happen to be a prefix of
  // the committed sequence. Today every committed opener is a single word, so that prefix check
  // can only ever match at turn 0 (already covered by forcedOpeners) — latent, not live. But a
  // future 2+-word committed opener whose first word equals a forced seq's first word would
  // re-contaminate turn 1 onward. Gating the whole phase off here removes that possibility
  // entirely, independent of what's committed. This is behaviorally identical to production
  // post-prefix play: production itself skips Phase 1 once state.guesses.length >= seq.length, so
  // real games never rely on Phase 1 beyond the forced prefix either — disabling it here changes
  // nothing about what's being measured, only removes a way that measurement could be corrupted.
  const evalOpts = { ...opts, disableOpeners: true }
  const suggester: Suggester = (st, d) => suggest(st, d, evalOpts, table)

  // The true live first move for this config: multi-board deep-mode entropy (2-ply),
  // seeded exactly as src/solver.ts seeds it ('main'), for use as a zero-strength-change fallback.
  const fresh = newGame(lang as Language, Number(lenS), boards)
  const liveFirst = suggestEntropy(fresh, dict, opts, table, 'main')[0].word

  // Steps 1-2: fresh-entropy ranking over T1 answers; o1 = top 4, probe pool = top 500.
  const t1 = dict.words.slice(0, dict.t1Count)
  const w1 = weightsFor(t1, dict)
  const rankedFresh = dict.words
    .map((w, i) => ({ w, i, h: entropyOf(w, t1, w1) }))
    .sort((a, b) => b.h - a.h || a.i - b.i)
    .map((x) => x.w)
  const o1s = rankedFresh.slice(0, 4)
  const probePool = rankedFresh.slice(0, 500)

  // Step 3: vote the best second word per o1 over 64 seeded sampled answers.
  const variants: string[][] = []
  for (const o1 of o1s) {
    variants.push([o1])
    const rng = mulberry32(djb2(config + '|' + o1))
    const votes = new Map<string, number>()
    for (let s = 0; s < 64; s++) {
      const ans = t1[Math.floor(rng() * t1.length)]
      const reduced = filterCandidates(t1, [o1], [scoreGuess(o1, ans)])
      if (reduced.length <= 1) continue
      const wr = weightsFor(reduced, dict)
      let bestWord = ''
      let bestH = -1
      for (const p of probePool) {
        if (p === o1) continue
        const h = entropyOf(p, reduced, wr)
        if (h > bestH) { bestH = h; bestWord = p }
      }
      if (bestWord) votes.set(bestWord, (votes.get(bestWord) ?? 0) + 1)
    }
    const top2 = [...votes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
    for (const [o2] of top2) variants.push([o1, o2])
  }

  // Steps 4-5: simulate baseline and every variant on the same seed; pick the winner.
  const evalSeq = (seq: string[], label = seq.join(' ')) => {
    const r = simulateGames(dict, boards, games, 42, suggester, { forcedOpeners: seq })
    console.log(`${config} [${label}] win=${(r.winRate * 100).toFixed(2)}% avg=${r.avgGuesses.toFixed(3)}`)
    return { seq, winRate: r.winRate, avg: r.avgGuesses }
  }
  // Baseline = the no-precomputation reference. This MUST force liveFirst rather than call
  // evalSeq([]): an empty seq means no forcedOpeners, so simulateGames falls through to the live
  // suggester for turn 0 too, and (absent the `suggester`'s disableOpeners: true above) that would
  // read openers[config] straight out of the *currently committed* openers.json for that first
  // turn. Forcing liveFirst keeps turn 0 pinned to the true live first move regardless. Turns
  // after the forced prefix, for every evalSeq call (baseline, variants, incumbent alike), are
  // made immune to openers.json by `suggester`'s disableOpeners: true (see above) rather than by
  // anything seed- or sequence-specific here — that's what actually closes the gap for future
  // multi-word committed openers, not the choice of what to force at turn 0.
  const baseline = evalSeq([liveFirst], `baseline: ${liveFirst}`)
  const results = variants.map((seq) => evalSeq(seq))
  // Also force-evaluate the incumbent committed sequence (if present and not already covered by
  // the baseline or this run's voted variants), so regeneration can never discard a proven winner
  // just because this run's fresh voting didn't happen to rediscover it.
  const incumbent = openers[config]
  const covered = (seq: string[]) =>
    JSON.stringify(seq) === JSON.stringify([liveFirst]) ||
    results.some((r) => JSON.stringify(r.seq) === JSON.stringify(seq))
  if (incumbent?.length && !covered(incumbent)) {
    results.push(evalSeq(incumbent, `incumbent: ${incumbent.join(' ')}`))
  }
  results.sort((a, b) => b.winRate - a.winRate || a.avg - b.avg)
  const best = results[0]
  const improved = best && (best.winRate > baseline.winRate ||
    (best.winRate === baseline.winRate && best.avg < baseline.avg))
  // Always write an entry: worst case, cache the true live first move (zero strength change).
  openers[config] = improved ? best.seq : [liveFirst]
  console.log(`${config}: selected [${openers[config].join(' ')}]${improved ? '' : ' (fallback: cached first move)'}`)
}

writeFileSync(openersPath, JSON.stringify(openers, null, 2) + '\n')
