export function captureLeadKey(lead = {}) {
  const mapsUrl = String(lead.mapsUrl || '').trim();
  if (mapsUrl) {
    try { const url = new URL(mapsUrl); url.hash = ''; return url.href; }
    catch { return mapsUrl; }
  }
  return String(lead.name || '').trim().toLowerCase() + '|' + String(lead.phone || '').trim();
}
function mergeLeadRecord(previous, incoming) {
  const emails = [...new Set([
    ...(Array.isArray(previous.emails) ? previous.emails : []),
    ...(Array.isArray(incoming.emails) ? incoming.emails : [])
  ].map((email) => String(email || '').trim().toLowerCase()).filter(Boolean))];
  return {
    ...previous, ...incoming,
    id: previous.id || incoming.id,
    name: incoming.name || previous.name || 'Empresa sem nome identificado',
    category: incoming.category || previous.category || '',
    phone: incoming.phone || previous.phone || '',
    whatsappUrl: incoming.whatsappUrl || previous.whatsappUrl || '',
    address: incoming.address || previous.address || '',
    website: incoming.website || previous.website || '',
    emails,
    emailStatus: emails.length ? 'found' : (incoming.emailStatus || previous.emailStatus || 'pending'),
    rating: incoming.rating || previous.rating || '',
    reviewCount: incoming.reviewCount || previous.reviewCount || '',
    mapsUrl: incoming.mapsUrl || previous.mapsUrl || '',
    searchTerm: incoming.searchTerm || previous.searchTerm || '',
    city: incoming.city || previous.city || '',
    source: incoming.source || previous.source || 'Google Maps',
    collectedAt: previous.collectedAt || incoming.collectedAt || new Date().toISOString(),
    captureNote: incoming.captureNote || previous.captureNote || ''
  };
}
export function mergeLeadRecords(existing = [], incoming = [], maxItems = 5000) {
  const records = new Map();
  for (const item of Array.isArray(existing) ? existing : []) {
    if (!item || typeof item !== 'object') continue;
    records.set(captureLeadKey(item), item);
  }
  for (const item of Array.isArray(incoming) ? incoming : []) {
    if (!item || typeof item !== 'object') continue;
    const key = captureLeadKey(item);
    const previous = records.get(key);
    records.set(key, previous ? mergeLeadRecord(previous, item) : {
      ...item,
      emails: [...new Set((Array.isArray(item.emails) ? item.emails : [])
        .map((email) => String(email || '').trim().toLowerCase()).filter(Boolean))]
    });
  }
  return [...records.values()]
    .sort((a, b) => (Date.parse(b.collectedAt || '') || 0) - (Date.parse(a.collectedAt || '') || 0))
    .slice(0, Math.max(1, Number(maxItems) || 5000));
}

export function summarizeCapture(stats = {}) {
  const count = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  };
  const requested = count(stats.requested);
  const collected = count(stats.collected);
  const filteredOut = count(stats.filteredOut);
  const scanned = count(stats.scanned);
  const remaining = requested > 0 ? Math.max(0, requested - collected) : null;
  return {
    requested,
    collected,
    filteredOut,
    scanned,
    remaining,
    partial: requested > 0 && collected < requested,
    reachedTarget: requested === 0 || collected >= requested,
    stopReason: String(stats.stopReason || '').trim()
  };
}
