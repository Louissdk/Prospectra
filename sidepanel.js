import { buildWhatsAppUrl, normalizePhone, toCsv } from './contact-utils.js';
import { createXlsx } from './workbook.js';

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = 'prospectra_leads_v1';
const MAX_SAVED = 5000;
let leads = [];
let busy = false;
let activeCaptureTaskId = null;

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (url.hostname === 'wa.me' || (url.hostname === 'whatsapp.com' || url.hostname.endsWith('.whatsapp.com'))) return '';
    return url.href;
  } catch { return ''; }
}

function normalizeWhatsApp(value, phone = '') {
  return buildWhatsAppUrl(value) || buildWhatsAppUrl(phone);
}

function normalizeLead(item) {
  const emails = [...new Set((Array.isArray(item.emails) ? item.emails : []).map((email) => String(email).trim().toLowerCase()).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
  const rawPhone = String(item.phone || '').trim();
  const legacyWhatsapp = /(?:wa\.me\/|whatsapp\.com\/send)/i.test(rawPhone) ? rawPhone : '';
  const phone = legacyWhatsapp ? '' : normalizePhone(rawPhone);
  const websiteCandidate = String(item.website || '').trim();
  const legacyWebsiteWhatsapp = /(?:wa\.me\/|whatsapp\.com\/send)/i.test(websiteCandidate) ? websiteCandidate : '';
  const website = normalizeUrl(websiteCandidate);
  const whatsappUrl = normalizeWhatsApp(item.whatsappUrl || legacyWhatsapp || legacyWebsiteWhatsapp, phone);
  return {
    id: item.id || crypto.randomUUID(),
    name: String(item.name || 'Empresa sem nome identificado').slice(0, 220),
    category: String(item.category || '').slice(0, 140),
    phone: phone.slice(0, 80),
    whatsappUrl,
    address: String(item.address || '').slice(0, 350),
    website,
    emails,
    emailStatus: item.emailStatus || (emails.length ? 'found' : (website ? 'pending' : 'no_website')),
    rating: String(item.rating || ''),
    reviewCount: String(item.reviewCount || ''),
    mapsUrl: normalizeUrl(item.mapsUrl || ''),
    searchTerm: String(item.searchTerm || '').slice(0, 120),
    city: String(item.city || '').slice(0, 120),
    source: item.source || 'Google Maps',
    collectedAt: item.collectedAt || new Date().toISOString(),
    captureNote: String(item.captureNote || '')
  };
}

async function loadLeads() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  leads = (Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : []).map(normalizeLead);
  render();
}

async function saveLeads() {
  leads = leads.slice(0, MAX_SAVED);
  await chrome.storage.local.set({ [STORAGE_KEY]: leads });
  render();
}

function setStatus(message, type = '') {
  const element = $('#statusMessage');
  element.textContent = message;
  element.className = `status-message ${type}`.trim();
}

function setBusy(value) {
  busy = value;
  $('#captureButton').disabled = value;
  $('#captureOpenButton').disabled = value;
  $('#searchMapsButton').disabled = value;
  $('#enrichButton').disabled = value || !leads.some((lead) => lead.website && !lead.emails.length);
  $('#captureButton').querySelector('span:nth-child(2)').textContent = value ? 'Coleta em andamento…' : 'Coletar leads';
}

function setProgress(done, total, label = 'Coletando empresas') {
  const wrap = $('#progressWrap');
  wrap.hidden = false;
  if (Number(total) === 0) {
    $('#progressBar').style.width = '100%';
    $('#progressBar').classList.add('indeterminate');
    $('#progressValue').textContent = Number(done || 0).toLocaleString('pt-BR');
    $('#progressLabel').textContent = `${label} · sem limite fixo`;
    return;
  }
  $('#progressBar').classList.remove('indeterminate');
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  $('#progressBar').style.width = `${percent}%`;
  $('#progressValue').textContent = `${percent}%`;
  $('#progressLabel').textContent = label;
}

function mergeLeads(incoming) {
  const byKey = new Map(leads.map((lead) => [lead.mapsUrl || `${lead.name}|${lead.phone}`, lead]));
  for (const raw of incoming) {
    const item = normalizeLead(raw);
    const key = item.mapsUrl || `${item.name}|${item.phone}`;
    const previous = byKey.get(key);
    if (previous) {
      byKey.set(key, normalizeLead({
        ...previous,
        ...item,
        phone: item.phone || previous.phone,
        whatsappUrl: item.whatsappUrl || previous.whatsappUrl,
        address: item.address || previous.address,
        website: item.website || previous.website,
        category: item.category || previous.category,
        city: item.city || previous.city,
        searchTerm: item.searchTerm || previous.searchTerm,
        emails: [...new Set([...(previous.emails || []), ...(item.emails || [])])],
        emailStatus: (item.emails?.length || previous.emails?.length) ? 'found' : (item.emailStatus || previous.emailStatus),
        collectedAt: previous.collectedAt
      }));
    } else byKey.set(key, item);
  }
  leads = [...byKey.values()].sort((a, b) => new Date(b.collectedAt) - new Date(a.collectedAt));
}

async function getActiveMapsTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || '') || !/google\.[^/]+\/maps/i.test(tab.url)) {
    throw new Error('Abra o Google Maps e aguarde os resultados carregarem antes de coletar.');
  }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  return tab;
}

async function searchMaps() {
  if (busy) return;
  const term = $('#searchTerm').value.trim();
  const city = $('#searchCity').value.trim();
  if (!term || !city) {
    setStatus('Informe o termo de pesquisa e a cidade ou região.', 'error');
    return;
  }
  const query = `${term} ${city}`;
  const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
  $('#searchMapsButton').disabled = true;
  setStatus(`Abrindo Google Maps: ${query}…`);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && /google\.[^/]+\/maps/i.test(tab.url || '')) {
      await chrome.tabs.update(tab.id, { url });
    } else {
      await chrome.tabs.create({ url, active: true });
    }
    setStatus('Pesquisa aberta no Google Maps. Aguarde os resultados carregarem e depois clique em Coletar.', 'success');
  } catch (error) {
    setStatus(error?.message || 'Não foi possível abrir a pesquisa no Google Maps.', 'error');
  } finally {
    $('#searchMapsButton').disabled = false;
  }
}

async function enrichLeads(items) {
  const targets = items.filter((item) => item.website && !item.emails.length);
  if (!targets.length) return { checked: 0, found: 0 };
  let cursor = 0;
  let found = 0;
  let checked = 0;
  const concurrency = 3;
  async function worker() {
    while (cursor < targets.length) {
      const index = cursor++;
      const target = targets[index];
      setProgress(checked, targets.length, `Localizando e-mails: ${checked + 1}/${targets.length}`);
      try {
        const response = await chrome.runtime.sendMessage({ type: 'PROSPECTRA_ENRICH', website: target.website });
        const result = response?.result;
        const current = leads.find((lead) => lead.id === target.id);
        if (current && response?.ok && result) {
          current.emails = [...new Set([...(current.emails || []), ...(result.emails || [])])];
          current.emailStatus = result.emailStatus || (current.emails.length ? 'found' : 'not_found');
          if (current.emails.length) found += 1;
        } else if (current) current.emailStatus = 'error';
      } catch {
        const current = leads.find((lead) => lead.id === target.id);
        if (current) current.emailStatus = 'error';
      }
      checked += 1;
      await saveLeads();
      setProgress(checked, targets.length, `Verificando sites: ${checked}/${targets.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return { checked, found };
}


function createCaptureWaiter(taskId) {
  let resolvePromise;
  let rejectPromise;
  let persistence = Promise.resolve();
  let inactivityTimer = null;
  const items = [];
  const armWatchdog = () => {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      rejectPromise(new Error('A coleta perdeu comunicação com a aba do Google Maps por 45 segundos. Os leads já salvos foram preservados. Recarregue a aba do Maps e tente novamente.'));
    }, 45000);
  };
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const listener = (message) => {
    if (!message || message.taskId !== taskId) return;
    armWatchdog();

    if (message.type === 'PROSPECTRA_CAPTURE_BATCH') {
      const batch = Array.isArray(message.items) ? message.items : [];
      items.push(...batch);
      persistence = persistence.then(async () => {
        mergeLeads(batch.map((item) => normalizeLead({
          ...item,
          collectedAt: new Date().toISOString()
        })));
        await saveLeads();
      }).catch((error) => {
        console.error('[Prospectra] Não foi possível salvar um lote durante a coleta:', error);
      });
      return;
    }

    if (message.type === 'PROSPECTRA_CAPTURE_COMPLETE') {
      clearTimeout(inactivityTimer);
      chrome.runtime.onMessage.removeListener(listener);
      persistence.then(() => {
        if (message.ok) resolvePromise({ ...message, items });
        else rejectPromise(new Error(message.error || 'Falha na coleta.'));
      });
    }
  };

  chrome.runtime.onMessage.addListener(listener);
  armWatchdog();
  return {
    promise,
    cancel: () => {
      clearTimeout(inactivityTimer);
      chrome.runtime.onMessage.removeListener(listener);
    }
  };
}

async function capture(mode) {
  if (busy) return;
  const wantsEnrich = $('#autoEnrich').checked;
  const rawLimit = $('#captureLimit').value.trim();
  const parsedLimit = rawLimit === '' ? 40 : Number(rawLimit);
  const requestedLimit = Number.isFinite(parsedLimit) && parsedLimit >= 0
    ? Math.min(5000, Math.floor(parsedLimit))
    : 40;
  const minRating = Number($('#minimumRating').value) || 0;
  const searchTerm = $('#searchTerm').value.trim();
  const city = $('#searchCity').value.trim();
  const permissionPromise = wantsEnrich
    ? chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] })
    : Promise.resolve(false);
  let waiter = null;
  let incoming = [];

  setBusy(true);
  $('#progressWrap').hidden = false;
  setProgress(0, requestedLimit, 'Conectando ao Google Maps');
  try {
    const tab = await getActiveMapsTab();
    const taskId = crypto.randomUUID();
    activeCaptureTaskId = taskId;
    waiter = createCaptureWaiter(taskId);

    const limitLabel = requestedLimit === 0
      ? 'todos os resultados disponíveis'
      : `${requestedLimit.toLocaleString('pt-BR')} empresas`;
    setStatus(mode === 'open' ? 'Lendo a ficha aberta…' :
      `Coletando ${limitLabel}${minRating ? ` com nota ${minRating.toLocaleString('pt-BR')}+` : ''}…`);

    // A aba confirma o início imediatamente. Os resultados chegam em lotes,
    // sem depender de uma única resposta pendente durante a navegação no Maps.
    const acknowledgement = await chrome.tabs.sendMessage(tab.id, {
      type: 'PROSPECTRA_CAPTURE_START',
      taskId,
      mode,
      limit: requestedLimit,
      minRating,
      searchTerm,
      city
    });
    if (!acknowledgement?.ok) {
      waiter.cancel();
      throw new Error(acknowledgement?.error || 'Não foi possível iniciar a coleta na aba do Maps.');
    }

    const response = await waiter.promise;
    incoming = (response.items || []).map((item) => normalizeLead(item));
    const filteredOut = Number(response.filteredOut || 0);
    if (!incoming.length) {
      setProgress(0, requestedLimit, 'Nenhum lead passou pelos filtros');
      setStatus(`Nenhum lead capturado. ${filteredOut} empresa(s) descartada(s) por avaliação abaixo do mínimo ou sem nota identificável.`, 'error');
      return;
    }

    mergeLeads(incoming);
    await saveLeads();
    const withWebsite = incoming.filter((item) => item.website).length;
    const withPhone = incoming.filter((item) => item.phone || item.whatsappUrl).length;
    const requestedText = requestedLimit === 0 ? 'todos os resultados disponíveis' : `${requestedLimit} solicitados`;
    const countMessage = `${incoming.length} lead(s) coletado(s) de ${requestedText}${filteredOut ? `; ${filteredOut} descartado(s) pela nota mínima` : ''}. ${withWebsite} com site e ${withPhone} com telefone/WhatsApp.`;
    setProgress(incoming.length + filteredOut, requestedLimit,
      requestedLimit === 0 ? `${incoming.length} leads encontrados` : `${incoming.length} de ${requestedLimit} leads coletados`);
    setStatus(countMessage, 'success');

    if (wantsEnrich) {
      const permissionGranted = await permissionPromise;
      if (permissionGranted && withWebsite > 0) {
        setStatus(`Coleta concluída. Verificando e-mails de ${withWebsite} site(s)…`);
        const result = await enrichLeads(incoming.map((item) => leads.find((lead) => lead.mapsUrl === item.mapsUrl) || item));
        setStatus(`${countMessage} ${result.found} empresa(s) com e-mail localizado.`, 'success');
      } else if (!permissionGranted) {
        setStatus(`${countMessage} Busca de e-mails não realizada: permissão não concedida.`, 'success');
      }
    }
  } catch (error) {
    setStatus(error?.message || 'Não foi possível concluir a coleta.', 'error');
    $('#progressWrap').hidden = true;
  } finally {
    waiter?.cancel();
    activeCaptureTaskId = null;
    setBusy(false);
  }
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function emailStatusLabel(lead) {
  if (lead.emails.length) return ['E-mail localizado', 'email'];
  if (!lead.website) return ['Sem site identificado', 'missing'];
  if (lead.emailStatus === 'pending') return ['Aguardando busca', 'pending'];
  if (lead.emailStatus === 'error') return ['Falha ao consultar', 'pending'];
  if (lead.emailStatus === 'blocked') return ['Site bloqueado', 'missing'];
  return ['E-mail não localizado', 'missing'];
}

function cardHtml(lead, index) {
  const [emailLabel, emailClass] = emailStatusLabel(lead);
  const websiteBadge = lead.website ? '<span class="badge site">SITE IDENTIFICADO</span>' : '<span class="badge missing">SEM SITE</span>';
  const emailsHtml = lead.emails.length
    ? lead.emails.map((email) => `<div class="email-entry"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a><button class="copy-button" data-copy="${escapeHtml(email)}" type="button">Copiar</button></div>`).join('')
    : `<span>${escapeHtml(emailLabel)}</span>`;
  const siteHtml = lead.website
    ? `<div class="lead-detail"><span class="detail-icon">↗</span><a href="${escapeHtml(lead.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(new URL(lead.website).hostname)}</a></div>`
    : '';
  const whatsappHtml = lead.whatsappUrl
    ? `<div class="lead-detail"><span class="detail-icon">◉</span><a href="${escapeHtml(lead.whatsappUrl)}" target="_blank" rel="noopener noreferrer">WhatsApp separado ↗</a></div>`
    : '';
  const phoneHtml = lead.phone
    ? `<div class="lead-detail"><span class="detail-icon">☎</span><span>${escapeHtml(lead.phone)}</span></div>` : '';
  const addressHtml = lead.address
    ? `<div class="lead-detail"><span class="detail-icon">⌖</span><span>${escapeHtml(lead.address)}</span></div>` : '';
  const ratingHtml = lead.rating ? `<span class="badge rating">★ ${escapeHtml(lead.rating)}${lead.reviewCount ? ` · ${escapeHtml(lead.reviewCount)} avaliações` : ''}</span>` : '';
  const mapHtml = lead.mapsUrl
    ? `<div class="lead-actions"><a class="text-action" href="${escapeHtml(lead.mapsUrl)}" target="_blank" rel="noopener noreferrer">Abrir no Google Maps ↗</a></div>` : '';
  return `<article class="lead-card">
    <div class="lead-top"><span class="lead-number">${index + 1}</span><div class="lead-main"><strong class="lead-name">${escapeHtml(lead.name)}</strong><span class="lead-category">${escapeHtml(lead.category || 'Categoria não identificada')}</span></div></div>
    <div class="lead-badges">${websiteBadge}<span class="badge ${emailClass}">${escapeHtml(emailLabel.toUpperCase())}</span>${ratingHtml}</div>
    ${phoneHtml}${whatsappHtml}${addressHtml}${siteHtml}
    <div class="lead-detail"><span class="detail-icon">@</span><div class="email-list">${emailsHtml}</div></div>
    ${mapHtml}
  </article>`;
}

function render() {
  const query = $('#searchInput').value.trim().toLowerCase();
  const filter = $('#filterSelect').value;
  const total = leads.length;
  const websites = leads.filter((lead) => !!lead.website).length;
  const emails = leads.filter((lead) => lead.emails.length > 0).length;
  $('#totalCount').textContent = total.toLocaleString('pt-BR');
  $('#websiteCount').textContent = websites.toLocaleString('pt-BR');
  $('#emailCount').textContent = emails.toLocaleString('pt-BR');
  $('#phoneCount').textContent = leads.filter((lead) => lead.phone || lead.whatsappUrl).length.toLocaleString('pt-BR');
  $('#listCount').textContent = total.toLocaleString('pt-BR');
  $('#exportXlsxButton').disabled = !total;
  $('#exportCsvButton').disabled = !total;
  $('#enrichButton').disabled = !leads.some((lead) => lead.website && !lead.emails.length) || busy;
  const filtered = leads.filter((lead) => {
    const haystack = [lead.name, lead.category, lead.phone, lead.city, lead.searchTerm, lead.address, lead.website, lead.whatsappUrl, ...lead.emails].join(' ').toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (filter === 'website' && !lead.website) return false;
    if (filter === 'email' && !lead.emails.length) return false;
    if (filter === 'noemail' && lead.emails.length) return false;
    return true;
  });
  const list = $('#leadList');
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">⌖</div><strong>${total ? 'Nenhum resultado para esse filtro' : 'Sua lista começa aqui'}</strong><span>${total ? 'Tente outro termo ou filtro.' : 'As empresas capturadas aparecerão neste painel.'}</span></div>`;
    return;
  }
  list.innerHTML = filtered.map((lead) => cardHtml(lead, leads.indexOf(lead))).join('');
  list.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        button.textContent = 'Copiado';
        setTimeout(() => { button.textContent = 'Copiar'; }, 1100);
      } catch { setStatus('O Chrome não permitiu copiar este e-mail.', 'error'); }
    });
  });
}

function downloadFile(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: true }, () => {
    if (chrome.runtime.lastError) setStatus(chrome.runtime.lastError.message, 'error');
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
}

function exportXlsx() {
  if (!leads.length) return;
  const workbook = createXlsx(leads);
  downloadFile(`prospectra-leads-${new Date().toISOString().slice(0, 10)}.xlsx`, workbook, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  setStatus(`Planilha Excel formatada preparada com ${leads.length} lead(s).`, 'success');
}

function exportCsv() {
  if (!leads.length) return;
  downloadFile(`prospectra-leads-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(leads), 'text/csv');
  setStatus(`CSV preparado com ${leads.length} lead(s).`, 'success');
}


async function enrichExisting() {
  if (busy) return;
  const targets = leads.filter((lead) => lead.website && !lead.emails.length);
  if (!targets.length) { setStatus('Não há sites pendentes de verificação.', 'success'); return; }
  const permissionPromise = chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] });
  setBusy(true);
  try {
    const granted = await permissionPromise;
    if (!granted) { setStatus('Permissão para consultar sites não concedida.', 'error'); return; }
    setStatus(`Verificando e-mails de ${targets.length} empresa(s)…`);
    const result = await enrichLeads(targets);
    setStatus(`Verificação concluída: ${result.checked} site(s) consultado(s), ${result.found} empresa(s) com e-mail localizado.`, 'success');
  } catch (error) {
    setStatus(error?.message || 'Falha ao verificar sites.', 'error');
  } finally {
    setBusy(false);
    render();
  }
}

async function updateTabStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isMaps = /google\.[^/]+\/maps/i.test(tab?.url || '');
    $('#tabStatus').textContent = isMaps ? 'Google Maps conectado nesta aba' : 'Pesquise um termo e cidade para começar';
  } catch { $('#tabStatus').textContent = 'Pesquise um termo e cidade para começar'; }
}

$('#searchMapsButton').addEventListener('click', searchMaps);
$('#captureButton').addEventListener('click', () => capture('visible'));
$('#captureOpenButton').addEventListener('click', () => capture('open'));
$('#searchInput').addEventListener('input', render);
$('#filterSelect').addEventListener('change', render);
$('#refreshButton').addEventListener('click', loadLeads);
$('#exportXlsxButton').addEventListener('click', exportXlsx);
$('#exportCsvButton').addEventListener('click', exportCsv);
$('#enrichButton').addEventListener('click', enrichExisting);
$('#clearButton').addEventListener('click', async () => {
  if (!leads.length) return;
  if (!confirm('Apagar todos os leads salvos neste navegador? Esta ação não pode ser desfeita.')) return;
  leads = [];
  await saveLeads();
  setStatus('Todos os leads locais foram removidos.', 'success');
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'PROSPECTRA_PROGRESS' && message.taskId === activeCaptureTaskId) {
    setProgress(message.done || 0, Number(message.total ?? 1), message.name ? `Processando: ${message.name}` : 'Lendo fichas do Maps');
  }
});

chrome.tabs.onActivated.addListener(updateTabStatus);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => { if (changeInfo.status === 'complete' || changeInfo.url) updateTabStatus(); });
loadLeads();
updateTabStatus();
