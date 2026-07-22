import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bookLookup, dictHashOf, parseMove0, parseMove1, serializeMove0, serializeMove1,
  type OpeningBook,
} from './book'
import { makeDictionary, parseDictAsset, type Dictionary } from './dictionary'
import { boardCandidatesOf, scoreAllWords, type BoardCandidates } from './entropy'
import { scoreGuess } from './pattern'
import { rateGuessRow, rateGuesses } from './rate'
import { suggest } from './solver'
import { defaultOptions, newGame, type GameState } from './types'

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
