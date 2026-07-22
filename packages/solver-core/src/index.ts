export const VERSION = '0.1.0'
export { GRAY, YELLOW, GREEN, allGreen, patternToString, scoreGuess, stringToPattern, type Pattern } from './pattern'
export { filterCandidates, matchesAll } from './filter'
export {
  answerWeight, boardView, makeDictionary, normalizeWord, parseDictAsset, serializeDict,
  type Dictionary,
} from './dictionary'
export {
  defaultMaxGuesses, defaultOptions, newGame, parseGameState, serializeGameState, solvedWordOf,
  type BoardState, type BoardSummary, type GameState, type Language, type SolveResult,
  type SolverOptions, type Suggestion,
} from './types'
export {
  SOLVE_BONUS, URGENCY_WEIGHT, boardCandidatesOf, entropyOf, entropyOfIdx, scoreAllWords, scoreWordAgainst, suggestEntropy, weightsFor,
  type BoardCandidates, type ScoredWord,
} from './entropy'
export { rateGuessRow, rateGuesses, type GuessRating } from './rate'
export { suggestRepairs, type TileRepair } from './repair'
export { endgameSearch, type EndgameResult } from './endgame'
export { buildPatternTable, DEFAULT_TABLE_BYTES, type PatternTable } from './patternTable'
export {
  BOOK_VERSION, MOVE1_MAX_LEN, dictHashOf, parseMove0, parseMove1, serializeMove0, serializeMove1,
  type Move1Book, type OpeningBook,
} from './book'
export { mulberry32, pickDistinct } from './random'
export { djb2 } from './random'
export { playGame, simulateGames, type SimResult, type Suggester } from './simulate'
export { openerKey, suggest } from './solver'
export {
  findContradictions, gameFileTemplate, hasGuessLines, parseGameFile, serializeGameFile, unknownWords, type ParsedGameFile,
} from './gamefile'
