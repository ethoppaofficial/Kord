-- 20261125000013_privilege_and_rls_trigger_hardening.sql
-- Narrowly scoped remediation for remaining database privilege & RLS event-trigger issues:
--   1. Revoke excessive TRUNCATE privilege from authenticated on 12 catalog/content tables.
--   2. Revoke excessive TRIGGER and REFERENCES privileges from anon on those same 12 tables.
--   3. Harden public.rls_auto_enable() so RLS enforcement failures raise an exception
--      and abort the DDL transaction instead of logging and succeeding silently.
--
-- Notes:
--   - Preserves all legitimate SELECT/INSERT/UPDATE/DELETE privileges for authenticated
--     (gated by RLS) and SELECT privileges for anon on public catalog tables.
--   - Preserves any existing event trigger binding to public.rls_auto_enable() in-place.
--   - Does not alter auth, profiles, admin provisioning, curriculum data, or RPC grants.

-- ---------------------------------------------------------------------------
-- 1. Revoke TRUNCATE from authenticated on the 12 public catalog/content tables
-- ---------------------------------------------------------------------------
revoke truncate on
  public.activities,
  public.categories,
  public.challenges,
  public.course_skills,
  public.course_versions,
  public.courses,
  public.lesson_resources,
  public.lessons,
  public.opportunities,
  public.phases,
  public.quizzes,
  public.skills
from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Revoke TRIGGER and REFERENCES from anon on those same 12 tables
-- ---------------------------------------------------------------------------
revoke trigger, references on
  public.activities,
  public.categories,
  public.challenges,
  public.course_skills,
  public.course_versions,
  public.courses,
  public.lesson_resources,
  public.lessons,
  public.opportunities,
  public.phases,
  public.quizzes,
  public.skills
from anon;

-- ---------------------------------------------------------------------------
-- 3. Replace public.rls_auto_enable() in-place to fail closed (abort on error)
-- ---------------------------------------------------------------------------
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_catalog.pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null and cmd.schema_name in ('public') then
      begin
        execute pg_catalog.format(
          'alter table if exists %s enable row level security',
          cmd.object_identity
        );
      exception
        when others then
          raise exception 'rls_auto_enable: failed to enable RLS on %: % (SQLSTATE %)',
            cmd.object_identity,
            sqlerrm,
            sqlstate
            using errcode = sqlstate;
      end;

      -- Defense-in-depth check: abort if the created table still lacks RLS
      if exists (
        select 1
        from pg_catalog.pg_class c
        where c.oid = cmd.objid
          and c.relkind in ('r', 'p')
          and not c.relrowsecurity
      ) then
        raise exception 'rls_auto_enable: RLS verification failed for % (oid %)',
          cmd.object_identity,
          cmd.objid;
      end if;

      raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
    end if;
  end loop;
end;
$$;

revoke all on function public.rls_auto_enable() from public, anon, authenticated;
