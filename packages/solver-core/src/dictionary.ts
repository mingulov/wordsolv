import { filterCandidates } from './filter'
import type { Pattern } from './pattern'
import type { Language } from './types'

export interface Dictionary {
  language: Language
  wordLength: number
  /** T1 words in frequency order, then T2 extras (alphabetical). */
  words: string[]
  t1Count: number
  index: Map<string, number>
}

const ALPHABET: Record<Language, RegExp> = {
  en: /^[a-z]+$/,
  ru: /^[а-я]+$/, // post ё→е normalization
}

export function normalizeWord(language: Language, raw: string): string | null {
  let w = raw.trim().toLowerCase()
  if (language === 'ru') w = w.replaceAll('ё', 'е')
  return ALPHABET[language].test(w) ? w : null
}

export function makeDictionary(language: Language, wordLength: number, t1: string[], t2Extra: string[]): Dictionary {
  const words = [...t1, ...t2Extra]
  const index = new Map<string, number>()
  words.forEach((w, i) => index.set(w, i))
  return { language, wordLength, words, t1Count: t1.length, index }
}

export function serializeDict(d: Dictionary): string {
  return `#wordsolv-dict v1 ${d.language} ${d.wordLength} ${d.t1Count}\n${d.words.join('\n')}\n`
}

export function parseDictAsset(text: string): Dictionary {
  const lines = text.split('\n').filter((l) => l.length > 0)
  const m = /^#wordsolv-dict v1 (en|ru) (\d+) (\d+)$/.exec(lines[0] ?? '')
  if (!m) throw new Error('dictionary asset: bad header')
  const [, lang, len, t1] = m
  const words = lines.slice(1)
  const t1Count = Number(t1)
  return makeDictionary(lang as Language, Number(len), words.slice(0, t1Count), words.slice(t1Count))
}

export const WEIGHT_SHIFT = 10
export const T2_FACTOR = 0.05

/** Frequency prior for a word by its dictionary index (T1 rank or T2). */
export function answerWeight(index: number, t1Count: number): number {
  if (index < t1Count) return 1 / Math.sqrt(index + WEIGHT_SHIFT)
  return T2_FACTOR / Math.sqrt(t1Count + WEIGHT_SHIFT)
}

/** Candidates for one board: T1 first, transparent widening to T2 when T1 empties. */
export function boardView(
  dict: Dictionary,
  guesses: string[],
  feedback: Pattern[],
): { candidates: string[]; tier: 1 | 2 } {
  const t1 = filterCandidates(dict.words.slice(0, dict.t1Count), guesses, feedback)
  if (t1.length > 0) return { candidates: t1, tier: 1 }
  return { candidates: filterCandidates(dict.words, guesses, feedback), tier: 2 }
}
