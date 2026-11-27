import fs from 'node:fs';
import path from 'node:path';

/** @typedef {import('@electric-sql/pglite').PGlite} PGliteInstance */
/** @typedef {import('@electric-sql/pglite').Transaction} PGliteTransaction */

/** @type {typeof import('@electric-sql/pglite').PGlite | null} */
let cachedPgliteCtor = null;
async function getPgliteCtor() {
  if (cachedPgliteCtor) return cachedPgliteCtor;
  const mod = await import('@electric-sql/pglite');
  cachedPgliteCtor = mod.PGlite;
  return cachedPgliteCtor;
}

const SUPABASE_DIR = path.resolve('supabase');
const MIGRATIONS_DIR = path.join(SUPABASE_DIR, 'migrations');

const BOOTSTRAP_SQL = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role supabase_admin nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role, supabase_admin;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role, supabase_admin;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    current_setting('role', true)
  );
$$;

grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role, supabase_admin;

create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role, supabase_admin;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id) on delete cascade,
  name text not null,
  owner uuid,
  owner_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;
grant select on storage.buckets to anon, authenticated, service_role, supabase_admin;
grant select, insert, update, delete on storage.objects to authenticated, service_role, supabase_admin;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select case
    when array_length(string_to_array(name, '/'), 1) > 1
    then (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
    else array[]::text[]
  end;
$$;

create or replace function storage.extension(name text)
returns text
language sql
immutable
as $$
  select case
    when position('.' in split_part(name, '/', array_length(string_to_array(name, '/'), 1))) > 0
    then regexp_replace(split_part(name, '/', array_length(string_to_array(name, '/'), 1)), '^.*\\.', '')
    else ''
  end;
$$;

grant execute on function storage.foldername(text), storage.extension(text) to anon, authenticated, service_role, supabase_admin;
`;

/** @param {string} sql */
function sanitizeForPglite(sql) {
  // PGlite ships built-in gen_random_uuid() in pg_catalog without pgcrypto shared lib
  return sql.replace(/^\s*create\s+extension\s+if\s+not\s+exists\s+"?pgcrypto"?\s*;\s*$/gim, '-- pgcrypto built-in');
}

export async function createSupabasePglite() {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const savedWindow = globalThis.window;
  if (hadWindow) {
    delete /** @type {{ window?: unknown }} */ (globalThis).window;
  }
  try {
    const PGlite = await getPgliteCtor();
    const db = new PGlite();
    await db.waitReady;
    await db.exec(BOOTSTRAP_SQL);
    return db;
  } finally {
    if (hadWindow) {
      globalThis.window = savedWindow;
    }
  }
}

export function getMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** @param {PGliteInstance} db */
export async function applyAllMigrations(db) {
  const files = getMigrationFiles();
  for (const file of files) {
    const rawSql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await db.exec(sanitizeForPglite(rawSql));
  }
  return files;
}

/** @param {PGliteInstance} db */
export async function applyStandaloneSql(db) {
  const orderedStandalone = [
    '01_schema.sql',
    '02_security.sql',
    '03_functions.sql',
    '04_storage.sql',
    '05_seed.sql',
    '06_dashboard.sql',
  ];
  for (const file of orderedStandalone) {
    const rawSql = fs.readFileSync(path.join(SUPABASE_DIR, file), 'utf8');
    await db.exec(sanitizeForPglite(rawSql));
  }
  return orderedStandalone;
}

const VALID_ROLES = new Set(['anon', 'authenticated', 'service_role', 'postgres', 'supabase_admin']);

/**
 * @template T
 * @param {PGliteInstance} db
 * @param {{ role?: string; userId?: string | null }} actor
 * @param {(tx: PGliteTransaction) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function asActor(db, { role = 'authenticated', userId = null } = {}, fn) {
  if (!VALID_ROLES.has(role)) {
    throw new Error(`Invalid test role: ${role}`);
  }
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId || '']);
    await tx.query(`select set_config('request.jwt.claim.role', $1, true)`, [role]);
    await tx.exec(`set local role ${role}`);
    return fn(tx);
  });
}

/**
 * @param {PGliteInstance} db
 * @param {{ id?: string | null; email: string; confirmed?: boolean; firstName?: string; fullName?: string; role?: string | null }} options
 * @returns {Promise<{ id: string; email: string; first_name: string; full_name: string; role: string }>}
 */
export async function createAuthUser(
  db,
  {
    id = null,
    email,
    confirmed = true,
    firstName = '',
    fullName = '',
    role = null,
  }
) {
  /** @type {Record<string, string>} */
  const meta = {};
  if (firstName) meta.first_name = firstName;
  if (fullName) meta.full_name = fullName;

  const res = await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4::jsonb)
     returning id, email`,
    [
      id,
      String(email).trim().toLowerCase(),
      confirmed ? new Date().toISOString() : null,
      JSON.stringify(meta),
    ]
  );
  const created = /** @type {{ id: string; email: string }} */ (res.rows[0]);
  if (role && role !== 'learner') {
    await asActor(db, { role: 'service_role' }, async (tx) => {
      await tx.query(`select public.admin_assign_profile_role($1::uuid, $2)`, [created.id, role]);
    });
  }
  const profileRes = await db.query(`select * from public.profiles where id = $1::uuid`, [created.id]);
  return /** @type {{ id: string; email: string; first_name: string; full_name: string; role: string }} */ (
    profileRes.rows[0]
  );
}
