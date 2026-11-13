// An in-memory Postgres (PGlite) with every migration applied, for the identity checks that need the REAL SQL:
// scripts/verify-identity-org-sql.mjs and the QA suite's stand-in (qa/standin/identity-db.mjs), which answers the app's
// customer_* calls from it. Synthetic data only; nothing here can reach a real project.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/** The stand-ins for what Supabase provides around the public schema (the same ones scripts/verify-identity-sql.mjs uses). */
export const SUPABASE_STANDINS = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create schema storage;
  create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text);
  alter table storage.objects enable row level security;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{"session_id":"10000000-0000-4000-8000-000000000001"}'::jsonb) $$;
  create publication supabase_realtime;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  -- like Supabase: a new table in public is handed to the service role by default, so a migration's own revoke is what is tested
  alter default privileges in schema public grant all on tables to service_role;
`

export const migrationFiles = (root) => readdirSync(path.join(root, 'supabase/migrations')).filter((name) => name.endsWith('.sql')).sort()

/**
 * A fresh database with the migrations applied in order. `onFile(file, db)` runs BEFORE each file is applied (to take a
 * "before" picture); a migration that fails throws with its file name.
 */
export async function openIdentityDb(root, { onFile } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(SUPABASE_STANDINS)
  const files = migrationFiles(root)
  for (const file of files) {
    if (onFile) await onFile(file, db)
    try { await db.exec(readFileSync(path.join(root, 'supabase/migrations', file), 'utf8')) }
    catch (error) { throw new Error(`${file}: ${String(error.message).split('\n')[0]}`) }
  }
  return { db, files }
}
