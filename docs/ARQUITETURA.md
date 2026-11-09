# Arquitetura do Prospectra 2.0

## Visão geral

O Prospectra é uma extensão Chrome Manifest V3 dividida em quatro partes principais:

| Arquivo | Responsabilidade |
|---|---|
| content.js | Detecta resultados do Maps, abre fichas, coleta campos e reporta progresso |
| service-worker.js | Persiste lotes, consulta sites públicos, verifica DNS/MX e agenda notificações |
| sidepanel.js | Interface, CRM, fila de pesquisas, relatórios e integrações |
| db.js | Inicialização, migração, persistência IndexedDB, backup e checkpoints |
| sync-utils.js | Tombstones de exclusão, reconciliação de conflitos e linhas Supabase |
| supabase-sync-client.js | Paginação PostgREST com contagem exata e upsert em lotes com verificação de falhas |
| geo-utils.js | Validação de coordenadas, visualização proporcional e exportação KML/GeoJSON |
| checkpoint-utils.js | Normalização e limites dos dados de retomada de coleta |
| permission-utils.js | Origens públicas específicas solicitadas para enriquecimento, incluindo DNS/MX |
| queue-utils.js | Classificação e resumo de pesquisas concluídas, parciais, interrompidas e com falha |
| crm-utils.js | Normalização, score, Place ID, endereço, telefone, CNPJ e templates |
| capture-utils.js | Deduplicação, mesclagem e resumo da coleta |
| contact-utils.js | E-mails, URLs públicas, telefones, WhatsApp e CSV |
| workbook.js | Geração do arquivo Excel XLSX |
| spreadsheet-import.js | Leitura de XLSX via diretório ZIP, relações do workbook e shared strings |

## Fluxo da captura

1. O usuário inicia uma tarefa no painel.
2. O painel envia um identificador de tarefa para o content script.
3. O content script reconhece a lista, coleta os cartões e percorre os resultados.
4. Cada ficha é aberta, lida e fechada antes da próxima.
5. Os lotes são enviados ao service worker.
6. O service worker grava os registros no IndexedDB e confirma a persistência.
7. O painel mescla os registros na lista e atualiza métricas.

O heartbeat informa que a comunicação continua viva. O progresso informa mudança de etapa. Os dois sinais são tratados separadamente para evitar que um heartbeat esconda uma coleta travada.

## Persistência local

O banco usa IndexedDB com uma chave de estado contendo leads, atividades, pesquisas, fila, configurações, lista de não contatar e diagnósticos. Checkpoints de coleta são armazenados em uma chave separada, com a consulta, último estabelecimento processado, contadores e status; assim, atualizar o checkpoint não regrava a base inteira de leads.

Na primeira abertura da versão 2.0, se o estado novo não existe, o Prospectra lê a chave prospectra_leads_v1 do Chrome Storage e migra os registros. A versão antiga não é apagada durante a migração.

IndexedDB oferece mais capacidade e estrutura do que armazenar a base inteira em um único registro do Chrome Storage. Ainda assim, os dados continuam vinculados ao perfil local do Chrome.

## Modelo simplificado de lead

Campos importantes:

- Identidade: id, placeId, mapsUrl.
- Geolocalização: latitude, longitude e coordinatesSource, somente quando a URL da ficha fornece coordenadas exatas.
- Empresa: name, category, categoryPath, address, addressParts, city.
- Contatos: phone, phones, emails, emailTypes, whatsappUrl, socialProfiles.
- Enriquecimento: websiteStatus, httpStatus, mxStatus, websiteMeta, CNPJ numérico/alfanumérico, openingHours.
- Qualidade: qualityScore, confidence, sourceMap, ratingHistory.
- CRM: stage, owner, tags, activities, nextFollowUp, doNotContact.
- Auditoria: collectedAt, updatedAt, enrichedAt.

## Deduplicação

A prioridade de identidade é:

1. Place ID disponível.
2. URL de ficha do Maps normalizada.
3. Nome normalizado mais telefone.
4. Nome normalizado mais endereço.

A mesclagem preserva dados preenchidos, e-mails, telefones, etiquetas, atividades e histórico de avaliação.

## Enriquecimento

O service worker valida URLs HTTP/HTTPS, limita tempo e tamanho de respostas, valida manualmente cada redirecionamento e bloqueia domínios externos, endereços privados e downgrade de HTTPS. A permissão DNS/MX é solicitada junto com as origens dos sites somente em uma ação explícita de enriquecimento. O service worker não executa scripts do site.

Os dados encontrados recebem origem e nível de confiança quando possível. E-mail e telefone encontrados no site são diferenciados dos campos lidos diretamente no Maps.

## Integrações

### Google Sheets
Envia um JSON com os leads para um Web App do Apps Script implantado pelo usuário. O endpoint e token opcional ficam nas configurações locais.

### Supabase
Autentica com e-mail e senha na API Auth e usa a chave anon/public com RLS. A tabela guarda cada lead como JSONB por usuário. A senha não é salva; tokens de sessão ficam no banco local do navegador.

A sincronização lê a nuvem em páginas de até 1.000 registros, com limite combinado de 20.000 linhas (até 10.000 leads ativos e 10.000 tombstones), mescla registros por identidade e usa a data updatedAt mais recente como regra de conflito. Listas e históricos são unidos. Exclusões são propagadas por deleted_at em lotes de até 200, sem remoção física da linha; uma coleta posterior mais nova pode reativar o lead. O resultado depende de relógios dos dispositivos sincronizados.

## Testes

- Testes unitários de normalização, CNPJ, Place ID, deduplicação, score e exportações.
- Testes simulados com jsdom para fluxo de abertura, leitura, retorno e tela de limitação.
- Testes de banco usam fake-indexeddb para simular migração, gravação em lote, checkpoint independente e limpeza do IndexedDB no Node.js.
- GitHub Actions executa verificação sintática, testes e validação do Manifest V3.

Os testes usam DOM simulado e não garantem que os seletores continuem funcionando em todas as versões reais do Google Maps.

## Cobertura geográfica

O painel desenha uma visualização proporcional em latitude/longitude para leads com coordenadas extraídas da URL da ficha do Maps. Ela é um gráfico de pontos, não um mapa-base cartográfico. KML e GeoJSON exportam os pontos para Google Earth e ferramentas GIS. Leads sem coordenadas não recebem uma posição estimada a partir do centro da cidade.

## Teste de navegador

O CI executa também um teste Chromium real do content script em uma página de ficha Maps controlada. Ele valida execução no motor do Chrome, comunicação simulada com as APIs da extensão, extração de telefone/site e captura de coordenadas da URL. Esse teste não acessa a página viva do Google Maps nem comprova que todos os seletores externos continuarão iguais.
