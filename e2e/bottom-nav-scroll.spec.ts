import { test, expect } from '@playwright/test'

const ONBOARDING_STORAGE_KEY = 'ai-gym-trainer:v0.1:onboarding-completed'

// Issue #454: проверяем, что CSS-фикс реально применён и что содержащий блок .nav
// не сломан. Chromium, а не iOS WebKit: сам rubber-band баг не воспроизводится,
// но заявленные свойства и фиксация .nav проверяются.
test.use({ viewport: { width: 393, height: 852 } })

test('нижняя навигация закреплена у нижней кромки вьюпорта', async ({ page }) => {
  await page.addInitScript((key) => window.localStorage.setItem(key, '1'), ONBOARDING_STORAGE_KEY)
  await page.goto('/')
  await expect(page.getByTestId('home-screen')).toBeVisible()

  const nav = page.getByRole('navigation', { name: 'Основная навигация' })
  // 3-й пункт навигации — экран «Прогресс»; адресуемся по позиции, не по подписи.
  await nav.getByRole('button').nth(2).click()
  await expect(page.locator('.progress-screen')).toBeVisible()

  // Фикс #454: композитный слой для fixed-планки в WebKit.
  expect(await nav.evaluate((el) => getComputedStyle(el).willChange)).toBe('transform')
  // Фикс #454: гасим резиновый отскок документа.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY)).toBe('none')

  // Мок короткий: раскрываем свёрнутые секции, чтобы документ реально прокрутился.
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => ((d as HTMLDetailsElement).open = true)))

  const height = page.viewportSize()?.height as number
  const navBottomGap = async () => {
    const box = await nav.boundingBox()
    if (!box) throw new Error('bottom nav has no bounding box')
    return height - (box.y + box.height)
  }
  const before = await navBottomGap()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  expect(Math.abs((await navBottomGap()) - before)).toBeLessThanOrEqual(1)
})
