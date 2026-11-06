// Kiosk suite, stage 1 — what can be checked without running anything: the tablet page's scripts, the bundle the app downloads, and
// the plain-Java parts of the app (compiled and run with javac). The dashboard-side rules of the remote PIN are checked here against
// the app's own Java: a record made by the portal's code (src/lib/kiosk/pin-record.ts) must verify in StaffPin.java.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { createStage, assert, skipTest } from '../lib/harness.mjs'
import { run } from '../lib/exec.mjs'

const APP = 'prototypes/sarcafe-kiosk-app'
const JAVA_SRC = `${APP}/src/il/co/sarcafe/kiosk`

function javac() {
  for (const p of [process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin', 'javac'), '/usr/bin/javac'].filter(Boolean)) if (fs.existsSync(p)) return p
  return null
}

export function kioskStaticStage(root) {
  const stage = createStage('kiosk-static', 'הקיוסק: הקוד של הדף, החבילה והאפליקציה (Java)')

  stage.test('page-scripts', 'כל הסקריפטים של דף הקיוסק תקינים (node --check)', 'static', async () => {
    const dir = path.join(root, APP, 'overrides')
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
    assert.ok(files.length >= 15, `only ${files.length} scripts`)
    const bad = []
    for (const f of files) { const r = await run('node', ['--check', path.join(dir, f)], { cwd: root, timeout: 30_000 }); if (r.code !== 0) bad.push(`${f}: ${r.output.split('\n').slice(0, 2).join(' ')}`) }
    assert.deepEqual(bad, [], 'scripts that do not parse:')
  })

  stage.test('bundle', 'חבילת הדף נבנית: כל הקבצים, כל אחד במקום, בלי קובץ ריק', 'static', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosk-bundle-'))
    try {
      const { assemble } = await import(path.join(root, 'scripts/assemble-kiosk-bundle.mjs'))
      await assemble(out)
      const files = []
      const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p) } }
      walk(out)
      assert.ok(files.some((f) => f.endsWith('index.html')), 'index.html')
      assert.ok(files.length >= 20, `${files.length} files`)
      const empty = files.filter((f) => fs.statSync(f).size === 0).map((f) => path.relative(out, f))
      assert.deepEqual(empty, [], 'empty files in the bundle:')
      const html = fs.readFileSync(files.find((f) => f.endsWith('index.html')), 'utf8')
      for (const name of ['kiosk-device.js', 'kiosk-admin.js', 'kiosk-config.js']) assert.ok(html.includes(name), `index.html loads ${name}`)
    } finally { fs.rmSync(out, { recursive: true, force: true }) }
  })

  stage.test('java-pin', 'האפליקציה (Java): קוד שנקבע בלוח הבקרה נבדק אצל הטאבלט כמו קוד שהוקלד בו, ורשומה פגומה נדחית', 'unit', async () => {
    const compiler = javac()
    if (!compiler) skipTest('no JDK on this machine (javac): GitHub Actions has one')
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosk-java-'))
    try {
      // the record exactly as the portal makes it (src/lib/kiosk/pin-record.ts pinRecord: PBKDF2-HMAC-SHA1, 15000, 16-byte salt)
      const salt = randomBytes(16)
      const record = `pbkdf2$15000$${salt.toString('hex')}$${pbkdf2Sync('482915', salt, 15000, 32, 'sha1').toString('hex')}`
      const portal = fs.readFileSync(path.join(root, 'src/lib/kiosk/pin-record.ts'), 'utf8')
      assert.ok(/PIN_ITERATIONS = 15000/.test(portal) && /pbkdf2Sync\(pin, salt, iterations, 32, 'sha1'\)/.test(portal) && /randomBytes\(16\)/.test(portal), 'the portal still makes records this way')
      const test = `package il.co.sarcafe.kiosk;
public final class RemotePinTest {
  static int fails = 0;
  static void check(String name, boolean ok) { if (!ok) { fails++; System.out.println("FAIL " + name); } }
  static String rep(String s, int n) { StringBuilder b = new StringBuilder(); for (int i = 0; i < n; i++) b.append(s); return b.toString(); } // Java 8: no String.repeat
  public static void main(String[] a) {
    String record = a[0];
    check("record accepted", PinReset.acceptableRecord(record));
    check("the PIN chosen on the dashboard opens the panel", StaffPin.verify(record, "482915"));
    check("another PIN does not", !StaffPin.verify(record, "482916"));
    check("an empty record is refused", !PinReset.acceptableRecord(""));
    check("plain text is refused", !PinReset.acceptableRecord("482915"));
    check("an old unsalted hash is refused", !PinReset.acceptableRecord(rep("a", 64)));
    check("too few iterations are refused", !PinReset.acceptableRecord("pbkdf2$999$" + rep("a", 32) + "$" + rep("b", 64)));
    check("upper-case hex is refused", !PinReset.acceptableRecord(record.toUpperCase()));
    check("a uuid id is accepted", PinReset.acceptableId("123e4567-e89b-42d3-a456-426614174000"));
    check("a non-uuid id is refused", !PinReset.acceptableId("1; drop table"));
    check("the tablet name defaults to the first tablet", PinReset.deviceOrDefault(null).equals("givat-haviva-1"));
    check("a bad tablet name falls back", PinReset.deviceOrDefault("../x").equals("givat-haviva-1"));
    check("a good tablet name is kept", PinReset.deviceOrDefault("maor-2").equals("maor-2"));
    System.out.println(fails == 0 ? "OK" : "FAILED " + fails);
    System.exit(fails == 0 ? 0 : 1);
  }
}`
      const testDir = path.join(work, 'src')
      fs.mkdirSync(testDir, { recursive: true })
      fs.writeFileSync(path.join(testDir, 'RemotePinTest.java'), test)
      const srcs = ['OtaRules.java', 'StaffPin.java', 'PinReset.java'].map((f) => path.join(root, JAVA_SRC, f))
      const c = await run(compiler, ['--release', '8', '-Xlint:-options', '-encoding', 'UTF-8', '-d', path.join(work, 'out'), ...srcs, path.join(testDir, 'RemotePinTest.java')], { cwd: root, timeout: 120_000 })
      assert.ok(c.code === 0, `javac: ${c.output.split('\n').filter((l) => /error/.test(l)).slice(0, 4).join(' | ')}`)
      const java = path.join(path.dirname(compiler), 'java')
      const r = await run(fs.existsSync(java) ? java : 'java', ['-cp', path.join(work, 'out'), 'il.co.sarcafe.kiosk.RemotePinTest', record], { cwd: root, timeout: 60_000 })
      assert.ok(r.code === 0 && /OK/.test(r.output), r.output.split('\n').filter((l) => /FAIL/.test(l)).join(' | ') || r.output.slice(-300))
    } finally { fs.rmSync(work, { recursive: true, force: true }) }
  }, { retry: false, timeout: 180_000 })

  stage.test('java-wiring', 'האפליקציה מושכת קוד מרחוק בכל בדיקת עדכונים, שומרת אותו כמו קוד שהוקלד ומאשרת; הדף מבצע פקודות פעם אחת', 'static', async () => {
    const ota = fs.readFileSync(path.join(root, JAVA_SRC, 'OtaUpdater.java'), 'utf8')
    assert.ok(/result\.append\("; "\)\.append\(checkPinReset\(\)\)/.test(ota), 'checked with every update check')
    assert.ok(/\/api\/kiosk\/device\/pin\?device=/.test(ota) && /X-Kiosk-Key/.test(ota), 'fetched with the kiosk key')
    assert.ok(/PinReset\.acceptableId\(id\) \|\| !PinReset\.acceptableRecord\(record\)/.test(ota.replace(/!PinReset\.acceptableId\(id\) \|\| /, 'PinReset.acceptableId(id) || ')) || /acceptableRecord\(record\)/.test(ota), 'the record is checked before it is kept')
    assert.ok(/putString\("pin_v2", record\)\.remove\("pin_hash"\)\.remove\("pin_failures"\)\.remove\("pin_locked_until"\)/.test(ota), 'kept exactly where the PIN dialog reads it, lockout cleared')
    assert.ok(/setRequestMethod\("POST"\)/.test(ota), 'confirmed back to the portal')
    const open = ota.slice(ota.indexOf('private HttpURLConnection open('), ota.indexOf('private HttpURLConnection open(') + 600)
    assert.ok(/setInstanceFollowRedirects\(false\)/.test(open) && /refused address/.test(open), 'only the pinned host, no redirects')
    const page = fs.readFileSync(path.join(root, APP, 'overrides/kiosk-device.js'), 'utf8')
    assert.ok(/localStorage\.setItem\(DONE_KEY, command\.id\)/.test(page) && page.indexOf('localStorage.setItem(DONE_KEY') < page.indexOf("command.kind === 'reload'"), 'the command is marked done before it runs (no reload loop)')
    assert.ok(/body\.commandDone = done/.test(page), 'the next report says it was done')
    const main = fs.readFileSync(path.join(root, JAVA_SRC, 'MainActivity.java'), 'utf8')
    const check = main.slice(main.indexOf('private void checkPin('), main.indexOf('// ---- the control panel'))
    assert.ok(/Wrong PIN/.test(check) && /\.show\(\)/.test(check), 'a wrong PIN says so (it used to close the dialog without a word)')
    const admin = fs.readFileSync(path.join(root, APP, 'overrides/kiosk-admin.js'), 'utf8')
    assert.ok(/\['stock', 'מלאי'\]/.test(admin) && /\$\{C\.apiBase\}\/stock/.test(admin) && /C\.headers\(\)/.test(admin), 'the panel has the live-stock tab, on the portal with the kiosk key')
  })

  return stage
}
