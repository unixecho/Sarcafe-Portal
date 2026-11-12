// Stage 0 — the suite checks itself: that it can start programs, find its tools, build in a safe place and clean up after itself on
// THIS machine (Windows or Linux). Everything else in the suite stands on these; when one of them is broken, dozens of tests fail
// with the same unhelpful line ("spawn npm ENOENT"), so they are tested first and by name. Works in a temp folder whose name has
// spaces and Hebrew, like a real user folder.
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createStage, assert, skipTest } from '../lib/harness.mjs'
import { run, start, npm, npmCli, packageBin, importFile, systemEnv, NODE } from '../lib/exec.mjs'
import { findJdk } from '../lib/jdk.mjs'
import { probeBrowser, selectBrowser, resolveBrowser, PROBE_MARK } from '../lib/browser.mjs'
import { sourceFiles, sourceFingerprint, copySource, linkDependencies, removeScratch, workDir, isInside, assertPortFree } from '../lib/scratch.mjs'

// Is this process still RUNNING? Signal 0 alone is not enough on Linux: it also succeeds for a zombie, a process that has already
// ended and only waits for its parent to collect it (in a container without an init process nobody does, so it stays for ever).
// So on Linux the kernel's own record is read first, and a zombie (Z) or dead (X, x) entry counts as ended. Anything else, an
// unreadable record, Windows and a POSIX system without /proc fall through to the signal probe, which never ends a process.
/** The state letter of a /proc/<pid>/stat line ("pid (name) S …"), or null. The name may hold spaces and brackets: the state is the field after the LAST ")". */
export const procStatState = (stat) => {
  const end = typeof stat === 'string' ? stat.lastIndexOf(')') : -1
  if (end < 0) return null
  const state = stat.slice(end + 1).trim().split(/\s+/)[0] ?? ''
  return /^[A-Za-z]$/.test(state) ? state : null
}
const linuxState = (pid) => { if (process.platform !== 'linux') return null; try { return procStatState(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')) } catch { return null } }
const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (['Z', 'X', 'x'].includes(linuxState(pid))) return false
  try { process.kill(pid, 0); return true } catch (err) { return err.code === 'EPERM' }
}
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)) } return !!(await fn()) }
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) }) })
const listening = (port) => new Promise((resolve) => { const c = net.connect(port, '127.0.0.1'); c.once('connect', () => { c.destroy(); resolve(true) }); c.once('error', () => resolve(false)) })

export function harnessStage(root) {
  const stage = createStage('harness', 'הבדיקות בודקות את עצמן: הפעלת תוכניות, כלים, עותק הבנייה וניקוי (Windows ו־Linux)')
  // one temp folder for the stage, with a space and non-English letters in its path
  let tmp
  const temp = () => (tmp ??= fs.mkdtempSync(path.join(os.tmpdir(), 'qa harness בדיקה ')))
  const cleanup = () => { if (tmp) { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); tmp = undefined } }
  process.once('exit', () => { try { cleanup() } catch { /* best effort */ } }) // also when only some of these tests ran (QA_TESTS)

  stage.test('missing-command', 'תוכנית שלא קיימת נכשלת עם הסיבה, בלי להפיל את הריצה', 'unit', async () => {
    const r = await run('qa-no-such-command-anywhere', ['x'], { timeout: 10_000 })
    assert.equal(r.code, 1, 'exit code')
    assert.match(r.output, /ENOENT/, 'the reason is in the output')
    const s = start('qa-no-such-command-anywhere', [], { timeout: 5_000 })
    let reason = ''
    try { await s.ready } catch (err) { reason = String(err.message) }
    assert.match(reason, /could not start|exited/, 'a long-running program that cannot start rejects (it used to crash the suite)')
    await s.stop()
  })

  stage.test('npm', 'npm מופעל בלי shell (ב־Windows זה npm.cmd, שאי אפשר להפעיל ישירות)', 'unit', async () => {
    assert.ok(npmCli() !== null || process.platform !== 'win32', `npm's own script was found for this Node (${NODE})`)
    const v = await npm(['--version'], { cwd: root, timeout: 60_000 })
    assert.equal(v.code, 0, `npm --version exit code (${v.output.slice(-200)})`)
    assert.match(v.output.trim(), /^\d+\.\d+\.\d+/, 'npm --version')
    // a script run the way the regression stage runs every check:* script, with an argument that a shell would have split or expanded
    const dir = path.join(temp(), 'npm project')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'qa-harness-fixture', private: true, scripts: { echo: 'node echo.mjs' } }))
    fs.writeFileSync(path.join(dir, 'echo.mjs'), 'console.log(JSON.stringify({ arg: process.argv[2], env: process.env.QA_HARNESS_VALUE }))\n')
    const r = await npm(['run', '-s', 'echo', '--', 'a b & c'], { cwd: dir, env: { QA_HARNESS_VALUE: 'passed through' }, timeout: 60_000 })
    assert.equal(r.code, 0, `npm run exit code (${r.output.slice(-200)})`)
    assert.deepEqual(JSON.parse(r.output.trim().split('\n').pop()), { arg: 'a b & c', env: 'passed through' }, 'the script got its argument whole and the environment')
  }, { timeout: 150_000 })

  stage.test('package-tools', 'הכלים של החבילות (tsc, next) מופעלים ישירות עם Node, בלי npx', 'unit', async () => {
    const tsc = await run(NODE, [packageBin(root, 'typescript', 'tsc'), '--version'], { cwd: root, timeout: 60_000 })
    assert.equal(tsc.code, 0, 'tsc --version exit code')
    assert.match(tsc.output, /Version \d+\.\d+/, 'tsc --version')
    const next = await run(NODE, [packageBin(root, 'next'), '--version'], { cwd: root, timeout: 60_000 })
    assert.equal(next.code, 0, 'next --version exit code')
    assert.match(next.output, /\d+\.\d+\.\d+/, 'next --version')
    let reason = ''
    try { packageBin(root, 'qa-no-such-package') } catch (err) { reason = String(err.message) }
    assert.match(reason, /not installed/, 'a missing package says so')
  }, { timeout: 150_000 })

  stage.test('import-by-path', 'מודול נטען לפי הנתיב שלו גם ב־Windows (C:\\…), גם מתיקייה עם רווחים', 'unit', async () => {
    const file = path.join(temp(), 'a module with spaces.mjs')
    fs.writeFileSync(file, 'export const answer = 42\n')
    assert.ok(path.isAbsolute(file), 'an absolute path')
    assert.equal((await importFile(file)).answer, 42, 'the module loaded')
    const real = await importFile(path.join(root, 'scripts/assemble-kiosk-bundle.mjs'))
    assert.equal(typeof real.assemble, 'function', 'the kiosk bundle assembler loads from its path')
  })

  stage.test('jdk', 'ה־JDK של המחשב נמצא (JAVA_HOME או javac ב־PATH, javac.exe ב־Windows) ובאמת מקמפל', 'unit', async () => {
    const jdk = findJdk()
    if (!jdk) {
      // a real absence only: nothing named javac in JAVA_HOME or anywhere on the PATH
      const exe = process.platform === 'win32' ? 'javac.exe' : 'javac'
      const dirs = [process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin'), ...(process.env.PATH ?? process.env.Path ?? '').split(path.delimiter)].filter(Boolean)
      assert.deepEqual(dirs.filter((d) => fs.existsSync(path.join(d, exe))), [], 'a javac exists but was not recognised as a JDK:')
      skipTest('no JDK on this machine (no javac in JAVA_HOME or on the PATH)')
    }
    assert.ok(fs.existsSync(jdk.javac) && fs.existsSync(jdk.java), `javac and java exist in ${jdk.home}`)
    // spaces yes, Hebrew no: on Windows the JDK's launcher reads its arguments in the system code page and cannot take such a path
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa jdk '))
    try {
    fs.writeFileSync(path.join(dir, 'Hello.java'), 'public final class Hello { public static void main(String[] a) { System.out.println("hello " + a[0]); } }\n')
    const c = await run(jdk.javac, ['--release', '8', '-Xlint:-options', '-encoding', 'UTF-8', '-d', path.join(dir, 'out'), path.join(dir, 'Hello.java')], { timeout: 120_000 })
    assert.equal(c.code, 0, `javac --release 8 exit code (${jdk.version}; ${c.output.slice(-200)})`)
    const r = await run(jdk.java, ['-cp', path.join(dir, 'out'), 'Hello', 'qa'], { timeout: 60_000 })
    assert.match(r.output, /hello qa/, 'the compiled class runs')
    // the names the old lookup missed: an empty JAVA_HOME and a compiler reachable only through the PATH
    const viaPath = findJdk({ PATH: path.join(jdk.home, 'bin') })
    assert.equal(viaPath?.home, jdk.home, 'found through the PATH alone, without JAVA_HOME')
    } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
    if (process.platform === 'win32') assert.equal(findJdk({ JAVA_HOME: path.join(temp(), 'not a jdk'), PATH: '' }), null, 'a JAVA_HOME without a compiler is not a JDK')
  }, { timeout: 200_000, retry: false })

  // A fixture program that starts a child that starts a grandchild; each prints its number (and appends it to pids.txt), then hangs.
  // They end themselves when the stop file appears (and after two minutes at the latest), so a test can clear up leftovers without
  // ever signalling a number that might by then belong to another program.
  const treeFixture = (dir) => {
    fs.mkdirSync(dir, { recursive: true })
    const stopFile = path.join(dir, 'stop')
    const pidFile = path.join(dir, 'pids.txt')
    for (const f of [stopFile, pidFile]) fs.rmSync(f, { force: true }) // a second try starts clean
    fs.writeFileSync(path.join(dir, 'tree.mjs'), [
      "import { spawn } from 'node:child_process'",
      "import fs from 'node:fs'",
      "import { fileURLToPath } from 'node:url'",
      "const [depth, stop, pids] = [Number(process.argv[2]), process.argv[3], process.argv[4]]",
      "console.log('pid ' + depth + ' ' + process.pid)",
      "fs.appendFileSync(pids, 'pid ' + depth + ' ' + process.pid + '\\n')",
      // Windows: Node ends its own ordinary children when it dies, which would hide a tree that was not ended; a detached child is
      // outside that and survives its parent, like the programs npm and a build start. POSIX: left in the parent's process group.
      "if (depth < 3) spawn(process.execPath, [fileURLToPath(import.meta.url), String(depth + 1), stop, pids], { stdio: 'inherit', detached: process.platform === 'win32', windowsHide: true })",
      "setInterval(() => { if (fs.existsSync(stop)) process.exit(0) }, 150)",
      "setTimeout(() => process.exit(0), 120000)",
      '',
    ].join('\n'))
    const readPids = () => { const text = fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8') : ''; return [1, 2, 3].map((d) => Number(text.match(new RegExp('pid ' + d + ' (\\d+)'))?.[1] ?? 0)) }
    return { args: [path.join(dir, 'tree.mjs'), '1', stopFile, pidFile], stopFile, readPids }
  }
  // leftovers after a failed check end themselves: nothing here signals a process, and the failed check still fails the test
  const releaseTree = async (fixture) => { fs.writeFileSync(fixture.stopFile, ''); await until(() => fixture.readPids().every((p) => !p || !alive(p)), 5000) }

  stage.test('process-state', 'הבדיקה מבחינה בין תהליך שרץ לתהליך שהסתיים (ב־Linux גם "זומבי" נחשב שהסתיים)', 'unit', async () => {
    assert.equal(procStatState('4242 (node) S 1 4242 4242 0 -1 4194560'), 'S', 'a sleeping process')
    assert.equal(procStatState('4242 (node) Z 1 4242 4242 0 -1 4227084'), 'Z', 'a zombie')
    assert.equal(procStatState('17 (a b) c (d)) Z 1 17 17 0'), 'Z', 'a name with spaces and brackets: the state after the LAST bracket')
    assert.equal(procStatState('17 (Z) R 1 17'), 'R', 'a running process whose NAME is Z is not a zombie')
    assert.equal(procStatState('17 (sh) X 1'), 'X', 'dead')
    for (const bad of ['', 'no brackets here', '17 (node)', '17 (node) 12 1', undefined, null]) assert.equal(procStatState(bad), null, 'not a stat line: ' + JSON.stringify(bad))
    assert.equal(alive(process.pid), true, 'this process is running')
    for (const bad of [0, -1, NaN, 1.5, undefined]) assert.equal(alive(bad), false, 'not a process number: ' + String(bad))
    // a real program: running while it runs, ended once it has ended (its number is read while it is still ours)
    const dir = path.join(temp(), 'state')
    fs.mkdirSync(dir, { recursive: true })
    const stop = path.join(dir, 'stop')
    const script = path.join(dir, 'wait.mjs')
    fs.writeFileSync(script, "import fs from 'node:fs'\nconsole.log('pid ' + process.pid)\nsetInterval(() => { if (fs.existsSync(process.argv[2])) process.exit(0) }, 100)\nsetTimeout(() => process.exit(0), 60000)\n")
    const s = start(NODE, [script, stop], { readyRe: /pid \d+/, timeout: 20_000 })
    try {
      await s.ready
      const pid = Number(s.logs().match(/pid (\d+)/)[1])
      assert.equal(alive(pid), true, 'a program that is running counts as running')
      fs.writeFileSync(stop, '')
      assert.ok(await until(() => !alive(pid)), 'once it has ended it counts as ended')
    } finally { fs.writeFileSync(stop, ''); await s.stop() }
  }, { timeout: 60_000 })

  stage.test('timeout-kills-tree', 'תוכנית שנתקעה נעצרת בזמן, יחד עם כל מה שהיא הפעילה (ב־Windows וב־Linux)', 'unit', async () => {
    const fixture = treeFixture(path.join(temp(), 'stuck'))
    try {
      const r = await run(NODE, fixture.args, { timeout: 4000 })
      assert.equal(r.code !== 0, true, 'a killed program does not report success')
      assert.equal(r.timedOut, true, 'the result says it ran out of time')
      assert.match(r.output, /killed after 4000 ms/, 'the report says it was stopped for time')
      const pids = fixture.readPids()
      assert.ok(pids.every((p) => p > 0), 'the program, its child and its grandchild started and named themselves (' + pids.join(', ') + ')')
      assert.ok(await until(() => !alive(pids[0])), 'the program itself is gone')
      assert.ok(await until(() => !alive(pids[1])), 'what it started is gone too')
      assert.ok(await until(() => !alive(pids[2])), 'and what THAT started is gone too')
    } finally { await releaseTree(fixture) }
  }, { timeout: 60_000 })

  stage.test('browser-probe', 'דפדפן נבחר רק אם באמת עלה: יציאה בשגיאה, היתקעות או יציאה בלי הדף נדחים עם הסיבה, והבא בתור נבדק', 'unit', async () => {
    const dir = path.join(temp(), 'browsers')
    const hang = treeFixture(path.join(dir, 'hang'))
    const put = (name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f }
    // Each "browser" is a file; its probe is this Node running it (in place of the real probe, which starts a browser with Playwright).
    const exit23 = put('exit23.mjs', 'console.error("cannot open display"); process.exit(23)\n')
    const silent = put('silent.mjs', 'process.exit(0)\n')
    const good = put('good.mjs', 'console.log("rendered " + process.argv[2])\n')
    const stuck = hang.args[0]
    const missing = path.join(dir, 'not installed', 'browser')
    const command = (exe) => (exe === stuck ? [NODE, hang.args] : exe === missing ? [exe, []] : [NODE, [exe, PROBE_MARK]])
    const probe = (exe, timeout = 20_000) => probeBrowser(exe, { timeout, command })
    try {
      const a = await probe(exit23)
      assert.equal(a.ok, false, 'a browser whose probe exits with 23 is rejected')
      assert.match(a.reason, /exited with 23: cannot open display/, 'with its exit code and what it said')

      const b = await probe(silent)
      assert.equal(b.ok, false, 'a probe that exits 0 without the rendered page is rejected')
      assert.match(b.reason, /without rendering/, 'and the reason says so')

      const t0 = Date.now()
      const c = await probe(stuck, 3000)
      assert.equal(c.ok, false, 'a browser that never answers is rejected')
      assert.match(c.reason, /no answer within 3000 ms/, 'the reason is the time limit')
      assert.ok(Date.now() - t0 < 20_000, 'the probe is bounded')
      const pids = hang.readPids()
      assert.ok(pids.every((p) => p > 0), 'the stuck browser had started a child and a grandchild (' + pids.join(', ') + ')')
      for (const [i, p] of pids.entries()) assert.ok(await until(() => !alive(p)), ['the stuck browser', 'its child', 'its grandchild'][i] + ' is gone after the probe')

      const d = await probe(missing)
      assert.equal(d.ok, false, 'a browser that cannot be started is rejected')
      assert.match(d.reason, /does not start/, 'with the start error')

      assert.deepEqual(await probe(good), { ok: true }, 'a probe that renders the page and exits 0 is accepted')

      // fallback: the failures are passed over in order, each recorded, and the first working one is chosen
      const seen = []
      const each = async (exe) => { const r = await probe(exe, 3000); seen.push(path.basename(exe) + ':' + r.ok); return r }
      const chosen = await selectBrowser([missing, exit23, undefined, stuck, silent, good, exit23], { probe: each })
      assert.equal(chosen.browser, good, 'the first working browser is chosen')
      assert.deepEqual(seen, ['exit23.mjs:false', 'tree.mjs:false', 'silent.mjs:false', 'good.mjs:true'], 'every installed one before it was tried, and nothing after it')
      assert.equal(chosen.problems.length, 3, 'one recorded problem per rejected browser (one that is not installed is not a problem)')
      assert.match(chosen.problems[0], /exit23\.mjs is installed but is not usable: exited with 23/, 'the first problem names the browser and the reason')
      assert.match(chosen.problems[1], /no answer within 3000 ms/, 'the second is the time-out')
      assert.match(chosen.problems[2], /without rendering/, 'the third is the silent exit')

      const none = await selectBrowser([exit23, stuck], { probe: each })
      assert.equal(none.browser, null, 'when nothing works, no browser is chosen')
      assert.equal(none.problems.length, 2, 'and both reasons are kept')

      // the real probe, against something that is a file but not a browser: a failure with the reason, never a pass
      const real = await probeBrowser(exit23, { timeout: 60_000 })
      assert.equal(real.ok, false, 'the real probe rejects a file that is not a browser')
      assert.match(real.reason, /exited with 1|no answer/, 'with a reason')
    } finally { await releaseTree(hang) }
  }, { timeout: 200_000, retry: false })

  stage.test('browser-chosen', 'הדפדפן של הריצה הזאת עבר את בדיקת המוכנות האמיתית (או שאין דפדפן, וזה נאמר)', 'unit', async () => {
    const { browser, problems } = await resolveBrowser()
    if (!browser && problems.length === 0) skipTest('no browser is installed on this machine (npx playwright install chromium)')
    assert.ok(browser, 'a browser on this machine works. Rejected: ' + problems.join(' | ').slice(0, 400))
    assert.deepEqual(await probeBrowser(browser), { ok: true }, 'the chosen browser passes the readiness check again')
  }, { timeout: 120_000 })

  stage.test('server-start-stop', 'שרת שהופעל נסגר עם כל מה שהפעיל והפורט מתפנה; שרת שנופל בהפעלה מדווח', 'unit', async () => {
    const dir = path.join(temp(), 'server')
    fs.mkdirSync(dir, { recursive: true })
    const port = await freePort()
    // like `next start`: a launcher that starts the real server as its own child
    fs.writeFileSync(path.join(dir, 'server.mjs'), `import http from 'node:http'\nhttp.createServer((q, s) => s.end('ok')).listen(${port}, '127.0.0.1', () => console.log('listening ' + process.pid))\n`)
    fs.writeFileSync(path.join(dir, 'launcher.mjs'), `import { spawn } from 'node:child_process'\nimport { fileURLToPath } from 'node:url'\nspawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], { stdio: 'inherit' })\nsetInterval(() => {}, 1000)\n`)
    const s = start(NODE, [path.join(dir, 'launcher.mjs')], { readyRe: /listening \d+/, timeout: 30_000 })
    try {
      await s.ready
      const inner = Number(s.logs().match(/listening (\d+)/)[1])
      assert.ok(await listening(port), 'the server answers')
      let busy = ''
      try { await assertPortFree(port, 'test') } catch (err) { busy = String(err.message) }
      assert.match(busy, /is not free/, 'a port that is taken is refused before a run starts')
      await s.stop()
      assert.ok(await until(() => !alive(s.child.pid)), 'the launcher is gone')
      assert.ok(await until(() => !alive(inner)), 'the server it started is gone')
      assert.ok(await until(async () => !(await listening(port))), 'nothing listens on the port any more')
      await assertPortFree(port, 'test')
    } finally { await s.stop() }
    fs.writeFileSync(path.join(dir, 'crash.mjs'), 'console.error("cannot start: bad configuration"); process.exit(3)\n')
    const bad = start(NODE, [path.join(dir, 'crash.mjs')], { readyRe: /never printed/, timeout: 20_000 })
    let reason = ''
    try { await bad.ready } catch (err) { reason = String(err.message) }
    await bad.stop()
    assert.match(reason, /exited with 3/, 'a server that dies while starting is reported with its exit code')
    assert.match(reason, /bad configuration/, 'and with what it printed')
  }, { timeout: 90_000 })

  stage.test('clean-environment', 'אפליקציית הבדיקה לא מקבלת מהמחשב מפתחות, כתובות או הגדרות של ספקים אמיתיים', 'security', async () => {
    const leak = { SUPABASE_SERVICE_ROLE_KEY: 'real', NEXT_PUBLIC_SUPABASE_URL: 'https://real.example', VAPID_PRIVATE_KEY: 'real', CRON_SECRET: 'real', QA_REPORT_SECRET: 'real', QA_REPORT_URL: 'https://real.example', KIOSK_SIGNUP_KEY: 'real', GITHUB_TOKEN: 'real', VERCEL_TOKEN: 'real', NODE_OPTIONS: '--inspect', npm_config_token: 'real' }
    const base = { PATH: '/bin', Path: 'C:\\Windows', SystemRoot: 'C:\\Windows', TEMP: '/tmp', HOME: '/home/x' }
    assert.deepEqual(Object.keys(systemEnv({ ...base, ...leak })).sort(), Object.keys(base).sort(), 'only operating-system names pass')
    const script = path.join(temp(), 'env.mjs')
    fs.writeFileSync(script, 'console.log(JSON.stringify(Object.keys(process.env)))\n')
    // the developer's shell, played by this process for the length of one child
    const saved = {}
    for (const k of Object.keys(leak)) { saved[k] = process.env[k]; process.env[k] = leak[k] }
    let r
    try { r = await run(NODE, [script], { cleanEnv: true, env: { QA_GIVEN: '1' }, timeout: 30_000 }) } finally { for (const k of Object.keys(leak)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } }
    assert.equal(r.code, 0, 'the child ran')
    const names = JSON.parse(r.output.trim())
    assert.deepEqual(names.filter((n) => n in leak), [], 'names from the developer\'s shell that reached the child:')
    assert.ok(names.includes('QA_GIVEN'), 'what the suite gives it explicitly arrives')
  }, { timeout: 80_000 })

  stage.test('scratch-copy', 'עותק הבנייה: רק קוד האפליקציה נכנס (בלי ‎.env ובלי תיקיות פרטיות), הקישור לחבילות עובד בלי הרשאות מנהל, והניקוי לא נוגע בשום דבר מחוץ ל־qa/.work', 'security', async () => {
    const fake = path.join(temp(), 'checkout with spaces')
    const put = (rel, text = 'x') => { const f = path.join(fake, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text) }
    put('package.json', '{}'); put('next.config.mjs'); put('tsconfig.json'); put('src/app/page.tsx', 'export default 1'); put('public/logo.svg')
    // none of these may reach the copy
    put('.env.local', 'SUPABASE_SERVICE_ROLE_KEY=real'); put('.env', 'x'); put('.env.production.local', 'x'); put('src/.env.local', 'x'); put('public/.env', 'x')
    put('private notes/staff.txt', 'personal'); put('.codex/session.json'); put('graphify-out/graph.json'); put('kiosk-signing.env', 'pw'); put('docs/x.md'); put('qa/reports/history/old.json')
    put('node_modules/next/package.json', '{"name":"next"}'); put('node_modules/keep-me.txt', 'installed packages')
    put('src/node_modules/x.js'); put('.next/BUILD_ID', 'old')
    const files = sourceFiles(fake)
    assert.deepEqual(files, ['next.config.mjs', 'package.json', 'public/logo.svg', 'src/app/page.tsx', 'tsconfig.json'], 'what goes into the copy')
    const work = workDir(fake, 'app')
    assert.ok(isInside(path.join(fake, 'qa', '.work'), work), 'the work folder is inside qa/.work')
    assert.equal(copySource(fake, work), files.length, 'files copied')
    const copied = []
    const walk = (d, rel = '') => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else copied.push(r) } }
    walk(work)
    assert.deepEqual(copied.sort(), files, 'the copy holds exactly those files')
    // a change of content, a new file and a removed file each change the fingerprint (a kept build is only kept for the same source)
    const f0 = sourceFingerprint(fake)
    assert.equal(sourceFingerprint(fake), f0, 'the same source gives the same fingerprint')
    put('src/app/page.tsx', 'export default 2'); const f1 = sourceFingerprint(fake)
    put('src/app/new.tsx'); const f2 = sourceFingerprint(fake)
    fs.rmSync(path.join(fake, 'src/app/new.tsx')); const f3 = sourceFingerprint(fake)
    put('.env.local', 'changed'); put('docs/x.md', 'changed')
    assert.ok(f1 !== f0 && f2 !== f1 && f3 === f1, 'an edit, a new file and a removal are each noticed')
    assert.equal(sourceFingerprint(fake), f3, 'files that are not part of the build do not count')
    // the link to the installed packages: no administrator rights needed, and removing the copy leaves the packages alone
    linkDependencies(fake, work)
    assert.equal(fs.readFileSync(path.join(work, 'node_modules/keep-me.txt'), 'utf8'), 'installed packages', 'the copy reaches the installed packages')
    assert.ok(fs.lstatSync(path.join(work, 'node_modules')).isSymbolicLink(), 'through a link, not a copy')
    linkDependencies(fake, work) // again over an existing link: replaced, not followed
    removeScratch(fake, work)
    assert.ok(!fs.existsSync(work), 'the copy is gone')
    assert.equal(fs.readFileSync(path.join(fake, 'node_modules/keep-me.txt'), 'utf8'), 'installed packages', 'the installed packages are untouched')
    assert.ok(fs.existsSync(path.join(fake, 'node_modules/next/package.json')), 'every installed file is still there')
    // nothing outside qa/.work can be named
    const refused = (fn) => { try { fn(); return '' } catch (err) { return String(err.message) } }
    assert.match(refused(() => removeScratch(fake, fake)), /refusing/, 'the checkout itself')
    assert.match(refused(() => removeScratch(fake, path.join(fake, 'qa', '.work'))), /refusing/, 'the whole work area')
    assert.match(refused(() => removeScratch(fake, path.join(fake, 'qa', '.work', '..', '..', 'src'))), /refusing/, 'a path that climbs out with ..')
    assert.match(refused(() => removeScratch(fake, path.join(fake, 'src'))), /refusing/, 'the source folder')
    assert.match(refused(() => removeScratch(fake, os.homedir())), /refusing/, 'the home folder')
    assert.match(refused(() => workDir(fake, '../../src')), /refusing/, 'a work-folder name that climbs out')
    assert.ok(fs.existsSync(path.join(fake, 'src/app/page.tsx')) && fs.existsSync(path.join(fake, '.env.local')), 'nothing was removed by the refused calls')
    assert.match(refused(() => linkDependencies(path.join(temp(), 'no packages here'), work)), /not installed/, 'a checkout without installed packages says so')
  }, { timeout: 60_000 })

  stage.test('cleanup', 'התיקייה הזמנית של הבדיקות האלה נמחקה', 'unit', async () => {
    const dir = tmp
    cleanup()
    assert.ok(!dir || !fs.existsSync(dir), 'the temp folder is gone')
  }, { retry: false })

  return stage
}
