import { useEffect, useState } from 'react'
import { normalizeWord, type Language } from '@wordlesolv/solver-core'
import { useI18n } from '../i18n'

const KEYS: Record<Language, string[]> = {
  en: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'],
  ru: ['йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю'],
}

interface Props {
  language: Language
  wordLength: number
  onCommit: (word: string) => void
  prefill: string
}

export function GuessInput({ language, wordLength, onCommit, prefill }: Props): JSX.Element {
  const { t } = useI18n()
  const [value, setValue] = useState('')
  const [warn, setWarn] = useState<string | null>(null)
  useEffect(() => setValue(prefill), [prefill])

  const commit = (): void => {
    const word = normalizeWord(language, value)
    if (word === null) {
      setWarn(t('game.invalidWord'))
      return
    }
    if (word.length !== wordLength) {
      setWarn(t('game.wrongLength').replace('{n}', String(wordLength)))
      return
    }
    setWarn(null)
    setValue('')
    onCommit(word)
  }

  return (
    <div className="guess-input">
      <div className="row">
        <input
          data-testid="guess-input"
          type="text"
          value={value}
          maxLength={wordLength}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
        />
        <button data-testid="guess-commit" onClick={commit}>
          {t('game.commit')}
        </button>
      </div>
      {warn && <p className="banner warn">{warn}</p>}
      <div className="keyboard">
        {KEYS[language].map((rowKeys) => (
          <div className="row" key={rowKeys}>
            {Array.from(rowKeys).map((k) => (
              <button
                key={k}
                data-testid={`kb-${k}`}
                onClick={() => setValue((v) => (v.length < wordLength ? v + k : v))}
              >
                {k}
              </button>
            ))}
            {rowKeys === KEYS[language][KEYS[language].length - 1] && (
              <button onClick={() => setValue((v) => v.slice(0, -1))}>⌫</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
