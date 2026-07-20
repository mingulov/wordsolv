import type { GameState, GuessRating, SolveResult, TileRepair } from '@wordsolv/solver-core'

export type SolveMode = 'auto' | 'deep' | 'lite'

export interface SuggestRequest {
  id: number
  type: 'suggest'
  state: GameState
  mode: SolveMode
  dictUrl: string
}

export interface ProgressReply {
  id: number
  type: 'progress'
  message: 'loading-dictionary' | 'building-table' | 'rating-guesses'
}

export interface ResultReply {
  id: number
  type: 'result'
  result: SolveResult
  effectiveMode: 'deep' | 'lite'
  contradictions: { board: number; guessIndex: number }[]
  unknownGuesses: string[]
  ratings: GuessRating[]
  repairs: TileRepair[]
}

export interface ErrorReply {
  id: number
  type: 'error'
  message: string
}

export type WorkerReply = ProgressReply | ResultReply | ErrorReply
