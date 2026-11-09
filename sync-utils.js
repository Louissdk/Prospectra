import { captureLeadAliases } from './capture-utils.js';

export const MAX_DELETION_TOMBSTONES = 10000;

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

function matchesTombstone(lead, tombstone) {
  const aliases = new Set(captureLeadAliases(lead));
  const leadIdentity = String(lead.identityKey || '').trim();
  if (leadIdentity) aliases.add(leadIdentity);
  return tombstone.aliases.some((alias) => aliases.has(alias)) || (leadIdentity && leadIdentity === tombstone.identityKey);
}

export function applyDeletionTombstones(leads = [], tombstones = []) {
  const normalized = mergeDeletionTombstones(tombstones);
  return (Array.isArray(leads) ? leads : []).filter((lead) => {
    const updatedAt = Date.parse(lead.updatedAt || lead.collectedAt || '') || 0;
    return !normalized.some((tombstone) => matchesTombstone(lead, tombstone) && Date.parse(tombstone.deletedAt) >= updatedAt);
  });
}

export function pruneSupersededTombstones(leads = [], tombstones = []) {
  const normalized = mergeDeletionTombstones(tombstones);
  return normalized.filter((tombstone) => !(Array.isArray(leads) ? leads : []).some((lead) => {
    const updatedAt = Date.parse(lead.updatedAt || lead.collectedAt || '') || 0;
    return matchesTombstone(lead, tombstone) && updatedAt > Date.parse(tombstone.deletedAt);
  }));
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
    id: item.id || ('deleted-' + encodeURIComponent(item.identityKey).slice(0, 120)),
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
