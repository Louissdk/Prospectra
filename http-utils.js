export async function readLimitedTextBody(response, maxBytes = 1_200_000) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('Limite de leitura HTTP inválido.');
  }
  if (!response || typeof response.text !== 'function') {
    throw new Error('Resposta HTTP sem corpo legível.');
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error('A página pública excedeu o limite de ' + maxBytes.toLocaleString('pt-BR') + ' bytes; o enriquecimento foi interrompido.');
    }
    return text;
  }

  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw new Error('A página pública excedeu o limite de ' + maxBytes.toLocaleString('pt-BR') + ' bytes; o enriquecimento foi interrompido.');
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}
