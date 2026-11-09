# Histórico de versões

Todas as alterações importantes do Prospectra são registradas neste arquivo.

## [2.0.0] — 2026-11-09

### Correções adicionais da auditoria
- Permissões de enriquecimento solicitadas em ação explícita; o modo automático usa apenas permissões previamente concedidas.
- Permissão do DNS-over-HTTPS incluída no fluxo de enriquecimento e MX.
- Redirecionamentos de sites validados manualmente, bloqueando hosts externos, destinos privados e downgrade de HTTPS.
- Resultado da fila classificado como concluído, parcial, interrompido ou com falha, evitando mensagens de sucesso enganosas.
- Exclusões individuais propagadas entre dispositivos por tombstones Supabase; backups mantêm o histórico para impedir reaparecimento de leads apagados.
- Conflitos entre dispositivos passam a respeitar o registro com updatedAt mais recente, preservando a união de atividades, etiquetas, contatos e histórico.
- Parser de endereços melhorado para rua, número, complemento, bairro, cidade, UF e CEP.
- Estado Não contatar passou a respeitar a atualização mais recente; capturas do Maps sem campo CRM não apagam um bloqueio salvo.
- Reconciliação de tombstones indexada por Place ID e aliases, mantendo o limite documentado de 10.000 leads + 10.000 exclusões sem varredura quadrática.
- Identificadores gerados para tombstones preservam a identidade completa e evitam colisões por truncamento.
- Apps Script valida ação, token e estrutura do payload antes de adquirir o bloqueio compartilhado; integração protegida contra chamadas inválidas que monopolizem o lock.



### Produto e experiência
- Reorganização do painel em cinco áreas: Visão geral, Leads, Funil, Pesquisas e Configurações.
- Identidade visual clara em verde `#018D3E`, creme `#FDF7E6` e vermelho `#E71506`, com tipografia, hierarquia, cartões, indicadores e componentes responsivos.
- Dashboard com indicadores, distribuição por etapa, follow-ups e cobertura por cidade/região.

### Coleta e estabilidade
- Pausar, continuar e cancelar uma coleta, com checkpoint persistente e retomada pela fila ignorando leads já salvos.
- Retomada prática de pesquisas com opção de pular registros já salvos.
- Fila sequencial de pesquisas por segmento, cidade, meta e nota mínima.
- Observação de mudanças do DOM com MutationObserver e reconhecimento ampliado de áreas de resultados.
- Repetição controlada da abertura de ficha quando a primeira tentativa falha.
- Reconhecimento de páginas de CAPTCHA, verificação e limitação; a coleta para sem contornar essas proteções.
- Diagnóstico técnico com URL, título, contagem de contêineres, links e versão da extensão.
- Place ID extraído quando presente e deduplicação por identificadores, URLs e dados de contato.
- Testes de fluxo com DOM simulado para abertura, leitura, retorno, persistência e bloqueio.

### Integridade dos dados
- Limpeza total remove também checkpoints e diagnósticos, preservando as configurações de integração.
- Ações da fila para remover pesquisas e adicionar pesquisas salvas são tratadas antes da busca por um lead.
- Restauração de backup converte tarefas em execução para interrompidas e descarta checkpoints da sessão anterior.
- Testes de IndexedDB cobrem migração do legado, persistência de lotes, checkpoints e limpeza do banco.

### Dados e enriquecimento
- Migração automática dos leads do Chrome Storage para IndexedDB.
- Estrutura de contatos múltiplos e classificação de telefone/e-mail.
- Pontuação de qualidade de 0 a 100 com pesos configuráveis.
- Categorias hierárquicas, campos de endereço normalizados e metadados de origem/confiança.
- Histórico da avaliação e status de empresa permanentemente/temporariamente fechada quando detectável.
- Verificação de site, status HTTP, URL final, título, descrição, viewport e sinais de tecnologias.
- Busca ampliada de contatos em até cinco páginas públicas do mesmo site, com ação para reenriquecer leads já salvos.
- Suporte ao CNPJ alfanumérico implantado em julho de 2026, seguindo conversão ASCII - 48 e módulo 11 da Receita Federal ([documentação oficial](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj)).
- Extração de e-mails, telefones, CNPJ numérico e alfanumérico com validação dos dígitos verificadores, e redes sociais públicas.
- Classificação de e-mails por finalidade e consulta DNS/MX do domínio.
- Captura de horários quando disponibilizados na ficha do Maps.

### CRM
- Etapas Novo, Analisado, Contatado, Interessado, Negociação, Cliente e Perdido.
- Kanban com movimentação entre etapas.
- Histórico de interações e observações por lead.
- Follow-ups com lembretes opcionais do Chrome.
- Lista de não contatar.
- Etiquetas, responsável comercial e modelos de mensagem.
- Link WhatsApp com mensagem preenchida, sem envio automático.

### Cobertura geográfica
- Captura de latitude e longitude exatas quando disponíveis na URL da ficha do Maps.
- Visualização proporcional por coordenadas, sem apresentar um mapa-base cartográfico.
- Exportação KML e GeoJSON; os campos de coordenadas ficam disponíveis em CSV, XLSX e Google Sheets. A planilha grava latitude/longitude como números e neutraliza entradas com potencial de injeção de fórmulas.

### Relatórios e integrações
- Exportação CSV customizável, com chave de identidade, e presets básicos HubSpot, Pipedrive e Salesforce.
- Importação de Excel XLSX, CSV e restauração de backup JSON.
- Backup completo de leads, interações, pesquisas e configurações.
- Integração opcional com Google Sheets via Apps Script próprio.
- Sincronização opcional com Supabase, autenticação e políticas RLS.
- Cobertura regional por cidade e links para abrir pesquisas no Maps.

### Distribuição
- CI gera um ZIP limpo da extensão, com manifest.json na raiz e sem dependências/testes de desenvolvimento.
- Tags v* publicam automaticamente uma GitHub Release com o pacote instalável.

### Segurança e documentação
- Consolidação de listeners duplicados no service worker.
- Enriquecimento com limites de tamanho, timeout, validação de URL e redirecionamento.
- Novas permissões de notificações e alarmes solicitadas somente quando o usuário ativa lembretes.
- Permissões para enriquecer sites solicitadas por domínio específico, sem pedir acesso amplo a todos os sites de uma vez.
- README redesenhado, guia de uso, arquitetura, privacidade, troubleshooting, integrações, licença proprietária e templates de contribuição.
- CI com sintaxe JavaScript, testes unitários, testes simulados de navegação e validação do Manifest V3.

### Limitações desta versão
- O parser XLSX cobre planilhas convencionais com strings compartilhadas ou inline; arquivos criptografados/ZIP64 não são suportados.
- A integração Supabase sincroniza até 10.000 leads ativos e até 10.000 tombstones de exclusão por usuário; exige a migração SQL da coluna deleted_at.
- O Google Sheets requer implantação e configuração próprias do Apps Script.
- Testes simulados não equivalem a uma coleta real no Google Maps.

## [1.2.5] — 2026-11-09
- Reconhecimento ampliado de contêineres e rotas de fichas do Google Maps.
- Espera de até 30 segundos por cartões.
- Mensagens de falha com diagnóstico de links e contêineres detectados.
- Identificação de encerramento por falta de novos cartões e de metas parciais.
- Limite de coleta alinhado no painel e no coletor.
- Suporte a quantidade zero para percorrer resultados disponíveis.
- Relatório de progresso diferencia fichas analisadas, descartes e meta não alcançada.

## [1.2.4] — 2026-11-09
- Navegação entre fichas sequencial, uma empresa por vez.
- Persistência dos lotes pelo service worker com confirmação após gravação.
- Watchdogs separados para comunicação e avanço da coleta.
- Cancelamento cooperativo e envio de lotes menores.
- Paginação visual de 50 leads no painel.
- Primeiros testes de mesclagem e deduplicação e CI no GitHub Actions.

## [1.2.3] — 2026-11-08
- Heartbeat de comunicação a cada 8 segundos.
- Watchdog de coleta ampliado e separado do progresso.

## [1.2.2] — 2026-11-08
- Processamento em lotes menores.
- Redução de tempos de espera em navegação sequencial.
- Remoção de opções sem função e da exportação JSON antiga.

## [1.2.1] — 2026-11-08
- Correções no fluxo de coleta e no retorno do Google Maps.
- Progresso por tarefa e envio incremental de resultados.
- Tratamento de navegação e BFCache.
- Suporte à opção de percorrer resultados disponíveis.
