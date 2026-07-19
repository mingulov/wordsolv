import { useState, type Dispatch } from 'react'
import type { GameState } from '@wordlesolv/solver-core'
import type { GameAction } from '../state/gameReducer'
import type { ResultReply } from '../worker/protocol'
import { BoardCard } from './BoardCard'

interface Props {
  state: GameState
  dispatch: Dispatch<GameAction>
  recheck: Record<number, number[]>
  reply: ResultReply | null
}

export function BoardsGrid({ state, dispatch, recheck, reply }: Props): JSX.Element {
  const compact = state.boardCount > 4
  const [expandedBoard, setExpandedBoard] = useState(0)
  return (
    <div className={`boards${compact ? ' compact' : ''}`}>
      {state.boards.map((_, b) => (
        <BoardCard
          key={b}
          state={state}
          board={b}
          dispatch={dispatch}
          recheckRows={recheck[b] ?? []}
          summary={reply?.result.boards[b] ?? null}
          contradiction={reply?.contradictions.find((c) => c.board === b)?.guessIndex ?? null}
          expanded={!compact || expandedBoard === b}
          onToggle={() => setExpandedBoard(b)}
          repairs={reply?.repairs.filter((r) => r.board === b) ?? []}
        />
      ))}
    </div>
  )
}
