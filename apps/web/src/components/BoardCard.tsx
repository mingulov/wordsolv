import type { Dispatch } from 'react'
import type { BoardSummary, GameState } from '@wordlesolv/solver-core'
import { useI18n } from '../i18n'
import { isRowDerived, solveRowOf, type GameAction } from '../state/gameReducer'

const COLOR = ['gray', 'yellow', 'green'] as const
const GLYPH = ['−', '*', '+'] as const
const TILE_KEY = ['tile.gray', 'tile.yellow', 'tile.green'] as const

interface Props {
  state: GameState
  board: number
  dispatch: Dispatch<GameAction>
  recheckRows: number[]
  summary: BoardSummary | null
  contradiction: number | null
  expanded: boolean
  onToggle: () => void
}

export function BoardCard({ state, board, dispatch, recheckRows, summary, contradiction, expanded, onToggle }: Props): JSX.Element {
  const { t } = useI18n()
  const sr = solveRowOf(state, board)

  const chip = (): string => {
    if (contradiction !== null) return `⚠ ${t('game.contradiction')} ${contradiction + 1}`
    if (sr !== -1) return `✓ ${t('game.solved')} · ${t('game.guessN')} ${sr + 1}`
    if (recheckRows.length > 0) return `⚠ ${t('game.recheck')}`
    if (summary) {
      const widened = summary.tier === 2 ? ` · ${t('game.widened')}` : ''
      return `${summary.candidatesLeft} ${t('game.candidates')}${widened}`
    }
    return '…'
  }

  return (
    <div className={`board-card${expanded ? ' expanded' : ''}`} data-solved={sr !== -1}>
      <button className="chip" data-testid={`board-chip-${board}`} onClick={onToggle}>
        #{board + 1} · {chip()}
      </button>
      {expanded && (
        <div>
          {state.guesses.map((word, row) => {
            const derived = isRowDerived(state, board, row)
            const pattern = state.boards[board].feedback[row]
            const flagged = recheckRows.includes(row)
            const conflicted = contradiction === row
            return (
              <div className={`tile-row${flagged ? ' recheck' : ''}${conflicted ? ' conflict' : ''}`} key={row}>
                {Array.from(word).map((ch, pos) => {
                  const digit = Math.floor(pattern / 3 ** pos) % 3
                  return (
                    <button
                      key={pos}
                      data-testid={`tile-${board}-${row}-${pos}`}
                      className={`tile ${COLOR[digit]}${derived ? ' derived' : ''}`}
                      disabled={derived}
                      aria-label={`${ch} — ${t(TILE_KEY[digit])}`}
                      onClick={() => dispatch({ type: 'cycleTile', board, row, pos })}
                    >
                      {ch}
                      <span className="glyph">{GLYPH[digit]}</span>
                    </button>
                  )
                })}
                {!derived && (
                  <span className="row-tools">
                    <button onClick={() => dispatch({ type: 'setRowAllGray', board, row })}>{t('game.allGray')}</button>
                    {board !== 0 && (
                      <button onClick={() => dispatch({ type: 'copyRowFrom', board, row, srcBoard: 0 })}>
                        {t('game.copyFrom')}
                      </button>
                    )}
                  </span>
                )}
              </div>
            )
          })}
          {summary && summary.candidatesLeft > 0 && summary.candidatesLeft <= 20 && (
            <p className="candidates">{summary.candidates.join(', ')}</p>
          )}
        </div>
      )}
    </div>
  )
}
