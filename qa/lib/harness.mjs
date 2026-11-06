// The QA suite's tiny test harness (docs/QA_BLUEPRINT.md). A stage registers tests; each has an id, a Hebrew title, a category
// (static, unit, sql, security, e2e, regression, survival, recovery, a11y, perf) and a body that throws on failure.
// A failing test is retried once: passing the second time makes it "flaky" (reported, not hidden). Every test has a time limit.

export class AssertionError extends Error {}
/** Throw from a test whose environment lacks what it needs: it is reported as skipped, with the reason. */
export const skipTest = (reason) => { throw Object.assign(new Error(reason), { skip: true }) }
// Every check a test makes is written down with what was EXPECTED and what ACTUALLY happened (owner, 2026-11-06: "expected result,
// actual result, the whole QA works"). Tests run one at a time, so the checks of the running test are kept here; the report keeps the
// failing ones first, then a few of the passing ones (src/lib/qa/report.ts QaCheck).
let checks = null
const clip = (v, n) => { const s = typeof v === 'string' ? v : (() => { try { return JSON.stringify(v) } catch { return String(v) } })(); return (s ?? 'undefined').length > n ? `${(s ?? '').slice(0, n - 1)}…` : (s ?? 'undefined') }
const record = (what, expected, actual, ok) => { if (checks && checks.length < 200) checks.push({ what: clip(what || 'בדיקה', 160), expected: clip(expected, 160), actual: clip(actual, 200), ok }) }
export const takeChecks = () => { const c = checks ?? []; checks = null; return c }
export const startChecks = () => { checks = [] }

export const assert = {
  ok(cond, message = 'expected true') { record(message, 'כן', cond ? 'כן' : 'לא', !!cond); if (!cond) throw new AssertionError(message) },
  equal(actual, expected, message = '') { const ok = actual === expected; record(message || 'ערך', expected, actual, ok); if (!ok) throw new AssertionError(`${message} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`.trim()) },
  deepEqual(actual, expected, message = '') { const ok = JSON.stringify(actual) === JSON.stringify(expected); record(message || 'ערך', expected, actual, ok); if (!ok) throw new AssertionError(`${message} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`.trim()) },
  match(text, re, message = '') { const ok = re.test(String(text)); record(message || 'טקסט', `תואם ${re}`, String(text), ok); if (!ok) throw new AssertionError(`${message} ${re} did not match ${JSON.stringify(String(text).slice(0, 160))}`.trim()) },
  notMatch(text, re, message = '') { const ok = !re.test(String(text)); record(message || 'טקסט', `לא מכיל ${re}`, ok ? 'לא נמצא' : String(String(text).match(re)?.[0]), ok); if (!ok) throw new AssertionError(`${message} ${re} matched ${JSON.stringify(String(text).match(re)?.[0])}`.trim()) },
  status(response, expected, message = '') {
    const list = [].concat(expected)
    const ok = list.includes(response.status)
    record(message || 'תשובת השרת', `HTTP ${list.join(' או ')}`, `HTTP ${response.status}`, ok)
    if (!ok) throw new AssertionError(`${message} HTTP ${response.status}, expected ${list.join('/')}`.trim())
  },
}

/** What goes in the report: failures first (up to 10), then up to 4 passing checks; an error that was not a check is a failed check. */
function keepChecks(list, error) {
  const out = [...list]
  if (error && !(error instanceof AssertionError) && !error.skip) out.push({ what: 'הבדיקה רצה עד הסוף בלי שגיאה', expected: 'בלי שגיאה', actual: clip(String(error?.message ?? error).replace(/\s+/g, ' '), 200), ok: false })
  const bad = out.filter((c) => !c.ok).slice(0, 10)
  const good = out.filter((c) => c.ok).slice(0, bad.length ? 2 : 4)
  return [...bad, ...good]
}

export function createStage(id, title) {
  const tests = []
  return {
    id, title,
    test(testId, testTitle, category, fn, opts = {}) { tests.push({ id: `${id}.${testId}`, title: testTitle, category, fn, timeout: opts.timeout ?? 60_000, retry: opts.retry ?? true }) },
    skip(testId, testTitle, category, reason) { tests.push({ id: `${id}.${testId}`, title: testTitle, category, skip: reason }) },
    async run({ log = console.log } = {}) {
      const started = Date.now()
      const results = []
      // QA_TESTS=ui.reset,ui.notifications-long runs only those tests (while fixing one thing); a full run never sets it
      const only = (process.env.QA_TESTS ?? '').split(',').map((x) => x.trim()).filter(Boolean)
      for (const t of tests) {
        if (only.length && !only.includes(t.id)) continue
        if (t.skip) { results.push({ id: t.id, title: t.title, status: 'skip', category: t.category, durationMs: 0, detail: t.skip }); log(`  – ${t.title} (${t.skip})`); continue }
        const once = async () => {
          const t0 = Date.now()
          let timer
          startChecks()
          try {
            await Promise.race([t.fn(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${t.timeout} ms`)), t.timeout) })])
            return { ok: true, ms: Date.now() - t0, checks: keepChecks(takeChecks(), null) }
          } catch (err) {
            return { ok: false, skip: err?.skip === true, ms: Date.now() - t0, detail: String(err?.message ?? err).replace(/\s+/g, ' ').slice(0, 580), checks: keepChecks(takeChecks(), err) }
          } finally { clearTimeout(timer) }
        }
        let r = await once()
        let status = r.ok ? 'pass' : r.skip ? 'skip' : 'fail'
        if (status === 'fail' && t.retry) {
          const again = await once()
          if (again.ok) { status = 'flaky'; r = { ...again, detail: `failed once, passed on retry: ${r.detail}` } }
          else r = again
        }
        results.push({ id: t.id, title: t.title, status, category: t.category, durationMs: r.ms, ...(r.detail && status !== 'pass' ? { detail: r.detail } : {}), ...(r.checks?.length ? { checks: r.checks } : {}) })
        log(`  ${status === 'pass' ? '✓' : status === 'flaky' ? '~' : '✗'} ${t.title}${status !== 'pass' && r.detail ? ` — ${r.detail}` : ''}`)
      }
      const failed = results.some((r) => r.status === 'fail')
      const shaky = results.some((r) => r.status === 'flaky')
      return { id, title, status: failed ? 'fail' : shaky ? 'warn' : 'pass', durationMs: Date.now() - started, tests: results }
    },
  }
}
