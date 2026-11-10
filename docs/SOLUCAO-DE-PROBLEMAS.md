# Solução de problemas

## O Prospectra não reconhece cartões no Google Maps

1. Confira se a aba está em uma pesquisa com resultados, não apenas na página inicial.
2. Aguarde os cartões aparecerem.
3. Atualize a página do Maps.
4. Clique no botão de diagnóstico técnico do Prospectra.
5. Confira quantos links de ficha e contêineres visíveis foram encontrados.

Se houver zero links, a estrutura da página pode ter mudado ou o Maps pode não ter apresentado resultados. Envie o relatório de diagnóstico sem dados pessoais.

## A coleta fica parcial

A meta configurada não é uma promessa de quantidade existente. O Google Maps pode apresentar menos cartões do que o solicitado.

Confira no resultado:
- fichas analisadas;
- descartes pela nota mínima;
- registros já salvos e ignorados;
- quantidade coletada;
- motivo de parada.

Ative **Pular empresas já salvas** para percorrer a pesquisa novamente sem duplicar a base.

## O Google Maps exibe CAPTCHA ou verificação

O Prospectra interrompe a coleta quando identifica telas de verificação ou sinais de limitação. Não existe rotina para contornar CAPTCHA ou restrições. Siga os controles apresentados pelo próprio Google e respeite os limites do serviço.

## Nenhum e-mail foi localizado

Isso não significa que a empresa não tenha e-mail. O site pode não publicar endereços, renderizar contatos com JavaScript, usar proteção contra robôs, exigir consentimento/login ou bloquear requisições.

Confirme o site manualmente. A verificação MX avalia o domínio, não a caixa postal individual.

## Site aparece como erro

O status HTTP ou a consulta podem refletir bloqueio, timeout, redirecionamento não permitido ou conteúdo não HTML. Abra o site manualmente e verifique se está acessível no navegador.

## A base antiga não apareceu na versão 2.0

A migração ocorre na primeira abertura quando o registro legado prospectra_leads_v1 ainda existe no Chrome Storage. Confirme que você carregou a pasta correta da extensão e não removeu os dados do Chrome antes de abrir a versão nova.

Se a base não aparecer, não limpe o armazenamento. Verifique se a extensão antiga ainda está instalada e exporte seus dados, se possível.

## A fila de pesquisas não avança

- Mantenha o Chrome aberto.
- Confirme que o Maps concluiu o carregamento.
- Não feche a aba usada pela fila.
- Verifique se a extensão continua ativa.
- Pesquisas com status Parcial, Falha ou Interrompida podem ser executadas novamente.
- O carregamento de uma pesquisa pode levar alguns segundos a mais se o Maps alterar a URL ou demorar para carregar os resultados.

## O Google Sheets não recebe dados

1. Confirme se a implantação do Apps Script é do tipo Web App.
2. Confira se a URL termina em /exec e usa o domínio script.google.com.
3. Confira se a propriedade PROSPECTRA_TOKEN está definida no Apps Script.
4. Use o mesmo token nas configurações do Prospectra.
5. Veja a página de execuções do Apps Script.
6. Confirme a permissão de host solicitada pelo Chrome.

Consulte a [integração Google Sheets](integrations/google-sheets.md).

## A sincronização Supabase falha

Confirme Project URL, chave anon/public, usuário autenticado, tabela prospectra_leads e políticas RLS. Verifique se aplicou o schema SQL no projeto informado.

Nunca use a chave service_role na extensão.

Consulte a [integração Supabase](integrations/supabase.md).

## Notificações não aparecem

Ative a opção de lembretes de follow-up no Prospectra e conceda as permissões de alarmes e notificações. Confirme também se as notificações do Chrome estão habilitadas no sistema operacional.

## Falha ao importar XLSX

O parser aceita planilhas XLSX convencionais com strings compartilhadas ou inline. Arquivos criptografados por senha, estruturas ZIP64 e documentos corrompidos não são suportados. Salve uma cópia CSV no Excel ou LibreOffice e tente novamente.
