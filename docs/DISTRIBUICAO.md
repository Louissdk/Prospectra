# Distribuição do Prospectra

## Pacote instalável

O workflow GitHub Actions gera um ZIP de distribuição após a aprovação dos jobs de testes.

O pacote:
- contém o manifest.json na raiz do ZIP;
- inclui módulos JavaScript locais, painel, ícones e documentação;
- exclui tests/, node_modules/, .github/ e ferramentas de desenvolvimento;
- é validado antes de ser publicado como artefato do CI.

## Publicação de uma versão

1. Mescle a versão candidata aprovada na branch main.
2. Confirme que manifest.json e package.json têm a mesma versão.
3. Crie uma tag anotada, por exemplo v2.0.0, apontando para o commit aprovado.
4. Envie a tag ao GitHub.
5. O workflow repete os testes, gera o ZIP e cria ou atualiza a GitHub Release com o changelog.

Exemplo PowerShell após integrar a versão na main:

~~~powershell
git switch main
git pull --ff-only origin main
git tag -a v2.0.0 -m "Prospectra 2.0.0"
git push origin v2.0.0
~~~

Não crie a tag antes de validar a coleta no Chrome estável e as integrações Supabase/Google Sheets em projetos de homologação.

## Instalação pelo ZIP

1. Baixe o ZIP em Releases.
2. Extraia para uma pasta permanente.
3. Abra chrome://extensions.
4. Ative Modo do desenvolvedor.
5. Clique em Carregar sem compactação.
6. Selecione a pasta extraída que contém manifest.json.

Para atualizar, faça backup da base, extraia o novo ZIP em uma pasta nova e carregue a nova pasta. O banco IndexedDB pertence ao perfil Chrome e é mantido quando a extensão é atualizada no mesmo perfil/origem da extensão.
