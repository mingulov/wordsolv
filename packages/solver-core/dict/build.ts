/** Compiles dict/raw/* into dict/assets/<lang>-<len>.txt. Run: npx tsx dict/build.ts */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeDictionary, normalizeWord, serializeDict } from '../src/dictionary'
import type { Language } from '../src/types'

const HERE = import.meta.dirname
/**
 * T1 (answer-priority) cap. EN: enable1 is huge and real games draw answers
 * from common words — cap at 3500 (the curated-answers bet). RU: the base
 * list is nouns-only (≈7k at the largest length) and the full-corpus ranks
 * carry the prior, so every ranked noun gets answer priority.
 */
const T1_CAP: Record<Language, number> = { en: 3500, ru: Number.POSITIVE_INFINITY }
const RANK_SOURCE: Record<Language, string> = { en: 'en_50k.txt', ru: 'ru_full.txt' }
const LENGTHS = [4, 5, 6, 7, 8]

function readLines(name: string): string[] {
  return readFileSync(join(HERE, 'raw', name), 'utf8').split('\n')
}

/** FrequencyWords format: "word count" per line, frequency-descending. */
function freqRanks(lang: Language, file: string): Map<string, number> {
  const ranks = new Map<string, number>()
  for (const line of readLines(file)) {
    const word = line.split(' ')[0]
    const norm = word ? normalizeWord(lang, word) : null
    if (norm && !ranks.has(norm)) ranks.set(norm, ranks.size)
  }
  return ranks
}

function baseWords(lang: Language, file: string): Set<string> {
  const out = new Set<string>()
  for (const line of readLines(file)) {
    const norm = normalizeWord(lang, line)
    if (norm) out.add(norm)
  }
  return out
}

function build(lang: Language, base: Set<string>, ranks: Map<string, number>): void {
  for (const len of LENGTHS) {
    const all = [...base].filter((w) => w.length === len)
    const ranked = all
      .filter((w) => ranks.has(w))
      .sort((a, b) => ranks.get(a)! - ranks.get(b)!)
    const t1 = ranked.slice(0, T1_CAP[lang])
    const t1Set = new Set(t1)
    const t2 = all.filter((w) => !t1Set.has(w)).sort()
    if (lang === 'ru' && len === 5)
      for (const w of ['качка', 'кадка'])
        if (!t1Set.has(w)) throw new Error(`ru-5 calibration check failed: "${w}" must be in T1`)
    const dict = makeDictionary(lang, len, t1, t2)
    const out = join(HERE, 'assets', `${lang}-${len}.txt`)
    writeFileSync(out, serializeDict(dict))
    console.log(`${lang}-${len}: t1=${t1.length} total=${dict.words.length}`)
    if (t1.length < 300 || dict.words.length < 1000)
      throw new Error(`${lang}-${len}: suspiciously small dictionary — check raw inputs`)
  }
}

mkdirSync(join(HERE, 'assets'), { recursive: true })
build('en', baseWords('en', 'enable1.txt'), freqRanks('en', RANK_SOURCE.en))
build('ru', baseWords('ru', 'russian_nouns.txt'), freqRanks('ru', RANK_SOURCE.ru))
