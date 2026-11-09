import { toCsv } from './contact-utils.js';

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = 'prospectra_leads_v1';
const MAX_SAVED = 5000;
let leads = [];
let busy = false;

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.href;
  } catch { return ''; }
}

function normalizeLead(item) {
  const emails = [...new Set((Array.isArray(item.emails) ? item.emails : []).map((email) => String(email).trim().toLowerCase()).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
  return {
    id: item.id || crypto.randomUUID(),
    name: String(item.name || 'Empresa sem nome identificado').slice(0, 220),
    category: String(item.category || '').slice(0, 140),
    phone: String(item.phone || '').slice(0, 80),
    address: String(item.address || '').slice(0, 350),
    website: normalizeUrl(item.website || ''),
    emails,
    emailStatus: item.emailStatus || (emails.length ? 'found' : (item.website ? 'pending' : 'no_website')),
    rating: String(item.rating || ''),
    reviewCount: String(item.reviewCount || ''),
    mapsUrl: normalizeUrl(item.mapsUrl || ''),
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
  $('#enrichButton').disabled = value || !leads.some((lead) => lead.website && !lead.emails.length);
  $('#captureButton').querySelector('span:nth-child(2)').textContent = value ? 'Coleta em andamento…' : 'Coletar resultados visíveis';
}

function setProgress(done, total, label = 'Coletando empresas') {
  const wrap = $('#progressWrap');
  wrap.hidden = false;
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
        address: item.address || previous.address,
        website: item.website || previous.website,
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
    throw new Error('Abra uma aba do Google Maps e faça uma pesquisa antes de coletar.');
  }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  return tab;
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

async function capture(mode) {
  if (busy) return;
  const wantsEnrich = $('#autoEnrich').checked;
  // Solicita a permissão opcional diretamente a partir do clique do usuário.
  const permissionPromise = wantsEnrich
    ? chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] })
    : Promise.resolve(false);
  setBusy(true);
  $('#progressWrap').hidden = false;
  setProgress(0, 1, 'Conectando ao Google Maps');
  try {
    const tab = await getActiveMapsTab();
    setStatus(mode === 'open' ? 'Lendo a ficha aberta…' : 'Lendo cartões e abrindo fichas do Maps…');
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'PROSPECTRA_CAPTURE',
      mode,
      limit: Number($('#captureLimit').value)
    });
    if (!response?.ok) throw new Error(response?.error || 'A coleta não retornou resultados.');
    const incoming = (response.items || []).map((item) => normalizeLead({ ...item, collectedAt: new Date().toISOString() }));
    if (!incoming.length) throw new Error('Nenhuma empresa foi capturada.');
    mergeLeads(incoming);
    await saveLeads();
    setProgress(incoming.length, incoming.length, `${incoming.length} empresa(s) capturada(s)`);
    const withWebsite = incoming.filter((item) => item.website).length;
    setStatus(`${incoming.length} empresa(s) adicionada(s). ${withWebsite} com site identificado.`, 'success');
    if (wantsEnrich) {
      const permissionGranted = await permissionPromise;
      if (permissionGranted && withWebsite > 0) {
        setStatus(`Coleta concluída. Verificando e-mails de ${withWebsite} site(s)…`);
        const result = await enrichLeads(incoming.map((item) => leads.find((lead) => lead.mapsUrl === item.mapsUrl) || item));
        setStatus(`Concluído: ${incoming.length} empresa(s), ${withWebsite} site(s) e ${result.found} empresa(s) com e-mail localizado.`, 'success');
        setProgress(result.checked, result.checked || 1, 'Enriquecimento concluído');
      } else if (!permissionGranted) {
        setStatus(`Coleta concluída. ${withWebsite} site(s) identificado(s). A busca de e-mails foi pulada porque a permissão não foi concedida.`, 'success');
      }
    }
  } catch (error) {
    setStatus(error?.message || 'Não foi possível concluir a coleta.', 'error');
    $('#progressWrap').hidden = true;
  } finally {
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
  const phoneHtml = lead.phone
    ? `<div class="lead-detail"><span class="detail-icon">☎</span><span>${escapeHtml(lead.phone)}</span></div>` : '';
  const addressHtml = lead.address
    ? `<div class="lead-detail"><span class="detail-icon">⌖</span><span>${escapeHtml(lead.address)}</span></div>` : '';
  const mapHtml = lead.mapsUrl
    ? `<div class="lead-actions"><a class="text-action" href="${escapeHtml(lead.mapsUrl)}" target="_blank" rel="noopener noreferrer">Abrir no Google Maps ↗</a></div>` : '';
  return `<article class="lead-card">
    <div class="lead-top"><span class="lead-number">${index + 1}</span><div class="lead-main"><strong class="lead-name">${escapeHtml(lead.name)}</strong><span class="lead-category">${escapeHtml(lead.category || 'Categoria não identificada')}</span></div></div>
    <div class="lead-badges">${websiteBadge}<span class="badge ${emailClass}">${escapeHtml(emailLabel.toUpperCase())}</span></div>
    ${phoneHtml}${addressHtml}${siteHtml}
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
  $('#listCount').textContent = total.toLocaleString('pt-BR');
  $('#exportCsvButton').disabled = !total;
  $('#exportJsonButton').disabled = !total;
  $('#enrichButton').disabled = !leads.some((lead) => lead.website && !lead.emails.length) || busy;
  const filtered = leads.filter((lead) => {
    const haystack = [lead.name, lead.category, lead.phone, lead.address, lead.website, ...lead.emails].join(' ').toLowerCase();
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
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: true }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
}

function exportCsv() {
  if (!leads.length) return;
  const csv = toCsv(leads);
  downloadFile(`prospectra-leads-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
  setStatus('Arquivo CSV preparado para exportação.', 'success');
}

function exportJson() {
  if (!leads.length) return;
  downloadFile(`prospectra-leads-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(leads, null, 2), 'application/json');
  setStatus('Arquivo JSON preparado para exportação.', 'success');
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
    $('#tabStatus').textContent = isMaps ? 'Google Maps conectado nesta aba' : 'Abra o Google Maps para coletar';
  } catch { $('#tabStatus').textContent = 'Abra o Google Maps para coletar'; }
}

$('#captureButton').addEventListener('click', () => capture('visible'));
$('#captureOpenButton').addEventListener('click', () => capture('open'));
$('#searchInput').addEventListener('input', render);
$('#filterSelect').addEventListener('change', render);
$('#refreshButton').addEventListener('click', loadLeads);
$('#exportCsvButton').addEventListener('click', exportCsv);
$('#exportJsonButton').addEventListener('click', exportJson);
$('#enrichButton').addEventListener('click', enrichExisting);
$('#settingsButton').addEventListener('click', () => { $('#settingsPanel').hidden = !$('#settingsPanel').hidden; });
$('#closeSettingsButton').addEventListener('click', () => { $('#settingsPanel').hidden = true; });
$('#clearButton').addEventListener('click', async () => {
  if (!leads.length) return;
  if (!confirm('Apagar todos os leads salvos neste navegador? Esta ação não pode ser desfeita.')) return;
  leads = [];
  await saveLeads();
  setStatus('Todos os leads locais foram removidos.', 'success');
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'PROSPECTRA_PROGRESS') {
    setProgress(message.done || 0, message.total || 1, message.name ? `Abrindo: ${message.name}` : 'Lendo fichas do Maps');
  }
});

chrome.tabs.onActivated.addListener(updateTabStatus);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => { if (changeInfo.status === 'complete' || changeInfo.url) updateTabStatus(); });
loadLeads();
updateTabStatus();
