-- Prospectra 2.0 — schema multi-tenant com Row Level Security
-- Execute no SQL Editor do projeto Supabase escolhido.

create table if not exists public.prospectra_leads (
  id text not null,
  identity_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

-- Migração segura para projetos que já tenham a tabela da versão inicial do conector.
alter table public.prospectra_leads
  add column if not exists identity_key text;

alter table public.prospectra_leads
  add column if not exists deleted_at timestamptz;

update public.prospectra_leads
set identity_key = coalesce(nullif(payload->>'identityKey',''), id)
where identity_key is null or identity_key = '';

alter table public.prospectra_leads
  alter column identity_key set not null;

create index if not exists prospectra_leads_user_updated_idx
  on public.prospectra_leads (user_id, updated_at desc);

create index if not exists prospectra_leads_user_deleted_idx
  on public.prospectra_leads (user_id, deleted_at) where deleted_at is not null;

create unique index if not exists prospectra_leads_user_identity_uidx
  on public.prospectra_leads (user_id, identity_key);

alter table public.prospectra_leads enable row level security;

drop policy if exists "Users can read their own Prospectra leads" on public.prospectra_leads;
create policy "Users can read their own Prospectra leads"
  on public.prospectra_leads for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own Prospectra leads" on public.prospectra_leads;
create policy "Users can insert their own Prospectra leads"
  on public.prospectra_leads for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own Prospectra leads" on public.prospectra_leads;
create policy "Users can update their own Prospectra leads"
  on public.prospectra_leads for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own Prospectra leads" on public.prospectra_leads;
create policy "Users can delete their own Prospectra leads"
  on public.prospectra_leads for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all privileges on table public.prospectra_leads from anon, public;
grant select, insert, update, delete on public.prospectra_leads to authenticated;

comment on table public.prospectra_leads is
  'Registros de leads do Prospectra, isolados por usuário autenticado via RLS.';
