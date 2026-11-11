// The scratch copy the test app is built in (qa/.work/app): what goes into it, how it reaches the installed packages, when an old
// build may be kept, and how it is removed. Nothing here writes or deletes outside qa/.work of the checkout under test.
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createHash } from 'node:crypto'

// What a production build of the app reads, and nothing else. A whole-folder copy also took whatever else sat in the checkout: a
// developer's .env.local (real keys, which Next would load into the test app), private notes, other tools' folders.
// A new top-level file or folder the build needs is added HERE, on purpose.
export const SOURCE_FILES = ['package.json', 'package-lock.json', 'next.config.mjs', 'tsconfig.json', 'postcss.config.mjs', 'tailwind.config.ts']
export const SOURCE_DIRS = ['src', 'public']
const NEVER = (name) => name === 'node_modules' || name === '.next' || name === '.git' || /^\.env(\.|$)/i.test(name)

function walk(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (NEVER(e.name)) continue
    const p = path.join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) walk(p, r, out)
    else if (e.isFile()) out.push(r)
  }
  return out
}

/** The files of `root` that go into the copy, as sorted relative paths with forward slashes. */
export function sourceFiles(root) {
  const out = []
  for (const f of SOURCE_FILES) if (fs.existsSync(path.join(root, f))) out.push(f)
  for (const d of SOURCE_DIRS) if (fs.existsSync(path.join(root, d))) walk(path.join(root, d), d, out)
  return out.sort()
}

/** A fingerprint of the source the copy was made from: every file's path, size and content. Any edit, new file or removal changes it. */
export function sourceFingerprint(root) {
  const hash = createHash('sha256')
  for (const rel of sourceFiles(root)) {
    const file = path.join(root, rel)
    hash.update(`${rel}\0${fs.statSync(file).size}\0`)
    hash.update(fs.readFileSync(file))
  }
  // the installed packages are part of what was built
  try { hash.update(fs.readFileSync(path.join(root, 'node_modules/.package-lock.json'))) } catch { hash.update('no-installed-lock') }
  return hash.digest('hex')
}

export function copySource(root, work) {
  const files = sourceFiles(root)
  if (!files.includes('package.json') || !files.some((f) => f.startsWith('src/'))) throw new Error(`${root} does not look like the app (no package.json or src/)`)
  for (const rel of files) {
    const to = path.join(work, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(path.join(root, rel), to)
  }
  return files.length
}

/** True when `target` is `parent` or inside it (after resolving `..`; both must be absolute). */
export function isInside(parent, target) {
  const rel = path.relative(path.resolve(parent), path.resolve(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** The only place the suite builds in. A computed path anywhere else is refused before anything is written or removed. */
export function workDir(root, name = 'app') {
  const base = path.join(path.resolve(root), 'qa', '.work')
  const work = path.join(base, name)
  if (!isInside(base, work) || work === base) throw new Error(`refusing a work folder outside ${base}: ${work}`)
  return work
}

/**
 * Removes a scratch copy. Only a folder inside <root>/qa/.work; a link in it (node_modules) is removed as a LINK first, so the
 * installed packages it points at are never emptied through it.
 */
export function removeScratch(root, work) {
  const base = path.join(path.resolve(root), 'qa', '.work')
  if (!isInside(base, work) || path.resolve(work) === base) throw new Error(`refusing to remove a folder outside ${base}: ${work}`)
  let stat
  try { stat = fs.lstatSync(work) } catch { return }
  if (stat.isSymbolicLink()) throw new Error(`refusing to remove ${work}: it is a link, not the suite's own folder`)
  unlinkDependencies(work)
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

function unlinkDependencies(work) {
  const link = path.join(work, 'node_modules')
  let stat
  try { stat = fs.lstatSync(link) } catch { return }
  if (!stat.isSymbolicLink()) return // a real folder inside the scratch copy: removed with it
  // a directory link is removed with rmdir on Windows (junction or symlink) and unlink elsewhere; neither follows it
  try { fs.unlinkSync(link) } catch { fs.rmdirSync(link) }
  if (fs.existsSync(link)) throw new Error(`could not remove the link ${link}`)
}

/**
 * Gives the copy the checkout's installed packages without copying them. Windows: a junction, which needs no administrator rights
 * (a directory symlink does, unless Developer Mode is on: EPERM). Elsewhere: the usual symlink.
 */
export function linkDependencies(root, work) {
  const target = path.join(path.resolve(root), 'node_modules')
  if (!fs.existsSync(path.join(target, 'next', 'package.json'))) throw new Error(`the packages are not installed in ${target} (run npm ci)`)
  unlinkDependencies(work)
  const link = path.join(work, 'node_modules')
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  if (!fs.existsSync(path.join(link, 'next', 'package.json'))) throw new Error(`the link ${link} does not reach the installed packages`)
}

/** Resolves when nothing is listening on 127.0.0.1:<port>; rejects with a plain reason when something is (an earlier run's server?). */
export function assertPortFree(port, what) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', (err) => reject(new Error(`port ${port} (${what}) is not free: ${err.code}. Is a server from an earlier run still alive?`)))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()))
  })
}
