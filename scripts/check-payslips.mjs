// Checks for the payslip viewer and the zip download: the zip writer is the real TypeScript, and what it writes is
// opened by a REAL unzip (Python's zipfile) so "valid zip" is not our own opinion; plus the wiring that must not drift
// (who may read, the one framing exception, the viewer's accessibility). The routes themselves are exercised in
// check-staff-access.mjs against a fixture database.
//
//   node scripts/check-payslips.mjs

import ts from 'typescript'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
let pass = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(name)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
const section = (t) => console.log(`\n${t}`)

const dir = mkdtempSync(join(tmpdir(), 'check-payslips-'))
process.on('exit', () => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* temp dir */
  }
})
writeFileSync(join(dir, 'zip.mjs'), ts.transpileModule(read('src/lib/staff/zip.ts'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText)
const Z = await import(pathToFileURL(join(dir, 'zip.mjs')).href)

async function build(files) {
  async function* source() {
    for (const file of files) yield file
  }
  return Buffer.from(await new Response(Z.zipStream(source(), new Date(2026, 9, 14, 10, 3, 20))).arrayBuffer())
}

section('the building blocks')
check('crc32 matches the standard test vector', Z.crc32(new TextEncoder().encode('123456789')) === 0xcbf43926 && Z.crc32(new Uint8Array(0)) === 0)
check('names with path characters or control characters are made safe, an empty one gets the fallback', Z.safeEntryName('a/b\\c:d.pdf', 'x') === 'a b c d.pdf' && Z.safeEntryName('  \u0001 ', 'תלוש') === 'תלוש' && Z.safeEntryName('תלוש 2026-09.pdf', 'x') === 'תלוש 2026-09.pdf')
check('two files with the same name keep both, the second numbered before the extension', JSON.stringify(Z.uniqueNames(['תלוש 2026-09.pdf', 'תלוש 2026-09.pdf', 'other.png', 'תלוש 2026-09.pdf'])) === JSON.stringify(['תלוש 2026-09.pdf', 'תלוש 2026-09 (2).pdf', 'other.png', 'תלוש 2026-09 (3).pdf']))

section('what it writes is a valid zip (opened by Python\'s zipfile)')
{
  const big = Buffer.alloc(4 * 1024 * 1024)
  for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761) >>> 24 // incompressible-looking, deterministic
  const files = [
    { name: 'תלוש 2026-08.pdf', data: new TextEncoder().encode('%PDF-1.7 first') },
    { name: 'תלוש 2026-09.pdf', data: big },
    { name: 'ריק.txt', data: new Uint8Array(0) },
    { name: 'plain.png', data: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128]) },
  ]
  const bytes = await build(files)
  const zipPath = join(dir, 'out.zip')
  const expectPath = join(dir, 'expect.json')
  writeFileSync(zipPath, bytes)
  writeFileSync(expectPath, JSON.stringify(files.map((f) => ({ name: f.name, size: f.data.length, hex: Buffer.from(f.data.subarray(0, 64)).toString('hex'), tail: Buffer.from(f.data.subarray(Math.max(0, f.data.length - 64))).toString('hex') }))))
  const script = [
    'import json, sys, zipfile',
    'z = zipfile.ZipFile(sys.argv[1])',
    'want = json.load(open(sys.argv[2], encoding="utf-8"))',
    'assert z.testzip() is None, "crc"',
    'assert [i.filename for i in z.infolist()] == [w["name"] for w in want], z.namelist()',
    'for w in want:',
    '    data = z.read(w["name"])',
    '    assert len(data) == w["size"], (w["name"], len(data))',
    '    assert data[:64].hex() == w["hex"] and data[-64:].hex() == w["tail"] if data else True',
    '    assert z.getinfo(w["name"]).compress_type == 0',
    '    assert z.getinfo(w["name"]).flag_bits & 0x800, "utf-8 flag"',
    'print("ok", len(want))',
  ].join('\n')
  const run = spawnSync('python', ['-I', '-c', script, zipPath, expectPath], { encoding: 'utf8' })
  const tried = run.error ? spawnSync('py', ['-3', '-I', '-c', script, zipPath, expectPath], { encoding: 'utf8' }) : run
  if (tried.error) {
    check('(skipped) no Python on this machine to open the zip with a real unzip', true)
    const listed = spawnSync('tar', ['-tf', zipPath], { encoding: 'utf8' })
    check('the system tar lists all four entries, Hebrew names intact', listed.status === 0 && files.every((f) => listed.stdout.includes(f.name)), listed.stderr)
  } else {
    check('a real unzip reads it: four entries, names (Hebrew, UTF-8 flag), sizes and bytes, CRC test passes, stored', tried.status === 0 && /^ok 4/.test(tried.stdout), `${tried.stdout}${tried.stderr}`.slice(0, 300))
  }
  check('a 4MB file is one entry and the archive is about the size of its parts (nothing doubled in memory or on the wire)', bytes.length < files.reduce((n, f) => n + f.data.length, 0) + 1024)
  const empty = await build([])
  check('an empty selection is still a well-formed archive (just the end record)', empty.length === 22 && empty.readUInt32LE(0) === 0x06054b50)
}

section('streaming: one file at a time')
{
  let produced = 0
  async function* lazy() {
    for (let i = 0; i < 3; i++) {
      produced++
      yield { name: `f${i}.bin`, data: new Uint8Array(10) }
    }
  }
  const reader = Z.zipStream(lazy()).getReader()
  await reader.read() // the first header
  check('reading the first chunk asks for only the first file (the rest are not downloaded yet)', produced === 1)
  await reader.cancel()
}

section('wiring')
{
  const cfg = read('next.config.mjs')
  const catchAll = cfg.indexOf("source: '/:path*'")
  const exception = cfg.indexOf("source: '/api/staff/payslips/:id/view'")
  check('the site still refuses framing everywhere', /X-Frame-Options', value: 'DENY'/.test(cfg) && /frame-ancestors 'none'/.test(cfg))
  check('the ONE exception is the viewer route, after the catch-all so it wins, and only for our own origin', exception > catchAll && /SAMEORIGIN/.test(cfg.slice(exception)) && /frame-ancestors 'self'/.test(cfg.slice(exception)) && (cfg.match(/SAMEORIGIN/g) ?? []).length === 1)
  const view = read('src/app/api/staff/payslips/[id]/view/route.ts')
  const zip = read('src/app/api/staff/payslips/zip/route.ts')
  const single = read('src/app/api/staff/payslips/[id]/route.ts')
  const access = read('src/lib/staff/payslips.ts')
  check('the viewer and the zip use the same reader rule: a signed-in Google person, never a code session', /me\.quick \|\| me\.via !== 'google'/.test(access) && /requirePayslipReader\(\)/.test(view) && /requirePayslipReader\(\)/.test(zip))
  check('an employee only ever reaches their own files, in both routes (owners anyone\'s)', /if \(!isOp\(me\)\) query = query\.eq\('staff_id', me\.id\)/.test(view) && /if \(!isOp\(me\)\) query = query\.eq\('staff_id', me\.id\)/.test(zip))
  check('the viewer shows only the three upload types inline and offers anything else as a download', /VIEWABLE_TYPES/.test(view) && /'attachment'/.test(view) && /application\/pdf/.test(access) && /image\/png/.test(access) && /image\/jpeg/.test(access))
  check('the viewer never hands out a storage link: the bytes come through the route', /\.download\(/.test(view) && !/createSignedUrl/.test(view) && !/createSignedUrl/.test(zip))
  check('the zip is capped by count and by total size, rate limited, and streamed', /MAX_ZIP_FILES/.test(zip) && /MAX_ZIP_BYTES/.test(zip) && /413/.test(zip) && /checkCredentialRateLimit/.test(zip) && /zipStream\(files\(\)\)/.test(zip))
  check('one id that is not yours fails the whole zip (nothing partial)', /data\.length !== ids\.length\) throw NotFound\(\)/.test(zip))
  check('the single download is unchanged (signed link, forced download)', /createSignedUrl\(slip\.object_path, 60, \{ download: slip\.file_name \}\)/.test(single))
  check('every response is private and uncacheable (same wrapper as the download)', /privateStaffRoute/.test(view) && /privateStaffRoute/.test(zip))
  const library = read('src/components/staff/PayslipLibrary.tsx')
  check('the viewer is a labelled modal dialog: closes on Escape, keeps Tab inside, gives focus back to what opened it', /role="dialog"/.test(library) && /aria-modal="true"/.test(library) && /aria-labelledby/.test(library) && /event\.key === 'Escape'/.test(library) && /event\.key === 'Tab'/.test(library) && /opener\.current\?\.focus\(\)/.test(library))
  check('it can be stepped through by buttons and by the arrow keys, newest first as the list is', /go\(index - 1\)/.test(library) && /go\(index \+ 1\)/.test(library) && /ArrowRight/.test(library) && /ArrowLeft/.test(library))
  check('every checkbox has a name, and the zip link only exists with a selection', (library.match(/aria-label=\{`בחירת תלוש/g) ?? []).length === 1 && /<span>בחירת הכל<\/span>/.test(library) && /chosen\.length > 0 \?/.test(library))
  check('the page behind does not scroll while the viewer is open, and it is rendered outside any animated wrapper', /document\.body\.style\.overflow = 'hidden'/.test(library) && /createPortal\(/.test(library))
  check('both the employee profile and the owner\'s employee file use it', /<PayslipLibrary payslips=\{records\.payslips\}/.test(read('src/components/staff/StaffRecordsView.tsx')))
  const css = read('src/components/staff/records.css')
  check('the viewer sits above the app header (z-index 320) and below toasts (1000)', (() => { const z = Number(/\.sr-viewer \{[^}]*z-index: (\d+)/.exec(css)?.[1]); return z > 325 && z < 1000 })())
  check('the viewer styles do not depend on the .staff-records scope it is portalled out of', !/\.sr-viewer[^{]*\{[^}]*var\(--sr-line\)/.test(css) && /\.sr-viewer \{[^}]*position: fixed/.test(css) && /prefers-reduced-motion[^}]*\.sr-viewer/.test(css))
  check('the content type travels with the list so the viewer knows a PDF from an image', /content_type/.test(read('src/lib/staff/records.ts')) && /content_type: string/.test(read('src/lib/staff/records-types.ts')))
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
