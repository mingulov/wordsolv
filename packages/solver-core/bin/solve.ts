/**
 * File-based solver assistant.
 *   npm run solve -- game.txt                  solve once and print
 *   npm run solve -- game.txt --init ru-5x4    write a fresh template
 *   npm run solve -- game.txt --watch          re-solve on every save
 */
import { existsSync, readFileSync, watchFile, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dictHashOf, parseMove0, type OpeningBook } from '../src/book'
import { parseDictAsset, type Dictionary } from '../src/dictionary'
import { findContradictions, gameFileTemplate, hasGuessLines, parseGameFile, unknownWords } from '../src/gamefile'
import { allGreen } from '../src/pattern'
import { buildPatternTable, type PatternTable } from '../src/patternTable'
import { suggest } from '../src/solver'
import { defaultOptions, type Language } from '../src/types'
import { rateGuesses } from '../src/rate'
import { suggestRepairs } from '../src/repair'

const NO_COLOR = 'NO_COLOR' in process.env
const args = process.argv.slice(2)
const watch = args.includes('--watch')
const initAt = args.indexOf('--init')
const initCfg = initAt === -1 ? null : args[initAt + 1]
const file = args.find((a, i) => !a.startsWith('--') && (initAt === -1 || i !== initAt + 1))

if (!file) {
  console.error('usage: solve <game-file> [--init <lang>-<len>x<boards>] [--watch]')
  process.exit(1)
}

const C = {
  green: (s: string) => (NO_COLOR ? s : `\x1b[42;30m${s}\x1b[0m`),
  yellow: (s: string) => (NO_COLOR ? s : `\x1b[43;30m${s}\x1b[0m`),
  gray: (s: string) => (NO_COLOR ? s : `\x1b[100;37m${s}\x1b[0m`),
  bold: (s: string) => (NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`),
}
const SYM = ['-', '*', '+'] // gray, yellow, green — the file format's own symbols

if (initCfg !== null) {
  if (initCfg === undefined) {
    console.error('--init: missing config (expected like ru-5x4)')
    process.exit(1)
  }
  const m = /^(en|ru)-(\d)x(\d{1,2})$/.exec(initCfg)
  if (!m) {
    console.error(`--init: bad config "${initCfg}" (expected like ru-5x4)`)
    process.exit(1)
  }
  const lang = m[1] as Language
  const len = Number(m[2])
  const boards = Number(m[3])
  if (len < 4 || len > 8 || boards < 1 || boards > 16) {
    console.error('--init: len must be 4..8 and boards 1..16')
    process.exit(1)
  }
  if (existsSync(file)) {
    let hasGuesses: boolean
    try {
      hasGuesses = hasGuessLines(readFileSync(file, 'utf8'))
    } catch {
      console.error(`--init: ${file} unreadable — refusing to overwrite`)
      process.exit(1)
    }
    if (hasGuesses) {
      console.error(`--init: ${file} already contains guesses — refusing to overwrite`)
      process.exit(1)
    }
  }
  writeFileSync(file, gameFileTemplate(lang, len, boards))
  console.log(`wrote template to ${file}`)
  if (!watch) process.exit(0)
}

const dictCache = new Map<string, Dictionary>()
const tableCache = new Map<string, PatternTable | null>()
const bookCache = new Map<string, OpeningBook | null>()

function loadDict(lang: Language, len: number): Dictionary {
  const key = `${lang}-${len}`
  let d = dictCache.get(key)
  if (!d) {
    d = parseDictAsset(readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', `${key}.txt`), 'utf8'))
    dictCache.set(key, d)
  }
  return d
}

/** Reads `<key>.m0.bin` next to the dictionary. Missing or stale files degrade to live scoring. */
function loadBook(key: string, dict: Dictionary): OpeningBook | null {
  if (bookCache.has(key)) return bookCache.get(key) ?? null
  let book: OpeningBook | null = null
  try {
    const raw = readFileSync(join(import.meta.dirname, '..', 'dict', 'assets', `${key}.m0.bin`))
    const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
    const move0 = parseMove0(buf, dict)
    if (move0) book = { dictHash: dictHashOf(dict), move0, move1: null }
  } catch {
    book = null
  }
  bookCache.set(key, book)
  return book
}

/** The guess word colored per one board's pattern (plus plain symbols under NO_COLOR). */
function renderCell(word: string, pattern: number): string {
  let p = pattern
  let colored = ''
  let syms = ''
  for (let i = 0; i < word.length; i++) {
    const code = p % 3
    p = Math.floor(p / 3)
    syms += SYM[code]
    colored += code === 2 ? C.green(word[i]) : code === 1 ? C.yellow(word[i]) : C.gray(word[i])
  }
  return NO_COLOR ? `${word}(${syms})` : colored
}

function run(): void {
  const { state, mode, guessLines, warnings } = parseGameFile(readFileSync(file!, 'utf8'))
  const dict = loadDict(state.language, state.wordLength)
  const key = `${state.language}-${state.wordLength}`
  let opts = defaultOptions(mode)
  let table: PatternTable | null = null
  if (mode === 'deep') {
    if (!tableCache.has(key)) {
      console.log('building pattern table (a few seconds, once per language/length)…')
      tableCache.set(key, buildPatternTable(dict))
    }
    table = tableCache.get(key) ?? null
    if (table === null) {
      console.log('pattern table over memory budget — using lite mode')
      opts = defaultOptions('lite')
    }
  }
  const book = loadBook(key, dict)
  const result = suggest(state, dict, opts, table, book)

  for (let g = 0; g < state.guesses.length; g++) {
    const cells = state.boards.map((b) => renderCell(state.guesses[g], b.feedback[g]))
    console.log(`  ${String(g + 1).padStart(2)}. ${cells.join('   ')}`)
  }
  const left = state.maxGuesses - state.guesses.length
  console.log(`\nguesses: ${state.guesses.length} of ${state.maxGuesses} used`)
  for (const w of warnings) console.log(`warning: ${w}`)
  for (const w of unknownWords(state, dict))
    console.log(`warning: "${w}" is not in the ${state.language}-${state.wordLength} dictionary`)

  const contradictions = findContradictions(state, dict)
  const repairs = contradictions.length > 0 ? suggestRepairs(state, dict) : []
  result.boards.forEach((b, i) => {
    if (b.solvedWord !== null) {
      const guessNum = state.boards[i].feedback.indexOf(allGreen(state.wordLength)) + 1
      console.log(`board ${i + 1}: solved ✓ ${b.solvedWord} (guess ${guessNum})`)
      if (!dict.index.has(b.solvedWord))
        console.log(`warning: board ${i + 1} solved by "${b.solvedWord}" which is not in the dictionary — double-check that row`)
    } else if (b.candidatesLeft === 0) {
      const c = contradictions.find((x) => x.board === i)
      const at = c ? ` — first conflict at guess ${c.guessIndex + 1} ("${state.guesses[c.guessIndex]}", line ${guessLines[c.guessIndex]})` : ''
      console.log(C.bold(`board ${i + 1}: CONTRADICTION, no word matches${at} — check that row's colors`))
      for (const r of repairs.filter((x) => x.board === i).slice(0, 3))
        console.log(
          `  fix? guess ${r.guessIndex + 1} "${state.guesses[r.guessIndex]}" letter ${r.pos + 1}` +
          ` ('${state.guesses[r.guessIndex][r.pos]}'): ${SYM[r.from]} → ${SYM[r.to]}  (${r.candidatesAfter} candidate(s))`,
        )
    } else {
      const tier = b.tier === 2 ? ' (widened to broad dictionary)' : ''
      const list = b.candidatesLeft <= 20 ? `: ${b.candidates.join(', ')}` : ''
      console.log(`board ${i + 1}: ${b.candidatesLeft} candidate(s)${tier}${list}`)
    }
  })

  const ratings = rateGuesses(state, dict, opts, table, book)
  if (ratings.length > 0) {
    console.log(`\n${C.bold('your guesses')}:`)
    ratings.forEach((r, i) => {
      const best = r.bestIsOpener ? `opener: ${r.bestWord}` : `best: ${r.bestWord} ${r.bestScore!.toFixed(1)}`
      console.log(
        `  ${String(i + 1).padStart(2)}. ${r.word}  ${r.score.toFixed(1)}  (${best})` +
        `  candidates ${r.candidatesBefore} → ${r.candidatesAfter}`,
      )
    })
  }

  const unsolved = result.boards.filter((b) => b.solvedWord === null).length
  if (unsolved === 0) {
    console.log(C.bold(`\nsolved all ${state.boardCount} board(s) in ${state.guesses.length} guesses 🎉`))
    return
  }
  if (left <= 0) {
    console.log(C.bold(`\ngame over — out of guesses with ${unsolved} unsolved board(s)`))
    result.boards.forEach((b, i) => {
      if (b.solvedWord !== null) return
      const shown = b.candidates.slice(0, 50)
      const more = b.candidates.length > shown.length ? ` … and ${b.candidates.length - shown.length} more` : ''
      console.log(`board ${i + 1}: ${shown.join(', ')}${more}`)
    })
    return
  }
  if (left === 1) console.log(C.bold('⚠ LAST GUESS — prefer a word that can win a board'))
  console.log(`\n${C.bold('best next guesses')} (mode: ${opts.mode}):`)
  result.suggestions.forEach((s, i) => {
    const badge = s.isCandidateFor.length
      ? `  answer? ${s.isCandidateFor.length > 1 ? 'boards' : 'board'} ${s.isCandidateFor.map((x) => x + 1).join(',')}`
      : ''
    const scoreTxt = s.source === 'opener' ? s.source : `${s.score.toFixed(2)} (${s.source})`
    console.log(`  ${String(i + 1).padStart(2)}. ${s.word}  ${scoreTxt}${badge}`)
  })
}

function runSafe(): void {
  try {
    run()
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    let msg = err instanceof Error ? err.message : String(e)
    if (err.code === 'ENOENT') msg += ' — create it first, e.g.: npm run solve -- <file> --init ru-5x4'
    console.error(`error: ${msg}`)
    if (!watch) process.exitCode = 1
  }
}

if (watch) {
  runSafe()
  console.log(`\nwatching ${file} — edit & save to re-solve (Ctrl-C to stop)`)
  watchFile(file, { interval: 1000 }, () => {
    if (!NO_COLOR) process.stdout.write('\x1b[2J\x1b[H')
    runSafe()
    console.log(`\nwatching ${file} — edit & save to re-solve (Ctrl-C to stop)`)
  })
} else {
  runSafe()
}
