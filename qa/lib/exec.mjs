// Child processes for the QA suite, the same on Windows and Linux.
//
// Nothing here goes through a shell: every command is an executable plus an argument array. That is why `npm` and `npx` are never
// spawned by name: on Windows they are `npm.cmd` / `npx.cmd`, which Node can only start through a shell (the suite died there with
// `spawn npm ENOENT`). Instead npm's own CLI script and a package's own bin script are run with THIS Node: npm() and packageBin().
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const WIN = process.platform === 'win32'
/** This Node, by its full path: never whatever `node` happens to be first on the PATH. */
export const NODE = process.execPath

// Environment names a child may inherit when it must not see the developer's own settings (the test app, see qa/live/app.mjs): what
// an operating system and Node need to start a program, and nothing that could name a real project, key or provider.
const SYSTEM_ENV = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'USERNAME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM', 'CI', 'PLAYWRIGHT_BROWSERS_PATH', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME'])
/** The operating system's part of this process's environment (see SYSTEM_ENV); names are compared without case, as Windows does. */
export function systemEnv(source = process.env) {
  const out = {}
  for (const [k, v] of Object.entries(source)) if (v !== undefined && SYSTEM_ENV.has(k.toUpperCase())) out[k] = v
  return out
}
const childEnv = (env, cleanEnv) => ({ ...(cleanEnv ? systemEnv() : process.env), ...env })

// ---- processes this suite started and that are still running: ended when the suite ends, whatever the reason
const owned = new Set()
const running = (child) => child.pid !== undefined && child.exitCode === null && child.signalCode === null

/** Ends a process this suite started, with everything it started in turn. Never touches a process the suite did not start. */
export function killTree(child) {
  if (!child || !owned.has(child) || !running(child)) return
  if (WIN) {
    // Windows has no process groups to signal: taskkill /T walks the tree from OUR child's pid (still running, checked above).
    const taskkill = path.join(process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'taskkill.exe')
    const r = spawnSync(taskkill, ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    if (r.status !== 0) { try { child.kill('SIGKILL') } catch { /* gone */ } }
    return
  }
  // a child started in its own group (start()) is ended with its group; any other is ended alone, as before
  if (child.__group) { try { process.kill(-child.pid, 'SIGKILL'); return } catch { /* fall through */ } }
  try { child.kill('SIGKILL') } catch { /* gone */ }
}
const adopt = (child, group = false) => {
  child.__group = group
  owned.add(child)
  child.once('close', () => owned.delete(child))
  child.once('error', () => owned.delete(child))
  return child
}
const endAll = () => { for (const child of [...owned]) killTree(child) }
process.on('exit', endAll)
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) process.on(signal, () => { endAll(); process.exit(code) })

/** Runs a command with a time limit. Resolves { code, output, ms } (output = the last 6000 characters of stdout+stderr); never rejects. */
export function run(cmd, args, { cwd, env, cleanEnv = false, timeout = 600_000, onLine } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let child
    try { child = adopt(spawn(cmd, args, { cwd, env: childEnv(env, cleanEnv), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })) } catch (err) { resolve({ code: 1, output: String(err), ms: 0 }); return }
    let output = ''
    let done = false
    const finish = (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, output, ms: Date.now() - t0 }) }
    const take = (chunk) => {
      const s = chunk.toString()
      output = (output + s).slice(-6000)
      if (onLine) s.split('\n').filter(Boolean).forEach(onLine)
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    const timer = setTimeout(() => { output += `\n[qa] killed after ${timeout} ms`; killTree(child) }, timeout)
    child.on('close', (code) => finish(code ?? 1))
    child.on('error', (err) => { output = (output + String(err)).slice(-6000); finish(1) })
  })
}

/**
 * Starts a long-running process; returns { child, ready, logs(), stop() }. `ready` resolves when `readyRe` is printed and rejects when
 * the process cannot start, exits first, or says nothing in time. stop() ends it with everything it started and resolves once it is gone.
 */
export function start(cmd, args, { cwd, env, cleanEnv = false, readyRe, timeout = 120_000 } = {}) {
  // POSIX: its own process group, so stop() also ends what it started. Windows: taskkill /T does that (a detached child would open a console window).
  const child = adopt(spawn(cmd, args, { cwd, env: childEnv(env, cleanEnv), stdio: ['ignore', 'pipe', 'pipe'], detached: !WIN, windowsHide: true }), !WIN)
  let logs = ''
  const gone = new Promise((resolve) => { child.once('close', resolve); child.once('error', resolve) })
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`not ready after ${timeout} ms:\n${logs.slice(-2000)}`)), timeout)
    const on = (chunk) => { logs = (logs + chunk.toString()).slice(-20000); if (readyRe?.test(logs)) { clearTimeout(timer); resolve() } }
    child.stdout.on('data', on)
    child.stderr.on('data', on)
    child.on('error', (err) => { clearTimeout(timer); reject(new Error(`could not start: ${err.message}`)) })
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`exited with ${code}:\n${logs.slice(-2000)}`)) })
  })
  ready.catch(() => {}) // a caller that stops before waiting must not leave an unhandled rejection behind
  const stop = async () => {
    killTree(child)
    await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 10_000))])
  }
  return { child, ready, logs: () => logs, stop }
}

// ---- npm and package tools, without a shell

let npmCliPath
/** npm's own CLI script (npm-cli.js) of the npm that belongs to this Node, or null. */
export function npmCli() {
  if (npmCliPath !== undefined) return npmCliPath
  const dir = path.dirname(NODE)
  const candidates = [
    // set by npm itself when the suite runs as `npm run qa`; another package manager's script is not taken
    /npm-cli\.js$/.test(process.env.npm_execpath ?? '') ? process.env.npm_execpath : null,
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Windows: next to node.exe
    path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Linux / macOS: <prefix>/lib
  ]
  npmCliPath = candidates.find((p) => p && fs.existsSync(p)) ?? null
  return npmCliPath
}

/** `npm <args>` (e.g. ['run', '-s', 'check:schedule']) as { code, output, ms }; same options as run(). */
export function npm(args, opts = {}) {
  const cli = npmCli()
  if (cli) return run(NODE, [cli, ...args], opts)
  // POSIX only: `npm` there is a real executable on the PATH. On Windows it is npm.cmd, which needs a shell: say so instead.
  if (!WIN) return run('npm', args, opts)
  return Promise.resolve({ code: 1, output: `npm's CLI script (npm-cli.js) was not found next to ${NODE}: run the suite with \`npm run qa\`, or install npm with this Node`, ms: 0 })
}

/** The script a package installs as a command (its package.json "bin"), e.g. packageBin(root, 'typescript', 'tsc'). Run it with NODE. */
export function packageBin(root, pkg, name = pkg) {
  const dir = path.join(root, 'node_modules', pkg)
  let meta
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) } catch { throw new Error(`${pkg} is not installed in ${path.join(root, 'node_modules')} (run npm ci)`) }
  const rel = typeof meta.bin === 'string' ? meta.bin : meta.bin?.[name]
  if (!rel) throw new Error(`${pkg} has no command named ${name}`)
  const file = path.join(dir, rel)
  if (!fs.existsSync(file)) throw new Error(`${pkg}'s ${name} command is missing: ${file}`)
  return file
}

/** import() of a module by its file path. A Windows path ("C:\…") is not a module address; a file: URL is, everywhere. */
export const importFile = (file) => import(pathToFileURL(path.resolve(file)).href)
