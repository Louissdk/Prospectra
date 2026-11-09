# Prospectra

**Prospectra** é uma extensão Manifest V3 para Chrome que transforma resultados visíveis do Google Maps em uma base local de prospecção.

## O que faz

- Captura empresas exibidas na lista de resultados do Google Maps.
- Abre fichas de empresas para tentar localizar nome, categoria, telefone, endereço, site, avaliação e link do Maps.
- Mostra explicitamente se um site foi identificado.
- Consulta o site e até duas páginas internas de contato/sobre para localizar e-mails publicados.
- Registra os resultados como `Encontrado`, `Não localizado`, `Sem site`, `Falha ao consultar` ou `Bloqueado`.
- Remove duplicados pelo link do Google Maps e atualiza dados de uma empresa já salva.
- Salva a base no armazenamento local do perfil do Chrome.
- Exporta CSV compatível com Excel (UTF-8, separador `;`, proteção contra fórmulas) e JSON.
- Permite buscar, filtrar e copiar e-mails.

## Instalação no Chrome

1. Baixe e extraia o ZIP da extensão.
2. Abra `chrome://extensions` no Chrome.
3. Ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta extraída `Prospectra` (a pasta que contém `manifest.json`).
6. Fixe o ícone da extensão na barra do Chrome.
7. Abra o Google Maps, pesquise um segmento e uma região, depois clique no ícone do Prospectra.
8. Use **Coletar resultados visíveis**. Para capturar mais empresas, role a lista do Google Maps para carregar mais resultados e execute outra coleta.

> O Chrome não instala extensões diretamente de um ZIP local. É preciso extrair o arquivo e usar **Carregar sem compactação**, ou publicar a extensão na Chrome Web Store.

## Como obter e-mails

O Google Maps normalmente não fornece o e-mail da empresa na ficha pública. O Prospectra tenta encontrá-lo no site informado pela própria ficha, procurando endereços `mailto:`, endereços presentes no HTML e páginas internas com nomes como `contato`, `fale conosco`, `sobre`, `equipe` e `atendimento`.

A extensão limita a consulta a três páginas por empresa nesta versão. Um e-mail só é exibido quando foi localizado publicamente. **“Não localizado” não significa que a empresa não tenha e-mail**: o endereço pode não estar publicado, estar protegido contra robôs, carregado por JavaScript ou escondido em outro canal.

## Permissões e privacidade

- `activeTab` e `scripting`: permitem ler a aba do Google Maps quando o usuário inicia a coleta.
- `storage`: mantém os leads no armazenamento local do Chrome.
- `sidePanel`: apresenta o painel lateral.
- `downloads`: permite exportar os dados.
- A permissão opcional `http://*/*` e `https://*/*` só é solicitada quando a busca automática de e-mails está marcada. O Chrome mostrará o pedido de acesso aos sites; sem aprovação, a coleta de empresas continua, mas o enriquecimento de e-mails é pulado.
- Não existe conta, analytics, servidor próprio ou sincronização remota nesta versão.
- Os dados ficam no perfil local do navegador e podem ser apagados nas configurações do Prospectra.
- A consulta de um site pode revelar ao site o IP e os dados normais de conexão do usuário, como qualquer visita feita pelo navegador.

## Limitações importantes

1. A estrutura HTML do Google Maps muda sem aviso. Seletores podem deixar de funcionar e exigir atualização.
2. A extensão coleta os cartões que já estão carregados na lista. Role a lista para carregar mais empresas.
3. O Google pode limitar a navegação automatizada, apresentar CAPTCHA ou alterar o painel de detalhes.
4. Alguns sites bloqueiam consultas, exigem JavaScript, Cloudflare, consentimento ou login. Nesses casos, o e-mail pode não ser localizado.
5. A extensão não contorna CAPTCHA, login, paywall ou controles de acesso.
6. A coleta de dados deve respeitar os termos dos serviços utilizados, a legislação aplicável e as regras de proteção de dados. Use os contatos para finalidades legítimas e respeite solicitações de não contato.
7. Esta extensão é uma nova implementação Manifest V3. Ela não executa o backend Go/Playwright do projeto original dentro do Chrome.

## Desenvolvimento e testes

Requer Node.js 18+ para executar os testes utilitários:

```bash
node --test tests/contact-utils.test.mjs
```

Valide a sintaxe dos scripts:

```bash
node --check service-worker.js
node --check content.js
node --check sidepanel.js
```

## Estrutura

```text
Prospectra/
├── manifest.json
├── service-worker.js
├── contact-utils.js
├── content.js
├── sidepanel.html
├── sidepanel.css
├── sidepanel.js
├── icons/
└── tests/
```

## Privacidade e uso responsável

O Prospectra foi desenhado para organizar dados empresariais que estejam publicamente disponíveis. A existência de um e-mail publicado não representa consentimento para envio irrestrito de mensagens. Não utilize a extensão para spam, coleta de dados sensíveis ou contato após oposição do destinatário.

## Publicar no GitHub

O script `publicar-github.ps1` cria o repositório `Louissdk/Prospectra` e envia o código usando o GitHub CLI. No Windows, abra PowerShell na pasta extraída e execute:

```powershell
# Uma vez: instale https://cli.github.com/ e autentique sua conta
 gh auth login

# Cria o repositório público e envia o código
 .\publicar-github.ps1 -Visibility Public
```

Para manter o código privado, use `-Visibility Private`. O script não contém nem solicita token em texto: usa a sessão autenticada do GitHub CLI.
