# Integração com Google Sheets

O Prospectra pode enviar os leads para uma planilha usando um Web App do Google Apps Script criado e controlado pelo usuário. A integração é opcional e não funciona até que o endpoint e o token sejam configurados.

## 1. Criar a planilha e o Apps Script

1. Crie uma planilha no Google Sheets.
2. Abra **Extensões → Apps Script**.
3. Apague o conteúdo inicial do editor.
4. Cole o código completo abaixo.
5. Salve o projeto.

## 2. Código do Apps Script

~~~javascript
const SHEET_NAME = 'Prospectra Leads';

function doPost(e) {
  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  try {
    // Serializa o ciclo ler → alterar → regravar para evitar perda em chamadas simultâneas.
    lock.waitLock(30000);
    lockAcquired = true;

    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('PROSPECTRA_TOKEN');
    const received = String(payload.token || '');
    delete payload.token;

    if (payload.action !== 'upsert') {
      return output({ ok: false, error: 'Ação inválida.' });
    }
    if (!expected || received !== expected) {
      return output({ ok: false, error: 'Token inválido ou não configurado.' });
    }
    const leads = Array.isArray(payload.leads) ? payload.leads : [];
    const deletedLeadKeys = Array.isArray(payload.deletedLeadKeys) ? payload.deletedLeadKeys : [];
    if (leads.length > 200 || deletedLeadKeys.length > 200) {
      return output({ ok: false, error: 'Lote inválido. Envie até 200 leads e 200 exclusões por requisição.' });
    }

    const headers = [
      'ID', 'Chave de identidade', 'Empresa', 'Categoria', 'Telefone', 'Telefones',
      'E-mails', 'Endereço', 'Cidade', 'Site', 'Status do site', 'CNPJ',
      'Instagram', 'Facebook', 'LinkedIn', 'Avaliação', 'Nº avaliações',
      'Etapa CRM', 'Responsável', 'Score', 'Etiquetas', 'Próximo follow-up',
      'Link Google Maps', 'Data da coleta', 'Última atualização',
      'Latitude', 'Longitude', 'Origem das coordenadas'
    ];

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
    if (sheet.getMaxColumns() < headers.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
    }
    const lastRow = sheet.getLastRow();
    const existing = lastRow > 1
      ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues()
      : [];
    const byIdentity = new Map();
    const byId = new Map();

    existing.forEach(function(row) {
      if (row[0]) byId.set(String(row[0]), row);
      const key = String(row[1] || row[0] || '');
      if (key) byIdentity.set(key, row);
    });

    leads.forEach(function(lead) {
      if (!lead || !lead.id) return;
      const social = lead.socialProfiles || {};
      const identityKey = String(lead.identityKey || lead.placeId || lead.mapsUrl || lead.id);
      const previous = byIdentity.get(identityKey) || byId.get(String(lead.id));
      if (previous) byIdentity.delete(String(previous[1] || previous[0]));

      const row = [
        lead.id, identityKey, lead.name || '', lead.category || '', lead.phone || '',
        (lead.phones || []).join(' | '), (lead.emails || []).join(' | '),
        lead.address || '', lead.city || '', lead.website || '',
        lead.websiteStatus || '', lead.cnpj || '',
        social.instagram || '', social.facebook || '', social.linkedin || '',
        lead.rating || '', lead.reviewCount || '', lead.stage || '',
        lead.owner || '', lead.qualityScore || 0, (lead.tags || []).join(' | '),
        lead.nextFollowUp || '', lead.mapsUrl || '', lead.collectedAt || '',
        lead.updatedAt || new Date().toISOString(),
        lead.latitude ?? '', lead.longitude ?? '', lead.coordinatesSource || ''
      ];
      byIdentity.set(identityKey, row.map(safeCell));
    });

    deletedLeadKeys.forEach(function(item) {
      const identityKey = String(item && item.identityKey || '');
      if (identityKey) byIdentity.delete(identityKey);
    });

    const rows = Array.from(byIdentity.values());
    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold').setBackground('#17365D').setFontColor('#FFFFFF');
    sheet.autoResizeColumns(1, headers.length);
    SpreadsheetApp.flush();

    return output({ ok: true, received: leads.length, deleted: deletedLeadKeys.length, total: rows.length });
  } catch (error) {
    return output({ ok: false, error: String(error && error.message || error) });
  } finally {
    if (lockAcquired) {
      try { lock.releaseLock(); } catch (releaseError) { console.error(releaseError); }
    }
  }
}


function safeCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return value;
  // Impede que dados externos sejam interpretados como fórmulas pelo Sheets.
  return /^[\s]*[=+\-@]/.test(value) ? "'" + value : value;
}

function output(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
~~~

## 3. Definir um token obrigatório

1. No Apps Script, abra **Configurações do projeto**.
2. Em **Propriedades do script**, adicione:
   - Nome: PROSPECTRA_TOKEN
   - Valor: um token aleatório longo e privado, diferente de senhas usadas em outros serviços.
3. Salve.

O mesmo token será inserido no Prospectra. A integração recusa requisições sem ele. **Não o coloque no código-fonte nem o publique no GitHub.**

## 4. Implantar como Web App

1. Clique em **Implantar → Nova implantação**.
2. Tipo: **App da Web**.
3. Executar como: sua conta Google.
4. Escolha o acesso permitido pela política da sua organização.
5. Implante e copie a URL do Web App, que deve terminar em /exec.

Se sua configuração permitir acesso amplo, proteja a implantação com o token forte e monitore o histórico de execuções. A escolha de acesso é responsabilidade do proprietário da planilha.

## 5. Configurar no Prospectra

1. Abra **Configurações → Google Sheets**.
2. Cole a URL do Web App.
3. Cole o token definido nas Propriedades do script.
4. Salve as configurações.
5. Clique em **Enviar leads** e conceda a permissão de host solicitada pelo Chrome.

O Prospectra envia lotes de até 200 leads e verifica o JSON de resposta do Apps Script. O script usa um bloqueio para serializar cada atualização e proteger o ciclo de leitura e gravação contra chamadas simultâneas. Em caso de falha parcial, a mensagem informa quantos registros foram confirmados. Reenviar a base atualiza as linhas pela chave de identidade, evitando duplicatas na mesma planilha. Exclusões locais são enviadas como tombstones e removidas da aba gerenciada pelo script; lotes de exclusões também são idempotentes.

## Segurança e limitações

- O token é enviado no corpo JSON da requisição POST, não na URL.
- Não compartilhe o token nem a URL de implantação com pessoas que não devam acessar a integração.
- A planilha e o Apps Script permanecem sob sua conta Google.
- O Apps Script neutraliza conteúdo textual que comece com `=`, `+`, `-` ou `@` antes de gravar, prevenindo que nomes e outros dados sejam interpretados como fórmulas.
- A aba Prospectra Leads é gerenciada pelo script. Leads removidos no Prospectra também são removidos dessa aba na próxima sincronização. Não use essa aba para anotações manuais; crie outra aba para observações.
- A primeira sincronização após migrar uma planilha antiga pode deixar linhas duplicadas se os registros não possuírem IDs ou chaves de identidade correspondentes. Faça uma cópia da planilha antes de atualizar o script.
- A comunicação entre o Chrome e Apps Script deve ser testada no seu próprio ambiente. Restrições de domínio, políticas organizacionais ou alterações no serviço podem impedir a chamada.
