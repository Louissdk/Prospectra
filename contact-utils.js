const EMAIL_RE = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;
const CONTACT_HINT_RE = /(contato|contact|fale.?conosco|fale.?com|about|sobre|empresa|equipe|team|imprensa|atendimento|sac|support)/i;
const NOISE_EMAIL_PARTS = [
  'example.com', 'email.com', 'yourdomain', 'sentry', 'wixpress', 'cloudflare',
  'webpack', 'googleusercontent', 'schema.org', 'gravatar', 'wordpress.org'
];

export function decodeEmailText(value = '') {
  return String(value)
    .replace(/&commat;|&#0*64;|&#x0*40;/gi, '@')
    .replace(/&period;|&#0*46;|&#x0*2e;/gi, '.')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s*(?:\[at\]|\(at\)|\{at\}|\sat\s)\s*/gi, '@')
    .replace(/\s*(?:\[dot\]|\(dot\)|\{dot\}|\sdot\s)\s*/gi, '.');
}

export function isValidPublicEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (value.length > 254 || value.length < 6 || value.includes('..')) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return false;
  if (NOISE_EMAIL_PARTS.some((part) => value.includes(part))) return false;
  if (/\.(?:png|jpe?g|gif|svg|webp|css|js|woff2?)$/i.test(value)) return false;
  return true;
}

export function extractEmails(html = '') {
  const raw = String(html);
  const mailtoEmails = [...raw.matchAll(/mailto:([^\s\"'<>?]+)/gi)].map((match) => match[1]);
  const source = decodeEmailText(`${mailtoEmails.join(' ')} ${raw
    .replace(/<\/(?:script|style)>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')}`);
  const found = new Set();
  for (const match of source.matchAll(EMAIL_RE)) {
    const email = match[0].replace(/[),.;:]+$/g, '').toLowerCase();
    if (isValidPublicEmail(email)) found.add(email);
  }
  return [...found].sort((a, b) => {
    const aGeneric = /^(info|contato|contact|comercial|vendas|atendimento|sac|hello|office)@/.test(a) ? 0 : 1;
    const bGeneric = /^(info|contato|contact|comercial|vendas|atendimento|sac|hello|office)@/.test(b) ? 0 : 1;
    return aGeneric - bGeneric || a.localeCompare(b);
  });
}

function isPrivateIPv4(host) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

export function isPublicHttpUrl(input) {
  try {
    const url = new URL(String(input || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') ||
        host.endsWith('.local') || host.endsWith('.internal') ||
        host.endsWith('.test') || host.endsWith('.invalid') || host.endsWith('.example')) return false;
    if (host === 'metadata.google.internal' || host === 'metadata') return false;
    if (host.includes(':')) {
      if (host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:') || host.startsWith('ff')) return false;
      if (host.startsWith('::ffff:')) return !isPrivateIPv4(host.slice(7));
    }
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && isPrivateIPv4(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export function extractContactLinks(html = '', baseUrl, limit = 2) {
  if (!isPublicHttpUrl(baseUrl)) return [];
  const base = new URL(baseUrl);
  const links = new Set();
  const anchorRe = /<a\b[^>]*href\s*=\s*(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi;
  for (const match of String(html).matchAll(anchorRe)) {
    const rawHref = match[2].replace(/&amp;/gi, '&').trim();
    const label = match[3].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    if (!CONTACT_HINT_RE.test(`${rawHref} ${label}`)) continue;
    try {
      const url = new URL(rawHref, base);
      if (url.origin !== base.origin || !isPublicHttpUrl(url.href)) continue;
      url.hash = '';
      if (url.pathname === base.pathname && !url.search) continue;
      links.add(url.href);
    } catch {
      // Ignora hrefs inválidos.
    }
    if (links.size >= limit) break;
  }
  return [...links];
}

export function safeCsvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[\u0000-\u0020]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows) {
  const headers = [
    'Empresa', 'Categoria', 'Telefone', 'Endereço', 'Site', 'Tem site', 'Tem e-mail',
    'E-mails encontrados', 'Status do e-mail', 'Avaliação', 'Quantidade de avaliações',
    'Google Maps', 'Data da coleta'
  ];
  const lines = [headers, ...rows.map((row) => [
    row.name, row.category, row.phone, row.address, row.website,
    row.website ? 'Sim' : 'Não identificado', (row.emails || []).length ? 'Sim' : 'Não localizado', (row.emails || []).join(' | '),
    row.emailStatus || (row.website ? 'Pendente' : 'Sem site'), row.rating,
    row.reviewCount, row.mapsUrl, row.collectedAt
  ])];
  return '\uFEFF' + lines.map((line) => line.map(safeCsvCell).join(';')).join('\r\n');
}
