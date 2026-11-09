# Roadmap do Prospectra

Este roadmap separa o que existe no produto do que seria uma evolução futura. Uma ideia no roadmap não é uma funcionalidade disponível.

## Versão 2.0.0 — Base de produto

- [x] Painel reorganizado em cinco áreas.
- [x] Banco local IndexedDB e migração dos leads legados.
- [x] Deduplicação por Place ID e atributos alternativos.
- [x] Pausa, continuação e cancelamento cooperativo.
- [x] Fila sequencial de pesquisas.
- [x] Diagnóstico técnico e reconhecimento de telas de limitação.
- [x] CRM com etapas, Kanban, histórico, follow-up e lista de não contatar.
- [x] Enriquecimento de contatos públicos, incluindo CNPJ alfanumérico.
- [x] Google Sheets opcional e sincronização Supabase opcional.
- [x] Backup JSON, importação CSV/XLSX e exportação configurável.
- [x] Documentação de instalação, uso, arquitetura, privacidade e integrações.

## Próximas versões sugeridas

### 2.1 — Robustez operacional
- [ ] Testes E2E em Chrome real com cenários controlados.
- [x] Checkpoints persistentes e retomada prática da consulta ignorando leads já salvos.
- [ ] Melhor detecção de fusos/horários e tratamento de campos de endereço.
- [ ] Histórico de alterações do registro e auditoria de mesclagens.
- [ ] Fila de enriquecimento com tentativas retomáveis.
- [ ] Sincronização em nuvem com controle de conflitos por campo.
- [ ] Exclusão lógica e sincronização de exclusões.

### 2.2 — CRM de equipe
- [ ] Múltiplos usuários e responsáveis compartilhados.
- [ ] Permissões por função e equipe.
- [ ] Tarefas e agenda comercial.
- [ ] Relatórios de conversão por vendedor e etapa.
- [ ] Campos personalizados e pipelines configuráveis.
- [ ] Histórico de consentimento e preferências de contato.

### 2.3 — Inteligência comercial
- [ ] Classificação de prioridade customizável por segmento.
- [ ] Pesquisa de concorrentes e presença digital comparativa.
- [ ] Enriquecimento por fontes comerciais autorizadas.
- [ ] Análise de cobertura por bairro com geocodificação.
- [ ] Relatórios de evolução da base e qualidade de dados.
- [ ] API própria para integração com sistemas externos.

## Critério de priorização

1. Não perder dados já capturados.
2. Não produzir duplicatas nem misturar empresas.
3. Mostrar claramente o que foi encontrado e o que não foi.
4. Evitar permissões desnecessárias e ações automáticas de contato.
5. Testar integração externa em ambiente de demonstração antes de produção.

## Como sugerir algo

Abra uma issue com o contexto, problema, resultado esperado e como validar a solução. Não anexe dados reais de clientes, senhas, tokens ou planilhas comerciais.
