import { extractContactLinks, extractEmails, isPublicHttpUrl, isSafeSameSiteRedirect } from './contact-utils.js';
import { extractCnpj, extractPhones, extractPublicProfiles, classifyEmail, isDoNotContact } from './crm-utils.js';
import { mergeLeadRecords } from './capture-utils.js';
import { loadAppState, saveAppState, saveLeadBatch, saveCaptureCheckpoint, clearCaptureCheckpoint } from './db.js';

async function ensureFollowUpAlarm() {
  try {
    const granted = await chrome.permissions.contains({ permissions: ['alarms', 'notifications'] });
    if (granted) chrome.alarms.create('prospectra-followups', { periodInMinutes: 5 });
  } catch (error) {
    console.warn('[Prospectra] Alarmes de follow-up indisponíveis:', error);
  }
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
    console.error('[Prospectra] Não foi possível configurar o painel lateral:', error);
  });
  ensureFollowUpAlarm();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  ensureFollowUpAlarm();
});
chrome.alarms?.onAlarm?.addListener(async (alarm) => {
  if (alarm.name !== 'prospectra-followups') return;
  try {
    const state = await loadAppState();
    if (!state.settings?.followUpNotifications) return;
    const now = Date.now();
    const due = (state.leads || []).filter((lead) =>
      lead.nextFollowUp && Date.parse(lead.nextFollowUp) <= now &&
      !lead.followUpNotifiedAt && !isDoNotContact(lead, state.doNotContact || [])
    );
    for (const lead of due.slice(0, 15)) {
      const id = 'prospectra-followup-' + String(lead.id).replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
      chrome.notifications.create(id, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Follow-up: ' + String(lead.name || 'Lead Prospectra').slice(0, 90),
        message: 'Retorno agendado. Abra o Prospectra para consultar o histórico e os contatos.'
      });
      lead.followUpNotifiedAt = new Date().toISOString();
    }
    if (due.length) await saveAppState(state);
  } catch (error) {
    console.error('[Prospectra] Falha ao verificar follow-ups:', error);
  }
});
chrome.notifications?.onClicked?.addListener(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
  } catch (error) {
    console.warn('[Prospectra] Não foi possível abrir o painel pelo alerta:', error);
  }
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
  } finally { try { reader.releaseLock(); } catch {} }
  const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}
async function fetchPage(url, timeoutMs = 10000) {
  if (!isPublicHttpUrl(url)) throw new Error('Endereço bloqueado por segurança.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = new URL(url).href;
    let response = null;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (!isPublicHttpUrl(currentUrl)) throw new Error('Redirecionamento para endereço não permitido.');
      response = await fetch(currentUrl, {
        method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' }
      });
      if (response.type === 'opaqueredirect') {
        throw new Error('O redirecionamento não pôde ser validado pelo navegador e foi bloqueado por segurança.');
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error('O site retornou um redirecionamento sem destino legível.');
        const nextUrl = new URL(location, currentUrl).href;
        if (!isPublicHttpUrl(nextUrl) || !isSafeSameSiteRedirect(currentUrl, nextUrl)) {
          throw new Error('Redirecionamento para outro domínio bloqueado. Confirme o endereço do site antes de enriquecer.');
        }
        if (redirects === 5) throw new Error('O site excedeu o limite de cinco redirecionamentos.');
        currentUrl = nextUrl;
        continue;
      }
      break;
    }
    if (!response || !isPublicHttpUrl(response.url || currentUrl)) {
      throw new Error('O endereço final não passou pela validação de segurança.');
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
      throw new Error('O endereço não retornou uma página HTML.');
    }
    const html = await readLimitedBody(response);
    return { html, finalUrl: response.url || currentUrl, status: response.status, ok: response.ok, contentType };
  } finally { clearTimeout(timeout); }
}
function parseStructuredBusinessData(html = '') {
  const entries = [];
  const scripts = String(html).match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    entries.push(value);
    if (value['@graph']) visit(value['@graph']);
    if (value.mainEntity) visit(value.mainEntity);
  };
  for (const script of scripts) {
    const json = script.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    try { visit(JSON.parse(json)); } catch {}
  }
  const business = entries.find((item) => {
    const type = Array.isArray(item['@type']) ? item['@type'].join(' ') : String(item['@type'] || '');
    return /LocalBusiness|Organization|ProfessionalService|Store|MedicalBusiness|Restaurant|Dentist|AutoRepair/i.test(type);
  }) || entries[0] || {};
  const list = (value) => (Array.isArray(value) ? value : value ? [value] : []).map((item) =>
    typeof item === 'string' ? item : String(item?.name || item?.addressLocality || item?.['@id'] || '')
  ).filter(Boolean);
  const hourSpecs = Array.isArray(business.openingHoursSpecification)
    ? business.openingHoursSpecification
    : business.openingHoursSpecification ? [business.openingHoursSpecification] : [];
  return {
    areaServed: list(business.areaServed),
    openingHours: list(business.openingHours).concat(hourSpecs.map((item) =>
      [list(item.dayOfWeek).join(', '), item.opens, item.closes].filter(Boolean).join(' ')
    )).filter(Boolean).slice(0, 20),
    telephone: list(business.telephone),
    email: list(business.email),
    legalName: String(business.legalName || business.name || ''),
    businessType: list(business['@type'])
  };
}
function metaFromHtml(html = '') {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const description = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i) || [])[1] || '';
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '';
  const scripts = (html.match(/<script\b[^>]*src=["'][^"']+/gi) || []).join(' ').toLowerCase();
  const body = html.toLowerCase();
  const technologies = [];
  if (/wp-content|wp-includes/.test(body)) technologies.push('WordPress');
  if (/shopify|cdn\.shopify/.test(body)) technologies.push('Shopify');
  if (/wixstatic|wix\.com/.test(body)) technologies.push('Wix');
  if (/webflow/.test(body)) technologies.push('Webflow');
  if (/cdn\.jsdelivr\.net\/npm\/react|react(?:-dom)?\.production/.test(scripts)) technologies.push('React');
  if (/gtm\.js|google-tag-manager/.test(body)) technologies.push('Google Tag Manager');
  if (/googletagmanager\.com\/gtag/.test(body)) technologies.push('Google Analytics / gtag');
  return {
    title: title.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 250),
    description: description.replace(/<[^>]*>/g, ' ').trim().slice(0, 500),
    h1: h1.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 250),
    hasViewport: viewport,
    hasTitle: !!title.trim(),
    hasMetaDescription: !!description.trim(),
    technologies
  };
}
async function checkMx(domain) {
  const host = String(domain || '').toLowerCase().replace(/^www\./, '');
  if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)) return 'unknown';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const url = 'https://dns.google/resolve?name=' + encodeURIComponent(host) + '&type=MX';
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/dns-json' } });
    if (!response.ok) return 'unknown';
    const data = await response.json();
    if (Number(data.Status) !== 0) return 'missing';
    return Array.isArray(data.Answer) && data.Answer.some((record) => Number(record.type) === 15) ? 'found' : 'missing';
  } catch { return 'unknown'; }
  finally { clearTimeout(timer); }
}
async function enrichWebsite(website) {
  if (!isPublicHttpUrl(website)) {
    return { emails: [], phones: [], emailStatus: 'blocked', websiteStatus: 'blocked', pagesChecked: 0, message: 'Site inválido ou bloqueado.' };
  }
  const visited = new Set();
  const queue = [website];
  const emails = new Set();
  const phones = new Set();
  const cnpjs = new Set();
  let profiles = {};
  let meta = {};
  let structured = {};
  let finalUrl = website;
  let httpStatus = 0;
  let websiteStatus = 'unreachable';
  const errors = [];
  while (queue.length && visited.size < 5) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    try {
      const response = await fetchPage(url);
      finalUrl = response.finalUrl;
      httpStatus = response.status;
      websiteStatus = response.ok ? 'online' : 'http_error';
      if (!response.ok) {
        errors.push('O site respondeu HTTP ' + response.status + '.');
        continue;
      }
      for (const email of extractEmails(response.html)) emails.add(email);
      for (const phone of extractPhones(response.html)) phones.add(phone);
      for (const phone of extractPhones(JSON.stringify(parseStructuredBusinessData(response.html)))) phones.add(phone);
      for (const cnpj of extractCnpj(response.html)) cnpjs.add(cnpj);
      profiles = { ...profiles, ...extractPublicProfiles(response.html, finalUrl) };
      if (!Object.keys(meta).length) meta = metaFromHtml(response.html);
      if (!Object.keys(structured).length) structured = parseStructuredBusinessData(response.html);
      for (const email of structured.email || []) {
        if (extractEmails(email).length) emails.add(email.toLowerCase());
      }
      for (const phone of structured.telephone || []) phones.add(phone);
      if (visited.size === 1 && queue.length === 0) {
        for (const link of extractContactLinks(response.html, finalUrl, 4)) {
          if (!visited.has(link) && !queue.includes(link)) queue.push(link);
        }
      }
    } catch (error) {
      errors.push(error?.message || 'Falha ao consultar o site.');
      if (visited.size === 1) websiteStatus = 'unreachable';
    }
  }
  const emailList = [...emails].sort();
  const domain = (() => { try { return new URL(finalUrl).hostname; } catch { return ''; } })();
  const mxStatus = emailList.length ? await checkMx(emailList[0].split('@')[1]) : await checkMx(domain);
  const emailTypes = Object.fromEntries(emailList.map((email) => [email, classifyEmail(email)]));
  return {
    emails: emailList, emailTypes, phones: [...phones], cnpjs: [...cnpjs],
    socialProfiles: profiles, websiteStatus, httpStatus, finalUrl, pagesChecked: visited.size,
    areaServed: structured.areaServed || [], openingHours: structured.openingHours || [],
    legalName: structured.legalName || '', businessType: structured.businessType || [],
    mxStatus, websiteMeta: meta,
    emailStatus: emailList.length ? 'found' : (errors.length ? 'error' : 'not_found'),
    message: emailList.length ? emailList.length + ' e-mail(s) público(s) localizado(s).' :
      (errors[0] || 'Nenhum e-mail público localizado nas páginas verificadas.')
  };
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PROSPECTRA_CAPTURE_BATCH') {
    const items = Array.isArray(message.items) ? message.items : [];
    if (!items.length) { sendResponse({ ok: true, saved: 0 }); return false; }
    saveLeadBatch(items, mergeLeadRecords)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Não foi possível salvar o lote no IndexedDB.' }));
    return true;
  }
  if (message?.type === 'PROSPECTRA_SAVE_CHECKPOINT') {
    saveCaptureCheckpoint(message.checkpoint)
      .then((checkpoint) => sendResponse({ ok: true, checkpoint }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Não foi possível salvar o checkpoint.' }));
    return true;
  }
  if (message?.type === 'PROSPECTRA_CLEAR_CHECKPOINT') {
    clearCaptureCheckpoint()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Não foi possível limpar o checkpoint.' }));
    return true;
  }
  if (message?.type === 'PROSPECTRA_SET_FOLLOWUPS') {
    if (message.enabled) chrome.alarms.create('prospectra-followups', { periodInMinutes: 5 });
    else chrome.alarms.clear('prospectra-followups');
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === 'PROSPECTRA_PROGRESS' || message?.type === 'PROSPECTRA_HEARTBEAT' || message?.type === 'PROSPECTRA_CAPTURE_COMPLETE') {
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
