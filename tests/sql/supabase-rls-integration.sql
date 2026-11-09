-- Validado em PostgreSQL 17 no runner descartável do GitHub Actions.
do $$
declare
  legacy_identity text;
  legacy_deleted_at timestamptz;
begin
  select identity_key, deleted_at
    into legacy_identity, legacy_deleted_at
  from public.prospectra_leads
  where id = 'legacy-1'
    and user_id = '11111111-1111-4111-8111-111111111111';

  if legacy_identity <> 'place:legacy-1' then
    raise exception 'A migração não preencheu identity_key da linha legada.';
  end if;
  if legacy_deleted_at is not null then
    raise exception 'A linha legada deveria continuar ativa.';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.prospectra_leads'::regclass) then
    raise exception 'RLS não foi habilitado.';
  end if;
  if not has_table_privilege('authenticated','public.prospectra_leads','SELECT')
     or not has_table_privilege('authenticated','public.prospectra_leads','INSERT')
     or not has_table_privilege('authenticated','public.prospectra_leads','UPDATE')
     or not has_table_privilege('authenticated','public.prospectra_leads','DELETE') then
    raise exception 'A role authenticated não recebeu os grants necessários.';
  end if;
  if has_table_privilege('anon','public.prospectra_leads','SELECT')
     or has_table_privilege('anon','public.prospectra_leads','INSERT')
     or has_table_privilege('anon','public.prospectra_leads','UPDATE')
     or has_table_privilege('anon','public.prospectra_leads','DELETE') then
    raise exception 'A role anon recebeu acesso indevido à tabela.';
  end if;
  if exists (
    select 1 from information_schema.table_privileges
    where table_schema='public'
      and table_name='prospectra_leads'
      and grantee='PUBLIC'
  ) then
    raise exception 'PUBLIC recebeu privilégios indevidos na tabela.';
  end if;
end
$$;

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);

do $$
declare
  visible_rows integer;
begin
  select count(*) into visible_rows from public.prospectra_leads;
  if visible_rows <> 1 then
    raise exception 'RLS deveria mostrar somente a linha do usuário atual; recebeu %.', visible_rows;
  end if;
end
$$;

insert into public.prospectra_leads(id,identity_key,user_id,payload)
values (
  'own-1',
  'place:own-1',
  '11111111-1111-4111-8111-111111111111',
  '{"name":"Lead próprio"}'::jsonb
);

update public.prospectra_leads
set payload = '{"name":"Lead próprio atualizado"}'::jsonb
where id='own-1';

do $$
begin
  begin
    insert into public.prospectra_leads(id,identity_key,user_id,payload)
    values (
      'foreign-1',
      'place:foreign-1',
      '22222222-2222-4222-8222-222222222222',
      '{"name":"Lead de outro usuário"}'::jsonb
    );
    raise exception 'A política RLS aceitou INSERT para outro usuário.';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.prospectra_leads
    set user_id='22222222-2222-4222-8222-222222222222'
    where id='own-1';
    raise exception 'A política RLS aceitou reatribuir o user_id.';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

do $$
declare
  visible_rows integer;
  updated_name text;
begin
  select count(*) into visible_rows from public.prospectra_leads;
  if visible_rows <> 2 then
    raise exception 'O usuário deveria ver suas duas linhas, recebeu %.', visible_rows;
  end if;
  select payload->>'name' into updated_name
  from public.prospectra_leads where id='own-1';
  if updated_name <> 'Lead próprio atualizado' then
    raise exception 'UPDATE legítimo não foi persistido.';
  end if;
end
$$;

delete from public.prospectra_leads where id='own-1';

do $$
declare
  remaining integer;
begin
  select count(*) into remaining from public.prospectra_leads;
  if remaining <> 1 then
    raise exception 'DELETE próprio falhou ou linhas de outros usuários ficaram visíveis.';
  end if;
end
$$;

reset role;
