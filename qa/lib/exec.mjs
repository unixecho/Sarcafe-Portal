import { spawn } from 'node:child_process'

/** Runs a command with a time limit. Resolves { code, output, ms } (output = the last 6000 characters of stdout+stderr). */
export function run(cmd, args, { cwd, env, timeout = 600_000, onLine } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const take = (chunk) => {
      const s = chunk.toString()
      output = (output + s).slice(-6000)
      if (onLine) s.split('\n').filter(Boolean).forEach(onLine)
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    const timer = setTimeout(() => { output += `\n[qa] killed after ${timeout} ms`; child.kill('SIGKILL') }, timeout)
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, output, ms: Date.now() - t0 }) })
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: 1, output: String(err), ms: Date.now() - t0 }) })
  })
}

/** Starts a long-running process; returns { child, ready: Promise, logs() , stop() }. `ready` resolves when `readyRe` is printed. */
export function start(cmd, args, { cwd, env, readyRe, timeout = 120_000 } = {}) {
  // its own process group, so stop() also ends what npx started (next-server)
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let logs = ''
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`not ready after ${timeout} ms:\n${logs.slice(-2000)}`)), timeout)
    const on = (chunk) => { logs = (logs + chunk.toString()).slice(-20000); if (readyRe?.test(logs)) { clearTimeout(timer); resolve() } }
    child.stdout.on('data', on)
    child.stderr.on('data', on)
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`exited with ${code}:\n${logs.slice(-2000)}`)) })
  })
  return { child, ready, logs: () => logs, stop: () => { try { process.kill(-child.pid, 'SIGTERM') } catch { try { child.kill('SIGTERM') } catch { /* gone */ } } } }
}
