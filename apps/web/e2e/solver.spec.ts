import { expect, test } from '@playwright/test'

test('happy path: RU 5×4 suggests the opener and updates after feedback', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('setup-new-game').click()
  // fresh game: opener suggestion arrives (deterministic: терка)
  await expect(page.getByTestId('suggestion-0')).toContainText('терка', { timeout: 30_000 })
  await page.getByTestId('suggestion-0').click()
  await page.getByTestId('guess-commit').click()
  // color all boards' row 0: board 0 gets a yellow on position 0
  await page.getByTestId('tile-0-0-0').click()
  // suggestions recompute (deep may take seconds)
  await expect(page.getByTestId('suggestion-0')).not.toContainText('терка', { timeout: 30_000 })
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

test('keyboard: uniform key widths, no wrapping at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByTestId('setup-new-game').click()
  const rows = page.locator('.kb-row')
  await expect(rows).toHaveCount(3)
  for (let r = 0; r < 3; r++) {
    const boxes = await rows.nth(r).locator('button').evaluateAll((els) =>
      els.map((el) => {
        const b = el.getBoundingClientRect()
        return { w: b.width, y: b.top, wide: el.classList.contains('kb-wide') }
      }),
    )
    expect(new Set(boxes.map((b) => Math.round(b.y))).size).toBe(1) // one line — no wrapping
    const widths = boxes.filter((b) => !b.wide).map((b) => b.w)
    for (const w of widths) expect(Math.abs(w - widths[0])).toBeLessThanOrEqual(1)
  }
})

test('contradiction: repair hint points at the mis-entered tile', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Boards').selectOption('1')
  await page.getByTestId('setup-new-game').click()
  await page.getByTestId('export-open').click()
  await page.getByTestId('import-text').fill(
    'lang ru\nlen 5\nboards 1\n\nокеан -+-*-\nфакир -+*--\nказус ++---\nкалым ++---\nкаппа ++--+\n',
  )
  await page.getByTestId('import-submit').click()
  await expect(page.getByTestId('board-chip-0')).toContainText('contradiction', { timeout: 30_000 })
  await expect(page.locator('.tile.suspect')).toHaveCount(1)
  await expect(page.getByTestId('repair-hint-0')).toContainText('океан')
  await expect(page.getByTestId('quality')).toContainText('океан') // ratings render up to the break
})
