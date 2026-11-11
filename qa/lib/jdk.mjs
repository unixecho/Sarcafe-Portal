// Where this machine's JDK is. The kiosk app's plain-Java parts are compiled and run by the suite (qa/kiosk/static.mjs) and by
// check:kiosk-ota, which reads JAVA_HOME. A JDK that is installed must be found: "no JDK, skipped" on a machine that has one is a
// false skip (it happened on Windows, where the compiler is javac.exe and nothing looked for that name).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const EXE = process.platform === 'win32' ? '.exe' : ''
const tool = (home, name) => path.join(home, 'bin', name + EXE)
const isJdk = (home) => !!home && fs.existsSync(tool(home, 'javac')) && fs.existsSync(tool(home, 'java'))

/** The Java home a `java` launcher really runs (asked from the launcher itself: a PATH entry can be a shim outside any JDK). */
function homeOf(java) {
  const r = spawnSync(java, ['-XshowSettings:properties', '-version'], { encoding: 'utf8', timeout: 20_000, windowsHide: true })
  const m = `${r.stderr ?? ''}\n${r.stdout ?? ''}`.match(/^\s*java\.home\s*=\s*(.+?)\s*$/m)
  return m ? m[1] : null
}

function search(env) {
  // 1. JAVA_HOME, when it really holds a compiler
  if (isJdk(env.JAVA_HOME)) return env.JAVA_HOME
  // 2. javac on the PATH: its folder's parent when that is a JDK, else whatever JDK its launcher runs
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)
  if (process.platform !== 'win32') dirs.push('/usr/bin')
  for (const dir of dirs) {
    const javac = path.join(dir, 'javac' + EXE)
    if (!fs.existsSync(javac)) continue
    let real = javac
    try { real = fs.realpathSync(javac) } catch { /* keep */ }
    const home = path.dirname(path.dirname(real))
    if (isJdk(home)) return home
    const java = path.join(dir, 'java' + EXE)
    const asked = fs.existsSync(java) ? homeOf(java) : null
    if (isJdk(asked)) return asked
  }
  return null
}

let found
/** { home, javac, java, version } of this machine's JDK, or null when there is none. Looked up once per run. */
export function findJdk(env = process.env) {
  if (env === process.env && found !== undefined) return found
  const home = search(env)
  let jdk = null
  if (home) {
    const v = spawnSync(tool(home, 'javac'), ['-version'], { encoding: 'utf8', timeout: 20_000, windowsHide: true })
    jdk = { home, javac: tool(home, 'javac'), java: tool(home, 'java'), version: `${v.stdout ?? ''}${v.stderr ?? ''}`.trim().split('\n')[0] || 'unknown' }
  }
  if (env === process.env) found = jdk
  return jdk
}
