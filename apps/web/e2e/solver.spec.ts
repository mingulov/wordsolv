import { expect, test } from '@playwright/test'

test('happy path: RU 5×4 suggests the opener and updates after feedback', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('setup-new-game').click()
  // fresh game: opener suggestion arrives (deterministic: серна)
  await expect(page.getByTestId('suggestion-0')).toContainText('серна', { timeout: 30_000 })
  await page.getByTestId('suggestion-0').click()
  await page.getByTestId('guess-commit').click()
  // color all boards' row 0: board 0 gets a yellow on position 0
  await page.getByTestId('tile-0-0-0').click()
  // suggestions recompute (deep may take seconds)
  await expect(page.getByTestId('suggestion-0')).not.toContainText('серна', { timeout: 30_000 })
})

test('session persists across reload', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('setup-new-game').click()
  await expect(page.getByTestId('suggestion-0')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('suggestion-0').click()
  await page.getByTestId('guess-commit').click()
  await page.waitForTimeout(600) // autosave debounce
  await page.reload()
  const session = page.getByTestId('setup-sessions').locator('button').first()
  await expect(session).toContainText('1')
  await session.click()
  await expect(page.getByTestId('tile-0-0-0')).toBeVisible()
})

test('game-file export/import round-trip', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('setup-new-game').click()
  await expect(page.getByTestId('suggestion-0')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('suggestion-0').click()
  await page.getByTestId('guess-commit').click()
  await page.getByTestId('export-open').click()
  const text = await page.getByTestId('export-text').inputValue()
  expect(text).toContain('lang ru')
  await page.getByTestId('import-text').fill(text)
  await page.getByTestId('import-submit').click()
  await expect(page.getByTestId('tile-0-0-0')).toBeVisible()
})
