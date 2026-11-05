// The QA suite's tiny test harness (docs/QA_BLUEPRINT.md). A stage registers tests; each has an id, a Hebrew title, a category
// (static, unit, sql, security, e2e, regression, survival, recovery, a11y, perf) and a body that throws on failure.
// A failing test is retried once: passing the second time makes it "flaky" (reported, not hidden). Every test has a time limit.

export class AssertionError extends Error {}
/** Throw from a test whose environment lacks what it needs: it is reported as skipped, with the reason. */
export const skipTest = (reason) => { throw Object.assign(new Error(reason), { skip: true }) }
export const assert = {
  ok(cond, message = 'expected true') { if (!cond) throw new AssertionError(message) },
  equal(actual, expected, message = '') { if (actual !== expected) throw new AssertionError(`${message} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`.trim()) },
  deepEqual(actual, expected, message = '') { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new AssertionError(`${message} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`.trim()) },
  match(text, re, message = '') { if (!re.test(String(text))) throw new AssertionError(`${message} ${re} did not match ${JSON.stringify(String(text).slice(0, 160))}`.trim()) },
  notMatch(text, re, message = '') { if (re.test(String(text))) throw new AssertionError(`${message} ${re} matched ${JSON.stringify(String(text).match(re)?.[0])}`.trim()) },
  status(response, expected, message = '') {
    const list = [].concat(expected)
    if (!list.includes(response.status)) throw new AssertionError(`${message} HTTP ${response.status}, expected ${list.join('/')}`.trim())
  },
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
          try {
            await Promise.race([t.fn(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${t.timeout} ms`)), t.timeout) })])
            return { ok: true, ms: Date.now() - t0 }
          } catch (err) {
            return { ok: false, skip: err?.skip === true, ms: Date.now() - t0, detail: String(err?.message ?? err).replace(/\s+/g, ' ').slice(0, 580) }
          } finally { clearTimeout(timer) }
        }
        let r = await once()
        let status = r.ok ? 'pass' : r.skip ? 'skip' : 'fail'
        if (status === 'fail' && t.retry) {
          const again = await once()
          if (again.ok) { status = 'flaky'; r = { ...again, detail: `failed once, passed on retry: ${r.detail}` } }
          else r = again
        }
        results.push({ id: t.id, title: t.title, status, category: t.category, durationMs: r.ms, ...(r.detail && status !== 'pass' ? { detail: r.detail } : {}) })
        log(`  ${status === 'pass' ? '✓' : status === 'flaky' ? '~' : '✗'} ${t.title}${status !== 'pass' && r.detail ? ` — ${r.detail}` : ''}`)
      }
      const failed = results.some((r) => r.status === 'fail')
      const shaky = results.some((r) => r.status === 'flaky')
      return { id, title, status: failed ? 'fail' : shaky ? 'warn' : 'pass', durationMs: Date.now() - started, tests: results }
    },
  }
}
