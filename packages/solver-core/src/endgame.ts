import { type Dictionary } from './dictionary'
import { entropyOf, weightsFor } from './entropy'
import { allGreen, scoreGuess } from './pattern'
import type { SolverOptions } from './types'

export interface EndgameResult {
  word: string
  winProb: number
  expGuesses: number
}

const ROOT_PROBES = 20
const CLOCK_MASK = 255

interface Value { p: number; eg: number }

class Timeout extends Error {}

/**
 * Exact expected-value search over the joint endgame.
 * Assumption: boards have pairwise-distinct answers (Quordle-family rule);
 * used only for the boards>guesses prune.
 */
export function endgameSearch(
  boardCands: string[][],
  guessesLeft: number,
  dict: Dictionary,
  opts: SolverOptions,
): EndgameResult | null {
  const deadline = performance.now() + opts.timeBudgetMs
  let clock = 0
  const done = allGreen(dict.wordLength)
  const memo = new Map<string, Value>()

  // Guess pool: all remaining candidates + top entropy probes (computed once at root).
  const candidateUnion = [...new Set(boardCands.flat())]
  const merged = candidateUnion
  const mergedWeights = weightsFor(merged, dict)
  const probes = dict.words
    .map((w, i) => ({ w, i, h: entropyOf(w, merged, mergedWeights) }))
    .sort((a, b) => b.h - a.h || a.i - b.i)
    .slice(0, ROOT_PROBES)
    .map((x) => x.w)
  const pool = [...new Set([...candidateUnion, ...probes])]

  /**
   * Deterministic work counter. Ticked once per pool word considered *and* once per
   * leaf of the cartesian walk (see `walk`), because the leaves are where the search
   * actually spends itself: a single pool word can expand into arbitrarily many of
   * them, and leaves served by the memo or by a base case in `value` do no other
   * accounting. The wall clock stays as a secondary, machine-dependent safety net.
   */
  let nodes = 0
  function tick(): void {
    if (++nodes > opts.endgameNodeBudget) throw new Timeout()
    if ((clock++ & CLOCK_MASK) === 0 && performance.now() > deadline) throw new Timeout()
  }

  function value(boards: string[][], left: number): Value {
    if (boards.length === 0) return { p: 1, eg: 0 }
    if (left === 0 || boards.length > left) return { p: 0, eg: 0 }
    const key = `${left}|${boards.map((b) => b.join(',')).sort().join(';')}`
    const hit = memo.get(key)
    if (hit) return hit
    const best = bestGuess(boards, left)
    const v: Value = { p: best.winProb, eg: best.expGuesses }
    memo.set(key, v)
    return v
  }

  function bestGuess(boards: string[][], left: number): EndgameResult {
    let best: EndgameResult = { word: '', winProb: -1, expGuesses: Infinity }
    for (const g of pool) {
      tick()
      // Partition every board by pattern.
      const parts = boards.map((cands) => {
        const m = new Map<number, string[]>()
        for (const c of cands) {
          const p = scoreGuess(g, c)
          const arr = m.get(p)
          if (arr) arr.push(c)
          else m.set(p, [c])
        }
        return { size: cands.length, entries: [...m.entries()] }
      })
      // Walk the cartesian product of per-board outcomes.
      let p = 0
      let eg = 0
      const walk = (bi: number, prob: number, next: string[][]): void => {
        if (bi === parts.length) {
          tick()
          const sub = value(next, left - 1)
          p += prob * sub.p
          eg += prob * (1 + sub.eg)
          return
        }
        for (const [pattern, subset] of parts[bi].entries) {
          const pr = prob * (subset.length / parts[bi].size)
          if (pattern === done) walk(bi + 1, pr, next)
          else walk(bi + 1, pr, [...next, subset])
        }
      }
      walk(0, 1, [])
      if (p > best.winProb + 1e-12 || (Math.abs(p - best.winProb) <= 1e-12 && eg < best.expGuesses - 1e-12)) {
        best = { word: g, winProb: p, expGuesses: eg }
      }
    }
    return best
  }

  try {
    const boards = boardCands.filter((b) => b.length > 0)
    if (boards.length === 0) return null
    return bestGuess(boards, guessesLeft)
  } catch (e) {
    if (e instanceof Timeout) return null
    throw e
  }
}
