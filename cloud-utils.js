export function normalizeSupabaseProjectUrl(value = '') {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw new Error('URL inválida do Supabase.'); }
  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname) ||
    url.username || url.password || url.port ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search || url.hash
  ) {
    throw new Error('Informe apenas a URL HTTPS do projeto *.supabase.co, sem caminhos ou parâmetros.');
  }
  return url.origin;
}
export function parsePostgrestTotal(contentRange = '') {
  const match = String(contentRange).trim().match(/^\s*(?:\d+-\d+|\*)\/(\d+|\*)\s*$/);
  if (!match || match[1] === '*') return null;
  const total = Number(match[1]);
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}
export function buildRangeHeader(offset, size) {
  const start = Number(offset);
  const count = Number(size);
  if (!Number.isSafeInteger(start) || start < 0 ||
      !Number.isSafeInteger(count) || count < 1 || count > 5000) {
    throw new Error('Intervalo de paginação inválido.');
  }
  return start + '-' + (start + count - 1);
}
export function isGoogleDomain(hostname = '') {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  return /(^|\.)google\.[a-z]{2,3}(?:\.[a-z]{2})?$/.test(host);
}
export function isGoogleMapsUrl(value = '') {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) &&
      isGoogleDomain(url.hostname) &&
      /^\/maps(?:\/|$)/i.test(url.pathname);
  } catch { return false; }
}
