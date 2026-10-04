import { test, expect } from '@playwright/test'

const ONBOARDING_STORAGE_KEY = 'ai-gym-trainer:v0.1:onboarding-completed'

test('открыть → тренировка → подход → сохранить → видно в истории', async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, '1')
  }, ONBOARDING_STORAGE_KEY)

  await page.goto('/')
  await expect(page.getByTestId('home-screen')).toBeVisible()

  await expect(page.getByTestId('history-section')).toHaveCount(0)

  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await page.getByRole('button', { name: 'Начать тренировку' }).click()

  await page
    .getByRole('group', { name: 'Сколько ещё сделаешь?' })
    .getByRole('button')
    .first()
    .click()
  await page.getByRole('button', { name: /^Подход \d+ выполнен$/ }).click()
  await page.getByRole('button', { name: 'Завершить всю тренировку' }).click()
  await page.getByRole('button', { name: 'Сохранить и на главную' }).click()

  await expect(page.getByTestId('home-screen')).toBeVisible()
  await expect(page.getByTestId('history-section')).toBeVisible()
  await expect(page.getByTestId('history-entry')).toHaveCount(1)
})
