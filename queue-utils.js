const INTERRUPTION_PATTERN = /cancelad|verifica(?:ção|cao)|limita(?:ção|cao)|interrompid|falha ao retornar|não foi possível retornar|tempo excedido|timeout|deixou de responder/i;

export function classifyQueueOutcome({ requested = 0, collected = 0, stopReason = '', error = '' } = {}) {
  const reason = String(error || stopReason || '').trim();
  if (INTERRUPTION_PATTERN.test(reason)) return 'interrupted';
  if (error) return 'failed';
  const target = Number(requested);
  const actual = Number(collected);
  if (Number.isFinite(target) && target > 0 && (!Number.isFinite(actual) || actual < target)) return 'partial';
  return 'done';
}

export function summarizeQueueOutcomes(outcomes = []) {
  const summary = { total: 0, done: 0, partial: 0, interrupted: 0, failed: 0 };
  for (const outcome of Array.isArray(outcomes) ? outcomes : []) {
    if (!Object.hasOwn(summary, outcome) || outcome === 'total') continue;
    summary[outcome] += 1;
    summary.total += 1;
  }
  return summary;
}
