import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { App } from './App'

it('renders the app shell with setup screen', () => {
  render(<App />)
  expect(screen.getByTestId('setup-new-game')).toBeTruthy()
})
