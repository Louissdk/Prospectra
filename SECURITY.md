# Política de segurança

## Relato responsável

Não publique tokens, senhas, bases de leads ou detalhes exploráveis de uma vulnerabilidade em issues públicas.

Para relatar uma falha, entre em contato diretamente com o mantenedor por um canal privado associado ao projeto. Inclua:

- versão do Prospectra e versão do Chrome;
- passos mínimos para reproduzir;
- impacto observado;
- logs sanitizados, sem dados de clientes ou credenciais.

## Princípios de segurança

- As consultas de sites aceitam somente HTTP/HTTPS e validam o destino dos URLs.
- O service worker limita tempo e tamanho de respostas.
- Integrações em nuvem usam autenticação do usuário e políticas RLS.
- A chave service_role do Supabase nunca deve ser colocada na extensão.
- Senhas de conta não são persistidas pelo Prospectra.
- A extensão não tenta contornar CAPTCHA, login ou controles de acesso.
- Dados de leads ficam localmente no IndexedDB por padrão.
- Tokens de integração não são incluídos nos backups JSON.

Nenhum software é livre de risco. Faça backups e mantenha o Chrome atualizado.
