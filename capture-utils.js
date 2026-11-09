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
function strongPlaceAlias(lead = {}) {
  return captureLeadAliases(lead).find((alias) => alias.startsWith('place:') && !alias.startsWith('place:maps-path:')) || '';
}

export function hasConflictingStrongPlaceId(left = {}, right = {}) {
  const leftPlace = strongPlaceAlias(left);
  const rightPlace = strongPlaceAlias(right);
  return Boolean(leftPlace && rightPlace && leftPlace !== rightPlace);
}

function mergeArrays(a, b, normalizer = (value) => String(value || '').trim()) {
  return [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].map(normalizer).filter(Boolean))];
}
function mergeLeadRecord(previous, incoming) {
  const previousTime = Date.parse(previous.updatedAt || previous.collectedAt || '') || 0;
  const incomingTime = Date.parse(incoming.updatedAt || incoming.collectedAt || '') || 0;
  const incomingIsNewer = incomingTime >= previousTime;
  const newer = incomingIsNewer ? incoming : previous;
  const older = incomingIsNewer ? previous : incoming;
  const merged = { ...older, ...newer };
  merged.id = previous.id || incoming.id;

  for (const field of ['emails', 'phones', 'tags']) {
    merged[field] = mergeArrays(previous[field], incoming[field], (value) => String(value || '').trim().toLowerCase());
  }
  merged.phone = newer.phone || older.phone || merged.phones?.[0] || '';
  merged.cnpj = newer.cnpj || older.cnpj || merged.cnpjs?.[0] || '';
  merged.cnpjs = mergeArrays(previous.cnpjs, incoming.cnpjs, (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  if (merged.cnpj && !merged.cnpjs.includes(merged.cnpj)) merged.cnpjs.unshift(merged.cnpj);
  merged.emails = merged.emails || [];
  merged.ratingHistory = mergeArrays(previous.ratingHistory, incoming.ratingHistory, (item) => JSON.stringify(item))
    .map((item) => { try { return JSON.parse(item); } catch { return item; } });
  merged.activities = mergeArrays(previous.activities, incoming.activities, (item) => typeof item === 'string' ? item : JSON.stringify(item))
    .map((item) => { try { return typeof item === 'string' ? JSON.parse(item) : item; } catch { return item; } });
  merged.socialProfiles = { ...(older.socialProfiles || {}), ...(newer.socialProfiles || {}) };
  merged.sourceMap = { ...(older.sourceMap || {}), ...(newer.sourceMap || {}) };
  merged.confidence = { ...(older.confidence || {}), ...(newer.confidence || {}) };
  merged.emailTypes = { ...(older.emailTypes || {}), ...(newer.emailTypes || {}) };
  merged.addressParts = newer.addressParts?.raw ? newer.addressParts : older.addressParts;
  merged.website = newer.website || older.website || '';
  merged.whatsappUrl = newer.whatsappUrl || older.whatsappUrl || '';
  merged.category = newer.category || older.category || '';
  merged.categoryPath = newer.categoryPath?.length ? newer.categoryPath : older.categoryPath || [];
  merged.address = newer.address || older.address || '';
  merged.rating = newer.rating || older.rating || '';
  merged.reviewCount = newer.reviewCount || older.reviewCount || '';
  merged.mapsUrl = newer.mapsUrl || older.mapsUrl || '';
  merged.placeId = newer.placeId || older.placeId || extractPlaceId(merged.mapsUrl);
  merged.searchTerm = newer.searchTerm || older.searchTerm || '';
  merged.city = newer.city || older.city || '';
  merged.stage = newer.stage || older.stage || 'new';
  merged.owner = newer.owner || older.owner || '';
  merged.nextFollowUp = newer.nextFollowUp || older.nextFollowUp || '';
  merged.doNotContact = Boolean(incoming.doNotContact || previous.doNotContact);
  merged.closedStatus = newer.closedStatus && newer.closedStatus !== 'unknown' ? newer.closedStatus : older.closedStatus || 'unknown';
  merged.collectedAt = previous.collectedAt || incoming.collectedAt || new Date().toISOString();
  merged.updatedAt = newer.updatedAt || newer.collectedAt || older.updatedAt || older.collectedAt || new Date().toISOString();
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
    const matchedKeys = [...new Set(aliases.map((alias) => aliasIndex.get(alias)).filter(Boolean))]
      .filter((key) => {
        const existing = records.get(key);
        return existing && !hasConflictingStrongPlaceId(existing, normalized);
      });
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
    for (const alias of captureLeadAliases(current)) {
      const existingKey = aliasIndex.get(alias);
      const existing = existingKey ? records.get(existingKey) : null;
      if (existing && existingKey !== primaryKey && hasConflictingStrongPlaceId(existing, current)) continue;
      aliasIndex.set(alias, primaryKey);
    }
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
