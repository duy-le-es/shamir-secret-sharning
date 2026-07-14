// UI end-to-end: drives the real app in headless Chrome via playwright-core.
// Requires the dev server running first: npm run dev
// Run: npm run test:ui
// Screenshots are saved to test-results/.
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = new URL('../test-results', import.meta.url).pathname

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
    args: ['--no-sandbox'],
  })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } })
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))

  console.log('[1] Default page is Members (dashboard removed)')
  await page.goto(BASE)
  await page.getByText('Members & Key Status').waitFor({ timeout: 20000 })
  await page.locator('strong', { hasText: 'Demo User' }).waitFor()
  await page.screenshot({ path: `${OUT}/01-members.png`, fullPage: true })

  console.log('[2] Owner sees Recovery Policy and can edit')
  await page.click('nav >> text=Recovery Policy')
  await page.getByText('Recovery Quorum').waitFor()
  await page.getByText('Add a recovery party').waitFor()
  await page.screenshot({ path: `${OUT}/02-policy-owner.png`, fullPage: true })

  console.log('[3] Recovery party sees Recovery Policy read-only')
  await page.selectOption('.role-switcher select', 'dave')
  await page.getByText('Recovery Quorum').waitFor()
  if (await page.getByText('Add a recovery party').count()) {
    throw new Error('Recovery party should not see the edit controls')
  }
  await page.screenshot({ path: `${OUT}/03-policy-readonly.png`, fullPage: true })

  console.log('[4] Selecting the demo user shows the login page')
  await page.selectOption('.role-switcher select', 'demo')
  await page.getByText('Sign in to Tracelium').waitFor()
  await page.screenshot({ path: `${OUT}/04-demo-login.png`, fullPage: true })
  await page.fill('input[type=password]', 'demo-password')
  await page.getByRole('button', { name: 'Sign in' }).click()

  console.log('[5] After login the mandatory create-recovery modal appears')
  await page.getByText('Recovery code required').waitFor({ timeout: 10000 })
  await page.screenshot({ path: `${OUT}/05-forced-modal.png` })
  await page.getByRole('button', { name: 'Create Recovery Code' }).click()
  await page.getByText('Creating recovery code…').waitFor()
  await page.getByText('Setup complete').waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: 'Continue to workspace' }).click()
  await page.screenshot({ path: `${OUT}/06-wizard-done.png` })

  console.log('[6] Demo user loses access → account recovery request')
  await page.click('nav >> text=Account Recovery')
  await page.getByRole('button', { name: "I've lost access to my account" }).click()
  await page.getByRole('button', { name: 'Submit Account Recovery Request' }).click()
  await page.getByText('Approval progress').waitFor()
  await page.screenshot({ path: `${OUT}/07-request-created.png`, fullPage: true })

  console.log('[7] Dave approves → 1 of 2, secret still locked')
  await page.selectOption('.role-switcher select', 'dave')
  await page.getByText('Verify with Passkey').click()
  await page.getByText('Approve and Release Recovery Share').click()
  await page.getByText('Quorum: 1 of 2').waitFor()
  await page.screenshot({ path: `${OUT}/08-quorum-1of2.png`, fullPage: true })

  console.log('[8] Carol approves → quorum reached → recovery session')
  await page.selectOption('.role-switcher select', 'carol')
  await page.getByText('Verify with Passkey').click()
  await page.getByText('Approve and Release Recovery Share').click()
  await page.getByText('Begin Recovery Session').waitFor()
  await page.getByText('Begin Recovery Session').click()
  await page.getByText('Temporary secret lifetime').waitFor({ timeout: 10000 })
  await page.screenshot({ path: `${OUT}/09-secret-countdown.png`, fullPage: true })
  await page.getByText('Temporary recovery material cleared').first().waitFor({ timeout: 20000 })
  await page.screenshot({ path: `${OUT}/10-breakglass-complete.png`, fullPage: true })

  console.log('[9] Audit log has the full trail')
  await page.click('nav >> text=Audit Log')
  await page.locator('td', { hasText: 'Account recovery requested' }).first().waitFor()
  await page.locator('td', { hasText: 'Account access lost reported' }).first().waitFor()
  await page.locator('td', { hasText: 'Recovery session completed' }).first().waitFor()
  await page.screenshot({ path: `${OUT}/11-audit.png`, fullPage: true })

  console.log('[10] Always-visible Crypto Trace proves the mechanism')
  await page.getByText('Reconstructed secret matches setup commitment').waitFor()
  await page.getByText('Temporary reconstructed secret cleared').waitFor()
  await page.screenshot({ path: `${OUT}/12-crypto-trace.png` })

  await browser.close()
  if (errors.length) {
    console.error('CONSOLE ERRORS:\n' + errors.join('\n'))
    process.exit(1)
  }
  console.log(`\nUI FLOW PASSED — no console errors. Screenshots in ${OUT}/`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
