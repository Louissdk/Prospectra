# Checklist de release do Prospectra

## Antes de publicar

- [ ] Revisar alterações e confirmar que não há credenciais, tokens ou dados pessoais.
- [ ] Atualizar versão em package.json e manifest.json.
- [ ] Atualizar CHANGELOG.md com recursos e limitações.
- [ ] Atualizar README e documentação afetada.
- [ ] Executar npm run verify em Node.js 20+.
- [ ] Confirmar que o workflow GitHub Actions ficou verde.
- [ ] Confirmar que o job package gerou o ZIP limpo e que manifest.json está na raiz do arquivo.
- [ ] Instalar a pasta em um perfil Chrome limpo.
- [ ] Testar migração de uma base de versão anterior.
- [ ] Testar interrupção da coleta, persistência do checkpoint e retomada pela fila sem duplicar os leads salvos.
- [ ] Testar coleta manual controlada no Maps.
- [ ] Testar backup e restauração.
- [ ] Confirmar que restaurar backup descarta o checkpoint da sessão anterior.
- [ ] Confirmar que remover uma pesquisa da fila ou limpar a fila invalida apenas o checkpoint vinculado a ela.
- [ ] Confirmar que apagar a base remove leads, interações, pesquisas, bloqueios, diagnósticos e checkpoint, preservando as configurações de integração.
- [ ] Testar Google Sheets e Supabase em ambientes próprios de teste.
- [ ] Testar opções de Não contatar e follow-up.
- [ ] Testar validação de CNPJ numérico e alfanumérico com exemplos conhecidos da Receita Federal.
- [ ] Revisar permissões do Manifest e mensagens de consentimento.
- [ ] Criar um backup antes de atualizar instalações de uso real.

## Na publicação

- [ ] Criar tag Git com a versão.
- [ ] Criar GitHub Release com resumo do changelog.
- [ ] Anexar ZIP da extensão sem node_modules, testes ou ferramentas de desenvolvimento. O workflow de tag v* gera e anexa esse pacote automaticamente.
- [ ] Conferir instalação a partir do ZIP baixado.
- [ ] Atualizar instruções de instalação e atualização.

## Depois

- [ ] Monitorar issues e regressões.
- [ ] Registrar problemas reproduzíveis.
- [ ] Priorizar correções antes de acrescentar mais recursos.


## Validação adicional da auditoria final

- [ ] Confirmar que o modo automático usa apenas permissões já concedidas e não abre prompts tardios depois de uma coleta longa.
- [ ] Autorizar novos domínios pela ação explícita "Enriquecer contatos pendentes" e confirmar consulta DNS/MX.
- [ ] Testar redirecionamento HTTP→HTTPS no mesmo domínio.
- [ ] Confirmar que redirecionamentos para outro domínio, IP privado e downgrade de HTTPS são bloqueados.
- [ ] Confirmar que a fila exibe contagem correta de concluídas, parciais, interrompidas e com falha.
- [ ] Validar parser com endereço sem número, com complemento, bairro e CEP em perfil Chrome de teste.

- [ ] Reexecutar o schema SQL Supabase em projeto de teste e confirmar a coluna deleted_at.
- [ ] Excluir um lead no dispositivo A, sincronizar e confirmar que ele não reaparece no dispositivo B.
- [ ] Recriar o mesmo lead depois da exclusão e confirmar a regra de atualização mais recente.
- [ ] Testar sincronização com tombstones e leads ativos próximos dos limites de 10.000 + 10.000.

- [ ] Coletar empresas com URLs de ficha que contenham e que não contenham coordenadas e confirmar que somente as primeiras aparecem na visualização geográfica.
- [ ] Abrir KML no Google Earth e GeoJSON em um visualizador GIS e confirmar os pontos em latitude/longitude corretos.
- [ ] Confirmar que CSV e XLSX incluem latitude, longitude e origem das coordenadas.
- [ ] Excluir um lead no dispositivo A, sincronizar e confirmar que ele não reaparece no dispositivo B.
- [ ] Testar migração SQL de deleted_at em projeto Supabase de homologação.

- [ ] Confirmar que o job `chromium-e2e` executa o content script em Chromium real.
- [ ] Repetir a captura manual em uma ficha real do Google Maps no Chrome estável, pois a fixture de navegador não substitui a validação ao vivo.
