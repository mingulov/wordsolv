import type { JSX } from 'react'
import type { Dispatch } from 'react'
import type { BoardSummary, GameState, TileRepair } from '@wordsolv/solver-core'
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
  repairs: TileRepair[]
}

export function BoardCard({ state, board, dispatch, recheckRows, summary, contradiction, expanded, onToggle, repairs }: Props): JSX.Element {
  const { t } = useI18n()
  const sr = solveRowOf(state, board)
  const suspect = contradiction !== null && repairs.length > 0 ? repairs[0] : null

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
                      className={`tile ${COLOR[digit]}${derived ? ' derived' : ''}${
                        suspect && suspect.guessIndex === row && suspect.pos === pos ? ' suspect' : ''}`}
                      disabled={derived}
                      aria-label={`${ch} — ${t(TILE_KEY[digit])}`}
                      onClick={() => dispatch({ type: 'cycleTile', board, row, pos })}
                    >
                      {ch}
                      <span className="glyph">{GLYPH[digit]}</span>
                    </button>
                  )
                })}
                {!derived && row === state.guesses.length - 1 && (
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
          {contradiction !== null && (
            <p className="repair-hint" data-testid={`repair-hint-${board}`}>
              {repairs.length > 0
                ? `${t('game.noMatch')}: ${repairs.slice(0, 3).map((r) =>
                    `«${state.guesses[r.guessIndex]}» — ${state.guesses[r.guessIndex][r.pos]} (${r.pos + 1}): ${GLYPH[r.from]} → ${GLYPH[r.to]}`,
                  ).join('; ')}`
                : t('game.noMatchManual')}
            </p>
          )}
          {summary && summary.candidatesLeft > 0 && summary.candidatesLeft <= 20 && (
            <p className="candidates">{summary.candidates.join(', ')}</p>
          )}
        </div>
      )}
    </div>
  )
}
