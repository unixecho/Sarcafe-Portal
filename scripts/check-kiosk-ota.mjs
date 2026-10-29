// Checks for the kiosk's over-the-air updates (docs/SARCAFE_KIOSK_OTA.md).
//
//   node scripts/check-kiosk-ota.mjs
//
// Runs the publisher into temp folders (never into public/): manifest shape, hashes on disk, determinism (two runs give
// identical bytes), path safety, size caps, refusal of broken bundles without failing the build, the signing round
// trip (keygen + sign + publish + verify), the APK channel, and, when a JDK is found, the same rules in the app's own
// Java (OtaRules, StaffPin) compiled with javac: same version, the Node signature verifies in Java, same name rules.
// Optional: KIOSK_OTA_TEST_APK=<a built kiosk APK> also tests "publish apk" with aapt2.

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as P from './publish-kiosk-ota.mjs'
import { keygen, signBundle, insideRepo } from './sign-kiosk-ota.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const PUBLISH = join(ROOT, 'scripts', 'publish-kiosk-ota.mjs')
let pass = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n${t}`)
const sha256 = (b) => createHash('sha256').update(b).digest('hex')

const tmp = mkdtempSync(join(tmpdir(), 'check-kiosk-ota-'))
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }) } catch { /* temp */ } })
const run = (args, env = {}) => spawnSync(process.execPath, [PUBLISH, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } })
const tree = (dir) => {
  const out = {}
  const walk = (d, pre) => { for (const n of readdirSync(d).sort()) { const f = join(d, n); if (statSync(f).isDirectory()) walk(f, `${pre}${n}/`); else out[`${pre}${n}`] = sha256(readFileSync(f)) } }
  walk(dir, '')
  return out
}

// a stand-in assembler, so refusals can be tested without touching the real sources
const fake = (name, body) => {
  const p = join(tmp, `${name}.mjs`)
  writeFileSync(p, `import { mkdirSync, writeFileSync } from 'node:fs'\nimport { join } from 'node:path'\nconst o = process.argv[2]\nmkdirSync(o, { recursive: true })\n${body}\n`)
  return p
}
const goodBody = `writeFileSync(join(o, 'index.html'), '<html>\\r\\n<script src="./r.js"></script></html>')\nwriteFileSync(join(o, 'r.js'), 'window.KioskNative && window.KioskNative.ready("")')`
const GOOD = fake('good', goodBody)

section('the real bundle: two runs, identical output')
const realAvailable = existsSync(join(ROOT, 'scripts', 'assemble-kiosk-bundle.mjs')) && existsSync(join(ROOT, 'prototypes', 'sarcafe-kiosk', 'index.html'))
let manifest = null
if (realAvailable) {
  const a = join(tmp, 'a'); const b = join(tmp, 'b')
  const r1 = run(['--out', a, '--strict', '--quiet'])
  const r2 = run(['--out', b, '--strict', '--quiet'], { VERCEL_GIT_COMMIT_SHA: '' })
  check('publisher exits 0 (strict)', r1.status === 0 && r2.status === 0, r1.stderr + r2.stderr)
  check('two runs give byte-identical trees', JSON.stringify(tree(a)) === JSON.stringify(tree(b)))
  manifest = JSON.parse(readFileSync(join(a, 'web', 'manifest.json'), 'utf8'))
  const dirs = readdirSync(join(a, 'web')).filter((n) => n !== 'manifest.json')
  check('exactly one version folder, named by the version', dirs.length === 1 && dirs[0] === manifest.version)
  check('manifest shape', manifest.schema === 1 && /^[0-9a-f]{16}$/.test(manifest.version) && Number.isSafeInteger(manifest.seq)
    && manifest.minNativeVersion === P.MIN_NATIVE_VERSION && Array.isArray(manifest.files) && 'createdFrom' in manifest)
  check('files sorted by path', manifest.files.map((f) => f.path).join() === [...manifest.files.map((f) => f.path)].sort().join())
  check('every file on disk matches its sha256 and size', manifest.files.every((f) => {
    const d = readFileSync(join(a, 'web', manifest.version, f.path)); return d.length === f.size && sha256(d) === f.sha256
  }))
  check('no file on disk that the manifest does not list', readdirSync(join(a, 'web', manifest.version)).length === manifest.files.length)
  check('version = hash of the file list', P.computeVersion(manifest.files) === manifest.version)
  check('totalBytes adds up and is under 15 MB', manifest.totalBytes === manifest.files.reduce((n, f) => n + f.size, 0) && manifest.totalBytes <= P.MAX_BUNDLE_BYTES)
  check('index.html and kiosk-ready.js are in it', manifest.files.some((f) => f.path === 'index.html') && manifest.files.some((f) => f.path === 'kiosk-ready.js'))
  check('every name is flat and safe', manifest.files.every((f) => P.isSafeName(f.path)))
  check('no CR in text files (same bytes on Windows and Vercel)', manifest.files.filter((f) => /\.(html|js|css|json)$/.test(f.path))
    .every((f) => !readFileSync(join(a, 'web', manifest.version, f.path)).includes(13)))
  const r3 = run(['--out', a, '--strict', '--quiet'], { VERCEL_GIT_COMMIT_SHA: 'abc1234def' })
  const m3 = JSON.parse(readFileSync(join(a, 'web', 'manifest.json'), 'utf8'))
  check('createdFrom carries the Vercel commit, same version', r3.status === 0 && m3.createdFrom === 'abc1234def' && m3.version === manifest.version)
} else {
  console.log('  (skipped: the assembler or prototypes/sarcafe-kiosk is missing in this checkout)')
}

section('path safety and caps')
for (const bad of ['', '..', '../x.js', 'a/b.js', 'a\\b.js', '/etc/passwd', 'C:x', '.hidden', 'x..js', 'name with space.js', 'ä.js', 'x'.repeat(101), '%2e%2e', 'a?b']) {
  check(`refused name ${JSON.stringify(bad.slice(0, 20))}`, !P.isSafeName(bad))
}
for (const ok of ['index.html', 'kiosk-app.css', 'givat-haviva-1-portrait.webp', 'rubik_latin.woff2', 'a.b.c']) check(`allowed name ${ok}`, P.isSafeName(ok))
const f = (path, size = 10) => ({ path, sha256: 'a'.repeat(64), size })
check('no index.html refused', /index/.test(P.checkEntries([f('a.js')])))
check('duplicate (case) refused', /duplicate/.test(P.checkEntries([f('index.html'), f('A.js'), f('a.js')])))
check('file over 8 MB refused', /too large/.test(P.checkEntries([f('index.html', P.MAX_FILE_BYTES + 1)])))
check('bundle over 15 MB refused', /too large/.test(P.checkEntries([f('index.html'), ...[1, 2].map((i) => f(`b${i}.webp`, 8 * 1024 * 1024))])))
check('over 200 files refused', /too many/.test(P.checkEntries(Array.from({ length: 201 }, (_, i) => f(i ? `f${i}.js` : 'index.html')))))

section('broken bundles are never published, and never fail the portal build')
const refusals = {
  'a folder in the bundle': fake('dir', `${goodBody}\nmkdirSync(join(o, 'sub'))`),
  'an unsafe name': fake('unsafe', `${goodBody}\nwriteFileSync(join(o, 'bad name.js'), 'x')`),
  'no KioskNative.ready()': fake('noready', `writeFileSync(join(o, 'index.html'), '<html></html>')`),
  'too large': fake('big', `${goodBody}\nwriteFileSync(join(o, 'big.webp'), Buffer.alloc(9 * 1024 * 1024))`),
  'assembler crashes': fake('crash', 'process.exit(3)'),
}
for (const [what, script] of Object.entries(refusals)) {
  const out = join(tmp, `r-${what.replace(/\W/g, '')}`)
  mkdirSync(join(out, 'web'), { recursive: true })
  writeFileSync(join(out, 'web', 'manifest.json'), '{"stale":true}')
  const soft = run(['--out', out, '--assembler', script, '--quiet'])
  check(`${what}: exit 0 without --strict`, soft.status === 0, soft.stderr)
  check(`${what}: nothing (not even a stale manifest) is left to serve`, !existsSync(join(out, 'web')))
  const strict = run(['--out', out, '--assembler', script, '--strict', '--quiet'])
  check(`${what}: exit 1 with --strict`, strict.status === 1)
}
const missing = run(['--out', join(tmp, 'missing'), '--assembler', join(tmp, 'nope.mjs'), '--quiet'])
check('missing assembler: exit 0, nothing published', missing.status === 0 && !existsSync(join(tmp, 'missing', 'web')))

section('older versions are removed, CRLF is normalised')
const keep = join(tmp, 'keep')
run(['--out', keep, '--assembler', GOOD, '--strict', '--quiet'])
const v1 = JSON.parse(readFileSync(join(keep, 'web', 'manifest.json'), 'utf8')).version
run(['--out', keep, '--assembler', fake('good2', `${goodBody}\nwriteFileSync(join(o, 'extra.css'), 'b{}')`), '--strict', '--quiet'])
const m2 = JSON.parse(readFileSync(join(keep, 'web', 'manifest.json'), 'utf8'))
check('a new version replaces the old folder', m2.version !== v1 && !existsSync(join(keep, 'web', v1)) && existsSync(join(keep, 'web', m2.version)))
check('CRLF in index.html stored as LF', !readFileSync(join(keep, 'web', m2.version, 'index.html')).includes(13))
check('unsigned without web-signature.json', m2.seq === 0 && !('signature' in m2))

section('signing (required by the app)')
check('a key inside the repo is refused', insideRepo(join(ROOT, 'x.pem')) && !insideRepo(join(tmp, 'x.pem')))
let threw = false
try { keygen(join(ROOT, 'should-not-exist.pem')) } catch { threw = true }
check('keygen refuses a path in the repo', threw && !existsSync(join(ROOT, 'should-not-exist.pem')))
const keyPath = join(tmp, 'keys', 'ota.pem')
const pub = keygen(keyPath)
threw = false
try { keygen(keyPath) } catch { threw = true }
check('keygen never overwrites a key', threw)
const sigOut = join(tmp, 'signed')
const rec = signBundle({ keyPath, seq: 1761650000, out: sigOut, assembler: GOOD })
check('signature record names the version and seq', /^[0-9a-f]{16}$/.test(rec.version) && rec.seq === 1761650000 && rec.publicKey === pub)
check('signature verifies (Node)', P.verifySignature(pub, P.signaturePayload(rec.version, rec.seq, P.MIN_NATIVE_VERSION), rec.signature))
check('signature fails for another version / seq', !P.verifySignature(pub, P.signaturePayload('0'.repeat(16), rec.seq, P.MIN_NATIVE_VERSION), rec.signature)
  && !P.verifySignature(pub, P.signaturePayload(rec.version, rec.seq + 1, P.MIN_NATIVE_VERSION), rec.signature))
const pubRun = run(['--out', sigOut, '--assembler', GOOD, '--strict', '--quiet'])
const signed = JSON.parse(readFileSync(join(sigOut, 'web', 'manifest.json'), 'utf8'))
check('publisher puts the matching signature and seq into the manifest', pubRun.status === 0 && signed.signature === rec.signature && signed.seq === rec.seq && signed.version === rec.version)
run(['--out', sigOut, '--assembler', fake('changed', `${goodBody}\nwriteFileSync(join(o, 'new.js'), '1')`), '--strict', '--quiet'])
const stale = JSON.parse(readFileSync(join(sigOut, 'web', 'manifest.json'), 'utf8'))
check('a signature for another version is NOT carried over', !('signature' in stale) && stale.seq === 0)

section('APK channel')
const apkTest = process.env.KIOSK_OTA_TEST_APK
if (apkTest && existsSync(apkTest)) {
  const out = join(tmp, 'apk')
  const r = run(['apk', '--apk', apkTest, '--out', out])
  check('publish apk exits 0', r.status === 0, r.stderr)
  const latest = JSON.parse(readFileSync(join(out, 'apk', 'latest.json'), 'utf8'))
  const data = readFileSync(join(out, 'apk', latest.url))
  check('latest.json shape', Number.isSafeInteger(latest.versionCode) && P.isSafeName(latest.url) && latest.url.endsWith('.apk') && typeof latest.versionName === 'string')
  check('latest.json sha256 + size match the copied APK', latest.size === data.length && latest.sha256 === sha256(data) && sha256(readFileSync(apkTest)) === latest.sha256)
  check('the same version code again is refused', run(['apk', '--apk', apkTest, '--out', out]).status === 1)
  check('a wrong --version-code is refused', run(['apk', '--apk', apkTest, '--out', join(tmp, 'apk2'), '--version-code', String(latest.versionCode + 5)]).status === 1)
} else {
  const out = join(tmp, 'apk')
  const fakeApk = join(tmp, 'fake.apk')
  writeFileSync(fakeApk, Buffer.from('not really an apk'))
  const r = run(['apk', '--apk', fakeApk, '--out', out, '--version-code', '3', '--version-name', '0.3', '--no-aapt'])
  const latest = r.status === 0 ? JSON.parse(readFileSync(join(out, 'apk', 'latest.json'), 'utf8')) : {}
  check('publish apk writes latest.json (version code given)', r.status === 0 && latest.versionCode === 3 && latest.url === 'sarcafe-kiosk-3.apk' && latest.size === 17, r.stderr)
  check('the same version code again is refused', run(['apk', '--apk', fakeApk, '--out', out, '--version-code', '3', '--no-aapt']).status === 1)
  check('a higher one replaces the old APK file', run(['apk', '--apk', fakeApk, '--out', out, '--version-code', '4', '--no-aapt']).status === 0
    && readdirSync(join(out, 'apk')).filter((n) => n.endsWith('.apk')).join() === 'sarcafe-kiosk-4.apk')
}

section('the app\'s own Java agrees (OtaRules, StaffPin)')
const jdk = [process.env.JAVA_HOME, 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.7.6-hotspot'].filter(Boolean).find((d) => existsSync(join(d, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac')))
if (jdk) {
  const jt = join(tmp, 'java')
  const pkg = join(jt, 'src', 'il', 'co', 'sarcafe', 'kiosk')
  mkdirSync(pkg, { recursive: true })
  const appSrc = join(ROOT, 'prototypes', 'sarcafe-kiosk-app', 'src', 'il', 'co', 'sarcafe', 'kiosk')
  for (const n of ['OtaRules.java', 'StaffPin.java']) writeFileSync(join(pkg, n), readFileSync(join(appSrc, n)))
  const files = manifest ? manifest.files : JSON.parse(readFileSync(join(sigOut, 'web', 'manifest.json'), 'utf8')).files
  const version = P.computeVersion(files)
  const lines = [
    ...files.map((x) => `file\t${x.path}\t${x.sha256}\t${x.size}`),
    `version\t${version}`,
    `sig\t${pub}\t${rec.version}\t${rec.seq}\t${P.MIN_NATIVE_VERSION}\t${rec.signature}`,
    ...['index.html', 'a.b.c', '..', 'a/b', 'a\\b', '.x', 'x..y', 'a b', 'ä', '', 'x'.repeat(101)].map((n) => `name\t${n}\t${P.isSafeName(n)}`),
  ]
  writeFileSync(join(jt, 'vectors.tsv'), `${lines.join('\n')}\n`, 'utf8')
  writeFileSync(join(pkg, 'OtaRulesTest.java'), javaTest())
  const javac = join(jdk, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac')
  const java = join(jdk, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  const srcs = ['OtaRules.java', 'StaffPin.java', 'OtaRulesTest.java'].map((n) => join(pkg, n))
  const c = spawnSync(javac, ['--release', '8', '-encoding', 'UTF-8', '-Xlint:-options', '-d', join(jt, 'out'), ...srcs], { encoding: 'utf8' })
  check('javac --release 8 compiles OtaRules + StaffPin + the test', c.status === 0, c.stderr)
  if (c.status === 0) {
    const r = spawnSync(java, ['-cp', join(jt, 'out'), 'il.co.sarcafe.kiosk.OtaRulesTest', join(jt, 'vectors.tsv')], { encoding: 'utf8' })
    for (const line of r.stdout.trim().split(/\r?\n/)) {
      const [status, ...rest] = line.split(' ')
      if (status === 'ok' || status === 'FAIL') check(`java: ${rest.join(' ')}`, status === 'ok')
    }
    check('java test finished', r.status === 0 && /^ok done/m.test(r.stdout), r.stderr)
  }
} else {
  console.log('  (skipped: no JDK found; set JAVA_HOME)')
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)

/** The Java side of the cross-check (a function declaration, so the section above can call it). */
function javaTest() {
  return `package il.co.sarcafe.kiosk;

import java.io.BufferedReader;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;

/** Generated by scripts/check-kiosk-ota.mjs; compiled with plain javac against the app's own OtaRules / StaffPin. */
public class OtaRulesTest {
    static int failed;
    static void check(String name, boolean ok) {
        System.out.println((ok ? "ok " : "FAIL ") + name);
        if (!ok) failed++;
    }

    public static void main(String[] a) throws Exception {
        List<OtaRules.Entry> files = new ArrayList<OtaRules.Entry>();
        String version = null;
        BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(a[0]), "UTF-8"));
        String line;
        int names = 0, namesOk = 0;
        while ((line = r.readLine()) != null) {
            String[] p = line.split("\\t", -1);
            if (p[0].equals("file")) files.add(new OtaRules.Entry(p[1], p[2], Long.parseLong(p[3])));
            else if (p[0].equals("version")) version = p[1];
            else if (p[0].equals("sig")) {
                byte[] payload = OtaRules.signaturePayload(p[2], Long.parseLong(p[3]), Integer.parseInt(p[4]));
                check("the Node signature verifies in Java", OtaRules.verifySignature(p[1], payload, p[5]));
                check("a changed seq does not verify", !OtaRules.verifySignature(p[1],
                    OtaRules.signaturePayload(p[2], Long.parseLong(p[3]) + 1, Integer.parseInt(p[4])), p[5]));
                check("a changed version does not verify", !OtaRules.verifySignature(p[1],
                    OtaRules.signaturePayload("0000000000000000", Long.parseLong(p[3]), Integer.parseInt(p[4])), p[5]));
                check("garbage signature does not verify", !OtaRules.verifySignature(p[1], payload, "AAAA"));
                check("an empty key does not verify", !OtaRules.verifySignature("", payload, p[5]));
            } else if (p[0].equals("name")) {
                names++;
                if (OtaRules.isSafeName(p[1]) == Boolean.parseBoolean(p[2])) namesOk++;
                else System.out.println("FAIL name rule differs for " + p[1]);
            }
        }
        r.close();
        check("same version as Node (" + version + ")", version != null && version.equals(OtaRules.computeVersion(files)));
        check("manifest file list accepted", OtaRules.checkEntries(files) == null);
        check("name rules agree with Node (" + names + " cases)", names > 0 && names == namesOk);
        List<OtaRules.Entry> twice = new ArrayList<OtaRules.Entry>(files);
        twice.add(files.get(0));
        check("duplicate name refused", "duplicate name".equals(OtaRules.checkEntries(twice)));
        List<OtaRules.Entry> big = new ArrayList<OtaRules.Entry>();
        big.add(new OtaRules.Entry("index.html", files.get(0).sha256, OtaRules.MAX_FILE_BYTES + 1));
        check("file over the cap refused", "file too large".equals(OtaRules.checkEntries(big)));
        List<OtaRules.Entry> noIndex = new ArrayList<OtaRules.Entry>();
        noIndex.add(new OtaRules.Entry("a.js", files.get(0).sha256, 1));
        check("bundle without index.html refused", "no index.html".equals(OtaRules.checkEntries(noIndex)));
        List<OtaRules.Entry> badHash = new ArrayList<OtaRules.Entry>();
        badHash.add(new OtaRules.Entry("index.html", "XYZ", 1));
        check("malformed hash refused", "bad hash".equals(OtaRules.checkEntries(badHash)));
        check("version format", OtaRules.isVersion("0123456789abcdef") && !OtaRules.isVersion("0123456789ABCDEF") && !OtaRules.isVersion("../x"));
        check("backoff 10 min, doubling, max 2 h", OtaRules.nextDelayMs(0) == 600000L && OtaRules.nextDelayMs(1) == 1200000L
            && OtaRules.nextDelayMs(50) == 7200000L);
        check("mime types", OtaRules.mimeFor("a.JS").equals("text/javascript") && OtaRules.mimeFor("x.woff2").equals("font/woff2")
            && OtaRules.mimeFor("y.webp").equals("image/webp") && OtaRules.mimeFor("z").equals("application/octet-stream"));
        check("base64 decoder", new String(OtaRules.base64Decode("aGVsbG8="), "UTF-8").equals("hello")
            && OtaRules.base64Decode("a*b") == null);

        // StaffPin (security review S-14)
        String rec = StaffPin.create("482913", new SecureRandom());
        check("PIN record format pbkdf2$15000$salt$hash", rec.matches("pbkdf2\\\\$15000\\\\$[0-9a-f]{32}\\\\$[0-9a-f]{64}"));
        check("right PIN verifies", StaffPin.verify(rec, "482913"));
        check("wrong PIN fails", !StaffPin.verify(rec, "482914") && !StaffPin.verify(rec, ""));
        check("two records for one PIN differ (salted)", !rec.equals(StaffPin.create("482913", new SecureRandom())));
        check("tampered record fails", !StaffPin.verify(rec.replace("pbkdf2$15000", "pbkdf2$1"), "482913") && !StaffPin.verify("junk", "482913"));
        check("new PINs need 6-8 digits", StaffPin.isAcceptableNewPin("123456") && StaffPin.isAcceptableNewPin("12345678")
            && !StaffPin.isAcceptableNewPin("1234") && !StaffPin.isAcceptableNewPin("123456789") && !StaffPin.isAcceptableNewPin("12a456"));
        String legacy = OtaRules.sha256Hex(OtaRules.utf8("sarcafe-kiosk:1234"));
        check("old-format PIN still recognised (once, then migrated)", StaffPin.verifyLegacy(legacy, "1234") && !StaffPin.verifyLegacy(legacy, "1235"));
        check("lockout: 5 free tries, then 30 s doubling, max 1 h", StaffPin.lockoutMs(4) == 0 && StaffPin.lockoutMs(5) == 30000L
            && StaffPin.lockoutMs(6) == 60000L && StaffPin.lockoutMs(40) == 3600000L);

        System.out.println(failed == 0 ? "ok done" : "FAIL done");
        System.exit(failed == 0 ? 0 : 1);
    }
}
`
}
