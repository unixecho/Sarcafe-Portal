// Signs the kiosk's web bundle on the owner's PC (security review S-27; see docs/SARCAFE_KIOSK_OTA.md).
// The kiosk applies a web update ONLY when its manifest carries this signature; the private key never leaves the PC.
//
//   node scripts/sign-kiosk-ota.mjs keygen     once: creates C:\Users\Johnathan\android-tools\sarcafe-kiosk-ota.pem
//                                              and prints the PUBLIC key to paste into OtaRules.PUBLIC_KEY_B64
//   node scripts/sign-kiosk-ota.mjs            every kiosk page change: builds the bundle exactly as Vercel will,
//                                              signs it, writes public/kiosk-ota/web-signature.json; commit + push it
//   node scripts/sign-kiosk-ota.mjs status     compares the live manifest with this checkout (signed? same version?)
//
// Options: --key <pem> (default above; must be outside the repo), --seq N (default: now, in seconds),
// --url <live manifest URL>, --out <kiosk-ota folder> and --assembler <script> (tests only).

import { execFileSync } from 'node:child_process'
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MIN_NATIVE_VERSION, appPublicKey, assembleBundle, computeVersion, signaturePayload, verifySignature } from './publish-kiosk-ota.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_KEY = 'C:\\Users\\Johnathan\\android-tools\\sarcafe-kiosk-ota.pem'
const LIVE = 'https://sarcafe-portal.vercel.app/kiosk-ota/web/manifest.json'
// what the bundle is assembled from (scripts/assemble-kiosk-bundle.mjs); Vercel builds what is COMMITTED
const INPUTS = ['prototypes/sarcafe-kiosk', 'prototypes/sarcafe-kiosk-app/overrides', 'prototypes/sarcafe-kiosk-app/fonts',
  'public/sarcafe-logo.png', 'public/backdrops', 'scripts/assemble-kiosk-bundle.mjs']

function args(list) {
  const out = { _: [] }
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    if (a.startsWith('--')) {
      const next = list[i + 1]
      if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true
      else { out[a.slice(2)] = next; i++ }
    } else out._.push(a)
  }
  return out
}

export function insideRepo(p) {
  const rel = relative(ROOT, resolve(p))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function keygen(outPath) {
  if (insideRepo(outPath)) throw new Error('the private key must live OUTSIDE the repo')
  if (existsSync(outPath)) throw new Error(`${outPath} already exists; refusing to replace a key the tablet may already trust`)
  mkdirSync(dirname(outPath), { recursive: true })
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  writeFileSync(outPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
}

/** Assembles, signs and writes <out>/web-signature.json. Returns the record. */
export function signBundle({ keyPath, seq = Math.floor(Date.now() / 1000), out = join(ROOT, 'public', 'kiosk-ota'), assembler } = {}) {
  if (insideRepo(keyPath)) throw new Error('the private key must live OUTSIDE the repo')
  if (!existsSync(keyPath)) throw new Error(`no key at ${keyPath}; run "node scripts/sign-kiosk-ota.mjs keygen" once`)
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error('--seq must be a positive integer')
  const files = assembler ? assembleBundle(assembler) : assembleBundle()
  const version = computeVersion(files)
  const key = createPrivateKey(readFileSync(keyPath))
  const publicKey = createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64')
  const signature = cryptoSign('sha256', signaturePayload(version, seq, MIN_NATIVE_VERSION), key).toString('base64')
  const record = { version, seq, minNativeVersion: MIN_NATIVE_VERSION, signature, publicKey }
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'web-signature.json'), `${JSON.stringify(record, null, 2)}\n`)
  return record
}

function dirtyInputs() {
  try {
    return execFileSync('git', ['status', '--porcelain', '--', ...INPUTS], { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

async function status(opts) {
  const url = typeof opts.url === 'string' ? opts.url : LIVE
  const res = await fetch(url, { redirect: 'error', cache: 'no-store' })
  if (res.status === 404) return console.log(`live: no manifest at ${url} (not published: is the prebuild line in package.json and the prototype committed?)`)
  const m = await res.json()
  const key = appPublicKey()
  const signed = !!m.signature && !!key && verifySignature(key, signaturePayload(m.version, m.seq, m.minNativeVersion), m.signature)
  console.log(`live:  ${m.version}  seq ${m.seq}  ${signed ? 'SIGNED (the kiosks will take it)' : m.signature ? 'signature does NOT verify' : 'UNSIGNED (the kiosks ignore it)'}${m.createdFrom ? `  from ${m.createdFrom.slice(0, 7)}` : ''}`)
  if (!key) console.log('note:  OtaRules.PUBLIC_KEY_B64 is empty in this checkout')
  try {
    const local = computeVersion(assembleBundle())
    console.log(`local: ${local}${local === m.version ? '  (same as live)' : '  (differs from live: push, or sign and push)'}`)
  } catch (e) {
    console.log(`local: cannot assemble (${e.message})`)
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const opts = args(process.argv.slice(2))
  const mode = opts._[0] || 'sign'
  const keyPath = resolve(typeof opts.key === 'string' ? opts.key : DEFAULT_KEY)
  try {
    if (mode === 'keygen') {
      const pub = keygen(keyPath)
      console.log(`private key: ${keyPath}  (keep it on this PC; back it up offline; never commit or upload it)`)
      console.log('public key for OtaRules.PUBLIC_KEY_B64 (then rebuild the APK):')
      console.log(pub)
    } else if (mode === 'sign') {
      const dirty = dirtyInputs()
      if (dirty) console.warn(`warning: uncommitted changes in the bundle inputs; Vercel builds the committed files, so commit them in the same push:\n${dirty}`)
      const r = signBundle({
        keyPath,
        seq: opts.seq ? Number(opts.seq) : undefined,
        out: typeof opts.out === 'string' ? resolve(opts.out) : undefined,
        assembler: typeof opts.assembler === 'string' ? resolve(opts.assembler) : undefined,
      })
      const appKey = appPublicKey()
      if (!appKey) console.warn('warning: OtaRules.PUBLIC_KEY_B64 is empty: no kiosk will accept anything until it is set and the APK rebuilt')
      else if (appKey !== r.publicKey) console.warn('warning: this key is NOT the one compiled into the app (OtaRules.PUBLIC_KEY_B64)')
      console.log(`signed web bundle ${r.version} (seq ${r.seq}) -> public/kiosk-ota/web-signature.json; commit it with the change and push`)
    } else if (mode === 'status') {
      await status(opts)
    } else {
      throw new Error(`unknown mode ${mode}`)
    }
  } catch (e) {
    console.error(`sign-kiosk-ota: ${e.message}`)
    process.exit(1)
  }
}
