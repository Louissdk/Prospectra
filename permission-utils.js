import { isPublicHttpUrl } from './contact-utils.js';

export function enrichmentPermissionOrigins(items = []) {
  const origins = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    try {
      const url = new URL(String(item?.website || ''));
      if (!isPublicHttpUrl(url.href)) continue;
      origins.add(url.origin + '/*');
    } catch {}
  }
  if (origins.size) origins.add('https://dns.google/*');
  return [...origins].sort();
}
