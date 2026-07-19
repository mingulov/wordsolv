import { scoreGuess, type Pattern } from './pattern'

/** True iff `word` (as hypothetical answer) reproduces every observed feedback. */
export function matchesAll(word: string, guesses: string[], feedback: Pattern[]): boolean {
  for (let i = 0; i < guesses.length; i++) {
    if (scoreGuess(guesses[i], word) !== feedback[i]) return false
  }
  return true
}

export function filterCandidates(words: readonly string[], guesses: string[], feedback: Pattern[]): string[] {
  const out: string[] = []
  for (const w of words) if (matchesAll(w, guesses, feedback)) out.push(w)
  return out
}
