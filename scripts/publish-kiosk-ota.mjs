// Publishes the kiosk's over-the-air update files into public/kiosk-ota/ (see docs/SARCAFE_KIOSK_OTA.md).
//
//   node scripts/publish-kiosk-ota.mjs                 web bundle (runs at Vercel build time, as "prebuild")
//   node scripts/publish-kiosk-ota.mjs apk [--apk <file>] [--version-code N] [--version-name X] [--force]
//                                                      after a local build.ps1: copy the APK + write latest.json
//   (signing the web bundle: scripts/sign-kiosk-ota.mjs, run on the owner's PC; the kiosk applies only signed bundles)
//
// Web mode: runs scripts/assemble-kiosk-bundle.mjs <tmp> (the same assembly build.ps1 packs into the APK), normalises
// text line endings, hashes every file, and writes public/kiosk-ota/web/<version>/... plus
// public/kiosk-ota/web/manifest.json; only the current version is kept. The version is a content hash, so the same
// sources always give the same output. It NEVER fails the portal build: any problem is printed and the web folder is
// left out (the kiosks then keep what they run). --strict turns problems into exit code 1 (used by the checks).
// Options for tests: --out <kiosk-ota folder>, --assembler <script>, --strict, --quiet.
//
// The kiosk app (prototypes/sarcafe-kiosk-app/src/.../OtaRules.java) recomputes the version and the signature
// payload the same way; change both together.

import { execFileSync } from 'node:child_process'
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MAX_BUNDLE_BYTES = 15 * 1024 * 1024
export const MAX_FILE_BYTES = 8 * 1024 * 1024
export const MAX_FILES = 200
export const MAX_APK_BYTES = 30 * 1024 * 1024
/** The first APK that understands OTA. A bundle needing newer native code raises this (the kiosk waits for the APK). */
export const MIN_NATIVE_VERSION = 2

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_OUT = join(ROOT, 'public', 'kiosk-ota')
const DEFAULT_ASSEMBLER = join(ROOT, 'scripts', 'assemble-kiosk-bundle.mjs')
const DEFAULT_APK = 'C:\\Users\\Johnathan\\android-tools\\kiosk-build\\sarcafe-kiosk.apk' // build.ps1's $out
const TEXT_EXT = new Set(['html', 'htm', 'js', 'mjs', 'css', 'json', 'svg', 'txt'])

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** Flat, ASCII, no leading dot, no "..", at most 100 characters (OtaRules.isSafeName). */
export function isSafeName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 100 && name[0] !== '.'
    && !name.includes('..') && /^[A-Za-z0-9._-]+$/.test(name)
}

/** First 16 hex of SHA-256 over "path\nsha256\nsize\n" per file, sorted by path (OtaRules.computeVersion). */
export function computeVersion(files) {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return sha256(Buffer.from(sorted.map((f) => `${f.path}\n${f.sha256}\n${f.size}\n`).join(''), 'utf8')).slice(0, 16)
}

/** The bytes the optional signature covers (OtaRules.signaturePayload). */
export function signaturePayload(version, seq, minNativeVersion) {
  return Buffer.from(`sarcafe-kiosk-ota-v1\n${version}\n${seq}\n${minNativeVersion}\n`, 'utf8')
}

/** Problems with a file list, or null (OtaRules.checkEntries). */
export function checkEntries(files) {
  if (!files.length) return 'no files'
  if (files.length > MAX_FILES) return 'too many files'
  const seen = new Set()
  let total = 0
  for (const f of files) {
    if (!isSafeName(f.path)) return `unsafe name: ${JSON.stringify(f.path)}`
    if (seen.has(f.path.toLowerCase())) return `duplicate name: ${f.path}`
    seen.add(f.path.toLowerCase())
    if (f.size > MAX_FILE_BYTES) return `file too large: ${f.path}`
    total += f.size
  }
  if (total > MAX_BUNDLE_BYTES) return `bundle too large: ${total} bytes`
  if (!seen.has('index.html')) return 'no index.html'
  return null
}

function args(list) {
  const out = { _: [] }
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = list[i + 1]
      if (next === undefined || next.startsWith('--')) out[key] = true
      else { out[key] = next; i++ }
    } else out._.push(a)
  }
  return out
}

/** Runs the assembler into a fresh temp folder and returns the normalised file list (buffers included). */
export function assembleBundle(assembler = DEFAULT_ASSEMBLER) {
  if (!existsSync(assembler)) throw new Error(`assembler not found: ${relative(ROOT, assembler)} (the kiosk web bundle cannot be built yet)`)
  const tmp = mkdtempSync(join(tmpdir(), 'kiosk-ota-'))
  try {
    execFileSync(process.execPath, [assembler, tmp], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] })
    const files = []
    for (const name of readdirSync(tmp).sort()) {
      const full = join(tmp, name)
      if (statSync(full).isDirectory()) throw new Error(`the bundle must be flat; found the folder ${name}`)
      if (!isSafeName(name)) throw new Error(`unsafe file name in the bundle: ${JSON.stringify(name)}`)
      let data = readFileSync(full)
      const ext = name.toLowerCase().split('.').pop()
      // same bytes on Windows (CRLF checkouts) and on Vercel (LF), so the version and a signature agree everywhere
      if (TEXT_EXT.has(ext)) data = Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
      files.push({ path: name, sha256: sha256(data), size: data.length, data })
    }
    const problem = checkEntries(files)
    if (problem) throw new Error(problem)
    const text = files.filter((f) => TEXT_EXT.has(f.path.toLowerCase().split('.').pop())).map((f) => f.data.toString('utf8')).join('\n')
    if (!/KioskNative\s*\.\s*ready\s*\(|KioskNative\??\.ready/.test(text)) {
      throw new Error('no file calls KioskNative.ready(): every kiosk would roll this bundle back, so it is not published')
    }
    return files
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** The public key compiled into the app (OtaRules.PUBLIC_KEY_B64), or null while it is empty. */
export function appPublicKey() {
  const src = join(ROOT, 'prototypes', 'sarcafe-kiosk-app', 'src', 'il', 'co', 'sarcafe', 'kiosk', 'OtaRules.java')
  if (!existsSync(src)) return null
  const m = /PUBLIC_KEY_B64\s*=\s*"([A-Za-z0-9+/=]*)"/.exec(readFileSync(src, 'utf8'))
  return m && m[1] ? m[1] : null
}

/** SHA256withECDSA check with a base64 SPKI key and a base64 DER signature (as the app does). */
export function verifySignature(publicKeyB64, payload, signatureB64) {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' })
    return cryptoVerify('sha256', payload, key, Buffer.from(String(signatureB64), 'base64'))
  } catch {
    return false
  }
}

/** Writes <out>/web/<version>/* and <out>/web/manifest.json; removes every other version. Returns the manifest. */
export function writeWeb(files, out, { createdFrom = null, signatureFile = join(out, 'web-signature.json') } = {}) {
  const version = computeVersion(files)
  const manifest = {
    schema: 1,
    version,
    seq: 0,
    createdFrom,
    minNativeVersion: MIN_NATIVE_VERSION,
    totalBytes: files.reduce((n, f) => n + f.size, 0),
    files: [...files].sort((a, b) => (a.path < b.path ? -1 : 1)).map(({ path, sha256: h, size }) => ({ path, sha256: h, size })),
  }
  if (existsSync(signatureFile)) {
    const sig = JSON.parse(readFileSync(signatureFile, 'utf8'))
    if (sig.version === version && sig.minNativeVersion === MIN_NATIVE_VERSION && Number.isSafeInteger(sig.seq)) {
      manifest.seq = sig.seq
      manifest.signature = sig.signature
      const key = appPublicKey()
      if (key && !verifySignature(key, signaturePayload(version, sig.seq, MIN_NATIVE_VERSION), sig.signature)) {
        console.warn('kiosk-ota: web-signature.json does NOT verify against the key in OtaRules.java: the kiosks will ignore this bundle')
      }
    } else {
      console.warn(`kiosk-ota: web-signature.json is for ${sig.version}, the bundle is ${version}: published UNSIGNED; the kiosks ignore it until the owner runs "node scripts/sign-kiosk-ota.mjs" and pushes`)
    }
  } else {
    console.warn(`kiosk-ota: no web-signature.json: bundle ${version} published UNSIGNED; the kiosks ignore it until it is signed`)
  }
  const web = join(out, 'web')
  const staging = join(out, `.web-${process.pid}`)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(join(staging, version), { recursive: true })
  for (const f of files) writeFileSync(join(staging, version, f.path), f.data)
  writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  rmSync(web, { recursive: true, force: true })
  renameSync(staging, web)
  return manifest
}

function webMode(opts) {
  const out = resolve(opts.out || DEFAULT_OUT)
  const log = opts.quiet ? () => {} : (m) => console.log(m)
  try {
    const files = assembleBundle(opts.assembler ? resolve(opts.assembler) : DEFAULT_ASSEMBLER)
    const sha = process.env.VERCEL_GIT_COMMIT_SHA
    const manifest = writeWeb(files, out, { createdFrom: sha && /^[0-9a-f]{7,40}$/.test(sha) ? sha : null })
    log(`kiosk-ota: web bundle ${manifest.version} (${manifest.files.length} files, ${Math.round(manifest.totalBytes / 1024)} KB${manifest.signature ? ', signed' : ''}) -> ${relative(ROOT, join(out, 'web'))}`)
  } catch (e) {
    rmSync(join(out, 'web'), { recursive: true, force: true }) // nothing half-made is ever served
    console.warn(`kiosk-ota: web bundle NOT published: ${e.message}`)
    if (opts.strict) process.exit(1)
  }
}

function apkMode(opts) {
  const apk = resolve(opts.apk || DEFAULT_APK)
  if (!existsSync(apk)) throw new Error(`APK not found: ${apk} (run build.ps1 first)`)
  const data = readFileSync(apk)
  if (data.length > MAX_APK_BYTES) throw new Error('APK larger than 30 MB')
  let code = opts['version-code'] ? Number(opts['version-code']) : null
  let name = typeof opts['version-name'] === 'string' ? opts['version-name'] : null
  const aapt2 = join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'build-tools', '36.1.0', 'aapt2.exe')
  if (existsSync(aapt2) && !opts['no-aapt']) {
    const badging = execFileSync(aapt2, ['dump', 'badging', apk], { encoding: 'utf8' })
    const m = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/.exec(badging)
    if (!m || m[1] !== 'il.co.sarcafe.kiosk') throw new Error('not the Sarcafe kiosk APK')
    if (code !== null && code !== Number(m[2])) throw new Error(`--version-code ${code} but the APK says ${m[2]}`)
    code = Number(m[2])
    name = name ?? m[3]
  }
  if (!Number.isSafeInteger(code) || code < 1) throw new Error('version code unknown: pass --version-code (aapt2 not found)')
  const dir = join(resolve(opts.out || DEFAULT_OUT), 'apk')
  const latestFile = join(dir, 'latest.json')
  if (existsSync(latestFile) && !opts.force) {
    const prev = JSON.parse(readFileSync(latestFile, 'utf8'))
    if (prev.versionCode >= code) throw new Error(`latest.json already has versionCode ${prev.versionCode}; bump the version code in build.ps1 (or --force)`)
  }
  mkdirSync(dir, { recursive: true })
  for (const f of readdirSync(dir)) if (f.endsWith('.apk')) rmSync(join(dir, f))
  const file = `sarcafe-kiosk-${code}.apk`
  copyFileSync(apk, join(dir, file))
  const latest = { versionCode: code, versionName: name || String(code), url: file, sha256: sha256(data), size: data.length }
  writeFileSync(latestFile, `${JSON.stringify(latest, null, 2)}\n`)
  console.log(`kiosk-ota: APK ${latest.versionName} (${code}), ${Math.round(data.length / 1024)} KB -> public/kiosk-ota/apk/${file}; commit public/kiosk-ota/apk/ and push`)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const opts = args(process.argv.slice(2))
  const mode = opts._[0] || 'web'
  try {
    if (mode === 'web') webMode(opts)
    else if (mode === 'apk') apkMode(opts)
    else throw new Error(`unknown mode ${mode}`)
  } catch (e) {
    console.error(`kiosk-ota: ${e.message}`)
    process.exit(1)
  }
}
