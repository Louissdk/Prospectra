# Integração com Supabase

A sincronização opcional permite compartilhar a base de leads entre instalações do Prospectra usando um projeto Supabase controlado pelo usuário.

## Pré-requisitos

- Projeto Supabase criado.
- Email/Password Auth habilitado.
- Tabela criada com o [schema SQL](../supabase/schema.sql).
- Project URL e chave anon/public.
- Usuário criado pelo Prospectra ou previamente no Supabase.

**Nunca use a chave service_role na extensão.** A extensão deve usar somente a chave anon/public e o token do usuário autenticado, com RLS habilitado.

## 1. Criar a tabela

1. Abra o painel do Supabase.
2. Acesse SQL Editor.
3. Abra o arquivo docs/supabase/schema.sql neste repositório.
4. Execute o SQL.
5. Confirme que a tabela prospectra_leads existe e que RLS está habilitado.

### Acesso pela Data API

Desde 30 de outubro de 2026, o Supabase passou a exigir grants explícitos para que novas tabelas do schema `public` sejam acessíveis pela Data API em todos os projetos. Uma tabela pode existir no PostgreSQL e ainda não estar exposta pelo PostgREST. O schema deste repositório inclui o grant mínimo para `authenticated`:

```sql
grant select, insert, update, delete on public.prospectra_leads to authenticated;
```

Esse grant já faz parte de `docs/supabase/schema.sql`; execute o arquivo completo. No painel, confirme que a Data API está habilitada e que o schema `public` está entre os schemas expostos. Não conceda acesso à role `anon` e nunca use `service_role` na extensão. As políticas RLS continuam limitando cada usuário às próprias linhas.

Se o PostgREST continuar retornando `PGRST205` ou não reconhecer a tabela depois da execução do SQL, confirme o projeto e o schema selecionados e atualize o cache do PostgREST pelo SQL Editor:

```sql
notify pgrst, 'reload schema';
```

## 2. Configurar Auth

1. Abra Authentication → Providers.
2. Habilite Email.
3. Configure as regras de confirmação de e-mail e senha conforme a política desejada.
4. Se a confirmação de e-mail estiver ativa, conclua a confirmação antes de fazer login.

## 3. Conectar no Prospectra

1. Abra Configurações → Supabase.
2. Informe a Project URL no formato https://seu-projeto.supabase.co.
3. Cole a chave anon/public (ou publishable key compatível com o endpoint).
4. Informe e-mail e senha.
5. Clique em **Criar conta** ou **Entrar**.
6. Clique em **Sincronizar**.

A senha é enviada à API Auth para autenticação e não é salva pelo Prospectra. O token da sessão é guardado no IndexedDB local para permitir sincronizações posteriores.

## 4. Política de sincronização

- A leitura remota usa RLS, páginas de 1.000 linhas e contagem exata. O limite combinado é de 20.000 linhas: até 10.000 leads ativos e até 10.000 registros de exclusão.
- A base local mantém o limite de 10.000 leads ativos. A sincronização não descarta silenciosamente registros acima dos limites: ela interrompe e informa o problema.
- O conflito entre versões usa a data `updatedAt` mais recente como regra de última gravação vence. Listas como e-mails, telefones, etiquetas e atividades são mescladas; a regra depende de relógios dos dispositivos razoavelmente sincronizados.
- Exclusões são propagadas como *tombstones* (`deleted_at`), não como remoções físicas. Isso impede que um lead apagado reapareça ao sincronizar outro dispositivo.
- Se o registro for coletado novamente depois da exclusão, a atualização posterior pode reativá-lo.
- O envio de leads e tombstones é feito em lotes de até 200 linhas.
- Antes de usar a nova sincronização, execute novamente o SQL completo de `docs/supabase/schema.sql` no projeto existente para adicionar a coluna `deleted_at` e o índice.
- Faça backup antes da primeira sincronização após atualizar o schema, especialmente quando houver vários dispositivos.

## 5. Segurança

- Mantenha RLS habilitado.
- Use as políticas do schema fornecido.
- Não conceda acesso anônimo à tabela de leads.
- Nunca coloque service_role, senha de banco ou segredo administrativo em arquivos da extensão.
- Tokens locais dependem da segurança do perfil Chrome e do dispositivo. Não considere o IndexedDB criptografia de ponta a ponta.
- Revogue sessões pelo painel Supabase quando um dispositivo for perdido ou não for mais confiável.

## Problemas comuns

- **401:** sessão expirada, senha incorreta ou token inválido. Entre novamente.
- **403:** políticas RLS ou permissões da tabela incorretas.
- **404 / PGRST205:** a tabela não existe no projeto informado ou o schema cache ainda não foi atualizado.
- **Coluna deleted_at ausente:** execute novamente o arquivo `docs/supabase/schema.sql` para aplicar a migração de exclusões.
- **Conflitos de dados entre dispositivos:** o registro com `updatedAt` mais recente prevalece; confira relógio/data dos dispositivos e faça backup antes de sincronizar.
- **Erro de rede:** confirme a Project URL, conectividade e permissão de host do Chrome.
- **Conta criada sem sessão:** se confirmação de e-mail estiver habilitada, confirme o endereço e depois entre.
