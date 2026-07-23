import { expect, test } from '@playwright/test'

test('semantic screen returns suggestions', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await page.getByRole('button', { name: /контексто|contexto|semantic/i }).click()
  await page.getByLabel(/слово|word/i).fill('снег')
  await page.getByLabel(/номер|ранг|rank/i).fill('206')
  await page.getByRole('button', { name: /добавить|add/i }).click()
  await expect(page.getByTestId('suggestions')).toContainText(/\p{Script=Cyrillic}+/u, { timeout: 150_000 })
})

test('semantic screen is dismissible back to setup', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /контексто|contexto|semantic/i }).click()
  await page.getByLabel(/слово|word/i).click() // screen reached: the word input is present
  await page.getByTestId('semantic-back').click()
  await expect(page.getByTestId('setup-new-game')).toBeVisible()
})
