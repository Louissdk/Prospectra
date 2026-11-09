export function normalizeCaptureCheckpoint(value = {}, now = new Date().toISOString()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Checkpoint de coleta inválido.');
  }
  const count = (input, max = 1000000) => {
    const parsed = Number(input);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(max, Math.floor(parsed))) : 0;
  };
  return {
    status: String(value.status || 'running').slice(0, 24),
    taskId: String(value.taskId || '').slice(0, 100),
    queueItemId: String(value.queueItemId || '').slice(0, 100),
    searchTerm: String(value.searchTerm || '').trim().slice(0, 120),
    city: String(value.city || '').trim().slice(0, 120),
    requested: count(value.requested, 500),
    minRating: Math.max(0, Math.min(5, Number(value.minRating) || 0)),
    collected: count(value.collected),
    filteredOut: count(value.filteredOut),
    scanned: count(value.scanned),
    lastPlaceName: String(value.lastPlaceName || '').slice(0, 180),
    lastPlaceId: String(value.lastPlaceId || '').slice(0, 180),
    lastMapsUrl: String(value.lastMapsUrl || '').slice(0, 1000),
    stopReason: String(value.stopReason || '').slice(0, 300),
    updatedAt: String(now)
  };
}
