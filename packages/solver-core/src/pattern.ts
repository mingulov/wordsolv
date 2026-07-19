/** Color pattern encoded base-3: digit i (3^i) is the color of position i. */
export type Pattern = number

export const GRAY = 0
export const YELLOW = 1
export const GREEN = 2

const CHARS = 'XYG'

export function scoreGuess(guess: string, answer: string): Pattern {
  const n = guess.length
  const codes = new Array<number>(n).fill(GRAY)
  const remaining = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    if (guess[i] === answer[i]) codes[i] = GREEN
    else remaining.set(answer[i], (remaining.get(answer[i]) ?? 0) + 1)
  }
  for (let i = 0; i < n; i++) {
    if (codes[i] === GREEN) continue
    const left = remaining.get(guess[i]) ?? 0
    if (left > 0) {
      codes[i] = YELLOW
      remaining.set(guess[i], left - 1)
    }
  }
  let p = 0
  for (let i = n - 1; i >= 0; i--) p = p * 3 + codes[i]
  return p
}

export function patternToString(p: Pattern, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += CHARS[p % 3]
    p = Math.floor(p / 3)
  }
  return out
}

export function stringToPattern(s: string): Pattern {
  let p = 0
  for (let i = s.length - 1; i >= 0; i--) p = p * 3 + CHARS.indexOf(s[i])
  return p
}

export function allGreen(length: number): Pattern {
  return 3 ** length - 1
}
