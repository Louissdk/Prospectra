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

- A sincronização baixa registros visíveis ao usuário autenticado pela RLS.
- O Prospectra mescla os registros locais e remotos por identidade comercial e mantém o ID local do registro consolidado.
- A leitura remota é paginada em blocos de 1.000 linhas e limitada a 10.000 leads por sincronização nesta versão.
- O resultado local é enviado em lotes de até 200 registros.
- Campos CRM incluídos no objeto do lead acompanham a sincronização.
- Exclusões não são propagadas nesta versão. Apagar um lead local não remove automaticamente uma cópia na nuvem.
- Faça backup antes de sincronizar em dispositivos diferentes.

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
- **Erro de rede:** confirme a Project URL, conectividade e permissão de host do Chrome.
- **Conta criada sem sessão:** se confirmação de e-mail estiver habilitada, confirme o endereço e depois entre.
