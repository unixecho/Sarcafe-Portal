// One browser readiness check, run as its own process by qa/lib/browser.mjs:  node browser-probe.mjs <browser executable> <mark>
// Starts the browser the way the suite will (Playwright, headless), renders a page whose title is the mark, reads the title back from
// the page and prints it. Exit 0 with the mark printed = the browser works. Anything else (an exception, a hang) is the caller's
// to judge: it bounds the time and ends this process with everything it started.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const [executablePath, mark] = process.argv.slice(2)
if (!executablePath || !mark) { console.error('usage: browser-probe.mjs <browser executable> <mark>'); process.exit(2) }
let browser
try {
  const { chromium } = require('playwright')
  browser = await chromium.launch({ headless: true, executablePath })
  const page = await browser.newPage()
  await page.setContent(`<title>${mark}</title><p>ready</p>`)
  const title = await page.evaluate(() => document.title)
  await browser.close()
  browser = null
  console.log(`rendered ${title}`)
  process.exit(title === mark ? 0 : 3)
} catch (err) {
  // the first line of the reason, without colour codes or Playwright's call log
  console.error(String(err?.message ?? err).replace(/\x1b\[[0-9;]*m/g, '').split(/\n|Call log:/)[0].trim().slice(0, 300))
  try { await browser?.close() } catch { /* already gone */ }
  process.exit(1)
}
