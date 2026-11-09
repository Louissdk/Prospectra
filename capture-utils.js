import { extractPlaceId, normalizeCompanyName, normalizeAddressKey, digitsOnly, qualityScore, normalizeLeadRecord } from './crm-utils.js';

export function captureLeadAliases(lead = {}) {
  const aliases = [];
  const placeId = String(lead.placeId || extractPlaceId(lead.mapsUrl || '')).trim();
  if (placeId) aliases.push('place:' + placeId);
  const mapsUrl = String(lead.mapsUrl || '').trim();
  if (mapsUrl) {
    try {
      const url = new URL(mapsUrl);
      url.hash = '';
      url.searchParams.sort();
      aliases.push('url:' + url.href);
    } catch { aliases.push('url:' + mapsUrl); }
  }
  const name = normalizeCompanyName(lead.name);
  const phone = digitsOnly(lead.phone || lead.phones?.[0]);
  const address = normalizeAddressKey(lead.address);
  if (name && phone) aliases.push('name-phone:' + name + '|' + phone);
  if (name && address) aliases.push('name-address:' + name + '|' + address);
  if (!aliases.length && name) aliases.push('name:' + name);
  return [...new Set(aliases)];
}
export function captureLeadKey(lead = {}) {
  return captureLeadAliases(lead)[0] || 'anonymous:' + normalizeCompanyName(lead.name);
}
function mergeArrays(a, b, normalizer = (value) => String(value || '').trim()) {
  return [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].map(normalizer).filter(Boolean))];
}
function mergeLeadRecord(previous, incoming) {
  const merged = { ...previous, ...incoming };
  merged.id = previous.id || incoming.id;
  for (const field of ['emails', 'phones', 'tags']) {
    merged[field] = mergeArrays(previous[field], incoming[field], (value) => String(value || '').trim().toLowerCase());
  }
  merged.phone = incoming.phone || previous.phone || merged.phones?.[0] || '';
  merged.cnpj = incoming.cnpj || previous.cnpj || merged.cnpjs?.[0] || '';
  merged.cnpjs = mergeArrays(previous.cnpjs, incoming.cnpjs, (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  if (merged.cnpj && !merged.cnpjs.includes(merged.cnpj)) merged.cnpjs.unshift(merged.cnpj);
  merged.emails = merged.emails || [];
  merged.ratingHistory = mergeArrays(previous.ratingHistory, incoming.ratingHistory, (item) => JSON.stringify(item))
    .map((item) => { try { return JSON.parse(item); } catch { return item; } });
  merged.activities = mergeArrays(previous.activities, incoming.activities, (item) => typeof item === 'string' ? item : JSON.stringify(item))
    .map((item) => { try { return typeof item === 'string' ? JSON.parse(item) : item; } catch { return item; } });
  merged.socialProfiles = { ...(previous.socialProfiles || {}), ...(incoming.socialProfiles || {}) };
  merged.sourceMap = { ...(previous.sourceMap || {}), ...(incoming.sourceMap || {}) };
  merged.confidence = { ...(previous.confidence || {}), ...(incoming.confidence || {}) };
  merged.emailTypes = { ...(previous.emailTypes || {}), ...(incoming.emailTypes || {}) };
  merged.addressParts = incoming.addressParts?.raw ? incoming.addressParts : previous.addressParts;
  merged.website = incoming.website || previous.website || '';
  merged.whatsappUrl = incoming.whatsappUrl || previous.whatsappUrl || '';
  merged.category = incoming.category || previous.category || '';
  merged.categoryPath = incoming.categoryPath?.length ? incoming.categoryPath : previous.categoryPath || [];
  merged.address = incoming.address || previous.address || '';
  merged.rating = incoming.rating || previous.rating || '';
  merged.reviewCount = incoming.reviewCount || previous.reviewCount || '';
  merged.mapsUrl = incoming.mapsUrl || previous.mapsUrl || '';
  merged.placeId = incoming.placeId || previous.placeId || extractPlaceId(merged.mapsUrl);
  merged.searchTerm = incoming.searchTerm || previous.searchTerm || '';
  merged.city = incoming.city || previous.city || '';
  merged.stage = incoming.stage || previous.stage || 'new';
  merged.owner = incoming.owner || previous.owner || '';
  merged.nextFollowUp = incoming.nextFollowUp || previous.nextFollowUp || '';
  merged.doNotContact = Boolean(incoming.doNotContact || previous.doNotContact);
  merged.closedStatus = incoming.closedStatus && incoming.closedStatus !== 'unknown' ? incoming.closedStatus : previous.closedStatus || 'unknown';
  merged.collectedAt = previous.collectedAt || incoming.collectedAt || new Date().toISOString();
  merged.updatedAt = new Date().toISOString();
  merged.qualityScore = qualityScore(merged);
  return normalizeLeadRecord(merged);
}
export function mergeLeadRecords(existing = [], incoming = [], maxItems = 10000) {
  const records = new Map();
  const aliasIndex = new Map();
  const upsert = (item) => {
    if (!item || typeof item !== 'object') return;
    const normalized = normalizeLeadRecord(item);
    const aliases = captureLeadAliases(normalized);
    const matchedKeys = [...new Set(aliases.map((alias) => aliasIndex.get(alias)).filter(Boolean))];
    let primaryKey = matchedKeys[0] || aliases[0] || captureLeadKey(normalized);
    let current = records.get(primaryKey);
    if (!current) {
      current = normalized;
      records.set(primaryKey, current);
    } else {
      current = mergeLeadRecord(current, normalized);
      records.set(primaryKey, current);
    }
    for (const duplicateKey of matchedKeys.slice(1)) {
      const duplicate = records.get(duplicateKey);
      if (duplicate && duplicateKey !== primaryKey) {
        const duplicateAliases = captureLeadAliases(duplicate);
        current = mergeLeadRecord(current, duplicate);
        records.delete(duplicateKey);
        for (const alias of duplicateAliases) aliasIndex.set(alias, primaryKey);
      }
    }
    for (const alias of captureLeadAliases(current)) aliasIndex.set(alias, primaryKey);
  };
  for (const item of Array.isArray(existing) ? existing : []) upsert(item);
  for (const item of Array.isArray(incoming) ? incoming : []) upsert(item);
  return [...records.values()]
    .sort((a, b) => (Date.parse(b.updatedAt || b.collectedAt || '') || 0) - (Date.parse(a.updatedAt || a.collectedAt || '') || 0))
    .slice(0, Math.max(1, Number(maxItems) || 10000));
}
export function summarizeCapture(stats = {}) {
  const count = (value) => { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0; };
  const requested = count(stats.requested), collected = count(stats.collected), filteredOut = count(stats.filteredOut), scanned = count(stats.scanned);
  const remaining = requested > 0 ? Math.max(0, requested - collected) : null;
  return { requested, collected, filteredOut, scanned, remaining, partial: requested > 0 && collected < requested, reachedTarget: requested === 0 || collected >= requested, stopReason: String(stats.stopReason || '').trim() };
}


export function isResumableCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object') return false;
  return ['running','interrupted','partial'].includes(String(checkpoint.status || '')) &&
    Boolean(String(checkpoint.searchTerm || '').trim()) &&
    Boolean(String(checkpoint.city || '').trim());
}

export function captureResumeLabel(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object') return '';
  const status = String(checkpoint.status || '');
  const term = String(checkpoint.searchTerm || 'pesquisa');
  const city = String(checkpoint.city || '');
  const last = String(checkpoint.lastPlaceName || '');
  const prefix = status === 'completed' ? 'Última pesquisa concluída' : 'Checkpoint recuperável';
  const tail = last ? ' · último estabelecimento: ' + last : '';
  return prefix + ': ' + term + (city ? ' · ' + city : '') + tail +
    '. ' + (Number(checkpoint.collected) || 0) + ' lead(s) confirmados.';
}
