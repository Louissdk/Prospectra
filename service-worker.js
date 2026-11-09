import { extractContactLinks, extractEmails, isPublicHttpUrl } from './contact-utils.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
    console.error('[Prospectra] Não foi possível configurar o painel lateral:', error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

async function readLimitedBody(response, maxBytes = 1_200_000) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

async function fetchPage(url, timeoutMs = 8500) {
  if (!isPublicHttpUrl(url)) throw new Error('Endereço bloqueado por segurança.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' }
    });
    if (!isPublicHttpUrl(response.url || url)) throw new Error('Redirecionamento para endereço não permitido.');
    if (!response.ok) throw new Error(`O site respondeu HTTP ${response.status}.`);
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
      throw new Error('O endereço não retornou uma página HTML.');
    }
    const html = await readLimitedBody(response);
    return { html, finalUrl: response.url || url };
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichWebsite(website) {
  if (!isPublicHttpUrl(website)) {
    return { emails: [], emailStatus: 'blocked', pagesChecked: 0, message: 'Site inválido ou bloqueado.' };
  }
  const visited = new Set();
  const queue = [website];
  const emails = new Set();
  const errors = [];
  while (queue.length && visited.size < 3) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    try {
      const { html, finalUrl } = await fetchPage(url);
      for (const email of extractEmails(html)) emails.add(email);
      if (visited.size === 1 && queue.length === 0) {
        for (const link of extractContactLinks(html, finalUrl, 2)) {
          if (!visited.has(link)) queue.push(link);
        }
      }
    } catch (error) {
      errors.push(error?.message || 'Falha ao consultar o site.');
    }
  }
  const list = [...emails].sort();
  return {
    emails: list,
    emailStatus: list.length ? 'found' : (errors.length && visited.size === 1 ? 'error' : 'not_found'),
    pagesChecked: visited.size,
    message: list.length ? `${list.length} e-mail(s) localizado(s).` :
      (errors[0] || 'Nenhum e-mail público localizado nas páginas verificadas.')
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PROSPECTRA_PROGRESS' ||
      message?.type === 'PROSPECTRA_CAPTURE_BATCH' ||
      message?.type === 'PROSPECTRA_CAPTURE_COMPLETE') {
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'PROSPECTRA_ENRICH') {
    enrichWebsite(message.website)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Erro ao consultar o site.' }));
    return true;
  }
  return false;
});
