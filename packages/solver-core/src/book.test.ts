import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  bookLookup, dictHashOf, parseMove0, parseMove1, serializeMove0, serializeMove1,
  type OpeningBook,
} from './book'
import { makeDictionary, parseDictAsset, type Dictionary } from './dictionary'
import { boardCandidatesOf, entropyOf, scoreAllWords, weightsFor, type BoardCandidates } from './entropy'
import { scoreGuess } from './pattern'
import { buildPatternTable } from './patternTable'
import { djb2, mulberry32 } from './random'
import { rateGuessRow, rateGuesses } from './rate'
import { suggest } from './solver'
import { defaultOptions, newGame, type GameState } from './types'
import booksJson from '../dict/assets/books.json' with { type: 'json' }

const d = makeDictionary('en', 3, ['bat', 'cat', 'hat'], ['bch'])

describe('move-0 book format', () => {
  it('round-trips values', () => {
    const vals = new Float64Array([1.5, 2.25, 3.125, 0])
    const buf = serializeMove0(d, vals)
    const out = parseMove0(buf, d)
    expect(out).not.toBeNull()
    expect([...out!]).toEqual([...vals])
  })

  it('rejects a dictionary whose hash differs', () => {
    const buf = serializeMove0(d, new Float64Array(4))
    const other = makeDictionary('en', 3, ['bat', 'cat', 'hat'], ['xyz'])
    expect(parseMove0(buf, other)).toBeNull()
  })

  it('rejects bad magic', () => {
    const buf = serializeMove0(d, new Float64Array(4))
    new DataView(buf).setUint8(0, 0)
    expect(parseMove0(buf, d)).toBeNull()
  })

  it('rejects a truncated buffer', () => {
    const buf = serializeMove0(d, new Float64Array(4))
    expect(parseMove0(buf.slice(0, 25), d)).toBeNull()
  })
})

describe('move-1 book format', () => {
  it('round-trips patterns and values, including odd patternCount', () => {
    const patterns = [0, 4, 26] // odd count exercises the 2-byte pad
    const values = new Float32Array([
      0, 1, 2, 3,
      4, 5, 6, 7,
      8, 9, 10, 11,
    ])
    const buf = serializeMove1(d, 2, patterns, values)
    const bk = parseMove1(buf, d)
    expect(bk).not.toBeNull()
    expect(bk!.openerIdx).toBe(2)
    expect(bk!.n).toBe(4)
    expect([...bk!.rowOf.entries()]).toEqual([[0, 0], [4, 1], [26, 2]])
    expect(bk!.values[1 * 4 + 2]).toBe(6)
  })

  it('rejects a dictionary whose hash differs', () => {
    const buf = serializeMove1(d, 0, [0], new Float32Array(4))
    const other = makeDictionary('en', 3, ['bat', 'cat', 'hat'], ['xyz'])
    expect(parseMove1(buf, other)).toBeNull()
  })
})

describe('dictHashOf', () => {
  it('changes when the word list changes', () => {
    const other = makeDictionary('en', 3, ['bat', 'cat', 'hat'], ['xyz'])
    expect(dictHashOf(d)).not.toBe(dictHashOf(other))
  })
  it('is stable for the same word list', () => {
    const same = makeDictionary('en', 3, ['bat', 'cat', 'hat'], ['bch'])
    expect(dictHashOf(d)).toBe(dictHashOf(same))
  })
})

function loadBook(cfg: string): { dict: ReturnType<typeof parseDictAsset>; book: OpeningBook } {
  const assets = join(import.meta.dirname, '..', 'dict', 'assets')
  const dict = parseDictAsset(readFileSync(join(assets, `${cfg}.txt`), 'utf8'))
  const raw = readFileSync(join(assets, `${cfg}.m0.bin`))
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
  const move0 = parseMove0(buf, dict)
  if (!move0) throw new Error(`move-0 book failed to parse for ${cfg}`)
  return { dict, book: { dictHash: dictHashOf(dict), move0, move1: null } }
}

const fullBooks = new Map<string, { dict: Dictionary; book: OpeningBook }>()

/**
 * `loadBook` plus the gzipped move-1 asset. Cached because several blocks below share a
 * config and the ru-4/ru-5 assets are a few MB once inflated.
 */
function loadFullBook(cfg: string): { dict: Dictionary; book: OpeningBook } {
  const hit = fullBooks.get(cfg)
  if (hit) return hit
  const { dict, book } = loadBook(cfg)
  const raw = gunzipSync(readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', `${cfg}.m1.bin.gz`)))
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
  const move1 = parseMove1(buf, dict)
  if (!move1) throw new Error(`move-1 book failed to parse for ${cfg}`)
  const loaded = { dict, book: { ...book, move1 } }
  fullBooks.set(cfg, loaded)
  return loaded
}

/** A move-1 position: `guess` played once, each board coloured against its own answer. */
function move1State(dict: Dictionary, guess: string, answers: string[]): GameState {
  const state = newGame(dict.language, dict.wordLength, answers.length)
  state.guesses = [guess]
  state.boards = answers.map((a) => ({ feedback: [scoreGuess(guess, a)] }))
  return state
}

/** T1 words bucketed by the pattern the opener paints on them — the builder's row layout. */
function t1Buckets(dict: Dictionary, opener: string): Map<number, string[]> {
  const byPattern = new Map<number, string[]>()
  for (const word of dict.words.slice(0, dict.t1Count)) {
    const p = scoreGuess(opener, word)
    const arr = byPattern.get(p)
    if (arr) arr.push(word)
    else byPattern.set(p, [word])
  }
  return byPattern
}

/** The exact `unsolved` array `scoreAllWords` passes to `bookLookup`. */
function unsolvedOf(state: GameState, dict: Dictionary): { bc: BoardCandidates; b: number }[] {
  return boardCandidatesOf(state, dict)
    .map((bc, b) => ({ bc, b }))
    .filter(({ bc }) => bc.solvedWord === null && bc.candidates.length > 0)
}

describe('move-0 book equivalence', () => {
  // ru-4 is the only config whose live move-0 scan (~2 s) belongs in the fast suite, so
  // the shared dictionary/book/baseline are computed once and reused by every test that
  // can use this exact state. Tests needing a different state pay for their own scan.
  const { dict, book } = loadBook('ru-4')
  const state = newGame('ru', 4, 4)
  const live = scoreAllWords(state, dict, null).scored
  const liveByWord = new Map(live.map((s) => [s.word, s.score]))

  it('reproduces live scores bit-for-bit and preserves the full ranking', () => {
    expect(bookLookup(state, dict, book, unsolvedOf(state, dict))).not.toBeNull()
    const withBook = scoreAllWords(state, dict, null, book).scored
    expect(withBook.length).toBe(live.length)
    for (let i = 0; i < live.length; i++) {
      expect(withBook[i].word).toBe(live[i].word)
      expect(withBook[i].score).toBe(live[i].score) // strict equality, not toBeCloseTo
      expect(withBook[i].isCandidateFor).toEqual(live[i].isCandidateFor)
    }
  })

  it('holds for a non-default board count and guess limit', () => {
    const st = newGame('ru', 4, 2, 11)
    expect(bookLookup(st, dict, book, unsolvedOf(st, dict))).not.toBeNull()
    const liveSmall = scoreAllWords(st, dict, null).scored
    const withBook = scoreAllWords(st, dict, null, book).scored
    for (let i = 0; i < liveSmall.length; i++) expect(withBook[i].score).toBe(liveSmall[i].score)
  })

  it('drives the scores it reports: perturbing one entry moves exactly one word', () => {
    const target = live[10] // well inside the top 50 of the live ranking
    const values = new Float64Array(book.move0)
    values[target.idx] += 1e-9
    const tweaked: OpeningBook = { ...book, move0: values }
    const withTweak = scoreAllWords(state, dict, null, tweaked).scored
    const differing = withTweak.filter((s) => s.score !== liveByWord.get(s.word)).map((s) => s.word)
    expect(differing).toEqual([target.word])
  })

  it('falls back to the live path once a guess has been played', () => {
    const st = newGame('ru', 4, 4)
    st.guesses = [dict.words[0]]
    st.boards = st.boards.map(() => ({ feedback: [0] }))
    expect(bookLookup(st, dict, book, unsolvedOf(st, dict))).toBeNull()
    const livePlayed = scoreAllWords(st, dict, null).scored
    const withBook = scoreAllWords(st, dict, null, book).scored
    for (let i = 0; i < livePlayed.length; i++) expect(withBook[i].score).toBe(livePlayed[i].score)
  })

  it('ignores a book whose dictHash does not match', () => {
    // Values are corrupted too, so a missing hash guard diverges visibly instead of
    // agreeing with the live path by accident.
    const values = new Float64Array(book.move0)
    for (let i = 0; i < values.length; i++) values[i] += 1
    const bad: OpeningBook = { ...book, move0: values, dictHash: book.dictHash ^ 1 }
    expect(bookLookup(state, dict, bad, unsolvedOf(state, dict))).toBeNull()
    const withBad = scoreAllWords(state, dict, null, bad).scored
    for (let i = 0; i < live.length; i++) expect(withBad[i].score).toBe(live[i].score)
  })
})

describe('book priority over a pattern table', () => {
  it('reads the book, not the table, when both are supplied', () => {
    // Every other book test passes `table = null`, so nothing there distinguishes the book
    // lookup from the table lookup inside `scoreWordAgainst` — `entropyOfIdx` and `entropyOf`
    // agree bit-for-bit, so swapping their priority stays numerically correct while silently
    // restoring the full move-0 scan for deep-mode users. This test supplies both.
    const dict = makeDictionary('en', 3, ['bat', 'cat', 'hat', 'mat', 'pat', 'rat'], ['bch', 'mpr'])
    const table = buildPatternTable(dict)
    expect(table).not.toBeNull() // a null table would make the whole test vacuous
    const state = newGame('en', 3, 2)

    // A book holding the true move-0 entropies, so book, table and live path all agree and
    // the perturbation below is the only observable difference between them.
    const bc = boardCandidatesOf(state, dict)[0]
    const move0 = new Float64Array(dict.words.length)
    for (let i = 0; i < dict.words.length; i++) {
      move0[i] = entropyOf(dict.words[i], bc.candidates, bc.weights)
    }
    const book: OpeningBook = { dictHash: dictHashOf(dict), move0, move1: null }
    expect(bookLookup(state, dict, book, unsolvedOf(state, dict))).not.toBeNull()

    const tableOnly = scoreAllWords(state, dict, table, null).scored
    const both = scoreAllWords(state, dict, table, book).scored
    for (let i = 0; i < tableOnly.length; i++) {
      expect(both[i].word).toBe(tableOnly[i].word)
      expect(both[i].score).toBe(tableOnly[i].score)
    }

    // The claim: with a table present the book still wins. Perturb one entry; the score of
    // exactly that word must move. If the table took priority the book would be dead weight
    // and every score would come back unchanged.
    const target = tableOnly[0]
    const values = new Float64Array(move0)
    values[target.idx] += 1e-9
    const tweaked: OpeningBook = { ...book, move0: values }
    const withTweak = scoreAllWords(state, dict, table, tweaked).scored
    const byWord = new Map(tableOnly.map((s) => [s.word, s.score]))
    const differing = withTweak.filter((s) => s.score !== byWord.get(s.word)).map((s) => s.word)
    expect(differing).toEqual([target.word])
  })
})

describe('rating consistency with the book', () => {
  const { dict, book } = loadBook('ru-4')
  const state = newGame('ru', 4, 4)
  const played = dict.words[3]
  const answers = [11, 29, 47, 83].map((i) => dict.words[i % dict.t1Count])
  state.guesses = [played]
  state.boards = answers.map((a) => ({ feedback: [scoreGuess(played, a)] }))
  const prefix = newGame('ru', 4, 4)

  it('draws the played score and the best score from the same source', () => {
    // Prove the book actually engages for the position being rated (row 0's prefix, i.e.
    // zero guesses played) — otherwise this equivalence would hold trivially even with
    // `bookLookup` stubbed to always return null, since book values are bit-identical to
    // live ones by construction (see 'move-0 book equivalence' above).
    expect(bookLookup(prefix, dict, book, unsolvedOf(prefix, dict))).not.toBeNull()

    const live = rateGuessRow(state, 0, dict, defaultOptions('lite'), null, null)
    const withBook = rateGuessRow(state, 0, dict, defaultOptions('lite'), null, book)
    expect(withBook).not.toBeNull()
    expect(withBook!.score).toBe(live!.score)
    expect(withBook!.bestWord).toBe(live!.bestWord)
    expect(withBook!.bestScore).toBe(live!.bestScore)
  })

  it("a perturbed entry at the played word's index moves rateGuessRow's score, and scoreAllWords agrees", () => {
    // The equivalence above is bit-identical to live scoring by construction (book values
    // are computed to match live entropy exactly), so it cannot distinguish "mine reads
    // the book" from "mine reads live scoring that happens to agree numerically". Perturb
    // the *played word's* own book entry and require the reported score to move — and to
    // match what `scoreAllWords` reports for that same word under the same perturbed book,
    // which is the actual claim: `mine` and `scored` are drawn from one source.
    const playedIdx = dict.index.get(played)!
    const values = new Float64Array(book.move0) // the typed-array ctor copies, it does not alias
    values[playedIdx] += 1e-9
    const perturbedBook: OpeningBook = { ...book, move0: values }

    const base = rateGuessRow(state, 0, dict, defaultOptions('lite'), null, book)
    const perturbed = rateGuessRow(state, 0, dict, defaultOptions('lite'), null, perturbedBook)
    expect(base).not.toBeNull()
    expect(perturbed).not.toBeNull()
    expect(perturbed!.score).not.toBe(base!.score)

    const { scored } = scoreAllWords(prefix, dict, null, perturbedBook)
    const scoredPlayed = scored.find((s) => s.word === played)
    expect(scoredPlayed).toBeDefined()
    expect(perturbed!.score).toBe(scoredPlayed!.score)
  })

  it('rateGuesses forwards the book consistently with rateGuessRow', () => {
    const rows = rateGuesses(state, dict, defaultOptions('lite'), null, book)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(rateGuessRow(state, 0, dict, defaultOptions('lite'), null, book))
  })
})

describe('suggest with a book', () => {
  it('returns the same suggestions as the live path at move 0', () => {
    const { dict, book } = loadBook('ru-4')
    const state = newGame('ru', 4, 4)
    const live = suggest(state, dict, defaultOptions('lite'), null, null)
    const withBook = suggest(state, dict, defaultOptions('lite'), null, book)
    expect(withBook.suggestions.map((s) => s.word)).toEqual(live.suggestions.map((s) => s.word))
    expect(withBook.suggestions.map((s) => s.score)).toEqual(live.suggestions.map((s) => s.score))
    expect(withBook.boards.map((b) => b.candidatesLeft)).toEqual(live.boards.map((b) => b.candidatesLeft))
  })

  it('is not vacuous: a perturbed book entry changes suggest scores (entropy phase, ru-4 has no opener entry)', () => {
    // ru-4 has no entry in openers.json, so move 0 here goes straight to Phase 3 (entropy).
    // The equivalence test above is bit-identical to live scoring by construction (book
    // values are computed to match live entropy exactly), so it cannot distinguish "suggest
    // reads the book" from "suggest ignores its book argument and reads live scoring that
    // happens to agree numerically". Perturb one entry and require the reported score for
    // that exact word to move.
    const { dict, book } = loadBook('ru-4')
    const state = newGame('ru', 4, 4)
    const opts = defaultOptions('lite')
    const live = suggest(state, dict, opts, null, null)
    expect(live.suggestions[0].source).toBe('entropy') // sanity: confirms this is the entropy-phase call site

    const target = live.suggestions[0]
    const targetIdx = dict.index.get(target.word)!
    const values = new Float64Array(book.move0)
    values[targetIdx] += 1e-9
    const tweaked: OpeningBook = { ...book, move0: values }

    const withTweak = suggest(state, dict, opts, null, tweaked)
    const tweakedEntry = withTweak.suggestions.find((s) => s.word === target.word)
    expect(tweakedEntry).toBeDefined()
    expect(tweakedEntry!.score).not.toBe(target.score)
  })

  it('threads the book through the opener phase too (ru-5x4 has an opener entry)', () => {
    // Separate call site from the previous test: openerKey('ru-5x4') is in openers.json,
    // so move 0 here takes Phase 1 (opener) and calls suggestEntropy for the *rest* of the
    // top-N list. Perturb a word we know appears in that rest list and require its score to move.
    const { dict, book } = loadBook('ru-5')
    const state = newGame('ru', 5, 4)
    const opts = defaultOptions('lite')
    const live = suggest(state, dict, opts, null, null)
    expect(live.suggestions[0].source).toBe('opener') // sanity: confirms this is the opener-phase call site
    expect(live.suggestions.length).toBeGreaterThan(1)

    const restTarget = live.suggestions[1]
    const targetIdx = dict.index.get(restTarget.word)!
    const values = new Float64Array(book.move0)
    values[targetIdx] += 1e-9
    const tweaked: OpeningBook = { ...book, move0: values }

    const withTweak = suggest(state, dict, opts, null, tweaked)
    expect(withTweak.suggestions[0].source).toBe('opener')
    expect(withTweak.suggestions[0].word).toBe(live.suggestions[0].word) // opener word itself is unaffected
    const tweakedEntry = withTweak.suggestions.find((s) => s.word === restTarget.word)
    expect(tweakedEntry).toBeDefined()
    expect(tweakedEntry!.score).not.toBe(restTarget.score)
  })

  it('threads the book through the endgame phase too (third, distinct call site)', () => {
    // Tiny fixture (mirrors `d` above) whose 3-candidate single board fits well inside
    // opts.endgameJointLimit, so Phase 2 (endgame) fires at move 0 and calls suggestEntropy
    // for the *rest* of the top-N list, same shape as the opener-phase test but a different
    // call site in solver.ts.
    const dict = makeDictionary('en', 3, ['bat', 'cat', 'hat'], ['bch'])
    const state = newGame('en', 3, 1, 6)
    const opts = defaultOptions('lite')
    const live = suggest(state, dict, opts, null, null)
    expect(live.suggestions[0].source).toBe('endgame') // sanity: confirms this is the endgame-phase call site

    const restTarget = live.suggestions.find((s) => s.source === 'entropy')!
    expect(restTarget).toBeDefined()
    const targetIdx = dict.index.get(restTarget.word)!
    const book: OpeningBook = { dictHash: dictHashOf(dict), move0: new Float64Array(dict.words.length), move1: null }
    const values = new Float64Array(book.move0)
    values[targetIdx] += 1e-9
    const tweaked: OpeningBook = { ...book, move0: values }

    const withTweak = suggest(state, dict, opts, null, tweaked)
    expect(withTweak.suggestions[0].source).toBe('endgame')
    expect(withTweak.suggestions[0].word).toBe(live.suggestions[0].word) // endgame word itself is unaffected
    const tweakedEntry = withTweak.suggestions.find((s) => s.word === restTarget.word)
    expect(tweakedEntry).toBeDefined()
    expect(tweakedEntry!.score).not.toBe(restTarget.score)
  })
})

/**
 * Move-1 values are stored as f32, so unlike move-0 they are *not* bit-identical to live
 * scores; the contract is that the rounding never reorders the head of the ranking. Checks
 * the top 50 over `trials` seeded reachable positions.
 */
function checkMove1TopFifty(cfg: string, trials: number, seed: number): void {
  const { dict, book } = loadFullBook(cfg)
  const m1 = book.move1!
  const opener = dict.words[m1.openerIdx]
  const t1 = dict.words.slice(0, dict.t1Count)
  const rng = mulberry32(seed)
  let engaged = 0
  let sawRounding = false
  for (let trial = 0; trial < trials; trial++) {
    const answers = Array.from({ length: 4 }, () => t1[Math.floor(rng() * t1.length)])
    const state = move1State(dict, opener, answers)
    // Not vacuous: were the book to decline, both sides would run the live path and agree
    // trivially. Every sampled position must actually be answered out of the book.
    expect(bookLookup(state, dict, book, unsolvedOf(state, dict))).not.toBeNull()
    engaged++
    const live = scoreAllWords(state, dict, null).scored
    const withBook = scoreAllWords(state, dict, null, book).scored
    expect(withBook.length).toBe(live.length)
    for (let i = 0; i < 50; i++) expect(withBook[i].word).toBe(live[i].word)
    if (!sawRounding) {
      const liveByWord = new Map(live.map((s) => [s.word, s.score]))
      sawRounding = withBook.some((s) => s.score !== liveByWord.get(s.word))
    }
  }
  expect(engaged).toBe(trials)
  // The scores themselves must *differ* somewhere: f32 storage rounds them. If they came
  // back bit-identical to live, the values being read would not be the stored f32 ones.
  expect(sawRounding).toBe(true)
}

describe('move-1 book equivalence', () => {
  // Two configs rather than six: a live move-1 scan costs ~0.2 s (ru) to ~0.6 s (en) per
  // position, so trials buy more confidence than breadth here. Every config's asset is
  // checked structurally and by sampled value in 'move-1 assets' below.
  it('matches the live top-50 ordering across sampled positions (ru-4)', () => {
    checkMove1TopFifty('ru-4', 20, 4242)
  })

  it('matches the live top-50 ordering across sampled positions (ru-5, the primary config)', () => {
    checkMove1TopFifty('ru-5', 20, 8484)
  })

  it('falls back when the played first guess is not the book opener', () => {
    const { dict, book } = loadFullBook('ru-4')
    const notOpener = dict.words[book.move1!.openerIdx === 0 ? 1 : 0]
    const state = move1State(dict, notOpener, Array(4).fill(dict.words[5]))
    expect(bookLookup(state, dict, book, unsolvedOf(state, dict))).toBeNull()
    const live = scoreAllWords(state, dict, null).scored
    const withBook = scoreAllWords(state, dict, null, book).scored
    // The book declined, so both sides ran the live path: strict equality is right here.
    for (let i = 0; i < live.length; i++) expect(withBook[i].score).toBe(live[i].score)
  })

  it('falls back when a board pattern has no T1 survivors (the T2-widening case)', () => {
    // en-4, not ru-4: ru-4 has exactly one T1-survivor-less pattern ('роек') and ru-5 has
    // five ('арека', 'векша', 'клект', 'скена', 'такыр') — every one of them a lone T1+T2
    // occupant. With a single candidate, every entropy is 0 and all four boards collapse to
    // the same flat (SOLVE_BONUS, 0, 0, ...) score, so the equality loop below would compare
    // ~1600 zeros with no signal. en-4 has a T1-survivor-less pattern shared by 2+ words.
    const { dict, book } = loadFullBook('en-4')
    const m1 = book.move1!
    const opener = dict.words[m1.openerIdx]
    // A pattern only T2 words produce: no T1 word survives it, so `boardView` widens the
    // board to T1+T2 and the book — built over T1 only — must decline.
    const t2Only = dict.words.slice(dict.t1Count).find((w) => {
      const p = scoreGuess(opener, w)
      if (m1.rowOf.has(p)) return false
      return dict.words.filter((cand) => scoreGuess(opener, cand) === p).length > 1
    })
    expect(t2Only).toBeDefined()
    const state = move1State(dict, opener, Array(4).fill(t2Only!))
    const unsolved = unsolvedOf(state, dict)
    expect(unsolved).toHaveLength(4) // widened, so still scorable — not silently empty
    expect(unsolved.every(({ bc }) => bc.tier === 2)).toBe(true)
    // The point of switching configs: a real ranking, not a field of zeros.
    expect(unsolved.every(({ bc }) => bc.candidates.length > 1)).toBe(true)
    expect(bookLookup(state, dict, book, unsolved)).toBeNull()
    const live = scoreAllWords(state, dict, null).scored
    const withBook = scoreAllWords(state, dict, null, book).scored
    for (let i = 0; i < live.length; i++) expect(withBook[i].score).toBe(live[i].score)
  })
})

describe('move-1 slot/board index translation', () => {
  it('handles a solved board so unsolved is shorter than boards (slot != board index)', () => {
    // `unsolved[slot].b` only differs from `slot` when some earlier board is already solved
    // — at move 1 that means its answer *is* the opener. The sampling loops above only hit
    // this by luck (see the file-level review notes): ru-4's 40-trial loop draws it once at
    // seed 4242, ru-5's 20-trial loop draws it zero times at seed 8484. Pin it directly:
    // board 0's answer is the opener itself, so board 0 solves on move 1 and `unsolved` holds
    // only boards 1-3, at slots 0-2 respectively — the one case where reading
    // `state.boards[unsolved[slot].b].feedback[0]` differs from reading `state.boards[slot]`.
    const { dict, book } = loadFullBook('ru-4')
    const m1 = book.move1!
    const opener = dict.words[m1.openerIdx]
    // 'есть' / 'этот' / 'мама' are T1 words distinct from the opener with three distinct
    // patterns against it (0, 3, 54), so the three unsolved boards read three different rows.
    const answers = [opener, 'есть', 'этот', 'мама']
    const state = move1State(dict, opener, answers)

    const unsolved = unsolvedOf(state, dict)
    expect(unsolved).toHaveLength(3)
    expect(unsolved.map(({ b }) => b)).toEqual([1, 2, 3])
    expect(unsolved.every(({ bc }) => bc.tier === 1)).toBe(true)

    expect(bookLookup(state, dict, book, unsolved)).not.toBeNull()
    const live = scoreAllWords(state, dict, null).scored
    const withBook = scoreAllWords(state, dict, null, book).scored
    for (let i = 0; i < 50; i++) expect(withBook[i].word).toBe(live[i].word)
  })
})

describe('move-1 tier guard', () => {
  it('declines the whole book when one unsolved board is on tier 2', () => {
    const { dict, book } = loadFullBook('ru-4')
    const m1 = book.move1!
    const opener = dict.words[m1.openerIdx]
    const t1 = dict.words.slice(0, dict.t1Count)
    const state = move1State(dict, opener, [t1[0], t1[1], t1[2], t1[3]])
    const unsolved = unsolvedOf(state, dict)
    expect(unsolved).toHaveLength(4)
    expect(unsolved.every(({ bc }) => bc.tier === 1)).toBe(true)
    // Baseline: with every board on tier 1 and every pattern in the book, it engages.
    expect(bookLookup(state, dict, book, unsolved)).not.toBeNull()

    // Same position, same in-book patterns, one board reported as widened. `bookLookup`
    // checks the tier *before* the pattern loop, so this is the guard that actually catches
    // a genuinely T2-widened board (the pattern guard, reached only afterwards, is the
    // redundant one: rowOf's keys are exactly the patterns T1 words produce, so a tier-1
    // board's pattern is always present). Supplying in-book patterns isolates it — the test
    // fails if the tier check is removed, even though the T2-widening test above still
    // passes via the pattern guard.
    const widened = unsolved.map(({ bc, b }, i) => ({ bc: i === 2 ? { ...bc, tier: 2 as const } : bc, b }))
    expect(bookLookup(state, dict, book, widened)).toBeNull()
  })
})

describe('move-0 assets', () => {
  // `dictHash` only pins the word list: a change to `answerWeight` or to `entropyOf` itself
  // would leave every committed .m0.bin silently stale, and only ru-4 is checked by value
  // above. Parse + sample every config in the manifest instead. Cheap: one dictionary parse
  // plus six `entropyOf` calls over T1 per config.
  const move0Configs = Object.entries(booksJson as Record<string, { m0: boolean; m1: boolean }>)
    .filter(([, flags]) => flags.m0)
    .map(([cfg]) => cfg)

  it('the manifest lists a move-0 book for every config', () => {
    expect(move0Configs).toEqual(Object.keys(booksJson))
  })

  for (const cfg of move0Configs) {
    it(`${cfg}: parses, and sampled values match a live entropyOf`, () => {
      // loadBook throws unless the asset parses, which also checks magic, version, language,
      // word length, dictHash, word count and t1Count for this config.
      const { dict, book } = loadBook(cfg)
      expect(book.move0.length).toBe(dict.words.length)
      expect(dict.t1Count).toBeLessThan(dict.words.length) // a T2 tier exists, so the boundary samples are real

      const t1 = dict.words.slice(0, dict.t1Count)
      const w = weightsFor(t1, dict)
      const rng = mulberry32(djb2(`${cfg}:m0`))
      // Ends, both sides of the T1/T2 boundary, and one seeded pick inside each tier.
      const sampled = [
        0,
        dict.t1Count - 1,
        dict.t1Count,
        dict.words.length - 1,
        Math.floor(rng() * dict.t1Count),
        dict.t1Count + Math.floor(rng() * (dict.words.length - dict.t1Count)),
      ]
      expect(new Set(sampled).size).toBeGreaterThanOrEqual(5) // the seeded picks may collide with an end
      for (const i of sampled) {
        // Exact, not toBeCloseTo: the builder wrote Float64 `entropyOf` output verbatim.
        expect(book.move0[i]).toBe(entropyOf(dict.words[i], t1, w))
      }
    })
  }
})

describe('move-1 assets', () => {
  // Openers the assets were built with (openers.json for ru/en 5x4, best move-0 entropy
  // otherwise). A silent opener change would make every book row wrong for that config.
  const OPENERS: Record<string, string> = {
    'ru-4': 'кора', 'ru-5': 'терка', 'ru-6': 'картон',
    'en-4': 'sate', 'en-5': 'tears', 'en-6': 'cartes',
  }

  // The config list comes from the manifest, not from OPENERS, so a future config that gains
  // a move-1 book is picked up automatically. OPENERS stays hardcoded as a tripwire: a config
  // the manifest lists but OPENERS doesn't know the opener for fails loudly instead of being
  // silently skipped.
  const move1Configs = Object.entries(booksJson as Record<string, { m0: boolean; m1: boolean }>)
    .filter(([, flags]) => flags.m1)
    .map(([cfg]) => cfg)

  for (const cfg of move1Configs) {
    it(`${cfg}: opener, row set and sampled values match a live rebuild`, () => {
      const opener = OPENERS[cfg]
      expect(opener).toBeDefined() // add the expected opener above before a new book can pass

      const { dict, book } = loadFullBook(cfg)
      const m1 = book.move1!
      expect(dict.words[m1.openerIdx]).toBe(opener)
      expect(m1.n).toBe(dict.words.length)

      const buckets = t1Buckets(dict, opener)
      expect([...m1.rowOf.keys()].sort((a, b) => a - b)).toEqual([...buckets.keys()].sort((a, b) => a - b))
      expect(m1.values.length).toBe(buckets.size * dict.words.length)

      // Spot-check stored entropies against a live recompute. Exact (not toBeCloseTo): the
      // builder wrote Float64 entropies into a Float32Array, which rounds exactly as
      // Math.fround does. This pins the row-major (pattern, dictionary index) layout that
      // `bookLookup` assumes, for every config.
      const patterns = [...m1.rowOf.keys()]
      const rng = mulberry32(djb2(cfg))
      for (let k = 0; k < 8; k++) {
        const p = patterns[Math.floor(rng() * patterns.length)]
        const g = Math.floor(rng() * m1.n)
        const cands = buckets.get(p)!
        const h = entropyOf(dict.words[g], cands, weightsFor(cands, dict))
        expect(m1.values[m1.rowOf.get(p)! * m1.n + g]).toBe(Math.fround(h))
      }
    })
  }
})
