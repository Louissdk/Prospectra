# Prospectra

**Prospectra 1.1.0** é uma extensão Manifest V3 para Chrome que transforma resultados do Google Maps em uma base organizada de prospecção local.

## Novidades da versão 1.1.0

- Pesquisa iniciada dentro da extensão com **termo + cidade/região**.
- Quantidade configurável de **1 a 500 leads** por coleta, sem o teto anterior de 40.
- Percurso progressivo da lista do Google Maps para carregar e processar resultados além do primeiro lote visível.
- Filtro de **nota mínima**: qualquer avaliação, 3,0+, 3,5+, 4,0+, 4,5+ ou 5,0. Leads abaixo do mínimo e leads sem avaliação identificável são descartados quando o filtro está ativo.
- Telefone normalizado em coluna própria, sem substituir o número por um link.
- Link `https://wa.me/` separado do telefone e do site oficial.
- Nome e categoria do lead em colunas independentes.
- Exportação **Excel `.xlsx` real**, com cabeçalho formatado, linhas alternadas, filtros, larguras de coluna ajustadas e primeira linha congelada.
- CSV atualizado com campos separados, incluindo telefone, WhatsApp, site, e-mail, categoria, cidade, termo e links.
- Migração dos registros antigos que tinham URLs do WhatsApp misturadas nos campos de telefone ou site.

## Instalação no Chrome

1. Baixe e extraia o ZIP da extensão.
2. Abra `chrome://extensions` no Chrome.
3. Ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta `Prospectra` que contém `manifest.json`.
6. Fixe o ícone do Prospectra na barra do Chrome.

## Como pesquisar

1. Abra o painel lateral do Prospectra.
2. Digite o segmento no campo **O que você quer encontrar?** (ex.: `clínicas odontológicas`).
3. Informe a cidade ou região (ex.: `Guarulhos, SP`).
4. Clique em **Pesquisar termo + cidade no Maps**.
5. Aguarde o Google Maps carregar os resultados.
6. Escolha a quantidade desejada (1 a 500) e a nota mínima.
7. Clique em **Coletar até a quantidade escolhida**.

A extensão percorre a lista de resultados progressivamente. A quantidade coletada depende dos resultados que o Google Maps realmente disponibilizar para aquela combinação de termo, cidade, filtros e sessão. Pedir 100 não significa que existem 100 resultados elegíveis. O painel informa quantos foram coletados e quantos foram descartados pelo critério de avaliação.

## Campos coletados

- Nome do lead.
- Categoria do lead.
- Telefone em texto simples e normalizado.
- Link direto do WhatsApp (`wa.me`), em coluna separada.
- Endereço.
- Site oficial informado na ficha pública.
- E-mails publicados encontrados no site e em páginas de contato.
- Nota e quantidade de avaliações.
- Cidade/região e termo pesquisado.
- Link da ficha no Google Maps.

O Google Maps normalmente não fornece e-mail diretamente. O Prospectra tenta localizá-lo no site público e em até duas páginas internas de contato/sobre. **“Não localizado” não significa que a empresa não tenha e-mail**: o endereço pode não estar publicado, estar protegido, ser carregado por JavaScript ou exigir interação.

## Exportação da planilha

Prefira **Excel (.xlsx)** para obter formatação de cabeçalho, filtros, largura de colunas, linhas alternadas e cabeçalho congelado. CSV também está disponível para importação em outros sistemas. O campo Telefone contém somente o número; o campo WhatsApp contém a URL `wa.me`; e o campo Site da empresa contém apenas o endereço do site, sem misturar canais.

## Permissões e privacidade

- `activeTab` e `scripting`: permitem ler a aba do Google Maps quando o usuário inicia a coleta.
- `storage`: mantém os leads no armazenamento local do Chrome.
- `sidePanel`: apresenta o painel lateral.
- `downloads`: permite exportar os dados.
- A permissão opcional `http://*/*` e `https://*/*` só é solicitada quando a busca automática de e-mails está marcada. Sem aprovação, a coleta de empresas continua, mas o enriquecimento de e-mails é pulado.
- Não existe conta, analytics, servidor próprio ou sincronização remota nesta versão.

## Limitações conhecidas

1. A estrutura HTML do Google Maps muda sem aviso. Seletores podem deixar de funcionar e exigir atualização.
2. A extensão tenta percorrer os resultados carregados por rolagem progressiva, mas o Google pode limitar a quantidade, aplicar filtros internos, ocultar cartões ou encerrar a paginação antes do número solicitado.
3. A abertura de fichas é sequencial para evitar sobrecarregar o Maps; coletas grandes podem demorar.
4. O Google pode apresentar CAPTCHA, exigir login ou limitar a navegação. O Prospectra não contorna CAPTCHA, login, paywall ou controles de acesso.
5. Alguns sites bloqueiam consultas, exigem JavaScript, Cloudflare, consentimento ou login. Nesses casos, o e-mail pode não ser localizado.
6. A extensão não garante que todos os leads tenham telefone, site ou e-mail: esses campos dependem da informação publicamente disponível em cada ficha e site.
7. Use a ferramenta conforme os termos dos serviços utilizados, a legislação aplicável e as regras de proteção de dados. Respeite pedidos de não contato.

## Desenvolvimento e testes

Requer Node.js 18+:

```bash
npm test
npm run check
```

O teste de workbook também grava `/tmp/prospectra-workbook-test.xlsx` para validação estrutural com ferramentas compatíveis com XLSX.

## Estrutura

```text
Prospectra/
├── manifest.json
├── service-worker.js
├── content.js
├── contact-utils.js
├── workbook.js
├── sidepanel.html
├── sidepanel.css
├── sidepanel.js
├── package.json
├── icons/
└── tests/
```

## Publicar no GitHub

A publicação utiliza GitHub CLI autenticado. Na pasta extraída, execute o arquivo diretamente:

```powershell
 gh auth login
 .\publicar-github.ps1 -Visibility Public
```

O script usa `$PSScriptRoot`, portanto deve ser executado como arquivo `.ps1`, não colado linha por linha no terminal.
