# Checklist de release do Prospectra

## Antes de publicar

- [ ] Revisar alterações e confirmar que não há credenciais, tokens ou dados pessoais.
- [ ] Atualizar versão em package.json e manifest.json.
- [ ] Atualizar CHANGELOG.md com recursos e limitações.
- [ ] Atualizar README e documentação afetada.
- [ ] Executar npm run verify em Node.js 20+.
- [ ] Confirmar que o workflow GitHub Actions ficou verde.
- [ ] Instalar a pasta em um perfil Chrome limpo.
- [ ] Testar migração de uma base de versão anterior.
- [ ] Testar interrupção da coleta, persistência do checkpoint e retomada pela fila sem duplicar os leads salvos.
- [ ] Testar coleta manual controlada no Maps.
- [ ] Testar backup e restauração.
- [ ] Testar Google Sheets e Supabase em ambientes próprios de teste.
- [ ] Testar opções de Não contatar e follow-up.
- [ ] Testar validação de CNPJ numérico e alfanumérico com exemplos conhecidos da Receita Federal.
- [ ] Revisar permissões do Manifest e mensagens de consentimento.
- [ ] Criar um backup antes de atualizar instalações de uso real.

## Na publicação

- [ ] Criar tag Git com a versão.
- [ ] Criar GitHub Release com resumo do changelog.
- [ ] Anexar ZIP da extensão sem node_modules.
- [ ] Conferir instalação a partir do ZIP baixado.
- [ ] Atualizar instruções de instalação e atualização.

## Depois

- [ ] Monitorar issues e regressões.
- [ ] Registrar problemas reproduzíveis.
- [ ] Priorizar correções antes de acrescentar mais recursos.
