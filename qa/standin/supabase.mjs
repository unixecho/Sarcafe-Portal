// A stand-in Supabase for the QA suite: an in-memory PostgREST + the bits of GoTrue the app uses + the RPCs the tested features need,
// with fault injection for the survival and recovery tests. It never talks to the real project. Part of the QA blueprint
// (docs/QA_BLUEPRINT.md): copy it to another project and give it that project's seed.
//
//   const sb = await startStandin({ port, seed })   →  { url, db, close() }
//   control (HTTP, test only):  POST /__qa/fault  { mode: 'none'|'down'|'slow'|'error', ms?, tables? }
//                               POST /__qa/missing { tables: [...], functions: [...] }   (a migration that is not applied)
//                               GET  /__qa/db/<table>        POST /__qa/reset
import http from 'node:http'
import { randomUUID, createHash, generateKeyPairSync, sign as signBytes } from 'node:crypto'

// A test RSA key standing in for GitHub Actions' token signer (lib/qa/auth.ts; the app is pointed at it with QA_OIDC_ISSUER): the
// stand-in serves its public half at /.well-known/jwks and the tests sign tokens with signToken(). Never used outside the suite.
const OIDC = generateKeyPairSync('rsa', { modulusLength: 2048 })
const OIDC_KID = 'qa-test-key'
/** A GitHub-style OIDC token (RS256) with `claims`, signed by the stand-in's key (or `{ forge: true }`: by a different key). */
export function signToken(claims, { forge = false } = {}) {
  const key = forge ? generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey : OIDC.privateKey
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = `${enc({ alg: 'RS256', typ: 'JWT', kid: OIDC_KID })}.${enc(claims)}`
  return `${head}.${signBytes('RSA-SHA256', Buffer.from(head), key).toString('base64url')}`
}

const json = (res, status, body, headers = {}) => {
  const text = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers })
  res.end(text)
}

// ── PostgREST filter parsing ─────────────────────────────────────────────────────────────────────────────────────────────
function splitTop(s, sep = ',') {
  const out = []; let depth = 0; let quote = false; let cur = ''
  for (const ch of s) {
    if (ch === '"') quote = !quote
    if (!quote && ch === '(') depth++
    if (!quote && ch === ')') depth--
    if (!quote && depth === 0 && ch === sep) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}
const unquote = (v) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v)
function parseValueList(v) { return splitTop(v.replace(/^\(|\)$/g, '')).map((x) => unquote(x.trim())) }

function cmp(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1
  if (b === null || b === undefined) return 1
  const na = Number(a); const nb = Number(b)
  if (typeof a !== 'boolean' && a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb) && !/^\d{4}-/.test(String(a))) return na - nb
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}
const eqv = (a, b) => (a === null || a === undefined ? b === 'null' : typeof a === 'boolean' ? String(a) === b : String(a) === b)
function like(value, pattern, ci) {
  const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*').replace(/_/g, '.') + '$', ci ? 'i' : '')
  return re.test(String(value ?? ''))
}
function evalCond(row, col, expr) {
  let neg = false
  if (expr.startsWith('not.')) { neg = true; expr = expr.slice(4) }
  const dot = expr.indexOf('.')
  const op = dot < 0 ? expr : expr.slice(0, dot)
  const val = dot < 0 ? '' : expr.slice(dot + 1)
  const v = col.includes('->') ? jsonPath(row, col) : row[col]
  let r
  switch (op) {
    case 'eq': r = eqv(v, unquote(val)); break
    case 'neq': r = !eqv(v, unquote(val)); break
    case 'gt': r = cmp(v, val) > 0; break
    case 'gte': r = cmp(v, val) >= 0; break
    case 'lt': r = cmp(v, val) < 0; break
    case 'lte': r = cmp(v, val) <= 0; break
    case 'like': r = like(v, val, false); break
    case 'ilike': r = like(v, val, true); break
    case 'is': r = val === 'null' ? v === null || v === undefined : val === 'true' ? v === true : val === 'false' ? v === false : false; break
    case 'in': r = parseValueList(val).some((x) => eqv(v, x)); break
    case 'cs': { const want = val.startsWith('{') ? val.slice(1, -1).split(',').map(unquote) : JSON.parse(val); r = Array.isArray(v) && [].concat(want).every((w) => v.map(String).includes(String(w))); break }
    default: r = true
  }
  return neg ? !r : r
}
function jsonPath(row, col) {
  const parts = col.split(/->>?/)
  let v = row[parts[0]]
  for (const p of parts.slice(1)) v = v == null ? null : v[p.replace(/'/g, '')]
  return v
}
function evalLogic(row, kind, inner) {
  const parts = splitTop(inner.replace(/^\(|\)$/g, ''))
  const results = parts.map((p) => {
    const m = p.match(/^(and|or)\((.*)\)$/)
    if (m) return evalLogic(row, m[1], `(${m[2]})`)
    const not = p.startsWith('not.') && /^not\.(and|or)\(/.test(p)
    if (not) { const mm = p.slice(4).match(/^(and|or)\((.*)\)$/); return !evalLogic(row, mm[1], `(${mm[2]})`) }
    const dot = p.indexOf('.')
    return evalCond(row, p.slice(0, dot), p.slice(dot + 1))
  })
  return kind === 'or' ? results.some(Boolean) : results.every(Boolean)
}
function applyFilters(rows, params) {
  return rows.filter((row) => {
    for (const [key, value] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue
      if (key === 'or' || key === 'and') { if (!evalLogic(row, key, value)) return false; continue }
      if (!evalCond(row, key, value)) return false
    }
    return true
  })
}
function applyOrder(rows, order) {
  if (!order) return rows
  const keys = splitTop(order).map((o) => { const [col, dir = 'asc'] = o.split('.'); return { col, desc: dir === 'desc' } })
  return [...rows].sort((a, b) => { for (const k of keys) { const c = cmp(a[k.col], b[k.col]); if (c) return k.desc ? -c : c } return 0 })
}
function project(rows, select) {
  if (!select || select === '*') return rows.map((r) => ({ ...r }))
  const cols = splitTop(select).map((c) => c.trim()).filter(Boolean)
  return rows.map((row) => {
    const out = {}
    for (const c of cols) {
      if (c === '*') { Object.assign(out, row); continue }
      const embedded = c.match(/^([\w]+)(?::([\w]+))?(?:!\w+)?\((.*)\)$/)
      if (embedded) { out[embedded[1]] = null; continue }
      const [left, right] = c.includes(':') ? c.split(':') : [c, c]
      const src = (right ?? left).replace(/::\w+$/, '')
      out[c.includes(':') ? left : src.replace(/->>?.*/, '')] = src.includes('->') ? jsonPath(row, src) : row[src]
    }
    return out
  })
}

// ── the server ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function startStandin({ port = 0, seed = () => ({}), keys = {} } = {}) {
  const state = { db: {}, tokens: new Map(), limits: new Map(), fault: { mode: 'none' }, missingTables: new Set(), missingFns: new Set(), requests: 0, byPath: new Map() }
  const reset = () => { state.db = structuredClone(seed()); state.tokens = new Map(Object.entries(state.db.__tokens ?? {})); delete state.db.__tokens; state.limits.clear(); state.fault = { mode: 'none' }; state.missingTables = new Set(state.db.__missingTables ?? []); delete state.db.__missingTables; state.missingFns = new Set() }
  reset()
  const table = (name) => (state.db[name] ??= [])
  const uniques = { staff_tool_usage: [['staff_id', 'tool_id']], staff_messages: [['id']], schedule_members: [['branch_id', 'staff_id']], staff_push_subscriptions: [['endpoint']], qa_digests: [['day']], kiosk_pin_resets: [['device_id']], kiosk_devices: [['id'], ['slug']], ...keys }

  const RPC = {
    check_rate_limit({ p_key, p_max, p_window_seconds }) {
      const now = Date.now(); const list = (state.limits.get(p_key) ?? []).filter((t) => now - t < p_window_seconds * 1000)
      if (list.length >= p_max) { state.limits.set(p_key, list); return false }
      list.push(now); state.limits.set(p_key, list); return true
    },
    staff_tool_usage_record({ p_staff_id, p_tool_id, p_query }) {
      if (!/^[a-z0-9-]{1,40}$/.test(p_tool_id ?? '')) throw Object.assign(new Error('invalid tool usage'), { code: '22023' })
      const rows = table('staff_tool_usage'); const hit = rows.find((r) => r.staff_id === p_staff_id && r.tool_id === p_tool_id)
      if (hit) { hit.uses = Math.min(100000, hit.uses + 1); hit.last_used_at = new Date().toISOString() } else rows.push({ staff_id: p_staff_id, tool_id: p_tool_id, uses: 1, last_used_at: new Date().toISOString() })
      const q = (p_query ?? '').trim()
      if (q.length >= 2 && q.length <= 60) {
        const s = table('staff_tool_searches'); state.db.staff_tool_searches = s.filter((r) => !(r.staff_id === p_staff_id && r.query.toLowerCase() === q.toLowerCase()))
        state.db.staff_tool_searches.push({ id: Date.now() + Math.random(), staff_id: p_staff_id, query: q, searched_at: new Date().toISOString() })
        const mine = state.db.staff_tool_searches.filter((r) => r.staff_id === p_staff_id).sort((a, b) => b.searched_at.localeCompare(a.searched_at)).slice(0, 5).map((r) => r.id)
        state.db.staff_tool_searches = state.db.staff_tool_searches.filter((r) => r.staff_id !== p_staff_id || mine.includes(r.id))
      }
      return null
    },
    staff_tool_usage_merge({ p_staff_id, p_usage }) {
      const rows = table('staff_tool_usage')
      for (const [id, u] of Object.entries(p_usage ?? {}).slice(0, 60)) {
        if (!/^[a-z0-9-]{1,40}$/.test(id)) continue
        const n = Math.min(100000, Math.max(0, Math.round(u.n))); if (n < 1) continue
        const at = new Date(Math.min(Number(u.t) || Date.now(), Date.now())).toISOString()
        const hit = rows.find((r) => r.staff_id === p_staff_id && r.tool_id === id)
        if (hit) { hit.uses = Math.max(hit.uses, n); hit.last_used_at = hit.last_used_at > at ? hit.last_used_at : at } else rows.push({ staff_id: p_staff_id, tool_id: id, uses: n, last_used_at: at })
      }
      return null
    },
    // the tablet's report (migrations 20261104120000 + 20261105140000): records what it says; the alert ladder is verified in SQL
    // by verify:kiosk-content-sql, so here only the recording and the answer the route relies on
    kiosk_device_report({ p_slug, p_level, p_charging, p_app_version, p_web_version }) {
      const row = table('kiosk_devices').find((d) => d.slug === p_slug && d.active)
      if (!row) return { ok: false, error: 'unknown_device' }
      const now = new Date().toISOString()
      Object.assign(row, { last_seen_at: now, battery_level: p_level ?? row.battery_level, battery_charging: p_charging ?? row.battery_charging, battery_reported_at: p_level == null ? row.battery_reported_at : now, app_version: p_app_version ?? row.app_version, web_version: p_web_version ?? row.web_version })
      return { ok: true, alerted: false, settingsUpdatedAt: row.settings_updated_at }
    },
    kiosk_device_alert_test({ p_slug }) {
      return table('kiosk_devices').some((d) => d.slug === p_slug) ? { ok: true } : { ok: false, error: 'unknown_device' }
    },
    staff_tool_usage_reset({ p_staff_id }) {
      state.db.staff_tool_usage = table('staff_tool_usage').filter((r) => r.staff_id !== p_staff_id)
      state.db.staff_tool_searches = table('staff_tool_searches').filter((r) => r.staff_id !== p_staff_id)
      return null
    },
  }

  function uniqueClash(name, row) {
    for (const cols of uniques[name] ?? [['id']]) {
      if (cols.some((c) => row[c] === undefined)) continue
      if (table(name).some((r) => cols.every((c) => String(r[c]) === String(row[c])))) return cols
    }
    return null
  }

  async function handle(req, res, body) {
    const url = new URL(req.url, 'http://x')
    const path = url.pathname
    // control plane
    if (path.startsWith('/__qa/')) {
      if (path === '/__qa/fault') { state.fault = { mode: 'none', ...JSON.parse(body || '{}') }; return json(res, 200, state.fault) }
      if (path === '/__qa/missing') { const m = JSON.parse(body || '{}'); state.missingTables = new Set(m.tables ?? []); state.missingFns = new Set(m.functions ?? []); return json(res, 200, { ok: true }) }
      if (path === '/__qa/reset') { reset(); return json(res, 200, { ok: true }) }
      if (path.startsWith('/__qa/db/')) {
        const name = path.slice(9)
        if (req.method === 'POST') { const rows = [].concat(JSON.parse(body || '[]')); table(name).push(...rows); return json(res, 201, rows) }
        if (req.method === 'DELETE') { state.db[name] = []; return json(res, 200, { ok: true }) }
        return json(res, 200, table(name))
      }
      // per endpoint ("/auth/v1/user", "/rest/v1/staff", …), so a test can count round trips; POST {clear:true} starts a new count
      if (path === '/__qa/jwks' || path === '/__qa/.well-known/jwks') return json(res, 200, { keys: [{ ...OIDC.publicKey.export({ format: 'jwk' }), kid: OIDC_KID, alg: 'RS256', use: 'sig' }] })
      if (path === '/__qa/stats') { if (body && JSON.parse(body).clear) { state.byPath.clear(); state.requests = 0 } return json(res, 200, { requests: state.requests, byPath: Object.fromEntries(state.byPath) }) }
      return json(res, 404, {})
    }
    state.requests++
    state.byPath.set(path, (state.byPath.get(path) ?? 0) + 1)
    // fault injection (the "database" is down, slow or failing)
    const f = state.fault
    const scoped = !f.tables || f.tables.some((t) => path.includes(`/${t}`))
    if (f.mode !== 'none' && scoped) {
      if (f.mode === 'slow') await new Promise((r) => setTimeout(r, f.ms ?? 4000))
      else if (f.mode === 'down') { req.socket.destroy(); return }
      else if (f.mode === 'error') return json(res, 500, { code: 'XX000', message: 'stand-in: injected failure', details: 'relation secret_internal_table at line 42' })
    }

    // GoTrue
    if (path === '/auth/v1/user') {
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
      const user = state.tokens.get(token)
      return user ? json(res, 200, user) : json(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' })
    }
    if (path === '/auth/v1/token') {
      const b = JSON.parse(body || '{}'); const entry = [...state.tokens.entries()].find(([, u]) => u.__refresh === b.refresh_token)
      if (!entry) return json(res, 400, { error: 'invalid_grant' })
      return json(res, 200, { access_token: entry[0], refresh_token: b.refresh_token, token_type: 'bearer', expires_in: 3600 * 24 * 365, expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 365, user: entry[1] })
    }
    if (path.startsWith('/auth/v1/logout')) { res.writeHead(204); return res.end() }
    if (path.startsWith('/auth/v1/')) return json(res, 404, { msg: 'not in stand-in' })
    if (path.startsWith('/storage/v1/')) return json(res, 404, { statusCode: '404', error: 'not_found', message: 'not in stand-in' })
    if (path.startsWith('/realtime/')) return json(res, 404, {})

    // RPC
    const rpc = path.match(/^\/rest\/v1\/rpc\/([\w]+)$/)
    if (rpc) {
      const fn = rpc[1]
      if (state.missingFns.has(fn)) return json(res, 404, { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` })
      const args = JSON.parse(body || '{}')
      try {
        const result = RPC[fn] ? RPC[fn](args) : null
        return json(res, 200, result)
      } catch (err) { return json(res, 400, { code: err.code ?? 'P0001', message: err.message }) }
    }

    // PostgREST tables
    const m = path.match(/^\/rest\/v1\/([\w]+)$/)
    if (!m) return json(res, 404, { message: 'unknown path' })
    const name = m[1]
    if (state.missingTables.has(name)) return json(res, 404, { code: 'PGRST205', message: `Could not find the table 'public.${name}' in the schema cache` })
    const params = [...url.searchParams.entries()]
    const prefer = String(req.headers.prefer ?? '')
    const wantObject = String(req.headers.accept ?? '').includes('vnd.pgrst.object')
    const select = url.searchParams.get('select')
    const finish = (rows, status = 200) => {
      const counting = /count=(exact|planned|estimated)/.test(prefer)
      const total = rows.length
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = url.searchParams.get('limit')
      let page = rows.slice(offset, limit ? offset + Number(limit) : undefined)
      const range = req.headers.range?.match(/(\d+)-(\d+)/)
      if (range) page = rows.slice(Number(range[1]), Number(range[2]) + 1)
      const headers = counting ? { 'content-range': `${page.length ? `0-${page.length - 1}` : '*'}/${total}` } : {}
      if (req.method === 'HEAD') { res.writeHead(status, { ...headers, 'content-type': 'application/json' }); return res.end() }
      const out = project(page, select)
      if (wantObject) {
        if (out.length !== 1) return json(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${out.length} rows` })
        return json(res, status, out[0], headers)
      }
      return json(res, status, out, headers)
    }

    if (req.method === 'GET' || req.method === 'HEAD') return finish(applyOrder(applyFilters(table(name), params), url.searchParams.get('order')))

    if (req.method === 'POST') {
      const incoming = [].concat(JSON.parse(body || '[]'))
      const merge = /resolution=merge-duplicates/.test(prefer)
      const ignore = /resolution=ignore-duplicates/.test(prefer)
      const onConflict = url.searchParams.get('on_conflict')?.split(',')
      const written = []
      for (const raw of incoming) {
        const row = { ...raw }
        const composite = uniques[name]?.[0]
        if (row.id === undefined && !(composite && composite.length > 1)) row.id = randomUUID()
        row.created_at ??= new Date().toISOString()
        const keyCols = onConflict ?? uniqueClash(name, row)
        const existing = keyCols && table(name).find((r) => keyCols.every((c) => String(r[c]) === String(row[c])))
        if (existing) {
          if (merge) { Object.assign(existing, raw); written.push(existing); continue }
          if (ignore) continue
          return json(res, 409, { code: '23505', message: `duplicate key value violates unique constraint "${name}_pkey"` })
        }
        table(name).push(row); written.push(row)
      }
      return /return=representation/.test(prefer) ? finish(written, 201) : (res.writeHead(201), res.end())
    }
    if (req.method === 'PATCH') {
      const patch = JSON.parse(body || '{}')
      const hit = applyFilters(table(name), params)
      for (const row of hit) Object.assign(row, patch)
      return /return=representation/.test(prefer) ? finish(hit) : (res.writeHead(204), res.end())
    }
    if (req.method === 'DELETE') {
      const hit = new Set(applyFilters(table(name), params))
      state.db[name] = table(name).filter((r) => !hit.has(r))
      return /return=representation/.test(prefer) ? finish([...hit]) : (res.writeHead(204), res.end())
    }
    return json(res, 405, {})
  }

  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => { handle(req, res, body).catch((err) => { try { json(res, 500, { message: String(err?.message ?? err) }) } catch { /* socket gone */ } }) })
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  const actual = server.address().port
  return {
    url: `http://127.0.0.1:${actual}`,
    port: actual,
    get db() { return state.db },
    state,
    reset,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()) }),
  }
}

/** A Supabase session cookie for the stand-in (what @supabase/ssr 0.5 reads): sb-<ref>-auth-token = "base64-" + base64url(session). */
export function sessionCookie(url, accessToken, user, refresh) {
  const ref = new URL(url).hostname.split('.')[0]
  const session = { access_token: accessToken, refresh_token: refresh, token_type: 'bearer', expires_in: 3600 * 24 * 365, expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 365, user }
  return { name: `sb-${ref}-auth-token`, value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url') }
}

/** An unsigned JWT-shaped token carrying the claims the app reads (sub, session_id). Deterministic (fixed far expiry), so the token in
 *  the browser's cookie is the same string the stand-in was seeded with. */
export function fakeJwt(claims) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ aud: 'authenticated', role: 'authenticated', exp: 4102444800, ...claims })}.${createHash('sha256').update(JSON.stringify(claims)).digest('base64url')}`
}
