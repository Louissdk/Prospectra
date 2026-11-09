# Contribuindo com o Prospectra

Obrigado pelo interesse no projeto. O repositório é proprietário; contribuições externas precisam de autorização do mantenedor antes de serem incorporadas.

## Antes de alterar

1. Abra uma issue descrevendo o problema ou a melhoria.
2. Não inclua dados pessoais reais de leads, tokens, senhas ou arquivos de clientes.
3. Prefira fixtures sintéticas para testes.
4. Mantenha a interface em português brasileiro.
5. Preserve a compatibilidade com Chrome Manifest V3.

## Qualidade mínima

Antes de abrir um pull request, execute:

~~~powershell
npm install
npm run verify
~~~

## Diretrizes de código

- Use módulos ES e funções pequenas.
- Trate erros de permissão, rede, armazenamento e navegação.
- Não salve senhas em claro.
- Não embuta service_role keys, tokens privados ou credenciais.
- Integrações externas devem ser opcionais e iniciadas pelo usuário.
- Nunca contorne CAPTCHA, autenticação ou controles de acesso de terceiros.
- Inclua teste automatizado para correções de utilitários e fluxos importantes.

## Pull requests

Explique o comportamento anterior, o novo comportamento, limitações, como testar e se a mudança exige permissão ou configuração adicional.
