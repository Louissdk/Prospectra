import { isPublicHttpUrl } from './contact-utils.js';

export function enrichmentPermissionOrigins(items = []) {
  const origins = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    try {
      const url = new URL(String(item?.website || ''));
      if (!isPublicHttpUrl(url.href)) continue;
      const hostname = url.hostname.toLowerCase();
      const withoutWww = hostname.replace(/^www\\./, '');
      const withWww = hostname.startsWith('www.') ? hostname : 'www.' + hostname;
      for (const host of new Set([hostname, withoutWww, withWww])) {
        const origin = url.protocol + '//' + host + (url.port ? ':' + url.port : '');
        origins.add(origin + '/*');
      }
    } catch {}
  }
  if (origins.size) origins.add('https://dns.google/*');
  return [...origins].sort();
}
