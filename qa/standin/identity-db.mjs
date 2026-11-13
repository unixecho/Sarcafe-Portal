// The identity system's database for the QA suite: a REAL Postgres (PGlite, in memory) with every migration applied. The stand-in
// Supabase (supabase.mjs) answers the app's customer_* identity calls from it, as the service role, with the same named arguments
// PostgREST would pass. So the live tests of the identity routes exercise the real SQL functions, constraints and triggers, not a
// JavaScript imitation of them. (Real CONCURRENCY is not provable here: PGlite has one connection. scripts/identity-concurrency-docker.mjs.)
// Synthetic people only: the stand-in's own made-up users and staff.
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** The functions answered from the real database (the waitlist and feedback customer_* functions are not part of it). */
export const IDENTITY_FUNCTION = /^customer_(access|org|department|invitation|manage)_[a-z_]+$/
const TABLES = ['customer_invitations', 'customer_identity_audit', 'customer_access_grants', 'customer_org_memberships', 'customer_business_memberships',
  'customer_principals', 'customer_members', 'customer_business_orgs', 'customer_departments', 'customer_organizations']

export async function startIdentityDb(root, { users = [], staff = [] } = {}) {
  const { openIdentityDb } = await import(pathToFileURL(path.join(root, 'scripts/lib/identity-pglite.mjs')).href)
  const { db } = await openIdentityDb(root)
  for (const id of users) await db.query(`insert into auth.users (id) values ($1) on conflict do nothing`, [id])
  for (const s of staff) {
    await db.query(`insert into public.staff (id, auth_user_id, first_name, role, badge, active) values ($1, $2, 'Synthetic', $3, $4, $5)`, [s.id, s.auth_user_id, s.role === 'owner' ? 'owner' : 'staff', s.badge ?? null, s.active !== false])
  }
  const business = (await db.query(`select id, slug, name, state, legacy_owner_access from public.customer_businesses where slug = 'sarcafe'`)).rows[0]

  // one statement sequence at a time: a call switches to the service role and back, and two calls must not interleave
  let queue = Promise.resolve()
  const exclusive = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => null); return run }

  return {
    /** The Sarcafe business row, as the stand-in's customer_businesses table serves it to the app. */
    business,
    handles: (name) => IDENTITY_FUNCTION.test(name),
    /** One RPC, as PostgREST would run it: the service role, named arguments. Throws the database's own error. */
    rpc: (name, args) => exclusive(async () => {
      const keys = Object.keys(args)
      if (!IDENTITY_FUNCTION.test(name) || keys.some((key) => !/^p_[a-z_]+$/.test(key))) throw Object.assign(new Error('not an identity function'), { code: 'PGRST202' })
      await db.exec('set role service_role')
      try { return (await db.query(`select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(', ')}) r`, keys.map((key) => args[key]))).rows[0].r }
      finally { await db.exec('reset role') }
    }),
    /** For a test: read or arrange the database directly (as the table owner). */
    query: (sql, params = []) => exclusive(async () => (await db.query(sql, params)).rows),
    /** An empty identity world again (the Sarcafe business, its branches and the staff stay). */
    reset: () => exclusive(async () => {
      await db.exec(`truncate ${TABLES.map((t) => `public.${t}`).join(', ')} cascade`)
      await db.exec(`delete from public.customer_businesses where slug <> 'sarcafe'`)
    }),
    close: () => db.close(),
  }
}
