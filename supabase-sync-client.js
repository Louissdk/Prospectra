import { parsePostgrestTotal, buildRangeHeader } from './cloud-utils.js';

export async function readSupabaseLeadRows({
  fetchImpl = globalThis.fetch,
  projectUrl,
  headers = {},
  maxRecords = 20000,
  pageSize = 1000,
  onProgress = () => {}
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Função fetch indisponível para consultar o Supabase.');
  if (!projectUrl) throw new Error('URL do projeto Supabase ausente.');
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) throw new Error('Limite de registros remoto inválido.');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 5000) throw new Error('Tamanho de página Supabase inválido.');

  const rows = [];
  let expectedTotal = null;
  const endpoint = projectUrl.replace(/\/$/, '') + '/rest/v1/prospectra_leads?select=id,identity_key,payload,updated_at,deleted_at';

  for (let offset = 0; offset <= maxRecords; offset += pageSize) {
    const response = await fetchImpl(endpoint, {
      headers: {
        ...headers,
        'Range-Unit': 'items',
        Range: buildRangeHeader(offset, pageSize),
        Prefer: 'count=exact'
      }
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if (/deleted_at/i.test(detail)) {
        throw new Error('A tabela Supabase ainda não possui a coluna deleted_at. Execute novamente docs/supabase/schema.sql para aplicar a migração.');
      }
      throw new Error('Falha ao ler a tabela Supabase. Verifique SQL e RLS. ' + detail.slice(0, 180));
    }

    const total = parsePostgrestTotal(response.headers?.get?.('content-range') || '');
    if (total !== null) {
      if (expectedTotal !== null && total !== expectedTotal) {
        throw new Error('A contagem da nuvem mudou durante a paginação. Tente sincronizar novamente.');
      }
      expectedTotal = total;
      if (total > maxRecords) {
        throw new Error('A nuvem contém ' + total.toLocaleString('pt-BR') + ' registros, acima do limite de ' +
          maxRecords.toLocaleString('pt-BR') + '. A sincronização foi cancelada sem importar dados parciais.');
      }
    }

    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Resposta inválida ao consultar registros do Supabase.');
    if (batch.length > pageSize) throw new Error('O Supabase retornou uma página maior que o intervalo solicitado.');
    if (offset >= maxRecords && batch.length) {
      throw new Error('A nuvem ultrapassa o limite de ' + maxRecords.toLocaleString('pt-BR') + ' registros.');
    }

    rows.push(...batch);
    onProgress(rows.length, expectedTotal ?? maxRecords);
    if (batch.length < pageSize || (expectedTotal !== null && rows.length >= expectedTotal)) break;
  }

  if (expectedTotal !== null && rows.length !== expectedTotal) {
    throw new Error('Leitura incompleta da nuvem: ' + rows.length + ' de ' + expectedTotal + ' registros recebidos.');
  }
  return { rows, total: expectedTotal };
}

export async function upsertSupabaseLeadRows({
  fetchImpl = globalThis.fetch,
  projectUrl,
  headers = {},
  rows = [],
  batchSize = 200,
  onProgress = () => {}
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Função fetch indisponível para enviar registros ao Supabase.');
  if (!projectUrl) throw new Error('URL do projeto Supabase ausente.');
  if (!Array.isArray(rows)) throw new Error('A lista de registros para sincronização é inválida.');
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error('Tamanho do lote Supabase inválido.');
  }

  const endpoint = projectUrl.replace(/\/$/, '') + '/rest/v1/prospectra_leads?on_conflict=user_id,identity_key';
  let sent = 0;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error('Falha ao enviar lote ' + (Math.floor(offset / batchSize) + 1) + '. ' +
        detail.slice(0, 180) + ' Verifique schema, chave única e políticas RLS.');
    }
    sent += batch.length;
    onProgress(sent, rows.length);
  }
  return sent;
}
