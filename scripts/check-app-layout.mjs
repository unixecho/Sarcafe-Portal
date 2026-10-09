// Real React components rendered with synthetic data in a fresh test browser.
// This verifies layout, not production authentication or device installation.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, '.codex', 'verification', 'app-polish')
fs.mkdirSync(output, { recursive: true })
const modules = new Map()
const mocked = {
  'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
  'next/navigation': { usePathname: () => '/owner/dashboard' },
  '@/components/SignOutButton': { default: ({ className }) => React.createElement('button', { className }, 'יציאה') },
}
const load = (file, extra = {}) => {
  const absolute = path.isAbsolute(file) ? file : path.join(root, file)
  if (modules.has(absolute) && !Object.keys(extra).length) return modules.get(absolute)
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { fileName: absolute, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in extra) return extra[name]
    if (name in mocked) return mocked[name]
    if (name.endsWith('.css')) return {}
    if (name.startsWith('@/') || name.startsWith('.')) {
      const target = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(absolute), name)
      const resolved = [target + '.ts', target + '.tsx', path.join(target, 'index.ts')].find(fs.existsSync)
      if (resolved) return load(resolved)
    }
    return require(name)
  }, module, module.exports)
  if (!Object.keys(extra).length) modules.set(absolute, module.exports)
  return module.exports
}
const h = React.createElement
const Header = load('src/components/OwnerHeader.tsx').default
const Categories = load('src/components/app/DashboardSections.tsx').default
const Notifications = load('src/components/app/DashboardNotifications.tsx').default
const Record = load('src/components/staff/StaffRecordsView.tsx').default
const PayslipRecord = load('src/components/staff/StaffRecordsView.tsx', { react: { ...React, useState: (value) => React.useState(value === 'shifts' ? 'payslips' : value) } }).default
const Week = load('src/components/shifts/WeekGrid.tsx').default
const { CalendarDays, ClipboardCheck, ShoppingBag, Users, Receipt } = require('lucide-react')
const rawStyle = ['src/app/globals.css', 'src/components/app/app.css', 'src/components/staff/records.css', 'src/components/shifts/schedule.css'].map((file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/^@import[^\r\n]+;/gm, '')).join('\n')
const style = (await require('postcss')([require('tailwindcss'), require('autoprefixer')]).process(rawStyle, { from: path.join(root, 'src/app/globals.css') })).css
const categories = [
  { title: 'צוות ומשמרות', entries: [
    { href: '/owner/staff', icon: Users, label: 'העובדים שלי', description: 'קליטה, היסטוריה ותלושי שכר' },
    { href: '/owner/schedule', icon: CalendarDays, label: 'סידור עבודה', description: 'בקשות, שיבוצים ואישור החלפות' },
    { href: '/staff/checklists', icon: ClipboardCheck, label: 'צ׳קליסטים למשמרת', description: 'פתיחה, החלפה וסגירה', badge: '2 דיווחים דורשים טיפול' },
  ] },
  { title: 'במהלך השירות', entries: [
    { href: '/staff/pos', icon: ShoppingBag, label: 'הזמנות מהירות', description: 'קבלת הזמנות ומעקב בזמן אמת' },
    { href: '/pos', icon: Receipt, label: 'קופת אירועים ועמדות', description: 'הזמנות האירוע והעמדה שבה עובדים' },
  ] },
]
const notification = [{ id: 'notice', title: 'בקשת ההחלפה ממתינה לאישור מנהל', body: 'העובד השני אישר את ההחלפה. הסידור הקיים נשמר עד לאישור.', created_at: '2030-01-01T12:00:00Z', read_at: null }]
const record = { employee: { id: 'fixture', first_name: 'עובד', last_name: 'לדוגמה', employee_no: 17, active: true }, shifts: [{ id: 'a', date: '2030-01-06', start: '07:00', end: '14:00', label: 'בוקר', branch: 'סניף לדוגמה' }], checklists: [], orders: [], payslips: [{ id: 'fixture', pay_month: '2030-01-01', file_name: 'תלוש ינואר.pdf', uploaded_at: '2030-02-01T10:00:00Z' }], canReadPayslips: true }
const db = { settings: { roles: [{ id: 'barista', name: 'בריסטה', color: '#ff7a45' }], presets: [], stations: [], workingDays: [0,1,2,3,4,5,6], dayHours: {}, openTime: '07:00', closeTime: '19:00' }, roster: [{ staffId: 'fixture', displayName: 'עובד לדוגמה', active: true }], now: { date: '2030-01-06', time: '06:00' }, viewerStaffId: 'fixture', requests: [], swaps: [] }
const shifts = Array.from({ length: 7 }, (_, index) => ({ id: `s${index}`, date: `2030-01-${String(6 + index).padStart(2, '0')}`, startTime: '07:00', endTime: '14:00', requirements: [{ roleId: 'barista', count: 2 }] }))
const assignments = shifts.map((s) => ({ id: `a${s.id}`, shiftId: s.id, staffId: 'fixture', roleId: 'barista' }))
const shell = (title, content, wide = false) => h('div', { className: 'native-app' }, h('main', { className: 'app-page', style: wide ? { maxWidth: 1760 } : undefined }, h(Header, { title, backHref: '/staff' }), content))
const pages = {
  dashboard: shell('Sarcafe צוות', h(React.Fragment, null, h('div', { className: 'app-welcome' }, h('div', null, h('h2', null, 'שלום, צוות Sarcafe'), h('p', null, 'המשמרות, המשימות והצוות שלך.'))), h(Notifications, { initialNotifications: notification, initialUnread: 1 }), h(Categories, { categories, staff: true }))),
  employee: shell('תיק עובד', h(Record, { initial: record, owner: true })),
  payslips: shell('תיק עובד', h(PayslipRecord, { initial: record, owner: true })),
  schedule: shell('סידור עבודה', h('div', { className: 'sch-board-scroll', role: 'region', 'aria-label': 'לוח שבועי', tabIndex: 0 }, h(Week, { weekStart: '2030-01-06', db, shifts, assignments, mode: 'manager', onShiftClick: () => {} })), true),
  staffSchedule: shell('המשמרות שלי', h(Week, { weekStart: '2030-01-06', db, shifts, assignments, mode: 'staff', onShiftClick: () => {} })),
}
const browser = await chromium.launch({ headless: true, ...(process.env.TEST_BROWSER ? { executablePath: process.env.TEST_BROWSER } : {}) })
let checks = 0
try {
  for (const width of [320, 390, 768, 1760]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' })
    await context.route('https://fonts.googleapis.com/**', (route) => route.abort())
    const page = await context.newPage()
    for (const [name, component] of Object.entries(pages)) {
      await page.setContent(`<!doctype html><html lang="he" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style></head><body>${renderToStaticMarkup(component)}</body></html>`)
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()), '#150f0c', 'Actual brand tokens loaded'); checks++
      assert.ok(dimensions.scroll <= dimensions.client + 1, `${name} overflows at ${width}px`); checks++
      assert.equal(await page.locator('a[aria-label="מסך הבית"]').count(), 1, `${name} has an accessible Home link`); checks++
      for (const box of await page.locator('.app-header__icon, .sr-tabs button').evaluateAll((elements) => elements.map((e) => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })))) {
        assert.ok(box.width >= 44 && box.height >= 44, `${name} navigation target is too small`); checks++
      }
      if (name === 'schedule') {
        assert.equal(await page.locator('.sch-day').count(), 7, 'Manager sees the full seven-day week'); checks++
        const board = await page.locator('.sch-board-scroll').evaluate((e) => ({ width: e.clientWidth, scroll: e.scrollWidth, overflow: getComputedStyle(e).overflowX }))
        assert.equal(board.overflow, 'auto', 'Week overflow stays inside board'); checks++
        if (width === 1760) { assert.ok(board.scroll <= board.width + 1, 'All seven days fit at wide desktop'); checks++ }
      }
      if (width === 390 || width === 1760 && name === 'schedule') await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true })
    }
    await context.close()
  }
  console.log(`App layout checks: ${checks} passed. Synthetic-data previews: ${output}`)
} finally { await browser.close() }
