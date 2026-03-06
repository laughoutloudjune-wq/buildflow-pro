-- Auto-create and sync public.profiles from auth.users
-- Safe to run multiple times.

-- 1) Ensure profiles table exists with required columns.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'foreman',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists role text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

alter table public.profiles alter column role set default 'foreman';

-- Add role constraint if missing.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('admin', 'pm', 'foreman'));
  end if;
end $$;

-- 2) Trigger fn: create profile on new auth user.
create or replace function public.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email, 'User'),
    'foreman'
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(public.profiles.full_name, excluded.full_name),
      updated_at = now();

  return new;
end;
$$;

-- 3) Trigger fn: keep email/name synced on auth update.
create or replace function public.handle_auth_user_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set email = new.email,
      full_name = coalesce(new.raw_user_meta_data ->> 'full_name', public.profiles.full_name),
      updated_at = now()
  where id = new.id;

  return new;
end;
$$;

-- 4) Bind triggers.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_auth_user_created();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
after update on auth.users
for each row execute function public.handle_auth_user_updated();

-- 5) Backfill any existing auth users with missing profile rows.
insert into public.profiles (id, email, full_name, role)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'full_name', u.email, 'User') as full_name,
  'foreman' as role
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- 6) Optional helper: keep updated_at fresh on profile edits.
create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_profiles_updated on public.profiles;
create trigger on_profiles_updated
before update on public.profiles
for each row execute function public.set_profile_updated_at();