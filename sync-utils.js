import { captureLeadAliases } from './capture-utils.js';

export const MAX_DELETION_TOMBSTONES = 10000;

export function createDeletionTombstone(lead = {}, deletedAt = new Date().toISOString()) {
  const identityKey = String(lead.identityKey || '').trim();
  if (!identityKey) return null;
  return normalizeDeletionTombstone({
    id:lead.id,
    identityKey,
    aliases:captureLeadAliases(lead),
    deletedAt
  });
}

export function normalizeDeletionTombstone(value = {}) {
  const identityKey = String(value.identityKey || value.identity_key || '').trim();
  const timestamp = Date.parse(value.deletedAt || value.deleted_at || '');
  if (!identityKey || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const aliases = [...new Set([
    identityKey,
    ...(Array.isArray(value.aliases) ? value.aliases : [])
  ].map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 50);
  return {
    id: String(value.id || '').trim(),
    identityKey,
    aliases,
    deletedAt: new Date(timestamp).toISOString()
  };
}

export function mergeDeletionTombstones(...groups) {
  const byIdentity = new Map();
  for (const group of groups) {
    for (const raw of Array.isArray(group) ? group : []) {
      const item = normalizeDeletionTombstone(raw);
      if (!item) continue;
      const previous = byIdentity.get(item.identityKey);
      if (!previous) {
        byIdentity.set(item.identityKey, item);
        continue;
      }
      const newest = Date.parse(item.deletedAt) >= Date.parse(previous.deletedAt) ? item : previous;
      byIdentity.set(item.identityKey, {
        ...newest,
        id: newest.id || previous.id || item.id,
        aliases: [...new Set([...previous.aliases, ...item.aliases])].slice(0, 50)
      });
    }
  }
  if (byIdentity.size > MAX_DELETION_TOMBSTONES) {
    throw new Error('O histórico de exclusões ultrapassou 10.000 registros. Exporte um backup antes de continuar.');
  }
  return [...byIdentity.values()].sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));
}

function strongPlaceAlias(aliases = []) {
  return aliases.find((alias) => alias.startsWith('place:') && !alias.startsWith('place:maps-path:')) || '';
}

function addIndexValue(index, key, tombstone) {
  if (!key) return;
  let bucket = index.get(key);
  if (!bucket) {
    bucket = new Set();
    index.set(key, bucket);
  }
  bucket.add(tombstone);
}

function buildTombstoneIndex(tombstones) {
  const byStrongPlace = new Map();
  const weakByAlias = new Map();
  const byAlias = new Map();
  const deletedAt = new Map();

  for (const tombstone of tombstones) {
    const strongPlace = strongPlaceAlias(tombstone.aliases);
    deletedAt.set(tombstone, Date.parse(tombstone.deletedAt) || 0);
    for (const alias of tombstone.aliases) {
      addIndexValue(byAlias, alias, tombstone);
      if (!strongPlace) addIndexValue(weakByAlias, alias, tombstone);
    }
    if (strongPlace) addIndexValue(byStrongPlace, strongPlace, tombstone);
  }
  return { byStrongPlace, weakByAlias, byAlias, deletedAt };
}

function findTombstoneCandidates(lead, index) {
  const aliases = captureLeadAliases(lead);
  const leadIdentity = String(lead.identityKey || '').trim();
  if (leadIdentity && !aliases.includes(leadIdentity)) aliases.push(leadIdentity);

  const strongPlace = strongPlaceAlias(aliases);
  const candidates = new Set();
  const collect = (bucket) => {
    if (bucket) for (const tombstone of bucket) candidates.add(tombstone);
  };

  if (strongPlace) {
    collect(index.byStrongPlace.get(strongPlace));
    for (const alias of aliases) collect(index.weakByAlias.get(alias));
  } else {
    for (const alias of aliases) collect(index.byAlias.get(alias));
  }
  return candidates;
}

export function applyDeletionTombstones(leads = [], tombstones = []) {
  const safeLeads = Array.isArray(leads) ? leads : [];
  const normalized = mergeDeletionTombstones(tombstones);
  if (!normalized.length || !safeLeads.length) return safeLeads;

  const index = buildTombstoneIndex(normalized);
  return safeLeads.filter((lead) => {
    const updatedAt = Date.parse(lead.updatedAt || lead.collectedAt || '') || 0;
    for (const tombstone of findTombstoneCandidates(lead, index)) {
      if (index.deletedAt.get(tombstone) >= updatedAt) return false;
    }
    return true;
  });
}

export function pruneSupersededTombstones(leads = [], tombstones = []) {
  const safeLeads = Array.isArray(leads) ? leads : [];
  const normalized = mergeDeletionTombstones(tombstones);
  if (!normalized.length || !safeLeads.length) return normalized;

  const index = buildTombstoneIndex(normalized);
  const superseded = new Set();
  for (const lead of safeLeads) {
    const updatedAt = Date.parse(lead.updatedAt || lead.collectedAt || '') || 0;
    if (!updatedAt) continue;
    for (const tombstone of findTombstoneCandidates(lead, index)) {
      if (updatedAt > index.deletedAt.get(tombstone)) superseded.add(tombstone.identityKey);
    }
  }
  return normalized.filter((tombstone) => !superseded.has(tombstone.identityKey));
}

export function buildSupabaseSyncRows(leads = [], tombstones = [], userId = '') {
  const ownerId = String(userId || '').trim();
  if (!ownerId) throw new Error('Usuário Supabase não identificado.');
  const active = (Array.isArray(leads) ? leads : []).map((lead) => ({
    id: String(lead.id || ''),
    identity_key: String(lead.identityKey || ''),
    user_id: ownerId,
    payload: lead,
    updated_at: lead.updatedAt || new Date().toISOString(),
    deleted_at: null
  })).filter((row) => row.id && row.identity_key);
  const deleted = mergeDeletionTombstones(tombstones).map((item) => ({
    // Preserve the full identity to avoid collisions between long, similar keys.
    id: item.id || ('deleted:' + item.identityKey),
    identity_key: item.identityKey,
    user_id: ownerId,
    payload: { deleted: true, identityKey: item.identityKey, aliases: item.aliases, deletedAt: item.deletedAt },
    updated_at: item.deletedAt,
    deleted_at: item.deletedAt
  }));
  if (active.length > 10000 || deleted.length > MAX_DELETION_TOMBSTONES ||
      active.length + deleted.length > 20000) {
    throw new Error('A base excede o limite combinado de 20.000 registros sincronizáveis.');
  }
  return [...active, ...deleted];
}
