export const CRM_STAGES = [
  { id: 'new', label: 'Novo' }, { id: 'analyzed', label: 'Analisado' },
  { id: 'contacted', label: 'Contatado' }, { id: 'interested', label: 'Interessado' },
  { id: 'negotiation', label: 'Negociação' }, { id: 'customer', label: 'Cliente' },
  { id: 'lost', label: 'Perdido' }
];
export const DEFAULT_WEIGHTS = { phone: 15, website: 15, email: 20, rating: 10, reviews: 10, address: 10, social: 5, cnpj: 5, hours: 5, reachable: 5 };
export const DEFAULT_MESSAGE_TEMPLATE = 'Olá, {empresa}! Tudo bem? Meu nome é {responsavel}. Encontrei a empresa de vocês enquanto pesquisava {categoria} em {cidade}. Gostaria de conversar sobre uma possível parceria. Este é um bom canal para falar com vocês?';
export const cleanText = (value) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
export const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');
export const normalizeCompanyName = (value) => cleanText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const normalizeAddressKey = (value) => normalizeCompanyName(value).replace(/\b(rua|r|avenida|av|bairro|sala|loja|cep)\b/g, '').replace(/\s+/g, ' ').trim();

export function extractPlaceId(mapsUrl = '') {
  try {
    const url = new URL(mapsUrl);
    for (const key of ['query_place_id', 'place_id', 'placeid', 'cid']) {
      const value = url.searchParams.get(key);
      if (value) return key === 'cid' ? 'cid:' + value : value;
    }
    const dataMatch = url.href.match(/!1s(ChIJ[A-Za-z0-9_-]{8,}|0x[0-9a-f]+:0x[0-9a-f]+)/i);
    if (dataMatch) return dataMatch[1];
    const path = url.pathname.match(/\/maps\/place\/([^/]+)/i);
    return path ? 'maps-path:' + decodeURIComponent(path[1]).toLowerCase() : '';
  } catch { return ''; }
}
export function normalizeCnpj(value = '') {
  const cnpj = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{12}\d{2}$/.test(cnpj) ? cnpj : '';
}
export function validateCnpj(value = '') {
  const cnpj = normalizeCnpj(value);
  if (cnpj.length !== 14 || /^([A-Z0-9])\1{13}$/.test(cnpj)) return false;
  // Receita Federal: valor do caractere = código ASCII - 48 (A=17, B=18...).
  const charValue = (character) => character.charCodeAt(0) - 48;
  const calc = (base, weights) => {
    const sum = [...base].reduce((total, character, index) => total + charValue(character) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = calc(cnpj.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]);
  const second = calc(cnpj.slice(0, 12) + first, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return Number(cnpj[12]) === first && Number(cnpj[13]) === second;
}
export function extractCnpj(value = '') {
  const pattern = /\b[A-Z0-9]{2}\.?[A-Z0-9]{3}\.?[A-Z0-9]{3}\/?[A-Z0-9]{4}-?\d{2}\b/gi;
  const matches = String(value).match(pattern) || [];
  return [...new Set(matches.map(normalizeCnpj).filter(validateCnpj))];
}
export function normalizeBrazilPhone(value = '') {
  let digits = digitsOnly(value);
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) digits = digits.slice(2);
  if (digits.length !== 10 && digits.length !== 11) return '';
  const area = digits.slice(0, 2);
  const subscriber = digits.slice(2);
  const mobile = subscriber.length === 9;
  return '+55 (' + area + ') ' + (mobile ? subscriber.slice(0, 5) : subscriber.slice(0, 4)) + '-' + (mobile ? subscriber.slice(5) : subscriber.slice(4));
}
export function extractPhones(value = '') {
  const matches = String(value).match(/(?:\+?55[\s.-]*)?(?:\(?\d{2}\)?[\s.-]*)?(?:9?[\s.-]*)\d{4}[\s.-]?\d{4}/g) || [];
  const phones = new Set();
  for (const match of matches) {
    const phone = normalizeBrazilPhone(match);
    if (phone) phones.add(phone);
  }
  return [...phones];
}
export function classifyPhone(value = '') {
  let digits = digitsOnly(value);
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) digits = digits.slice(2);
  if (digits.length < 10 || digits.length > 11) return 'desconhecido';
  if (digits.length === 11 && digits[2] === '9') return 'celular';
  return 'fixo_ou_comercial';
}
export function classifyEmail(email = '') {
  const local = String(email).split('@')[0].toLowerCase();
  if (/^(vendas|sales|comercial|orcamento|orçamento)/.test(local)) return 'vendas';
  if (/^(contato|contact|hello|ola|olá|info|atendimento)/.test(local)) return 'contato';
  if (/^(financeiro|billing|accounts|cobranca|cobrança)/.test(local)) return 'financeiro';
  if (/^(suporte|support|sac|help)/.test(local)) return 'suporte';
  if (/^(rh|recrutamento|careers|jobs)/.test(local)) return 'recursos_humanos';
  return 'individual_ou_outro';
}
export function extractPublicProfiles(html = '', baseUrl = '') {
  const profiles = {};
  const hrefs = [...String(html).matchAll(/href\s*=\s*(['"])(.*?)\1/gi)].map((m) => m[2].replace(/&amp;/gi, '&'));
  const patterns = { instagram: /(^|\.)instagram\.com$/i, facebook: /(^|\.)facebook\.com$/i, linkedin: /(^|\.)linkedin\.com$/i, youtube: /(^|\.)youtube\.com$/i, tiktok: /(^|\.)tiktok\.com$/i };
  for (const href of hrefs) {
    try {
      const url = new URL(href, baseUrl);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      for (const [network, pattern] of Object.entries(patterns)) {
        if (!profiles[network] && pattern.test(host) && !/\/(share|intent|login|signup|dialog|plugins)\b/i.test(url.pathname)) profiles[network] = url.href.split('#')[0];
      }
    } catch {}
  }
  return profiles;
}
export function parseAddress(address = '') {
  const raw = cleanText(address);
  const result = { raw, street: '', number: '', complement: '', neighborhood: '', city: '', state: '', postalCode: '', confidence: 'low' };
  if (!raw) return result;

  const postal = raw.match(/\b\d{5}-?\d{3}\b/);
  if (postal) result.postalCode = postal[0].replace(/(\d{5})(\d{3})/, '$1-$2');
  const pieces = raw.replace(/\b\d{5}-?\d{3}\b/g, '').split(/\s*[,;]\s*/).map(cleanText).filter(Boolean);
  if (!pieces.length) return result;

  const stateCodes = 'AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO';
  const cityStatePattern = new RegExp('^(.*?)\\s*[-/]\\s*(' + stateCodes + ')$', 'i');
  const stateOnlyPattern = new RegExp('^(' + stateCodes + ')$', 'i');
  let cityStart = pieces.length;
  const cityIndex = pieces.findIndex((piece) => cityStatePattern.test(piece) || stateOnlyPattern.test(piece));
  if (cityIndex >= 0) {
    const cityState = pieces[cityIndex].match(cityStatePattern);
    if (cityState) {
      result.city = cleanText(cityState[1]);
      result.state = cityState[2].toUpperCase();
      cityStart = cityIndex;
    } else {
      result.state = pieces[cityIndex].toUpperCase();
      if (cityIndex > 0) {
        result.city = pieces[cityIndex - 1];
        cityStart = cityIndex - 1;
      } else {
        cityStart = cityIndex;
      }
    }
  } else if (pieces.length >= 3) {
    result.city = pieces[pieces.length - 1];
    cityStart = pieces.length - 1;
  }

  const addressParts = pieces.slice(0, cityStart);
  if (!addressParts.length && pieces.length === 1) {
    result.street = pieces[0];
    return result;
  }

  const first = addressParts.shift() || '';
  const inlineNumber = first.match(/^(.*?)\s+(?:n[ºo.]?\s*)?(\d+[A-Za-z]?(?:-\d+)?|s\/n)$/i);
  if (inlineNumber) {
    result.street = cleanText(inlineNumber[1]);
    result.number = inlineNumber[2].toLowerCase() === 's/n' ? 's/n' : inlineNumber[2];
  } else {
    result.street = first;
  }

  const numberPattern = /^\s*(?:n[ºo.]?\s*)?(\d+[A-Za-z]?(?:-\d+)?|s\/n)(?:\s*[-/]\s*(.*))?$/i;
  const extra = [...addressParts];
  if (!result.number && extra.length) {
    const match = extra[0].match(numberPattern);
    if (match) {
      result.number = match[1].toLowerCase() === 's/n' ? 's/n' : match[1];
      if (match[2]) result.complement = cleanText(match[2]);
      extra.shift();
    }
  }
  if (!result.complement && extra.length && /\b(sala|conjunto|loja|bloco|andar|apto|apartamento|galp[aã]o|fundos|casa)\b/i.test(extra[0])) {
    result.complement = extra.shift();
  }
  if (extra.length) {
    result.neighborhood = extra.pop();
    if (!result.complement && extra.length) result.complement = extra.join(', ');
  }

  if (result.street && result.city && result.state) result.confidence = result.number ? 'high' : 'medium';
  else if (result.street && result.neighborhood) result.confidence = 'medium';
  return result;
}

export function qualityScore(lead = {}, weights = {}) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const present = {
    phone: (lead.phones?.length || lead.phone ? 1 : 0),
    website: lead.website ? 1 : 0,
    email: (lead.emails?.length || 0) ? 1 : 0,
    rating: lead.rating && Number(lead.rating) > 0 ? 1 : 0,
    reviews: Number(lead.reviewCount) > 0 ? 1 : 0,
    address: lead.address ? 1 : 0,
    social: Object.values(lead.socialProfiles || {}).some(Boolean) ? 1 : 0,
    cnpj: lead.cnpj ? 1 : 0,
    hours: lead.openingHours ? 1 : 0,
    reachable: lead.websiteStatus === 'online' ? 1 : 0
  };
  const total = Object.values(w).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0) || 1;
  const score = Object.entries(present).reduce((sum, [key, exists]) => sum + (exists ? Math.max(0, Number(w[key]) || 0) : 0), 0);
  return Math.max(0, Math.min(100, Math.round(score / total * 100)));
}
export function identityKeyForLead(lead = {}) {
  const placeId = String(lead.placeId || extractPlaceId(lead.mapsUrl || '') || '').trim();
  if (placeId) return 'place:' + placeId;
  const name = normalizeCompanyName(lead.name);
  const phone = digitsOnly(lead.phone || lead.phones?.[0]);
  const address = normalizeAddressKey(lead.address);
  if (name && address) return 'name-address:' + name + '|' + address;
  if (name && phone) return 'name-phone:' + name + '|' + phone;
  const mapsUrl = String(lead.mapsUrl || '').trim();
  if (mapsUrl) {
    try {
      const url = new URL(mapsUrl);
      url.hash = '';
      url.searchParams.sort();
      return 'url:' + url.href;
    } catch { return 'url:' + mapsUrl; }
  }
  return name ? 'name:' + name : '';
}

export function normalizeLeadRecord(lead = {}, owner = '') {
  const mapsUrl = String(lead.mapsUrl || '').trim();
  const placeId = String(lead.placeId || extractPlaceId(mapsUrl) || '').trim();
  const phone = String(lead.phone || '').trim();
  const phones = [...new Set([...(Array.isArray(lead.phones) ? lead.phones : []), phone].map((item) => normalizeBrazilPhone(item) || String(item || '').trim()).filter(Boolean))];
  const emails = [...new Set((Array.isArray(lead.emails) ? lead.emails : []).map((email) => String(email).trim().toLowerCase()).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
  const stageIds = new Set(CRM_STAGES.map((stage) => stage.id));
  return {
    ...lead, id: String(lead.id || (globalThis.crypto?.randomUUID?.() || 'lead-' + Date.now() + '-' + Math.random().toString(16).slice(2))),
    placeId, identityKey: identityKeyForLead({ ...lead, placeId, mapsUrl }), name: cleanText(lead.name) || 'Empresa sem nome identificado',
    category: cleanText(lead.category), categoryPath: lead.categoryPath || cleanText(lead.category).split(/\s*[>›|/]\s*/).filter(Boolean),
    phone: phones[0] || '', phones, phoneTypes: phones.map(classifyPhone),
    emails, emailTypes: Object.fromEntries(emails.map((email) => [email, classifyEmail(email)])),
    cnpj: normalizeCnpj(lead.cnpj),
    addressParts: lead.addressParts || parseAddress(lead.address),
    socialProfiles: lead.socialProfiles || {}, sourceMap: lead.sourceMap || {}, confidence: lead.confidence || {},
    ratingHistory: Array.isArray(lead.ratingHistory) ? lead.ratingHistory : [],
    tags: Array.isArray(lead.tags) ? [...new Set(lead.tags)] : [],
    stage: stageIds.has(lead.stage) ? lead.stage : 'new',
    owner: String(lead.owner || owner || ''),
    activities: Array.isArray(lead.activities) ? lead.activities : [],
    nextFollowUp: lead.nextFollowUp || '',
    doNotContact: !!lead.doNotContact,
    closedStatus: lead.closedStatus || 'unknown',
    qualityScore: Number.isFinite(Number(lead.qualityScore)) ? Number(lead.qualityScore) : qualityScore({ ...lead, phones, emails }),
    collectedAt: lead.collectedAt || new Date().toISOString(),
    updatedAt: lead.updatedAt || lead.collectedAt || new Date().toISOString()
  };
}
export function renderTemplate(template, lead, owner = '') {
  const replacements = {
    empresa: lead.name || '', categoria: lead.category || 'seu segmento',
    cidade: lead.city || 'sua região', responsavel: owner || lead.owner || ''
  };
  return String(template || '').replace(/\{(empresa|categoria|cidade|responsavel)\}/g, (_, key) => replacements[key]);
}
export function isDoNotContact(lead, list = []) {
  const key = normalizeCompanyName(lead.name);
  const phone = digitsOnly(lead.phone || lead.phones?.[0]);
  return !!lead.doNotContact || list.some((item) => (item.placeId && item.placeId === lead.placeId) || (item.nameKey && item.nameKey === key) || (item.phone && item.phone === phone));
}
, 'i');
  let cityStart = pieces.length;
  const cityIndex = pieces.findIndex((piece) => stateSuffix.test(piece));
  if (cityIndex >= 0) {
    const match = pieces[cityIndex].match(new RegExp('^(.*?)\\s*[-/]\\s*(' + stateCodes + ')export function qualityScore(lead = {}, weights = {}) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const present = {
    phone: (lead.phones?.length || lead.phone ? 1 : 0),
    website: lead.website ? 1 : 0,
    email: (lead.emails?.length || 0) ? 1 : 0,
    rating: lead.rating && Number(lead.rating) > 0 ? 1 : 0,
    reviews: Number(lead.reviewCount) > 0 ? 1 : 0,
    address: lead.address ? 1 : 0,
    social: Object.values(lead.socialProfiles || {}).some(Boolean) ? 1 : 0,
    cnpj: lead.cnpj ? 1 : 0,
    hours: lead.openingHours ? 1 : 0,
    reachable: lead.websiteStatus === 'online' ? 1 : 0
  };
  const total = Object.values(w).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0) || 1;
  const score = Object.entries(present).reduce((sum, [key, exists]) => sum + (exists ? Math.max(0, Number(w[key]) || 0) : 0), 0);
  return Math.max(0, Math.min(100, Math.round(score / total * 100)));
}
export function identityKeyForLead(lead = {}) {
  const placeId = String(lead.placeId || extractPlaceId(lead.mapsUrl || '') || '').trim();
  if (placeId) return 'place:' + placeId;
  const name = normalizeCompanyName(lead.name);
  const phone = digitsOnly(lead.phone || lead.phones?.[0]);
  const address = normalizeAddressKey(lead.address);
  if (name && address) return 'name-address:' + name + '|' + address;
  if (name && phone) return 'name-phone:' + name + '|' + phone;
  const mapsUrl = String(lead.mapsUrl || '').trim();
  if (mapsUrl) {
    try {
      const url = new URL(mapsUrl);
      url.hash = '';
      url.searchParams.sort();
      return 'url:' + url.href;
    } catch { return 'url:' + mapsUrl; }
  }
  return name ? 'name:' + name : '';
}

export function normalizeLeadRecord(lead = {}, owner = '') {
  const mapsUrl = String(lead.mapsUrl || '').trim();
  const placeId = String(lead.placeId || extractPlaceId(mapsUrl) || '').trim();
  const phone = String(lead.phone || '').trim();
  const phones = [...new Set([...(Array.isArray(lead.phones) ? lead.phones : []), phone].map((item) => normalizeBrazilPhone(item) || String(item || '').trim()).filter(Boolean))];
  const emails = [...new Set((Array.isArray(lead.emails) ? lead.emails : []).map((email) => String(email).trim().toLowerCase()).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
  const stageIds = new Set(CRM_STAGES.map((stage) => stage.id));
  return {
    ...lead, id: String(lead.id || (globalThis.crypto?.randomUUID?.() || 'lead-' + Date.now() + '-' + Math.random().toString(16).slice(2))),
    placeId, identityKey: identityKeyForLead({ ...lead, placeId, mapsUrl }), name: cleanText(lead.name) || 'Empresa sem nome identificado',
    category: cleanText(lead.category), categoryPath: lead.categoryPath || cleanText(lead.category).split(/\s*[>›|/]\s*/).filter(Boolean),
    phone: phones[0] || '', phones, phoneTypes: phones.map(classifyPhone),
    emails, emailTypes: Object.fromEntries(emails.map((email) => [email, classifyEmail(email)])),
    cnpj: normalizeCnpj(lead.cnpj),
    addressParts: lead.addressParts || parseAddress(lead.address),
    socialProfiles: lead.socialProfiles || {}, sourceMap: lead.sourceMap || {}, confidence: lead.confidence || {},
    ratingHistory: Array.isArray(lead.ratingHistory) ? lead.ratingHistory : [],
    tags: Array.isArray(lead.tags) ? [...new Set(lead.tags)] : [],
    stage: stageIds.has(lead.stage) ? lead.stage : 'new',
    owner: String(lead.owner || owner || ''),
    activities: Array.isArray(lead.activities) ? lead.activities : [],
    nextFollowUp: lead.nextFollowUp || '',
    doNotContact: !!lead.doNotContact,
    closedStatus: lead.closedStatus || 'unknown',
    qualityScore: Number.isFinite(Number(lead.qualityScore)) ? Number(lead.qualityScore) : qualityScore({ ...lead, phones, emails }),
    collectedAt: lead.collectedAt || new Date().toISOString(),
    updatedAt: lead.updatedAt || lead.collectedAt || new Date().toISOString()
  };
}
export function renderTemplate(template, lead, owner = '') {
  const replacements = {
    empresa: lead.name || '', categoria: lead.category || 'seu segmento',
    cidade: lead.city || 'sua região', responsavel: owner || lead.owner || ''
  };
  return String(template || '').replace(/\{(empresa|categoria|cidade|responsavel)\}/g, (_, key) => replacements[key]);
}
export function isDoNotContact(lead, list = []) {
  const key = normalizeCompanyName(lead.name);
  const phone = digitsOnly(lead.phone || lead.phones?.[0]);
  return !!lead.doNotContact || list.some((item) => (item.placeId && item.placeId === lead.placeId) || (item.nameKey && item.nameKey === key) || (item.phone && item.phone === phone));
}
, 'i'));
    result.state = match ? match[2].toUpperCase() : pieces[cityIndex].toUpperCase();
    if (match && match[1].trim()) {
      result.city = cleanText(match[1]);
      cityStart = cityIndex;
    } else if (cityIndex > 0) {
      result.city = pieces[cityIndex - 1];
      cityStart = cityIndex - 1;
    } else {
      cityStart = cityIndex;
    }
  } else if (pieces.length >= 3) {
    result.city = pieces[pieces.length - 1];
    cityStart = pieces.length - 1;
  }

  const addressParts = pieces.slice(0, cityStart);
  if (!addressParts.length && pieces.length === 1) {
    result.street = pieces[0];
    return result;
  }

  const first = addressParts.shift() || '';
  const inlineNumber = first.match(/^(.*?)\\s+(?:n[ºo.]?\\s*)?(\\d+[A-Za-z]?(?:-\\d+)?|s\\/n)$/i);
  if (inlineNumber) {
    result.street = cleanText(inlineNumber[1]);
    result.number = inlineNumber[2].toLowerCase() === 's/n' ? 's/n' : inlineNumber[2];
  } else {
    result.street = first;
  }

  const numberPattern = /^\\s*(?:n[ºo.]?\\s*)?(\\d+[A-Za-z]?(?:-\\d+)?|s\\/n)(?:\\s*[-/]\\s*(.*))?$/i;
  const extra = [...addressParts];
  if (!result.number && extra.length) {
    const match = extra[0].match(numberPattern);
    if (match) {
      result.number = match[1].toLowerCase() === 's/n' ? 's/n' : match[1];
      if (match[2]) result.complement = cleanText(match[2]);
      extra.shift();
    }
  }
  if (!result.complement && extra.length && /\\b(sala|conjunto|loja|bloco|andar|apto|apartamento|galp[aã]o|fundos|casa)\\b/i.test(extra[0])) {
    result.complement = extra.shift();
  }
  if (extra.length) {
    result.neighborhood = extra.pop();
    if (!result.complement && extra.length) result.complement = extra.join(', ');
  }
  if (result.street && result.city && result.state) result.confidence = result.number ? 'high' : 'medium';
  else if (result.street && result.neighborhood) result.confidence = 'medium';
  return result;
}
export function qualityScore(lead = {}, weights = {}) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const present = {
    phone: (lead.phones?.length || lead.phone ? 1 : 0),
    website: lead.website ? 1 : 0,
    email: (lead.emails?.length || 0) ? 1 : 0,
    rating: lead.rating && Number(lead.rating) > 0 ? 1 : 0,
    reviews: Number(lead.reviewCount) > 0 ? 1 : 0,
    address: lead.address ? 1 : 0,
    social: Object.values(lead.socialProfiles || {}).some(Boolean) ? 1 : 0,
    cnpj: lead.cnpj ? 1 : 0,
    hours: lead.openingHours ? 1 : 0,
    reachable: lead.websiteStatus === 'online' ? 1 : 0
  };
  const total = Object.values(w).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0) || 1;
  const score = Object.entries(present).reduce((sum, [key, exists]) => sum + (exists ? Math.max(0, Number(w[key]) || 0) : 0), 0);
  return Math.max(0, Math.min(100, Math.round(score / total * 100)));
}
export function identityKeyForLead(lead = {}) {
  const placeId = String(lead.placeId || extractPlaceId(lead.mapsUrl || '') || '').trim();
  if (placeId) return 'place:' + placeId;
  const name = normalizeCompanyName(lead.name);
  const phone = digitsOnly(lead.phone || lead.phones?.[0]);
  const address = normalizeAddressKey(lead.address);
  if (name && address) return 'name-address:' + name + '|' + address;
  if (name && phone) return 'name-phone:' + name + '|' + phone;
  const mapsUrl = String(lead.mapsUrl || '').trim();
  if (mapsUrl) {
    try {
      const url = new URL(mapsUrl);
      url.hash = '';
      url.searchParams.sort();
      return 'url:' + url.href;
    } catch { return 'url:' + mapsUrl; }
  }
  return name ? 'name:' + name : '';
}

export function normalizeLeadRecord(lead = {}, owner = '') {
  const mapsUrl = String(lead.mapsUrl || '').trim();
  const placeId = String(lead.placeId || extractPlaceId(mapsUrl) || '').trim();
  const phone = String(lead.phone || '').trim();
  const phones = [...new Set([...(Array.isArray(lead.phones) ? lead.phones : []), phone].map((item) => normalizeBrazilPhone(item) || String(item || '').trim()).filter(Boolean))];
  const emails = [...new Set((Array.isArray(lead.emails) ? lead.emails : []).map((email) => String(email).trim().toLowerCase()).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
  const stageIds = new Set(CRM_STAGES.map((stage) => stage.id));
  return {
    ...lead, id: String(lead.id || (globalThis.crypto?.randomUUID?.() || 'lead-' + Date.now() + '-' + Math.random().toString(16).slice(2))),
    placeId, identityKey: identityKeyForLead({ ...lead, placeId, mapsUrl }), name: cleanText(lead.name) || 'Empresa sem nome identificado',
    category: cleanText(lead.category), categoryPath: lead.categoryPath || cleanText(lead.category).split(/\s*[>›|/]\s*/).filter(Boolean),
    phone: phones[0] || '', phones, phoneTypes: phones.map(classifyPhone),
    emails, emailTypes: Object.fromEntries(emails.map((email) => [email, classifyEmail(email)])),
    cnpj: normalizeCnpj(lead.cnpj),
    addressParts: lead.addressParts || parseAddress(lead.address),
    socialProfiles: lead.socialProfiles || {}, sourceMap: lead.sourceMap || {}, confidence: lead.confidence || {},
    ratingHistory: Array.isArray(lead.ratingHistory) ? lead.ratingHistory : [],
    tags: Array.isArray(lead.tags) ? [...new Set(lead.tags)] : [],
    stage: stageIds.has(lead.stage) ? lead.stage : 'new',
    owner: String(lead.owner || owner || ''),
    activities: Array.isArray(lead.activities) ? lead.activities : [],
    nextFollowUp: lead.nextFollowUp || '',
    doNotContact: !!lead.doNotContact,
    closedStatus: lead.closedStatus || 'unknown',
    qualityScore: Number.isFinite(Number(lead.qualityScore)) ? Number(lead.qualityScore) : qualityScore({ ...lead, phones, emails }),
    collectedAt: lead.collectedAt || new Date().toISOString(),
    updatedAt: lead.updatedAt || lead.collectedAt || new Date().toISOString()
  };
}
export function renderTemplate(template, lead, owner = '') {
  const replacements = {
    empresa: lead.name || '', categoria: lead.category || 'seu segmento',
    cidade: lead.city || 'sua região', responsavel: owner || lead.owner || ''
  };
  return String(template || '').replace(/\{(empresa|categoria|cidade|responsavel)\}/g, (_, key) => replacements[key]);
}
export function isDoNotContact(lead, list = []) {
  const key = normalizeCompanyName(lead.name);
  const phone = digitsOnly(lead.phone || lead.phones?.[0]);
  return !!lead.doNotContact || list.some((item) => (item.placeId && item.placeId === lead.placeId) || (item.nameKey && item.nameKey === key) || (item.phone && item.phone === phone));
}
