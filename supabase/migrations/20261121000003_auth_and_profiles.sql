-- 20261121000003_auth_and_profiles.sql
-- Hardened authentication, role protection, and controlled admin provisioning.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- Defense-in-depth trigger preventing learners/clients from altering id, email, role, or created_at
create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role')
     and coalesce(current_setting('role', true), '') not in ('service_role', 'postgres', 'supabase_admin') then
    if new.id is distinct from old.id
       or new.email is distinct from old.email
       or new.role is distinct from old.role
       or new.created_at is distinct from old.created_at then
      raise exception 'Privileged profile fields (id, email, role, created_at) cannot be modified directly';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_profile_privileged_fields() from public, anon, authenticated;

drop trigger if exists trg_protect_profile_privileged_fields on public.profiles;
create trigger trg_protect_profile_privileged_fields
  before update on public.profiles
  for each row execute function public.protect_profile_privileged_fields();

-- Hardened auth.users trigger: assigns 'learner' by default; admin only when email is verified & designated
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_role text := 'learner';
  derived_first text;
  derived_full text;
begin
  if lower(coalesce(new.email, '')) = 'ethoppaofficial@gmail.com'
     and new.email_confirmed_at is not null then
    assigned_role := 'admin';
  end if;

  derived_full := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(new.email, 'learner'), '@', 1)
  );
  derived_first := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''),
    split_part(derived_full, ' ', 1)
  );

  insert into public.profiles (id, email, first_name, full_name, role)
  values (
    new.id,
    lower(new.email),
    derived_first,
    derived_full,
    assigned_role
  )
  on conflict (id) do update
    set email = excluded.email,
        first_name = coalesce(nullif(excluded.first_name, ''), public.profiles.first_name),
        full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
        role = case
          when lower(excluded.email) = 'ethoppaofficial@gmail.com'
               and new.email_confirmed_at is not null
          then 'admin'
          else public.profiles.role
        end;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Controlled admin role provisioning (strictly restricted to service_role / postgres operators)
create or replace function public.admin_assign_profile_role(
  p_target_user_id uuid,
  p_new_role text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles;
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role')
     and coalesce(current_setting('role', true), '') not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Service role authorization required to assign profile roles';
  end if;

  if p_new_role not in ('learner', 'admin') then
    raise exception 'Invalid role: must be learner or admin';
  end if;

  update public.profiles
  set role = p_new_role
  where id = p_target_user_id
  returning * into v_row;

  if not found then
    raise exception 'Profile not found for user %', p_target_user_id;
  end if;

  return v_row;
end;
$$;

revoke all on function public.admin_assign_profile_role(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_assign_profile_role(uuid, text) to service_role;
