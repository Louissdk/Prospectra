# Guia rápido do Prospectra

## 1. Instalar

1. Baixe o ZIP do repositório pelo botão **Code → Download ZIP**.
2. Extraia o ZIP em uma pasta permanente.
3. Abra chrome://extensions.
4. Ative Modo do desenvolvedor.
5. Clique em **Carregar sem compactação** e escolha a pasta que contém manifest.json.
6. Fixe a extensão e abra o painel.

Para atualizar uma instalação Git, use git pull --ff-only origin main na pasta do projeto e clique em Recarregar na página de extensões.

## 2. Fazer a primeira pesquisa

1. Na tela Visão geral, digite o segmento.
2. Digite cidade ou região.
3. Escolha a meta (1 a 500) ou 0 para percorrer o que o Maps disponibilizar.
4. Escolha a nota mínima.
5. Mantenha **Pular empresas já salvas** ativo para percorrer novamente sem duplicar os registros conhecidos.
6. Clique em **Abrir pesquisa no Maps**.
7. Espere a pesquisa carregar.
8. Volte ao painel e clique em **Iniciar coleta**.

A coleta abre as fichas individualmente, lê os dados públicos disponíveis e volta à lista. Os resultados confirmados são salvos em lotes.

## 3. Pausar e continuar

Durante a coleta, use **Pausar** para interromper a navegação entre etapas e **Continuar** para retomar. **Cancelar** pede o encerramento cooperativo. Lotes já confirmados permanecem salvos.

O Prospectra grava um checkpoint com a consulta, meta, nota mínima, último estabelecimento processado e contadores. Se a coleta for interrompida, abra a área **Pesquisas** e use **Retomar pesquisa**. A extensão recria ou reativa a pesquisa na fila e começa novamente pela lista do Maps, ignorando os leads que já foram confirmados no IndexedDB. O checkpoint não restaura a posição exata da rolagem; ele permite continuar a mesma pesquisa sem duplicar o que já foi salvo.

## 4. Usar fila de pesquisas

1. Abra a área Pesquisas.
2. Informe segmento, região, meta e nota mínima.
3. Clique em **Adicionar à fila**.
4. Repita para outras combinações.
5. Clique em **Executar fila**.

A fila processa uma pesquisa por vez na aba do Maps. Pesquisas parcialmente concluídas podem ser executadas novamente. Os registros já salvos são ignorados quando a opção de pular existentes estiver ativa.

## 5. Trabalhar no CRM

Na área Leads:

- atualize a etapa comercial pelo seletor do cartão;
- registre ligação, reunião, mensagem ou observação;
- agende data e hora de retorno;
- adicione etiquetas;
- atribua o responsável;
- marque a empresa como Não contatar.

Na área Funil, arraste os cartões entre as sete etapas comerciais.

O score de qualidade indica completude dos dados. Ele não mede interesse, capacidade financeira ou intenção real de compra.

## 6. Abordagem pelo WhatsApp

O botão WhatsApp abre uma conversa com texto pré-preenchido. O Prospectra não envia mensagens automaticamente. Revise a mensagem, confirme se o contato é apropriado e decida manualmente se deseja enviar.

Os leads marcados como Não contatar não exibem o botão de mensagem pronta.

## 7. Enriquecer contatos

Marque **Enriquecer dados automaticamente** antes da coleta. O Chrome pode solicitar permissão para consultar sites HTTP/HTTPS. O Prospectra tenta verificar a página principal e páginas públicas de contato do mesmo domínio.

A consulta MX verifica registros do domínio por DNS sobre HTTPS. Um MX encontrado não significa que o endereço de e-mail existe, está ativo ou aceitará mensagens.

## 8. Exportar e importar

- **Excel:** exporta a base completa como XLSX formatado.
- **CSV:** exporta os registros filtrados.
- **Campos selecionados:** escolha campos e um preset de cabeçalhos básicos para CRM.
- **Backup JSON:** guarda leads, atividades, pesquisas, fila e configurações.
- **Importar Excel XLSX:** lê a primeira planilha do arquivo, com suporte a strings compartilhadas e inline.
- **Importar CSV:** mescla registros com a base local e tenta deduplicar.
- **Restaurar JSON:** restaura um backup completo e mescla os leads.

Arquivos XLSX protegidos por senha ou com ZIP64 não são suportados. Em planilhas com múltiplas abas, a importação usa a primeira aba listada no arquivo XLSX.

## 9. Lembretes de follow-up

Na área Configurações, ative **Ativar lembretes de follow-up**. O Chrome solicitará permissões opcionais de alarmes e notificações. Quando o retorno vencer, o navegador exibirá um alerta.

A extensão não envia e-mails ou mensagens para o lead. O alerta serve somente para lembrar o operador.

## 10. Google Sheets

O envio depende de um Web App do Google Apps Script criado e implantado pelo usuário. Consulte [Integração com Google Sheets](integrations/google-sheets.md).

## 11. Supabase

A sincronização entre dispositivos depende de projeto Supabase, tabela e políticas RLS configuradas. Consulte [Integração com Supabase](integrations/supabase.md) e aplique o [schema SQL](supabase/schema.sql).

## 12. Backup antes de atualizar

Antes de trocar de computador, reinstalar o Chrome ou limpar dados do navegador, gere um Backup JSON. A base local não é automaticamente sincronizada sem a configuração do Supabase.
