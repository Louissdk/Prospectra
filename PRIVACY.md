# Política de privacidade — Prospectra

**Versão 2.0.0 · 9 de novembro de 2026**

Esta política descreve o funcionamento técnico da extensão Prospectra. Ela não substitui análise jurídica sobre a finalidade, base legal ou conformidade de cada operação comercial.

## 1. Armazenamento por padrão

O Prospectra utiliza uma arquitetura local-first. Sem a ativação de integrações externas, os dados ficam no IndexedDB do perfil local do Chrome utilizado.

A primeira execução da versão 2.0 migra os leads que encontrar na chave legada prospectra_leads_v1 do Chrome Storage para o banco IndexedDB. A migração não remove a chave antiga.

O desenvolvedor do Prospectra não recebe automaticamente a base armazenada no navegador. Não há conta central, analytics próprio ou sincronização remota automática nesta versão.

## 2. Dados tratados

A extensão pode armazenar informações empresariais que o usuário acessa em fichas públicas do Google Maps e páginas públicas dos estabelecimentos:

- nome comercial, categoria e endereço;
- telefone, e-mail, site e links públicos de redes sociais;
- CNPJ publicado pela própria empresa;
- horários, avaliação e quantidade de avaliações;
- link de origem e data da coleta.

Também podem ser armazenados dados operacionais inseridos pelo usuário, como responsável comercial, etapa do funil, etiquetas, observações, histórico de interações, datas de follow-up e lista de não contatar.

O Prospectra não se destina a coletar dados pessoais sensíveis. O usuário deve avaliar a natureza dos dados e a finalidade de cada tratamento.

## 3. Consulta a sites públicos

Quando o usuário ativa o enriquecimento, a extensão solicita permissão para consultar sites HTTP/HTTPS.

As consultas são feitas por requisições GET, sem reutilizar cookies ou credenciais de login do usuário. O código aplica limites de tempo e tamanho de resposta, valida o protocolo e verifica redirecionamentos.

O enriquecimento pode consultar a página principal e até quatro páginas internas relevantes do mesmo site. A disponibilidade depende da estrutura do site, de proteções anti-robô e do conteúdo efetivamente publicado.

A consulta DNS/MX utiliza DNS sobre HTTPS do Google, por meio de dns.google. O nome do domínio consultado é enviado ao resolvedor. Um registro MX indica configuração de recebimento no domínio, mas não comprova que uma caixa postal existe, está ativa ou aceita mensagens.

## 4. Integrações externas

### Google Sheets
Quando configurado e iniciado pelo usuário, os dados são enviados para a URL de Web App do Google Apps Script informada no Prospectra. A planilha, o script, as permissões e os registros passam a seguir as configurações da conta Google do usuário.

### Supabase
Quando configurado e iniciado pelo usuário, os dados de leads são sincronizados com o projeto Supabase informado. O acesso deve estar protegido por Row Level Security (RLS), com chave anon/public e sessão de usuário.

A senha digitada é utilizada na chamada de autenticação e não é salva pelo Prospectra. A chave anon/public e os tokens da sessão são armazenados no IndexedDB local para permitir o uso da integração. O schema aplica Row Level Security por usuário; nunca utilize a chave service_role na extensão.

O backup JSON remove a chave anon/public, o token do Google Sheets e os tokens da sessão Supabase. Ainda assim, o arquivo de backup contém os dados comerciais e deve ser protegido como qualquer cópia da base.

A sincronização Supabase desta versão não propaga exclusões. Apagar registros localmente não remove cópias já sincronizadas na nuvem.

## 5. Permissões do Chrome

A extensão utiliza:

- activeTab e scripting para interagir com a aba ativa do Google Maps;
- storage para migrar os dados antigos;
- sidePanel para apresentar a interface;
- downloads para exportar arquivos;
- permissões opcionais de host para consultar sites, Google Sheets e Supabase;
- alarms e notifications, somente quando o usuário ativa lembretes de follow-up.

O Chrome exibe solicitações de permissão conforme a funcionalidade que o usuário inicia.

## 6. Retenção e exclusão

Os dados locais permanecem no perfil Chrome até que o usuário os exclua, remova os dados da extensão ou apague o perfil.

Backups JSON, CSV e XLSX exportados ficam sob controle do usuário e seguem as regras de retenção do local onde forem salvos.

Na integração Supabase, exclusões são propagadas como marcadores lógicos (tombstones) quando os dispositivos sincronizam. Isso evita que um lead excluído em um dispositivo reapareça em outro, desde que ambos utilizem a versão compatível e que a sincronização seja concluída. A tabela exige a coluna `deleted_at), criada pelo script em `docs/supabase/schema.sql`. A sincronização mantém até 10.000 leads ativos e até 10.000 marcadores de exclusão por usuário; exceder esse limite exige exportar/arquivar a base e planejar a retenção antes de continuar.

A integração Google Sheets não possui exclusão remota automática: apagar um lead localmente não remove a linha já enviada à planilha. O usuário deve gerenciar essas cópias diretamente no Google Sheets.

## 7. Uso responsável e proteção de dados

O usuário é responsável por definir a finalidade e a base legal para o tratamento de dados, cumprir deveres de transparência, respeitar solicitações de não contato e definir prazos de retenção.

A lista Não contatar é uma ferramenta operacional local; ela não substitui uma política completa de governança de dados ou gestão de consentimento.

Recomenda-se coletar somente os dados necessários, evitar abordagens indiscriminadas e revisar os requisitos aplicáveis da LGPD antes de usar a ferramenta em escala.

## 8. Limitações e segurança

Nenhum software é livre de risco. A proteção de URLs e redirecionamentos reduz algumas ameaças, mas não equivale a uma auditoria completa de segurança de rede.

O usuário deve manter o Chrome atualizado, proteger o dispositivo, restringir permissões de integrações e armazenar backups em local confiável.

## 9. Alterações desta política

Esta política pode ser atualizada quando o comportamento do Prospectra mudar. Consulte o histórico em CHANGELOG.md.
