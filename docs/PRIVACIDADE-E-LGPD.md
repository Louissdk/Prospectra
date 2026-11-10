# Privacidade e proteção de dados

Este documento descreve o comportamento técnico do Prospectra. Não constitui aconselhamento jurídico nem determina, por si só, a base legal de qualquer atividade comercial.

## Por padrão: armazenamento local

Sem integrações ativadas, leads, atividades, pesquisas, fila, configurações e lista de não contatar ficam no IndexedDB do perfil Chrome utilizado.

A extensão não cria conta do Prospectra, não envia analytics ao desenvolvedor e não sincroniza automaticamente os registros.

## Dados empresariais tratados

Podem ser armazenados dados que o usuário coleta de fichas públicas do Google Maps e páginas públicas dos próprios estabelecimentos, incluindo nome comercial, categoria, endereço comercial, telefone, site, e-mail, redes sociais, CNPJ numérico ou alfanumérico publicado, horário, avaliação e links de origem.

O banco também armazena dados operacionais inseridos pelo usuário: etapa comercial, responsável, etiquetas, observações, histórico de interações e datas de follow-up.

## Consultas a sites

Ao habilitar enriquecimento, o Chrome pode solicitar permissão para consultar páginas HTTP/HTTPS. O Prospectra envia requisições GET sem credenciais do usuário, limita tamanho e tempo de resposta e verifica redirecionamentos.

A consulta DNS/MX envia o nome do domínio ao resolvedor DNS sobre HTTPS do Google (dns.google) para verificar registros MX. Essa consulta não comprova a existência de uma caixa postal e compartilha o domínio consultado com o resolvedor.

## Google Sheets

Quando configurado e iniciado, o Prospectra envia os registros para a URL do Apps Script informada pelo usuário. O controle de acesso, a planilha e a retenção passam a depender da configuração dessa implantação e da política do Google.

## Supabase

Quando configurado, os registros de leads e os campos CRM incluídos no payload são enviados ao projeto Supabase escolhido pelo usuário. Autenticação usa a API Auth; o acesso à tabela deve ser protegido por RLS.

A senha digitada é usada na chamada de autenticação e não é persistida pelo Prospectra. Tokens de sessão e chave anon/public ficam nas configurações locais do IndexedDB. O armazenamento local do navegador não é uma carteira criptográfica nem substitui a proteção do dispositivo.

Nunca informe uma chave service_role no Prospectra.

## Retenção e exclusão

Os registros permanecem até que o usuário os exclua, remova os dados da extensão ou apague o perfil Chrome. Backups JSON são arquivos exportados pelo usuário e passam a seguir as regras de armazenamento do destino.

A exclusão local não remove cópias enviadas ao Google Sheets ou Supabase. Exclua esses registros diretamente nas integrações quando necessário.

## Uso responsável

- Colete apenas o necessário para a finalidade definida.
- Respeite pedidos de oposição e não contato.
- Não use a ferramenta para spam, discriminação ou decisões automatizadas de alto impacto.
- Revise a base legal e os deveres de transparência aplicáveis à sua atividade.
- Defina prazos de retenção e processos para atender solicitações dos titulares.
- Consulte assessoria jurídica para uso comercial em escala.

## Permissões Chrome

- activeTab e scripting: leitura da aba ativa do Google Maps quando o usuário inicia a coleta.
- storage: leitura dos dados legados durante a migração.
- sidePanel: painel lateral.
- downloads: exportações.
- Permissões opcionais de host: para enriquecimento, o Prospectra solicita apenas os domínios dos sites dos leads selecionados; Google Sheets e Supabase solicitam os respectivos hosts quando o usuário inicia a integração.
- alarms e notifications: solicitadas somente quando o usuário ativa lembretes de follow-up.
