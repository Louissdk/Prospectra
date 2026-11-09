import { buildWhatsAppUrl, normalizePhone, safeCsvCell, toCsv } from './contact-utils.js';
import { createXlsx } from './workbook.js';
import { parseXlsxRows } from './spreadsheet-import.js';
import { mergeLeadRecords, captureLeadAliases, summarizeCapture, captureResumeLabel, isResumableCheckpoint } from './capture-utils.js';
import {
  CRM_STAGES, DEFAULT_MESSAGE_TEMPLATE, DEFAULT_WEIGHTS, classifyEmail,
  isDoNotContact, normalizeCompanyName, normalizeLeadRecord, qualityScore, renderTemplate, identityKeyForLead
} from './crm-utils.js';
import { loadAppState, saveAppState, createBackup, validateBackup, loadCaptureCheckpoint } from './db.js';
import { normalizeSupabaseProjectUrl, parsePostgrestTotal, buildRangeHeader, isGoogleMapsUrl } from './cloud-utils.js';
import { enrichmentPermissionOrigins } from './permission-utils.js';
import { classifyQueueOutcome, summarizeQueueOutcomes } from './queue-utils.js';
import { MAX_DELETION_TOMBSTONES, normalizeDeletionTombstone, createDeletionTombstone, mergeDeletionTombstones, applyDeletionTombstones, pruneSupersededTombstones, buildSupabaseSyncRows } from './sync-utils.js';
import { getGeolocatedLeads, buildGeoJSON, buildKML, buildCoverageSvg } from './geo-utils.js';

const $ = (selector) => document.querySelector(selector);
const PAGE_SIZE = 50;
const MAX_LEADS = 10000;
const MAX_CLOUD_RECORDS = MAX_LEADS + MAX_DELETION_TOMBSTONES;
const EXPORT_FIELDS = [
  ['identityKey','Chave de identidade'],
  ['name','Empresa'],['category','Categoria'],['phone','Telefone'],['phones','Telefones'],
  ['address','Endereço'],['city','Cidade'],['website','Site'],['emails','E-mails'],
  ['emailStatus','Status do e-mail'],['mxStatus','DNS/MX'],['rating','Avaliação'],
  ['reviewCount','Nº avaliações'],['stage','Etapa CRM'],['owner','Responsável'],
  ['qualityScore','Qualidade'],['tags','Etiquetas'],['nextFollowUp','Próximo follow-up'],
  ['latitude','Latitude'],['longitude','Longitude'],['coordinatesSource','Origem das coordenadas'],
  ['cnpj','CNPJ'],['instagram','Instagram'],['facebook','Facebook'],['linkedin','LinkedIn'],
  ['openingHours','Horários'],['websiteStatus','Status do site'],['mapsUrl','Google Maps'],
  ['searchTerm','Termo pesquisado'],['collectedAt','Data da coleta']
];
let state = null;
let leads = [];
let busy = false;
let queueRunning = false;
let queueStopRequested = false;
let activeTask = null;
let lastCaptureCheckpoint = null;
let visibleLeadCount = PAGE_SIZE;
let activeCaptureItems = [];
let currentView = 'overview';

const stageLabel = (id) => CRM_STAGES.find((stage) => stage.id === id)?.label || 'Novo';
const safeExternal = (value) => {
  try { const url = new URL(String(value || '')); return ['http:','https:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
};
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]);
const formatDate = (value) => {
  if (!value) return 'Sem data';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
};
const makeId = () => crypto.randomUUID();

function normalizeCurrentLead(lead) {
  const normalized = normalizeLeadRecord(lead, state?.settings?.owner || '');
  normalized.qualityScore = qualityScore(normalized, state?.settings?.weights || {});
  return normalized;
}
function setStatus(message, type = '') {
  const node = $('#statusMessage');
  if (node) {
    node.textContent = message;
    node.className = ('status-message ' + type).trim();
  }
  const global = $('#globalStatus');
  if (global) {
    global.textContent = message;
    global.className = ('global-status visible ' + type).trim();
  }
}
function setBusy(value) {
  busy = value;
  $('#captureButton').disabled = value;
  $('#captureOpenButton').disabled = value;
  $('#searchMapsButton').disabled = value;
  if ($('#enrichPendingButton')) $('#enrichPendingButton').disabled = value || !leads.some((lead) => lead.website && !lead.emails?.length);
  $('#runQueueButton').disabled = value || queueRunning;
  $('#pauseButton').disabled = !value;
  $('#cancelButton').disabled = !value;
  $('#progressWrap').hidden = !value && !activeTask;
}
function setProgress(done, total, label) {
  $('#progressWrap').hidden = false;
  const totalNumber = Number(total || 0);
  if (!totalNumber) {
    $('#progressBar').classList.add('indeterminate');
    $('#progressBar').style.width = '100%';
    $('#progressValue').textContent = Number(done || 0).toLocaleString('pt-BR');
  } else {
    $('#progressBar').classList.remove('indeterminate');
    const percent = Math.max(0, Math.min(100, Math.round(Number(done || 0) / totalNumber * 100)));
    $('#progressBar').style.width = percent + '%';
    $('#progressValue').textContent = percent + '%';
  }
  $('#progressLabel').textContent = label || 'Processando';
}
async function persist() {
  state.deletedLeadKeys = mergeDeletionTombstones(state.deletedLeadKeys || []);
  leads = applyDeletionTombstones(leads.slice(0, MAX_LEADS), state.deletedLeadKeys);
  state.deletedLeadKeys = pruneSupersededTombstones(leads, state.deletedLeadKeys);
  state.leads = leads;
  state = await saveAppState(state);
  leads = state.leads;
  render();
}
async function load() {
  state = await loadAppState();
  lastCaptureCheckpoint = await loadCaptureCheckpoint().catch(() => null);
  state.settings = { ...state.settings, weights: { ...DEFAULT_WEIGHTS, ...(state.settings?.weights || {}) }, messageTemplate: state.settings?.messageTemplate || DEFAULT_MESSAGE_TEMPLATE };
  state.deletedLeadKeys = mergeDeletionTombstones(state.deletedLeadKeys || []);
  state.leads = applyDeletionTombstones(
    mergeLeadRecords([], (state.leads || []).map((lead) => normalizeCurrentLead(lead)), MAX_LEADS),
    state.deletedLeadKeys
  );
  state.deletedLeadKeys = pruneSupersededTombstones(state.leads, state.deletedLeadKeys);
  state.queue = (state.queue || []).map((item) => item.status === 'running' ? { ...item, status:'interrupted', message:'Execução interrompida; pode ser retomada.' } : item);
  leads = state.leads;
  renderSettings();
  render();
  if (state.migratedFromChromeStorage) setStatus('Migração concluída: seus leads antigos foram preservados no banco local IndexedDB.', 'success');
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('[data-view]').forEach((node) => node.classList.toggle('active', node.dataset.view === view));
  document.querySelectorAll('[data-view-target]').forEach((node) => node.classList.toggle('active', node.dataset.viewTarget === view));
  if (view === 'leads') renderLeads();
  if (view === 'pipeline') renderPipeline();
  if (view === 'research') renderResearch();
}
function mergeIncoming(items) {
  if (!Array.isArray(items) || !items.length) return;
  const tombstones = mergeDeletionTombstones(state.deletedLeadKeys || []);
  leads = applyDeletionTombstones(
    mergeLeadRecords(leads, items.map(normalizeCurrentLead), MAX_LEADS),
    tombstones
  );
  state.deletedLeadKeys = pruneSupersededTombstones(leads, tombstones);
  state.leads = leads;
}

function renderOverview() {
  const total = leads.length;
  const contact = leads.filter((lead) => lead.phone || lead.phones?.length || lead.emails?.length).length;
  const email = leads.filter((lead) => lead.emails?.length).length;
  const average = total ? Math.round(leads.reduce((sum, lead) => sum + qualityScore(lead, state.settings.weights), 0) / total) : 0;
  $('#totalCount').textContent = total.toLocaleString('pt-BR');
  $('#contactCount').textContent = contact.toLocaleString('pt-BR');
  $('#emailCount').textContent = email.toLocaleString('pt-BR');
  $('#qualityAverage').innerHTML = average + '<span>/100</span>';
  const counts = Object.fromEntries(CRM_STAGES.map((stage) => [stage.id, leads.filter((lead) => lead.stage === stage.id).length]));
  const max = Math.max(1, ...Object.values(counts));
  $('#stageSummary').innerHTML = CRM_STAGES.map((stage) => '<div class="stage-row"><span class="stage-name">' + stage.label + '</span><div class="stage-track"><div class="stage-fill" style="width:' + (counts[stage.id] / max * 100) + '%"></div></div><b class="stage-count">' + counts[stage.id] + '</b></div>').join('');
  const upcoming = leads.filter((lead) => lead.nextFollowUp && !lead.doNotContact).sort((a,b) => Date.parse(a.nextFollowUp)-Date.parse(b.nextFollowUp)).slice(0,5);
  $('#followUpSummary').innerHTML = upcoming.length ? upcoming.map((lead) => '<div class="followup-item"><div><strong>' + escapeHtml(lead.name) + '</strong><small>' + escapeHtml(lead.city || lead.category || 'Sem região') + '</small></div><span class="followup-date">' + formatDate(lead.nextFollowUp) + '</span></div>').join('') : '<div class="empty-state compact"><b>Sem follow-ups agendados</b><small>Agende o próximo contato diretamente no cartão do lead.</small></div>';
  const allCities = Object.entries(leads.reduce((map, lead) => { const city = (lead.city || 'Região não informada').trim(); map[city] = (map[city] || 0) + 1; return map; }, {})).sort((a,b) => b[1]-a[1]);
  const cities = allCities.slice(0,8);
  const geolocated = getGeolocatedLeads(leads);
  $('#cityCount').textContent = allCities.length + ' regiões';
  $('#geoCoverageNote').textContent = geolocated.length
    ? geolocated.length.toLocaleString('pt-BR') + ' de ' + total.toLocaleString('pt-BR') + ' lead(s) com coordenadas precisas. Os demais não possuem localização exata extraída.'
    : 'Nenhum lead possui coordenadas precisas ainda. O Prospectra não inventa pontos a partir do centro da cidade.';
  $('#coverageMap').innerHTML = geolocated.length
    ? buildCoverageSvg(geolocated)
    : '<div class="empty-state compact"><b>Mapa aguardando coordenadas</b><small>As coordenadas são capturadas quando a URL da ficha do Maps as disponibiliza.</small></div>';
  $('#exportGeoJsonButton').disabled = !geolocated.length;
  $('#exportKmlButton').disabled = !geolocated.length;
  $('#coverageSummary').innerHTML = cities.length ? cities.map(([city,count]) => '<div class="coverage-row"><a href="https://www.google.com/maps/search/' + encodeURIComponent(city) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(city) + '</a><div class="coverage-track"><div class="coverage-fill" style="width:' + (count / Math.max(1,cities[0][1]) * 100) + '%"></div></div><span class="coverage-count">' + count + '</span></div>').join('') : '<div class="empty-state compact"><b>Ainda sem cobertura</b><small>A cidade será preenchida pelas pesquisas e pelas fichas do Maps.</small></div>';
}

function stageOptions(selected) {
  return CRM_STAGES.map((stage) => '<option value="' + stage.id + '"' + (stage.id === selected ? ' selected' : '') + '>' + stage.label + '</option>').join('');
}
function emailBadge(lead) {
  if (lead.emails?.length) return '<span class="tag-pill">E-mail encontrado</span>';
  if (lead.emailStatus === 'error') return '<span class="tag-pill">Falha no site</span>';
  return '<span class="tag-pill">E-mail não localizado</span>';
}
function leadCard(lead) {
  const isDnc = isDoNotContact(lead, state.doNotContact || []);
  const phoneList = [...new Set([...(lead.phones || []), lead.phone].filter(Boolean))];
  const phoneHtml = phoneList.slice(0,4).map((phone) => '<a href="tel:' + escapeHtml(phone.replace(/[^\d+]/g,'')) + '">' + escapeHtml(phone) + '</a>').join('');
  const emailsHtml = (lead.emails || []).slice(0,4).map((email) => '<a href="mailto:' + escapeHtml(email) + '" title="' + escapeHtml(lead.emailTypes?.[email] || classifyEmail(email)) + '">' + escapeHtml(email) + '</a>').join('');
  const profiles = Object.entries(lead.socialProfiles || {}).filter(([,url]) => safeExternal(url));
  const activities = [...(lead.activities || [])].sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0)).slice(0,12);
  const activityHtml = activities.length
    ? '<details class="activity-history"><summary>Histórico de interações · ' + (lead.activities || []).length + '</summary>' +
      activities.map((activity) => '<div class="activity-entry"><b>' + escapeHtml(activity.type || 'nota') + '</b><span>' + escapeHtml(activity.note || '') + '</span><small>' + escapeHtml(formatDate(activity.createdAt)) + (activity.owner ? ' · ' + escapeHtml(activity.owner) : '') + '</small></div>').join('') +
      '</details>'
    : '';
  const profileHtml = profiles.map(([network,url]) => '<a href="' + escapeHtml(safeExternal(url)) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(network) + ' ↗</a>').join('');
  const site = safeExternal(lead.website);
  const maps = safeExternal(lead.mapsUrl);
  const whatsappNumber = lead.whatsappUrl || buildWhatsAppUrl(phoneList[0] || '');
  const message = renderTemplate(state.settings.messageTemplate || DEFAULT_MESSAGE_TEMPLATE, lead, state.settings.owner);
  let whatsapp = '';
  if (whatsappNumber && !isDnc) {
    try { const link = new URL(whatsappNumber); link.searchParams.set('text', message); whatsapp = link.href; } catch {}
  }
  const tags = (lead.tags || []).slice(0,5).map((tag) => '<span class="tag-pill">' + escapeHtml(tag) + '</span>').join('');
  const status = lead.closedStatus === 'permanently_closed' ? '<span class="tag-pill closed">Fechada permanentemente</span>' :
    lead.closedStatus === 'temporarily_closed' ? '<span class="tag-pill closed">Fechada temporariamente</span>' : '';
  const followUp = lead.nextFollowUp ? '<span class="tag-pill">Retorno: ' + formatDate(lead.nextFollowUp) + '</span>' : '';
  return '<article class="lead-card" data-lead-id="' + escapeHtml(lead.id) + '">' +
    '<div class="lead-head"><div class="lead-title"><h3>' + escapeHtml(lead.name) + '</h3><small>' + escapeHtml([lead.category,lead.city].filter(Boolean).join(' · ') || 'Categoria/região não identificada') + '</small></div><span class="score-pill">' + qualityScore(lead,state.settings.weights) + '/100</span></div>' +
    '<div class="lead-meta"><span class="tag-pill stage">' + stageLabel(lead.stage) + '</span>' + emailBadge(lead) + (lead.website ? '<span class="tag-pill">Site</span>' : '') + status + followUp + tags + '</div>' +
    '<div class="lead-info">' + (phoneHtml ? '<div>☎ ' + phoneHtml + '</div>' : '') + (emailsHtml ? '<div>@ ' + emailsHtml + '</div>' : '') +
    (site ? '<div>↗ <a href="' + escapeHtml(site) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(new URL(site).hostname) + '</a> · <span class="tag-pill">' + escapeHtml(lead.websiteStatus || 'não verificado') + '</span></div>' : '') +
    (lead.address ? '<div>⌖ <span>' + escapeHtml(lead.address) + '</span></div>' : '') +
    (lead.cnpj ? '<div>CNPJ <span>' + escapeHtml(lead.cnpj) + '</span></div>' : '') +
    (lead.areaServed?.length ? '<div>Área atendida <span>' + escapeHtml(lead.areaServed.join(', ')) + '</span></div>' : '') +
    (profileHtml ? '<div>◉ ' + profileHtml + '</div>' : '') +
    (maps ? '<div><a href="' + escapeHtml(maps) + '" target="_blank" rel="noopener noreferrer">Abrir ficha no Maps ↗</a></div>' : '') + '</div>' +
    '<div class="lead-controls"><select data-action="stage" data-id="' + escapeHtml(lead.id) + '" aria-label="Etapa comercial">' + stageOptions(lead.stage) + '</select><select data-action="owner" data-id="' + escapeHtml(lead.id) + '" aria-label="Responsável"><option value="">Sem responsável</option><option value="' + escapeHtml(state.settings.owner || '') + '"' + (lead.owner === state.settings.owner && state.settings.owner ? ' selected' : '') + '>' + escapeHtml(state.settings.owner || 'Responsável') + '</option><option value="__edit">Definir outro...</option></select></div>' +
    activityHtml +
    '<div class="lead-actions">' +
    (whatsapp ? '<a href="' + escapeHtml(whatsapp) + '" target="_blank" rel="noopener noreferrer">WhatsApp com mensagem ↗</a>' : '') +
    '<button data-action="activity" data-id="' + escapeHtml(lead.id) + '">+ Interação</button>' +
    '<button data-action="followup" data-id="' + escapeHtml(lead.id) + '">Agendar retorno</button>' +
    '<button data-action="tags" data-id="' + escapeHtml(lead.id) + '">Etiquetas</button>' +
    '<button data-action="owner-edit" data-id="' + escapeHtml(lead.id) + '">Responsável</button>' +
    '<button data-action="dnc" class="dnc" data-id="' + escapeHtml(lead.id) + '">' + (isDnc ? 'Remover bloqueio' : 'Não contatar') + '</button>' +
    '<button data-action="delete" class="delete" data-id="' + escapeHtml(lead.id) + '" aria-label="Excluir lead">Excluir</button></div></article>';
}
function getFilteredLeads() {
  const query = ($('#searchInput')?.value || '').trim().toLowerCase();
  const filter = $('#filterSelect')?.value || 'all';
  const sort = $('#sortSelect')?.value || 'recent';
  const now = Date.now();
  const filtered = leads.filter((lead) => {
    const haystack = [lead.name,lead.category,lead.phone,lead.city,lead.searchTerm,lead.address,lead.website,lead.cnpj,lead.owner,...(lead.phones||[]),...(lead.emails||[]),...(lead.tags||[])].join(' ').toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (filter === 'website' && !lead.website) return false;
    if (filter === 'email' && !lead.emails?.length) return false;
    if (filter === 'phone' && !(lead.phone || lead.phones?.length)) return false;
    if (filter === 'followup' && (!lead.nextFollowUp || Date.parse(lead.nextFollowUp) < now - 86400000)) return false;
    if (filter === 'dnc' && !isDoNotContact(lead,state.doNotContact||[])) return false;
    return true;
  });
  if (sort === 'score') filtered.sort((a,b) => qualityScore(b,state.settings.weights)-qualityScore(a,state.settings.weights));
  else if (sort === 'name') filtered.sort((a,b) => a.name.localeCompare(b.name,'pt-BR'));
  else if (sort === 'rating') filtered.sort((a,b) => Number(b.rating||0)-Number(a.rating||0));
  else if (sort === 'followup') filtered.sort((a,b) => (Date.parse(a.nextFollowUp)||Infinity)-(Date.parse(b.nextFollowUp)||Infinity));
  else filtered.sort((a,b) => (Date.parse(b.updatedAt||b.collectedAt)||0)-(Date.parse(a.updatedAt||a.collectedAt)||0));
  return filtered;
}
function renderLeads() {
  if (!state) return;
  const filtered = getFilteredLeads();
  $('#listCount').textContent = filtered.length.toLocaleString('pt-BR') + ' leads';
  $('#selectedHint').textContent = leads.length.toLocaleString('pt-BR') + ' na base total';
  $('#exportCsvButton').disabled = !filtered.length;
  $('#exportXlsxButton').disabled = !leads.length;
  $('#enrichPendingButton').disabled = busy || !leads.some((lead) => lead.website && !lead.emails?.length);
  const list = $('#leadList');
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state"><span class="empty-art">◎</span><b>Nenhum lead encontrado</b><small>Altere os filtros ou faça uma nova pesquisa no Maps.</small></div>';
    return;
  }
  const visible = filtered.slice(0,visibleLeadCount);
  list.innerHTML = visible.map(leadCard).join('');
  if (filtered.length > visible.length) {
    list.insertAdjacentHTML('beforeend','<button id="showMoreButton" class="button button-quiet button-full">Mostrar mais ' + Math.min(PAGE_SIZE,filtered.length-visible.length) + ' de ' + (filtered.length-visible.length) + '</button>');
    $('#showMoreButton').addEventListener('click',() => { visibleLeadCount += PAGE_SIZE; renderLeads(); });
  }
}
function renderPipeline() {
  const board = $('#pipelineBoard');
  board.innerHTML = CRM_STAGES.map((stage) => {
    const items = leads.filter((lead) => lead.stage === stage.id);
    return '<section class="pipeline-column" data-stage="' + stage.id + '"><div class="pipeline-column-head"><strong>' + stage.label + '</strong><span>' + items.length + '</span></div>' +
      items.slice(0,35).map((lead) => '<article class="pipeline-card" draggable="true" data-drag-id="' + escapeHtml(lead.id) + '"><strong>' + escapeHtml(lead.name) + '</strong><small>' + escapeHtml(lead.city || lead.category || '') + ' · ' + qualityScore(lead,state.settings.weights) + '/100</small></article>').join('') +
      (items.length > 35 ? '<small class="helper-text">Mostrando 35 de ' + items.length + '</small>' : '') + '</section>';
  }).join('');
}
function renderResearch() {
  const checkpointNotice=$('#checkpointNotice');
  const checkpointText=$('#checkpointText');
  const resumeButton=$('#resumeCheckpointButton');
  if (checkpointNotice && checkpointText && resumeButton) {
    checkpointNotice.hidden=!lastCaptureCheckpoint;
    checkpointText.textContent=lastCaptureCheckpoint?captureResumeLabel(lastCaptureCheckpoint):'';
    resumeButton.hidden=!isResumableCheckpoint(lastCaptureCheckpoint);
    resumeButton.disabled=busy||queueRunning;
  }
  $('#queueCount').textContent = state.queue.length;
  $('#queueList').innerHTML = state.queue.length ? state.queue.map((item) => '<div class="queue-item"><div><strong>' + escapeHtml(item.term) + ' · ' + escapeHtml(item.city) + '</strong><small>' + (item.limit === 0 ? 'Todos disponíveis' : item.limit + ' leads') + ' · nota ' + item.rating + '+ · ' + (item.collected || 0) + ' coletados</small></div><div><span class="queue-status">' + escapeHtml(item.status || 'pending') + '</span><button data-action="remove-queue" data-id="' + escapeHtml(item.id) + '" title="Remover">✕</button></div></div>').join('') : '<div class="empty-state compact"><b>Nenhuma pesquisa na fila</b><small>Adicione uma pesquisa acima para começar.</small></div>';
  $('#savedSearchList').innerHTML = state.searches.length ? state.searches.map((item) => '<div class="saved-search-item"><div><strong>' + escapeHtml(item.term) + ' · ' + escapeHtml(item.city) + '</strong><small>Salva em ' + formatDate(item.createdAt) + '</small></div><div><button data-action="queue-saved" data-id="' + escapeHtml(item.id) + '">Adicionar à fila</button><button data-action="remove-search" data-id="' + escapeHtml(item.id) + '">✕</button></div></div>').join('') : '<div class="empty-state compact"><b>Sem pesquisas salvas</b><small>Salve pesquisas recorrentes para reutilizá-las.</small></div>';
  $('#runQueueButton').disabled = queueRunning || !state.queue.some((item) => ['pending','interrupted','failed','partial'].includes(item.status));
  $('#stopQueueButton').hidden = !queueRunning;
}
function renderSettings() {
  const settings = state.settings || {};
  $('#ownerName').value = settings.owner || '';
  $('#messageTemplate').value = settings.messageTemplate || DEFAULT_MESSAGE_TEMPLATE;
  $('#followUpNotifications').checked = !!settings.followUpNotifications;
  $('#sheetsUrl').value = settings.sheetsUrl || '';
  $('#sheetsToken').value = settings.sheetsToken || '';
  $('#supabaseUrl').value = settings.supabaseUrl || '';
  $('#supabaseAnonKey').value = settings.supabaseAnonKey || '';
  $('#cloudStatus').textContent = settings.supabaseSession?.access_token ? 'Sessão conectada para ' + (settings.supabaseSession.user?.email || 'sua conta') + '.' : 'Desconectado. Configure o projeto e aplique o SQL do tutorial.';
  $('#exportFields').innerHTML = EXPORT_FIELDS.map(([key,label]) => '<label class="export-field"><input type="checkbox" value="' + key + '" checked> ' + label + '</label>').join('');
  $('#weightSettings').innerHTML = Object.entries(DEFAULT_WEIGHTS).map(([key,value]) => '<label class="weight-row"><span>' + ({phone:'Telefone',website:'Site',email:'E-mail',rating:'Avaliação',reviews:'Quantidade de avaliações',address:'Endereço',social:'Redes sociais',cnpj:'CNPJ',hours:'Horários',reachable:'Site acessível'}[key] || key) + '<input type="range" min="0" max="30" step="1" data-weight="' + key + '" value="' + (settings.weights?.[key] ?? value) + '"></span><output>' + (settings.weights?.[key] ?? value) + '</output></label>').join('');
}

function render() {
  renderOverview();
  if (currentView === 'leads') renderLeads();
  if (currentView === 'pipeline') renderPipeline();
  if (currentView === 'research') renderResearch();
  $('#footerVersion')?.replaceChildren(document.createTextNode('v2.0.0'));
}

function addActivity(lead, type, note) {
  const activity = { id:makeId(), leadId:lead.id, type, note:String(note||'').trim(), createdAt:new Date().toISOString(), owner:state.settings.owner||'' };
  lead.activities = [...(lead.activities||[]),activity];
  state.activities = [...(state.activities||[]),activity].slice(-20000);
  lead.updatedAt = new Date().toISOString();
}
async function updateLead(id, updater) {
  const lead = leads.find((item) => item.id === id);
  if (!lead) return;
  updater(lead);
  lead.updatedAt = new Date().toISOString();
  lead.qualityScore = qualityScore(lead,state.settings.weights);
  await persist();
}
async function handleLeadAction(action,id) {
  if (action === 'remove-queue') {
    const queued = state.queue.find((item) => item.id === id);
    if (!queued) return;
    if (queued.status === 'running' || queueRunning) {
      setStatus('Pare a fila antes de remover uma pesquisa em execução.','warning');
      return;
    }
    state.queue = state.queue.filter((item) => item.id !== id);
    await persist();
    if (lastCaptureCheckpoint?.queueItemId === id) await clearLastCaptureCheckpoint();
    renderResearch();
    return;
  }
  if (action === 'remove-search') {
    state.searches = state.searches.filter((item) => item.id !== id);
    await persist();
    renderResearch();
    return;
  }
  if (action === 'queue-saved') {
    const saved = state.searches.find((item) => item.id === id);
    if (!saved) return;
    state.queue.push({ ...saved,id:makeId(),status:'pending',collected:0,createdAt:new Date().toISOString() });
    await persist();
    renderResearch();
    return;
  }
  const lead = leads.find((item) => item.id === id);
  if (!lead) return;
  if (action === 'delete') {
    if (!confirm('Excluir "' + lead.name + '" da base? A exclusão será propagada para os outros dispositivos na próxima sincronização Supabase.')) return;
    const identityKey = lead.identityKey || identityKeyForLead(lead);
    if (!identityKey) { setStatus('Não foi possível gerar uma identidade segura para este lead.','error'); return; }
    const tombstone = createDeletionTombstone({ ...lead, identityKey });
    state.deletedLeadKeys = mergeDeletionTombstones(state.deletedLeadKeys || [], [tombstone]);
    leads = leads.filter((item) => item.id !== id);
    state.leads = leads;
    state.activities = [...(state.activities || []), {
      id:makeId(), type:'lead_deleted', leadId:id, identityKey, note:'Lead excluído e marcado para sincronização.',
      createdAt:new Date().toISOString()
    }].slice(-5000);
    await persist();
    setStatus('Lead excluído. A exclusão será sincronizada na próxima sincronização Supabase.','success');
    return;
  }
  if (action === 'activity') {
    const note = prompt('Registre a interação (ligação, reunião, mensagem ou observação):');
    if (note?.trim()) await updateLead(id,(item) => addActivity(item,'interaction',note));
  } else if (action === 'followup') {
    const current = lead.nextFollowUp ? lead.nextFollowUp.slice(0,16) : '';
    const value = prompt('Data e hora para retornar (AAAA-MM-DDTHH:MM):',current);
    if (value === null) return;
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) { setStatus('Data inválida. Use AAAA-MM-DDTHH:MM.','error'); return; }
    await updateLead(id,(item) => { item.nextFollowUp = date.toISOString(); item.followUpNotifiedAt=''; addActivity(item,'followup','Retorno agendado para ' + date.toLocaleString('pt-BR')); });
  } else if (action === 'tags') {
    const value = prompt('Etiquetas separadas por vírgula:',(lead.tags||[]).join(', '));
    if (value === null) return;
    await updateLead(id,(item) => { item.tags = [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0,20))]; addActivity(item,'tags','Etiquetas atualizadas.'); });
  } else if (action === 'owner-edit') {
    const value = prompt('Responsável por este lead:',lead.owner||state.settings.owner||'');
    if (value === null) return;
    await updateLead(id,(item) => { item.owner = value.trim(); addActivity(item,'owner','Responsável: ' + (value.trim()||'não atribuído')); });
  } else if (action === 'dnc') {
    const blocked = isDoNotContact(lead,state.doNotContact||[]);
    if (!blocked && !confirm('Adicionar ' + lead.name + ' à lista de não contatar? A extensão impedirá a abertura de uma mensagem pronta para este lead.')) return;
    await updateLead(id,(item) => {
      item.doNotContact = !blocked;
      if (!blocked) state.doNotContact = [...(state.doNotContact||[]),{ placeId:item.placeId||'',nameKey:normalizeCompanyName(item.name),phone:(item.phone||'').replace(/\D/g,''),createdAt:new Date().toISOString() }];
      else state.doNotContact = (state.doNotContact||[]).filter((entry) => !(entry.placeId && entry.placeId === item.placeId) && !(entry.nameKey && entry.nameKey === normalizeCompanyName(item.name)) && !(entry.phone && entry.phone === (item.phone||'').replace(/\D/g,'')));
      addActivity(item,'consent',blocked?'Removido da lista de não contatar.':'Marcado para não contatar.');
    });



  }
}

function renderExportValue(lead,key,preset) {
  const map = {
    identityKey:lead.identityKey || identityKeyForLead(lead),
    name:lead.name,category:lead.category,phone:lead.phone,email:(lead.emails||[])[0]||'',phones:(lead.phones||[]).join(' | '),
    address:lead.address,city:lead.city,website:lead.website,emails:(lead.emails||[]).join(' | '),
    emailStatus:lead.emailStatus,mxStatus:lead.mxStatus,rating:lead.rating,reviewCount:lead.reviewCount,
    stage:stageLabel(lead.stage),owner:lead.owner,qualityScore:qualityScore(lead,state.settings.weights),
    tags:(lead.tags||[]).join(' | '),nextFollowUp:lead.nextFollowUp,latitude:lead.latitude,longitude:lead.longitude,coordinatesSource:lead.coordinatesSource,cnpj:lead.cnpj,
    instagram:lead.socialProfiles?.instagram,facebook:lead.socialProfiles?.facebook,linkedin:lead.socialProfiles?.linkedin,
    openingHours:lead.openingHours,websiteStatus:lead.websiteStatus,mapsUrl:lead.mapsUrl,
    searchTerm:lead.searchTerm,collectedAt:lead.collectedAt
  };
  if (preset === 'hubspot') {
    const names = { name:'Company name',website:'Company domain name',phone:'Phone number',city:'City',category:'Industry',address:'Street address',owner:'Company owner',stage:'Lifecycle stage' };
    return map[key] ?? '';
  }
  return map[key] ?? '';
}
function exportSelectedCsv(rows = leads) {
  const keys = [...$('#exportFields').querySelectorAll('input:checked')].map((node) => node.value);
  if (!keys.length) { setStatus('Selecione pelo menos um campo para exportar.','warning'); return; }
  const preset = $('#crmExportPreset').value;
  const headerMap = { hubspot:{name:'Company name',website:'Company domain name',phone:'Phone number',city:'City',category:'Industry',address:'Street address',owner:'Company owner'}, pipedrive:{name:'Organization name',phone:'Phone',email:'Email',city:'City',website:'Website'}, salesforce:{name:'Company',phone:'Phone',city:'Billing City',website:'Website',category:'Industry'} };
  const headers = keys.map((key) => key === 'identityKey' ? 'Chave de identidade' : (headerMap[preset]?.[key] || EXPORT_FIELDS.find((field) => field[0] === key)?.[1] || key));
  const data = [headers,...rows.map((lead) => keys.map((key) => renderExportValue(lead,key,preset)))];
  const csv = '\uFEFF' + data.map((row) => row.map(safeCsvCell).join(';')).join('\r\n');
  downloadFile('prospectra-export-' + preset + '-' + new Date().toISOString().slice(0,10) + '.csv',csv,'text/csv');
  setStatus('CSV personalizado exportado com ' + rows.length + ' registro(s).','success');
}
function downloadFile(filename,content,mime) {
  const blob = content instanceof Blob ? content : new Blob([content],{type:mime+';charset=utf-8'});
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({url,filename,saveAs:true},() => {
    if (chrome.runtime.lastError) setStatus(chrome.runtime.lastError.message,'error');
    setTimeout(() => URL.revokeObjectURL(url),30000);
  });
}
function exportGeospatial(format) {
  const geolocated = getGeolocatedLeads(leads);
  if (!geolocated.length) {
    setStatus('Não há coordenadas precisas para exportar. Faça coletas em fichas do Maps que incluam coordenadas na URL.','warning');
    return;
  }
  const date = new Date().toISOString().slice(0,10);
  if (format === 'geojson') {
    downloadFile('prospectra-cobertura-' + date + '.geojson',JSON.stringify(buildGeoJSON(geolocated),null,2),'application/geo+json');
  } else {
    downloadFile('prospectra-cobertura-' + date + '.kml',buildKML(geolocated),'application/vnd.google-earth.kml+xml');
  }
  setStatus('Arquivo geográfico exportado com ' + geolocated.length.toLocaleString('pt-BR') + ' ponto(s) com coordenadas exatas.','success');
}

function exportXlsx() {
  if (!leads.length) return;
  downloadFile('prospectra-leads-' + new Date().toISOString().slice(0,10) + '.xlsx',createXlsx(leads),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  setStatus('Planilha Excel completa preparada.','success');
}
function rowsToLeads(rows, source = 'Importação CSV') {
  const headers=(rows.shift()||[]).map((value) => String(value ?? '').trim().toLowerCase());
  const find = (...names) => headers.findIndex((header) => names.includes(header));
  return rows.map((values) => {
    const value=(...names) => { const index=find(...names); return index>=0 ? String(values[index]||'').trim() : ''; };
    const emailText=value('e-mails encontrados','emails','email','e-mail','email address');
    return normalizeCurrentLead({
      identityKey:value('chave de identidade','identity key','identitykey'),
      name:value('nome do lead','nome','empresa','company name','organization name'),
      category:value('categoria do lead','categoria','industry'),
      phone:value('telefone','phone','phone number'),
      phones:value('telefones').split(/[|,]/).map((v)=>v.trim()).filter(Boolean),
      address:value('endereço','endereco','street address'),
      website:value('site da empresa','website','company domain name','site'),
      emails:emailText.split(/[|,;,]/).map((v)=>v.trim()).filter((v)=>v.includes('@')),
      emailStatus:value('status do e-mail','email status'),
      rating:value('avaliação (estrelas)','avaliação','rating'),
      reviewCount:value('quantidade de avaliações','nº avaliações','review count'),
      city:value('cidade / região','cidade','city','billing city'),
      latitude:value('latitude','lat'),longitude:value('longitude','lon','lng'),coordinatesSource:value('origem das coordenadas','coordinates source'),
      searchTerm:value('termo pesquisado','search term'),
      mapsUrl:value('link google maps','google maps','maps url'),
      stage:value('etapa crm','stage'),
      owner:value('responsável','owner'),
      tags:value('etiquetas','tags').split(/[|,]/).map((v)=>v.trim()).filter(Boolean),
      cnpj:value('cnpj'),
      source
    });
  }).filter((lead) => lead.name && lead.name !== 'Empresa sem nome identificado');
}
function parseCsv(text) {
  const content = String(text || '').replace(/^\uFEFF/,'');
  const delimiter = (content.split(/\r?\n/)[0].match(/;/g)||[]).length > (content.split(/\r?\n/)[0].match(/,/g)||[]).length ? ';' : ',';
  const rows=[]; let row=[], field='', quoted=false;
  for (let i=0;i<content.length;i++) {
    const char=content[i], next=content[i+1];
    if (char === '"' && quoted && next === '"') { field+='"'; i++; }
    else if (char === '"') quoted=!quoted;
    else if (char === delimiter && !quoted) { row.push(field); field=''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i++;
      row.push(field); if (row.some((value) => value.trim())) rows.push(row);
      row=[]; field='';
    } else field+=char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rowsToLeads(rows,'Importação CSV');
}
async function importFile(file) {
  const filename=String(file?.name||'').toLowerCase();
  let imported=[];
  if (filename.endsWith('.json')) {
    const backup=validateBackup(JSON.parse(await file.text()));
    const existing=leads.length;
    leads=mergeLeadRecords(leads,(backup.leads||[]).map(normalizeCurrentLead),MAX_LEADS);
    state={...state,...backup,leads};
    state.queue=(state.queue||[]).map((item)=>item.status==='running'?{...item,status:'interrupted',message:'Backup restaurado; execute novamente para retomar.'}:item);
    await persist();
    await clearLastCaptureCheckpoint();
    renderResearch();
    setStatus('Backup restaurado e mesclado: ' + (leads.length-existing) + ' novo(s) registro(s). O checkpoint anterior foi removido.','success');
    return;
  }
  if (filename.endsWith('.csv')) imported=parseCsv(await file.text());
  else if (filename.endsWith('.xlsx')) imported=rowsToLeads(await parseXlsxRows(file),'Importação Excel');
  else throw new Error('Formato não suportado. Use backup JSON, CSV ou Excel XLSX.');
  const previous=leads.length;
  mergeIncoming(imported);
  await persist();
  setStatus('Importação concluída: ' + imported.length + ' linha(s) válidas; ' + (leads.length-previous) + ' nova(s) empresa(s).','success');
}
async function exportBackup() {
  const content=await createBackup(state);
  downloadFile('prospectra-backup-' + new Date().toISOString().slice(0,10) + '.json',content,'application/json');
  setStatus('Backup completo gerado com leads, histórico, pesquisas e configurações.','success');
}

function setBusyStatus(tabId,taskId,paused) {
  activeTask = { tabId,taskId,paused:!!paused };
  $('#pauseButton').textContent = paused ? 'Continuar' : 'Pausar';
}
function createCaptureWaiter(taskId) {
  let resolvePromise,rejectPromise;
  let communicationTimer=null,progressTimer=null,lastStage='iniciando';
  const items=[];
  const clearTimers=()=>{clearTimeout(communicationTimer);clearTimeout(progressTimer);};
  const cleanup=()=>{clearTimers();chrome.runtime.onMessage.removeListener(listener);};
  const fail=(message)=>{cleanup();rejectPromise(new Error(message));};
  const armCommunication=()=>{clearTimeout(communicationTimer);communicationTimer=setTimeout(()=>fail('A aba do Maps deixou de responder por 90 segundos. Os lotes já salvos foram preservados.'),90000);};
  const armProgress=()=>{clearTimeout(progressTimer);progressTimer=setTimeout(()=>fail('A coleta ficou 60 segundos sem avançar. Última etapa: '+lastStage+'. Os registros salvos foram preservados.'),60000);};
  const promise=new Promise((resolve,reject)=>{resolvePromise=resolve;rejectPromise=reject;});
  const listener=(message)=>{
    if (!message || message.taskId !== taskId) return;
    armCommunication();
    if (message.type === 'PROSPECTRA_HEARTBEAT') return;
    if (message.type === 'PROSPECTRA_PROGRESS') {
      lastStage=String(message.name||'processando').slice(0,180);
      armProgress();
      setProgress(message.done||0,message.total??1,lastStage);
      return;
    }
    if (message.type === 'PROSPECTRA_CAPTURE_BATCH') {
      const batch=Array.isArray(message.items)?message.items:[];
      items.push(...batch);
      // O service worker já confirmou a gravação do lote no IndexedDB.
      // Aqui atualizamos somente a interface; não sobrescrevemos o estado completo durante a coleta.
      mergeIncoming(batch);
      state.leads=leads;
      render();
      lastStage='lote confirmado e salvo';armProgress();
      return;
    }
    if (message.type === 'PROSPECTRA_CAPTURE_COMPLETE') {
      cleanup();
      if (message.ok) resolvePromise({...message,items});
      else rejectPromise(new Error(message.error||'Falha na coleta.'));
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  armCommunication();armProgress();
  return {promise,cancel:cleanup};
}
async function requestEnrichmentPermission(items=[],{allowPrompt=true}={}) {
  const origins=enrichmentPermissionOrigins(items);
  if (!origins.length) return false;
  // O pedido precisa acontecer diretamente no clique do usuário. No fluxo pós-coleta,
  // apenas consultamos permissões existentes e adiamos o restante para o botão manual.
  return allowPrompt
    ? chrome.permissions.request({origins})
    : chrome.permissions.contains({origins});
}
async function enrichLeads(items,{force=false}={}) {
  const targets=items.filter((item)=>item.website && !item.emails?.length && (force || !item.enrichedAt || item.emailStatus==='pending' || item.websiteStatus==='unknown'));
  let cursor=0,checked=0,found=0;
  async function worker() {
    while(cursor<targets.length) {
      const target=targets[cursor++];
      setProgress(checked,targets.length,'Enriquecendo ' + (checked+1) + '/' + targets.length);
      try {
        const response=await chrome.runtime.sendMessage({type:'PROSPECTRA_ENRICH',website:target.website});
        if (!response?.ok) throw new Error(response?.error||'Falha no enriquecimento');
        const current=leads.find((lead)=>lead.id===target.id || (target.placeId && lead.placeId===target.placeId));
        if (current) {
          const result=response.result||{};
          current.emails=[...new Set([...(current.emails||[]),...(result.emails||[])])];
          current.phones=[...new Set([...(current.phones||[]),...(result.phones||[])])];
          current.phone=current.phone||current.phones[0]||'';
          current.cnpjs=[...new Set([...(current.cnpjs||[]),...(result.cnpjs||[])])];
          current.cnpj=current.cnpjs[0]||current.cnpj||'';
          current.emailTypes={...(current.emailTypes||{}),...(result.emailTypes||{})};
          current.socialProfiles={...(current.socialProfiles||{}),...(result.socialProfiles||{})};
          current.websiteStatus=result.websiteStatus||current.websiteStatus||'unknown';
          current.httpStatus=result.httpStatus||0;
          current.finalWebsiteUrl=result.finalUrl||current.website;
          current.mxStatus=result.mxStatus||'unknown';
          current.websiteMeta=result.websiteMeta||{};
          current.areaServed=result.areaServed||current.areaServed||[];
          current.openingHours=current.openingHours||result.openingHours?.join(' · ')||'';
          current.legalName=result.legalName||current.legalName||'';
          current.businessType=result.businessType||current.businessType||[];
          current.pagesChecked=result.pagesChecked||0;
          current.emailStatus=result.emailStatus||'not_found';
          current.enrichedAt=new Date().toISOString();
          current.sourceMap={...(current.sourceMap||{}),emails:'website',phones:'website',cnpj:'website',socialProfiles:'website'};
          current.confidence={...(current.confidence||{}),emails:current.emails.length?'high':'unknown',phones:current.phones.length?'medium':'unknown',cnpj:current.cnpj?'high':'unknown'};
          current.qualityScore=qualityScore(current,state.settings.weights);
          if (current.emails.length) found++;
        }
      } catch {
        const current=leads.find((lead)=>lead.id===target.id);
        if (current) { current.emailStatus='error'; current.websiteStatus=current.websiteStatus||'unknown'; }
      }
      checked++;
      state.leads=leads;
      await saveAppState(state);
      setProgress(checked,targets.length,'Sites verificados: '+checked+'/'+targets.length);
    }
  }
  await Promise.all(Array.from({length:Math.min(3,targets.length)},worker));
  render();
  return {checked,found};
}

async function enrichExistingLeads() {
  if (busy || queueRunning) return;
  const targets=leads.filter((lead)=>lead.website && !lead.emails?.length);
  if (!targets.length) {setStatus('Não há leads com site e e-mail pendente.','success');return;}
  setBusy(true);
  renderLeads();
  try {
    const granted=await requestEnrichmentPermission(targets);
    if (!granted) {setStatus('Permissão para consultar sites não concedida.','warning');return;}
    setStatus('Enriquecendo contatos de '+targets.length+' empresa(s)…');
    const result=await enrichLeads(targets,{force:true});
    setStatus('Enriquecimento concluído: '+result.checked+' site(s) consultado(s), '+result.found+' empresa(s) com e-mail localizado.','success');
  } catch(error) {
    setStatus(error?.message||'Falha ao enriquecer os contatos.','error');
  } finally {
    setBusy(false);
    render();
  }
}

async function getActiveMapsTab() {
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if (!tab?.id || !isGoogleMapsUrl(tab.url||'')) throw new Error('Abra uma página oficial do Google Maps e aguarde os resultados antes de iniciar a coleta.');
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
  return tab;
}
async function runCapture(tab,params={}) {
  if (busy) throw new Error('Já existe uma operação em andamento.');
  setBusy(true);
  let waiter=null;
  const taskId=makeId();
  activeCaptureItems=[];
  setBusyStatus(tab.id,taskId,false);
  waiter=createCaptureWaiter(taskId);
  const skipExisting=params.skipExisting !== false;
  const known=skipExisting ? leads : [];
  const skipPlaceIds=known.map((lead)=>lead.placeId).filter(Boolean).slice(0,10000);
  const skipMapsUrls=known.map((lead)=>lead.mapsUrl).filter(Boolean).slice(0,10000);
  const limit=Math.max(0,Math.min(500,Math.floor(Number(params.limit??40)||0)));
  const minRating=Number(params.minRating)||0;
  const searchTerm=params.searchTerm||'';
  const city=params.city||'';
  setProgress(0,limit,params.mode==='open'?'Lendo ficha aberta':'Conectando ao Maps');
  setStatus(params.mode==='open'?'Capturando a empresa aberta…':'Coletando empresas de ' + (searchTerm||'sua pesquisa') + '…');
  try {
    const acknowledgement=await chrome.tabs.sendMessage(tab.id,{
      type:'PROSPECTRA_CAPTURE_START',taskId,mode:params.mode||'visible',limit,minRating,
      searchTerm,city,skipPlaceIds,skipMapsUrls,queueItemId:params.queueItemId||''
    });
    if (!acknowledgement?.ok) throw new Error(acknowledgement?.error||'Não foi possível iniciar a captura.');
    const response=await waiter.promise;
    lastCaptureCheckpoint=await loadCaptureCheckpoint().catch(()=>lastCaptureCheckpoint);
    const fresh=response.items||[];
    mergeIncoming(fresh);
    if (fresh.length) await persist();
    const summary=summarizeCapture({requested:Number(response.requested??(params.mode==='open'?fresh.length:limit)),collected:fresh.length,filteredOut:response.filteredOut,scanned:response.scanned,stopReason:response.stopReason});
    let status='Coleta: ' + fresh.length + (summary.requested ? ' de '+summary.requested : '') + ' leads. ' + summary.scanned + ' fichas analisadas.';
    if (summary.filteredOut) status+=' ' + summary.filteredOut + ' descartadas pela nota.';
    if (summary.partial) status+=' Meta não atingida: faltaram '+summary.remaining+'.';
    if (response.skippedExisting) status+=' ' + response.skippedExisting + ' registro(s) já salvo(s) foram ignorados.';
    if (response.stopReason) status+=' Motivo: '+response.stopReason;
    setStatus(status,summary.partial?'warning':'success');
    if (params.enrich && fresh.length) {
      const targets=fresh.map((item)=>leads.find((lead)=>lead.placeId===item.placeId || lead.mapsUrl===item.mapsUrl)||item);
      // A coleta pode levar minutos. Não tentamos abrir um pedido de permissão
      // depois que a ativação do clique inicial já expirou.
      const granted=await requestEnrichmentPermission(targets,{allowPrompt:false});
      if (!granted) {
        setStatus(status+' Enriquecimento adiado: abra Leads e clique em "Enriquecer contatos pendentes" para autorizar os sites.',summary.partial?'warning':'success');
      } else {
        const enriched=await enrichLeads(targets);
        setStatus(status+' Enriquecimento: '+enriched.found+' empresa(s) com e-mail, '+enriched.checked+' site(s) consultado(s).',summary.partial?'warning':'success');
      }
    }
    return {response,items:fresh};
  } catch(error) {
    chrome.tabs.sendMessage(tab.id,{type:'PROSPECTRA_CAPTURE_CANCEL',taskId}).catch(()=>{});
    lastCaptureCheckpoint=await loadCaptureCheckpoint().catch(()=>lastCaptureCheckpoint);
    if (currentView==='research') renderResearch();
    setStatus(error?.message||'Falha na coleta.','error');
    throw error;
  } finally {
    waiter?.cancel();
    activeTask=null;
    setBusy(false);
    if (!queueRunning) $('#progressWrap').hidden=false;
  }
}
async function captureCurrent(mode='visible') {
  if (busy || queueRunning) return;
  const limitValue=$('#captureLimit').value.trim();
  const parsedLimit=limitValue===''?40:Number(limitValue);
  if (!Number.isFinite(parsedLimit) || parsedLimit<0 || parsedLimit>500) {setStatus('Quantidade inválida. Use um número entre 0 e 500.','error');return;}
  const limit=Math.floor(parsedLimit);
  const term=$('#searchTerm').value.trim(),city=$('#searchCity').value.trim();
  try {
    const tab=await getActiveMapsTab();
    await runCapture(tab,{mode,limit,minRating:Number($('#minimumRating').value),searchTerm:term,city,skipExisting:$('#skipExisting').checked,enrich:$('#autoEnrich').checked});
  } catch(error) { setStatus(error?.message||'Não foi possível iniciar a coleta.','error'); }
}
async function searchMaps() {
  if (busy || queueRunning) return;
  const term=$('#searchTerm').value.trim(),city=$('#searchCity').value.trim();
  if (!term || !city) {setStatus('Informe segmento e cidade.','warning');return;}
  const url='https://www.google.com/maps/search/'+encodeURIComponent(term+' '+city);
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if (tab?.id && isGoogleMapsUrl(tab.url||'')) await chrome.tabs.update(tab.id,{url});
    else await chrome.tabs.create({url,active:true});
    setStatus('Pesquisa aberta no Google Maps. Aguarde os resultados aparecerem.','success');
  } catch(error) {setStatus(error?.message||'Não foi possível abrir o Maps.','error');}
}
async function waitForTabReady(tabId,expectedUrl='',timeout=35000) {
  const matchesExpected = (value) => {
    if (!expectedUrl) return true;
    try {
      const actual = new URL(value || '');
      const expected = new URL(expectedUrl);
      const actualPath = decodeURIComponent(actual.pathname).replace(/\/+$/,'').toLowerCase();
      const expectedPath = decodeURIComponent(expected.pathname).replace(/\/+$/,'').toLowerCase();
      return isGoogleMapsUrl(actual.href) &&
        actualPath.startsWith('/maps/search/') &&
        (actualPath === expectedPath || actualPath.startsWith(expectedPath));
    } catch { return false; }
  };
  const current=await chrome.tabs.get(tabId);
  if (current?.status==='complete' && matchesExpected(current.url)) {
    await new Promise((resolve)=>setTimeout(resolve,1400));
    return;
  }
  await new Promise((resolve,reject) => {
    let finished=false;
    const done=(error)=>{if(finished)return;finished=true;clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);error?reject(error):resolve();};
    const listener=(id,info,updated)=>{
      if(id===tabId && info.status==='complete' && matchesExpected(updated?.url)) done();
    };
    const timer=setTimeout(()=>done(new Error('Tempo excedido aguardando o Google Maps carregar a pesquisa.')),timeout);
    chrome.tabs.onUpdated.addListener(listener);
  });
  await new Promise((resolve)=>setTimeout(resolve,1400));
}
function saveSearchEntry(term,city,limit,rating) {
  const existing=state.searches.find((item)=>item.term.toLowerCase()===term.toLowerCase() && item.city.toLowerCase()===city.toLowerCase());
  if (existing) {existing.limit=limit;existing.rating=rating;existing.updatedAt=new Date().toISOString();return existing;}
  const item={id:makeId(),term,city,limit,rating,createdAt:new Date().toISOString()};
  state.searches.unshift(item);
  return item;
}
async function addQueueItem() {
  const term=$('#queueTerm').value.trim(),city=$('#queueCity').value.trim();
  if (!term||!city) {setStatus('Preencha segmento e região para adicionar uma pesquisa.','warning');return;}
  const parsedLimit=$('#queueLimit').value.trim()===''?40:Number($('#queueLimit').value);
  if (!Number.isFinite(parsedLimit) || parsedLimit<0 || parsedLimit>500) {setStatus('Meta inválida. Use um número entre 0 e 500.','error');return;}
  const limit=Math.floor(parsedLimit);
  const rating=Number($('#queueRating').value)||0;
  const saved=saveSearchEntry(term,city,limit,rating);
  state.queue.push({...saved,id:makeId(),status:'pending',collected:0,createdAt:new Date().toISOString()});
  await persist();
  $('#queueTerm').value='';$('#queueCity').value='';
  setStatus('Pesquisa adicionada à fila.','success');
}
async function saveSearchOnly() {
  const term=$('#queueTerm').value.trim(),city=$('#queueCity').value.trim();
  if (!term||!city) {setStatus('Preencha segmento e região para salvar a pesquisa.','warning');return;}
  const parsedLimit=$('#queueLimit').value.trim()===''?40:Number($('#queueLimit').value);
  if (!Number.isFinite(parsedLimit) || parsedLimit<0 || parsedLimit>500) {setStatus('Meta inválida. Use um número entre 0 e 500.','error');return;}
  saveSearchEntry(term,city,Math.floor(parsedLimit),Number($('#queueRating').value)||0);
  await persist();
  setStatus('Pesquisa salva na biblioteca.','success');
}
async function runQueue() {
  if (queueRunning||busy) return;
  const pending=state.queue.filter((item)=>['pending','interrupted','failed','partial'].includes(item.status));
  if (!pending.length) return;
  let tab;
  const outcomes=[];
  queueRunning=true;queueStopRequested=false;renderResearch();
  try {
    const [active]=await chrome.tabs.query({active:true,currentWindow:true});
    tab=active?.id && isGoogleMapsUrl(active.url||'') ? active : await chrome.tabs.create({url:'https://www.google.com/maps',active:true});
    for (const item of pending) {
      if (queueStopRequested) break;
      let currentQueueItem=state.queue.find((row)=>row.id===item.id);
      if (!currentQueueItem) continue;
      currentQueueItem.status='running';currentQueueItem.message='Abrindo pesquisa';await persist();
      try {
        const url='https://www.google.com/maps/search/'+encodeURIComponent(item.term+' '+item.city);
        await chrome.tabs.update(tab.id,{url});
        await waitForTabReady(tab.id,url);
        await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
        if (queueStopRequested) break;
        const result=await runCapture(tab,{limit:item.limit,minRating:item.rating,searchTerm:item.term,city:item.city,skipExisting:$('#skipExisting').checked,enrich:$('#autoEnrich').checked,queueItemId:item.id});
        currentQueueItem=state.queue.find((row)=>row.id===item.id);
        if (currentQueueItem) {
          const reason=String(result.response.stopReason||'');
          const outcome=classifyQueueOutcome({
            requested:Number(result.response.requested||0),
            collected:result.items.length,
            stopReason:reason
          });
          currentQueueItem.status=outcome;
          outcomes.push(outcome);
          currentQueueItem.collected=(currentQueueItem.collected||0)+result.items.length;
          currentQueueItem.message=result.response.stopReason||'Concluída';
        }
      } catch(error) {
        currentQueueItem=state.queue.find((row)=>row.id===item.id);
        if (currentQueueItem) {
          const message=error?.message||'Falha na pesquisa';
          const outcome=classifyQueueOutcome({error:message});
          currentQueueItem.status=outcome;
          outcomes.push(outcome);
          currentQueueItem.message=message;
        }
        if (queueStopRequested) break;
      }
      await persist();
    }
    const summary=summarizeQueueOutcomes(outcomes);
    const prefix=queueStopRequested?'Fila interrompida pelo usuário.':'Fila finalizada.';
    const details=summary.total
      ? summary.total+' pesquisa(s): '+summary.done+' concluída(s), '+summary.partial+' parcial(is), '+summary.interrupted+' interrompida(s), '+summary.failed+' com falha.'
      : 'Nenhuma pesquisa foi processada.';
    const statusType=queueStopRequested||summary.partial||summary.interrupted?'warning':summary.failed?'error':'success';
    setStatus(prefix+' '+details,statusType);
  } catch(error) {setStatus(error?.message||'Não foi possível executar a fila.','error');}
  finally {queueRunning=false;queueStopRequested=false;renderResearch();setBusy(false);}
}
async function resumeCheckpoint() {
  if (busy || queueRunning) return;
  const checkpoint=lastCaptureCheckpoint;
  if (!isResumableCheckpoint(checkpoint)) {
    setStatus('Não há checkpoint interrompido para retomar.','warning');
    return;
  }
  let item=state.queue.find((row)=>row.id && row.id===checkpoint.queueItemId);
  if (!item) {
    item={
      id:makeId(),
      term:checkpoint.searchTerm,
      city:checkpoint.city,
      limit:Number(checkpoint.requested)||0,
      rating:Number(checkpoint.minRating)||0,
      status:'interrupted',
      collected:0,
      createdAt:new Date().toISOString(),
      message:'Retomada criada a partir do último checkpoint.'
    };
    state.queue.unshift(item);
  } else {
    item.status='interrupted';
    item.limit=Number(checkpoint.requested)||0;
    item.rating=Number(checkpoint.minRating)||0;
    item.message='Retomada solicitada a partir do último checkpoint.';
  }
  await persist();
  switchView('research');
  renderResearch();
  await runQueue();
}

async function pauseOrResume() {
  if (!activeTask) return;
  const next=!activeTask.paused;
  try {
    const result=await chrome.tabs.sendMessage(activeTask.tabId,{type:next?'PROSPECTRA_CAPTURE_PAUSE':'PROSPECTRA_CAPTURE_RESUME',taskId:activeTask.taskId});
    if (result?.ok) {activeTask.paused=next;$('#pauseButton').textContent=next?'Continuar':'Pausar';setStatus(next?'Coleta pausada. Os leads salvos permanecem no banco local.':'Coleta retomada.','success');}
  } catch(error) {setStatus(error?.message||'Não foi possível alterar a coleta.','error');}
}
async function cancelCapture() {
  if (!activeTask) return;
  try { await chrome.tabs.sendMessage(activeTask.tabId,{type:'PROSPECTRA_CAPTURE_CANCEL',taskId:activeTask.taskId}); }
  catch {}
  setStatus('Solicitação de cancelamento enviada. Os lotes confirmados foram preservados.','warning');
}
async function diagnostics() {
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id) throw new Error('Não há aba ativa.');
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
    const report=await chrome.tabs.sendMessage(tab.id,{type:'PROSPECTRA_DIAGNOSTICS'});
    const full={generatedAt:new Date().toISOString(),extensionVersion:chrome.runtime.getManifest().version,tab:{url:tab.url,title:tab.title},report,leadCount:leads.length,storage:'IndexedDB'};
    await navigator.clipboard.writeText(JSON.stringify(full,null,2));
    state.diagnostics=[...(state.diagnostics||[]),full].slice(-50);
    await persist();
    setStatus('Diagnóstico técnico copiado para a área de transferência.','success');
  } catch(error) {setStatus(error?.message||'Não foi possível gerar o diagnóstico. Abra o Google Maps.','error');}
}
async function saveProfile() {
  state.settings.owner=$('#ownerName').value.trim();
  state.settings.messageTemplate=$('#messageTemplate').value.trim()||DEFAULT_MESSAGE_TEMPLATE;
  leads=leads.map((lead)=>normalizeCurrentLead({...lead,owner:lead.owner||state.settings.owner}));
  await persist();
  setStatus('Personalização salva.','success');
}
async function saveWeights() {
  const weights={...DEFAULT_WEIGHTS};
  document.querySelectorAll('[data-weight]').forEach((input)=>{weights[input.dataset.weight]=Number(input.value)||0;});
  state.settings.weights=weights;
  leads=leads.map((lead)=>normalizeCurrentLead(lead));
  await persist();
  setStatus('Pesos atualizados e pontuações recalculadas.','success');
}
async function saveSheetsSettings() {
  const url=$('#sheetsUrl').value.trim();
  if (url) {
    let parsed;
    try { parsed=new URL(url); } catch { setStatus('URL inválida do Google Apps Script.','error');return; }
    if (parsed.protocol!=='https:' || !/(^|\.)script\.google\.com$/.test(parsed.hostname) || !parsed.pathname.includes('/macros/s/')) {setStatus('Use uma URL HTTPS de implantação do Google Apps Script no formato /macros/s/.../exec.','error');return;}
  }
  state.settings.sheetsUrl=url;
  state.settings.sheetsToken=$('#sheetsToken').value.trim();
  await persist();
  setStatus('URL do Google Sheets salva.','success');
}
async function syncGoogleSheets() {
  const raw=state.settings.sheetsUrl||'';
  if (!raw) {setStatus('Configure a URL do Apps Script antes de sincronizar.','warning');return;}
  if (!leads.length) {setStatus('Não há leads para enviar.','warning');return;}
  const token=String($('#sheetsToken').value||state.settings.sheetsToken||'').trim();
  if (!token) {setStatus('Informe o token obrigatório configurado nas Propriedades do Apps Script.','warning');return;}
  state.settings.sheetsToken=token;
  let url;
  try {url=new URL(raw);} catch {setStatus('URL inválida.','error');return;}
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/.test(url.href)) {setStatus('Use uma URL HTTPS do Apps Script no formato /macros/s/.../exec.','error');return;}
  const granted=await chrome.permissions.request({origins:[url.origin+'/*','https://script.googleusercontent.com/*']});
  if (!granted) {setStatus('Permissão para acessar o Web App não concedida.','warning');return;}
  const batchSize=200;
  let sent=0;
  try {
    for (let offset=0;offset<leads.length;offset+=batchSize) {
      const batch=leads.slice(offset,offset+batchSize);
      setStatus('Enviando lote '+(Math.floor(offset/batchSize)+1)+' de '+Math.ceil(leads.length/batchSize)+' para o Google Sheets…');
      const response=await fetch(url.href,{
        method:'POST',redirect:'follow',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify({
          action:'upsert',token,
          source:'Prospectra',exportedAt:new Date().toISOString(),leads:batch
        })
      });
      const text=await response.text();
      if (!response.ok) throw new Error('HTTP '+response.status+': '+text.slice(0,180));
      let result;
      try {result=JSON.parse(text);} catch {throw new Error('O Apps Script não retornou JSON válido: '+text.slice(0,180));}
      if (!result?.ok) throw new Error(result?.error||'O Apps Script recusou o lote.');
      sent+=batch.length;
      setProgress(sent,leads.length,'Google Sheets: '+sent+'/'+leads.length+' leads enviados');
    }
    setStatus('Google Sheets atualizado: '+sent+' lead(s) enviados em lotes de até '+batchSize+'.','success');
  } catch(error) {
    setStatus('Google Sheets: '+(error?.message||'falha na integração')+'. '+sent+' de '+leads.length+' lead(s) foram confirmados; você pode reenviar a base com segurança.','error');
  }
}
function normalizedSupabaseUrl() {
  const url=normalizeSupabaseProjectUrl($('#supabaseUrl').value||state.settings.supabaseUrl||'');
  $('#supabaseUrl').value=url;
  state.settings.supabaseUrl=url;
  return url;
}
function supabaseHeaders(anon,token) {
  return {'Content-Type':'application/json',apikey:anon,...(token?{Authorization:'Bearer '+token}:{})};
}
async function supabaseAuthRequest(path,body) {
  const url=normalizedSupabaseUrl();
  const anon=$('#supabaseAnonKey').value.trim()||state.settings.supabaseAnonKey;
  if (!anon) throw new Error('Informe a chave anon/public do Supabase.');
  const granted=await chrome.permissions.request({origins:[url+'/*']});
  if (!granted) throw new Error('Permissão para acessar o projeto Supabase não concedida.');
  const response=await fetch(url+'/auth/v1/'+path,{method:'POST',headers:supabaseHeaders(anon),body:JSON.stringify(body)});
  const result=await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(result.msg||result.message||result.error_description||result.error||'Falha na autenticação Supabase.');
  return result;
}
async function supabaseSignIn() {
  const email=$('#supabaseEmail').value.trim(),password=$('#supabasePassword').value;
  if (!email||!password) {setStatus('Informe e-mail e senha para entrar.','warning');return;}
  try {
    const session=await supabaseAuthRequest('token?grant_type=password',{email,password});
    state.settings.supabaseUrl=normalizedSupabaseUrl();
    state.settings.supabaseAnonKey=$('#supabaseAnonKey').value.trim();
    state.settings.supabaseSession=session;
    $('#supabasePassword').value='';
    await persist();
    $('#cloudStatus').textContent='Conectado como '+(session.user?.email||email)+'.';
    setStatus('Autenticação Supabase concluída.','success');
  } catch(error) {setStatus(error?.message||'Não foi possível autenticar.','error');}
}
async function supabaseSignUp() {
  const email=$('#supabaseEmail').value.trim(),password=$('#supabasePassword').value;
  if (!email||!password) {setStatus('Informe e-mail e senha para criar a conta.','warning');return;}
  try {
    const result=await supabaseAuthRequest('signup',{email,password});
    if (result.access_token) {
      state.settings.supabaseSession=result;
      $('#cloudStatus').textContent='Conta criada e conectada como '+(result.user?.email||email)+'.';
    } else {
      $('#cloudStatus').textContent='Conta criada. Verifique o e-mail caso a confirmação esteja habilitada no Supabase.';
    }
    state.settings.supabaseUrl=normalizedSupabaseUrl();
    state.settings.supabaseAnonKey=$('#supabaseAnonKey').value.trim();
    $('#supabasePassword').value='';
    await persist();
  } catch(error) {setStatus(error?.message||'Não foi possível criar a conta.','error');}
}
function decodeJwtPayload(token) {
  try {const chunk=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');return JSON.parse(decodeURIComponent(escape(atob(chunk))));}
  catch {return {};}
}
async function getSupabaseSession() {
  const session=state.settings.supabaseSession;
  if (!session?.access_token) throw new Error('Entre na sua conta Supabase antes de sincronizar.');
  const exp=Number(session.expires_at||0);
  if (exp && exp>Date.now()/1000+60) return session;
  if (!session.refresh_token) throw new Error('Sessão expirada. Entre novamente.');
  const refreshed=await supabaseAuthRequest('token?grant_type=refresh_token',{refresh_token:session.refresh_token});
  state.settings.supabaseSession=refreshed;
  await persist();
  return refreshed;
}
async function syncSupabase() {
  try {
    const url=normalizedSupabaseUrl();
    const anon=$('#supabaseAnonKey').value.trim()||state.settings.supabaseAnonKey||'';
    if (!anon) throw new Error('Informe a chave anon/public do Supabase.');
    state.settings.supabaseUrl=url;
    state.settings.supabaseAnonKey=anon;
    const granted=await chrome.permissions.request({origins:[url+'/*']});
    if (!granted) throw new Error('Permissão para acessar o projeto Supabase não concedida.');

    const session=await getSupabaseSession();
    const token=session.access_token;
    const userId=session.user?.id||decodeJwtPayload(token).sub;
    if (!userId) throw new Error('Não foi possível identificar o usuário autenticado no Supabase.');
    const headers=supabaseHeaders(anon,token);
    setStatus('Lendo registros e exclusões da nuvem…');

    const remote=[];
    const remotePageSize=1000;
    let remoteTotal=null;
    for (let offset=0;offset<=MAX_CLOUD_RECORDS;offset+=remotePageSize) {
      const response=await fetch(url+'/rest/v1/prospectra_leads?select=id,identity_key,payload,updated_at,deleted_at',{
        headers:{
          ...headers,
          'Range-Unit':'items',
          'Range':buildRangeHeader(offset,remotePageSize),
          'Prefer':'count=exact'
        }
      });
      if (!response.ok) {
        const detail=await response.text().catch(()=>'');
        if (/deleted_at/i.test(detail)) {
          throw new Error('A tabela Supabase ainda não possui a coluna deleted_at. Execute novamente docs/supabase/schema.sql para aplicar a migração.');
        }
        throw new Error('Falha ao ler a tabela. Verifique o SQL e as políticas RLS. '+detail.slice(0,160));
      }
      const total=parsePostgrestTotal(response.headers.get('content-range'));
      if (total!==null) {
        remoteTotal=total;
        if (total>MAX_CLOUD_RECORDS) {
          throw new Error('A nuvem contém '+total.toLocaleString('pt-BR')+' registros, acima do limite combinado de '+MAX_CLOUD_RECORDS.toLocaleString('pt-BR')+' leads e exclusões. A sincronização foi cancelada sem importar dados parciais.');
        }
      }
      const batch=await response.json();
      if (!Array.isArray(batch)) throw new Error('Resposta inválida ao consultar os registros na nuvem.');
      if (offset>=MAX_CLOUD_RECORDS && batch.length) {
        throw new Error('A nuvem ultrapassa o limite de '+MAX_CLOUD_RECORDS.toLocaleString('pt-BR')+' registros. A sincronização foi cancelada.');
      }
      remote.push(...batch);
      setProgress(remote.length,remoteTotal??MAX_CLOUD_RECORDS,'Lendo registros remotos: '+remote.length.toLocaleString('pt-BR'));
      if (batch.length<remotePageSize || (remoteTotal!==null && remote.length>=remoteTotal)) break;
    }
    if (remoteTotal!==null && remote.length!==remoteTotal) {
      throw new Error('Leitura incompleta da nuvem: '+remote.length+' de '+remoteTotal+' registros recebidos.');
    }

    const remoteTombstones=remote
      .filter((row)=>row.deleted_at)
      .map((row)=>normalizeDeletionTombstone({
        id:row.id,
        identityKey:row.identity_key||row.payload?.identityKey,
        aliases:row.payload?.aliases,
        deletedAt:row.deleted_at
      }))
      .filter(Boolean);
    const remoteLeads=remote.filter((row)=>!row.deleted_at).map((row)=>normalizeCurrentLead({
      ...(row.payload||{}),
      id:row.id,
      identityKey:row.identity_key||row.payload?.identityKey,
      updatedAt:row.updated_at||row.payload?.updatedAt
    }));
    const merged=mergeLeadRecords(leads,remoteLeads,MAX_LEADS+1);
    if (merged.length>MAX_LEADS) {
      throw new Error('A mesclagem ultrapassaria o limite local de '+MAX_LEADS.toLocaleString('pt-BR')+' leads. Exporte ou organize a base antes de sincronizar.');
    }
    const tombstones=mergeDeletionTombstones(state.deletedLeadKeys||[],remoteTombstones);
    leads=applyDeletionTombstones(merged,tombstones);
    state.leads=leads;
    state.deletedLeadKeys=pruneSupersededTombstones(leads,tombstones);
    await persist();

    const body=buildSupabaseSyncRows(leads,state.deletedLeadKeys,userId);
    for (let offset=0;offset<body.length;offset+=200) {
      const batch=body.slice(offset,offset+200);
      const response=await fetch(url+'/rest/v1/prospectra_leads?on_conflict=user_id,identity_key',{
        method:'POST',
        headers:{...headers,Prefer:'resolution=merge-duplicates,return=minimal'},
        body:JSON.stringify(batch)
      });
      if (!response.ok) {
        const detail=await response.text().catch(()=>'');
        throw new Error('Falha ao enviar lote '+(Math.floor(offset/200)+1)+'. '+detail.slice(0,180)+' Verifique o schema e as políticas RLS.');
      }
      setProgress(Math.min(offset+batch.length,body.length),body.length,'Sincronizando leads e exclusões');
    }

    state.settings.supabaseLastSync=new Date().toISOString();
    await persist();
    $('#cloudStatus').textContent='Última sincronização: '+new Date(state.settings.supabaseLastSync).toLocaleString('pt-BR')+'. '+leads.length+' leads ativos · '+state.deletedLeadKeys.length+' exclusões.';
    setStatus('Sincronização concluída: '+leads.length+' lead(s) ativo(s) e '+state.deletedLeadKeys.length+' exclusão(ões) propagada(s).','success');
  } catch(error) {
    setStatus('Supabase: '+(error?.message||'falha ao sincronizar'),'error');
  }
}
async function updateTabStatus() {
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    const maps=isGoogleMapsUrl(tab?.url||'');
    $('#tabStatus')?.replaceChildren(document.createTextNode(maps?'Google Maps disponível nesta aba':'Abra uma pesquisa do Google Maps para capturar'));
  } catch {}
}

document.addEventListener('click',async(event)=>{
  const nav=event.target.closest('[data-view-target]');
  if (nav) {switchView(nav.dataset.viewTarget);return;}
  const button=event.target.closest('[data-action]');
  if (button) await handleLeadAction(button.dataset.action,button.dataset.id);
});
document.addEventListener('change',async(event)=>{
  const node=event.target;
  if (node.matches('[data-action="stage"]')) await updateLead(node.dataset.id,(lead)=>{lead.stage=node.value;addActivity(lead,'stage','Etapa alterada para '+stageLabel(node.value));});
  if (node.matches('[data-action="owner"]') && node.value==='__edit') await handleLeadAction('owner-edit',node.dataset.id);
  if (node.matches('[data-action="owner"]') && node.value!=='__edit') await updateLead(node.dataset.id,(lead)=>{lead.owner=node.value;});
});
document.addEventListener('dragstart',(event)=>{
  const card=event.target.closest('[data-drag-id]');
  if (card) {event.dataTransfer.setData('text/plain',card.dataset.dragId);event.dataTransfer.effectAllowed='move';}
});
document.addEventListener('dragover',(event)=>{
  const column=event.target.closest('[data-stage]');
  if (column) {event.preventDefault();column.classList.add('drag-over');}
});
document.addEventListener('dragleave',(event)=>event.target.closest('[data-stage]')?.classList.remove('drag-over'));
document.addEventListener('drop',async(event)=>{
  const column=event.target.closest('[data-stage]');
  if (!column) return;
  event.preventDefault();column.classList.remove('drag-over');
  const id=event.dataTransfer.getData('text/plain');
  await updateLead(id,(lead)=>{lead.stage=column.dataset.stage;addActivity(lead,'stage','Movido para '+stageLabel(column.dataset.stage));});
  renderPipeline();
});

$('#searchMapsButton').addEventListener('click',searchMaps);
$('#captureButton').addEventListener('click',()=>captureCurrent('visible'));
$('#captureOpenButton').addEventListener('click',()=>captureCurrent('open'));
$('#pauseButton').addEventListener('click',pauseOrResume);
$('#cancelButton').addEventListener('click',cancelCapture);
$('#diagnosticsButton').addEventListener('click',diagnostics);
$('#searchInput').addEventListener('input',()=>{visibleLeadCount=PAGE_SIZE;renderLeads();});
$('#filterSelect').addEventListener('change',()=>{visibleLeadCount=PAGE_SIZE;renderLeads();});
$('#sortSelect').addEventListener('change',renderLeads);
$('#refreshButton').addEventListener('click',async()=>{state=await loadAppState();leads=state.leads||[];render();setStatus('Base local atualizada.','success');});
$('#exportCsvButton').addEventListener('click',()=>exportSelectedCsv(getFilteredLeads()));
$('#enrichPendingButton').addEventListener('click',enrichExistingLeads);
$('#exportXlsxButton').addEventListener('click',exportXlsx);
$('#exportCustomButton').addEventListener('click',()=>exportSelectedCsv(leads));
$('#exportGeoJsonButton').addEventListener('click',()=>exportGeospatial('geojson'));
$('#exportKmlButton').addEventListener('click',()=>exportGeospatial('kml'));
$('#backupButton').addEventListener('click',exportBackup);
$('#importButton').addEventListener('click',() => $('#importFile').click());
$('#importFile').addEventListener('change',async(event)=>{
  const file=event.target.files?.[0];if(!file)return;
  try {await importFile(file);} catch(error) {setStatus(error?.message||'Falha ao importar arquivo.','error');}
  finally {event.target.value='';}
});
$('#clearButton').addEventListener('click',async()=>{
  if (busy || queueRunning) {setStatus('Finalize ou cancele a operação atual antes de apagar a base.','warning');return;}
  if (!confirm('Excluir permanentemente todos os leads e dados comerciais deste navegador? Se o Supabase estiver conectado, as exclusões dos leads também serão propagadas na próxima sincronização. Faça um backup antes.')) return;
  try {
    const deleted=leads.map((lead)=>createDeletionTombstone(lead)).filter(Boolean);
    state.deletedLeadKeys=mergeDeletionTombstones(state.deletedLeadKeys||[],deleted);
    leads=[];
    state.activities=[];
    state.searches=[];
    state.queue=[];
    state.doNotContact=[];
    state.diagnostics=[];
    await persist();
    await clearLastCaptureCheckpoint();
    renderResearch();
    setStatus('Base local limpa. '+deleted.length+' exclusão(ões) foi/foram preservada(s) para sincronização Supabase. Configurações de integração foram mantidas.','success');
  } catch(error) {
    setStatus('Não foi possível limpar a base: '+(error?.message||'falha ao preservar exclusões'),'error');
  }
});
$('#saveProfileButton').addEventListener('click',saveProfile);
$('#followUpNotifications').addEventListener('change',async(event)=>{
  if (event.target.checked) {
    const granted=await chrome.permissions.request({permissions:['alarms','notifications']});
    if (!granted) {event.target.checked=false;setStatus('Permissão de notificações não concedida.','warning');return;}
  }
  state.settings.followUpNotifications=event.target.checked;
  await persist();
  chrome.runtime.sendMessage({type:'PROSPECTRA_SET_FOLLOWUPS',enabled:event.target.checked}).catch(()=>{});
  setStatus(event.target.checked?'Lembretes de follow-up ativados.':'Lembretes de follow-up desativados.','success');
});
$('#saveWeightsButton').addEventListener('click',saveWeights);
$('#weightSettings').addEventListener('input',(event)=>{
  if (event.target.matches('[data-weight]')) event.target.parentElement.querySelector('output').textContent=event.target.value;
});
$('#saveSheetsButton').addEventListener('click',saveSheetsSettings);
$('#sheetsSyncButton').addEventListener('click',syncGoogleSheets);
$('#supabaseLoginButton').addEventListener('click',supabaseSignIn);
$('#supabaseSignupButton')?.addEventListener('click',supabaseSignUp);
$('#supabaseSyncButton').addEventListener('click',syncSupabase);
$('#saveSearchButton').addEventListener('click',saveSearchOnly);
$('#enqueueSearchButton').addEventListener('click',addQueueItem);
$('#runQueueButton').addEventListener('click',runQueue);
$('#resumeCheckpointButton').addEventListener('click',resumeCheckpoint);
$('#stopQueueButton').addEventListener('click',()=>{queueStopRequested=true;cancelCapture();});
$('#clearQueueButton').addEventListener('click',async()=>{
  if (queueRunning || busy) {setStatus('Pare a execução atual antes de limpar a fila.','warning');return;}
  if (!confirm('Remover todas as pesquisas da fila? As empresas já capturadas permanecem salvas.')) return;
  const removedIds=new Set(state.queue.map((item)=>item.id));
  state.queue=[];
  await persist();
  if (lastCaptureCheckpoint?.queueItemId && removedIds.has(lastCaptureCheckpoint.queueItemId)) {
    await clearLastCaptureCheckpoint();
  }
  renderResearch();
});

chrome.runtime.onMessage.addListener((message)=>{
  if (message?.type==='PROSPECTRA_PROGRESS' && message.taskId===activeTask?.taskId) setProgress(message.done||0,message.total??1,message.name||'Processando');
});
chrome.tabs.onActivated.addListener(updateTabStatus);
chrome.tabs.onUpdated.addListener((_id,change)=>{if(change.status==='complete'||change.url)updateTabStatus();});
load().catch((error)=>setStatus(error?.message||'Não foi possível abrir o banco local.','error'));
updateTabStatus();
