-- Banco descartável de CI: simula apenas as tabelas/funções mínimas do Supabase Auth.
create role anon nologin;
create role authenticated nologin;
create role authenticator login noinherit password 'prospectra-ci-authenticator';
grant anon, authenticated to authenticator;

create schema auth;
grant usage on schema auth to authenticated;

create table auth.users (
  id uuid primary key
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;
grant execute on function auth.uid() to authenticated;

grant usage on schema public to anon, authenticated, authenticator;

-- Estado legado da primeira versão, sem identity_key e deleted_at.
create table public.prospectra_leads (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.prospectra_leads(id,user_id,payload,updated_at)
values (
  'legacy-1',
  '11111111-1111-4111-8111-111111111111',
  '{"identityKey":"place:legacy-1","name":"Empresa legada"}'::jsonb,
  '2026-11-01T10:00:00Z'
);
