import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEmailText, extractContactLinks, extractEmails, isPublicHttpUrl, isSafeSameSiteRedirect, safeCsvCell, toCsv, normalizePhone, buildWhatsAppUrl } from '../contact-utils.js';

test('extracts and deduplicates plain and mailto emails', () => {
  const html = '<a href="mailto:Vendas@Empresa.com.br">fale conosco</a><p>contato@empresa.com.br</p><p>suporte@empresa.com.br</p>';
  assert.deepEqual(extractEmails(html), ['contato@empresa.com.br', 'vendas@empresa.com.br', 'suporte@empresa.com.br'].sort((a,b) => {
    const ag = /^(info|contato|contact|comercial|vendas|atendimento|sac|hello|office)@/.test(a) ? 0 : 1;
    const bg = /^(info|contato|contact|comercial|vendas|atendimento|sac|hello|office)@/.test(b) ? 0 : 1;
    return ag-bg || a.localeCompare(b);
  }));
});

test('normalizes common email obfuscation', () => {
  assert.equal(decodeEmailText('comercial [at] empresa [dot] com.br'), 'comercial@empresa.com.br');
  assert.deepEqual(extractEmails('<p>comercial [at] empresa [dot] com.br</p>'), ['comercial@empresa.com.br']);
});

test('rejects example and asset-like email strings', () => {
  assert.deepEqual(extractEmails('hello@example.com image@empresa.png'), []);
});

test('blocks localhost and private network URLs', () => {
  for (const url of ['http://localhost', 'http://127.0.0.1:8080', 'http://10.0.0.2', 'http://192.168.1.1', 'http://169.254.169.254', 'http://service.internal']) {
    assert.equal(isPublicHttpUrl(url), false, url);
  }
});

test('blocks IPv6 local, link-local and multicast addresses', () => {
  for (const url of ['http://[::1]/', 'http://[::]/', 'http://[fd00::1]/', 'http://[fe80::1]/', 'http://[ff02::1]/']) {
    assert.equal(isPublicHttpUrl(url), false, url);
  }
});

test('allows public websites and rejects unsafe protocols', () => {
  assert.equal(isPublicHttpUrl('https://empresa.com.br/contato'), true);
  assert.equal(isPublicHttpUrl('javascript:alert(1)'), false);
  assert.equal(isPublicHttpUrl('file:///etc/passwd'), false);
});

test('finds only same-origin contact pages', () => {
  const html = '<a href="/contato">Contato</a><a href="https://empresa.com.br/sobre">Sobre</a><a href="https://outro.com/contato">Contato externo</a><a href="/produtos">Produtos</a>';
  assert.deepEqual(extractContactLinks(html, 'https://empresa.com.br/', 3), ['https://empresa.com.br/contato', 'https://empresa.com.br/sobre']);
});

test('CSV cells are quoted and formula neutralized', () => {
  assert.equal(safeCsvCell('=1+1'), '"\'=1+1"');
  assert.equal(safeCsvCell('O "Restaurante"'), '"O ""Restaurante"""');
  const csv = toCsv([{ name: '=CMD()', emails: ['a@b.com'] }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes("'=CMD()"));
});


test('keeps phone number and WhatsApp URL as separate values', () => {
  assert.equal(normalizePhone('+55 11 98765-4321'), '+55 (11) 98765-4321');
  assert.equal(buildWhatsAppUrl('+55 (11) 98765-4321'), 'https://wa.me/5511987654321');
  assert.equal(buildWhatsAppUrl('(11) 3333-4444'), 'https://wa.me/551133334444');
  assert.equal(buildWhatsAppUrl('11987654321'), 'https://wa.me/5511987654321');
  assert.equal(buildWhatsAppUrl('telefone sem número'), '');
});

test('CSV exports independent lead, category, phone, WhatsApp and website columns', () => {
  const csv = toCsv([{
    name: 'Clínica Exemplo', category: 'Dentista', phone: '+55 (11) 98765-4321',
    whatsappUrl: 'https://wa.me/5511987654321', website: 'https://clinica.example.com',
    city: 'Guarulhos, SP', searchTerm: 'dentista', emails: ['contato@clinica.com.br'],
    rating: '4.8', reviewCount: '125', mapsUrl: 'https://maps.google.com/example'
  }]);
  assert.ok(csv.includes('\"Nome do lead\";'));
  assert.ok(csv.includes('\"Categoria do lead\";'));
  assert.ok(csv.includes('https://wa.me/5511987654321'));
  assert.ok(csv.includes('https://clinica.example.com'));
  assert.ok(csv.includes('Guarulhos, SP'));
});

test('allows only safe same-site redirects and blocks external hosts or HTTPS downgrade', () => {
  assert.equal(isSafeSameSiteRedirect('http://empresa.com.br/inicio','https://empresa.com.br/inicio'),true);
  assert.equal(isSafeSameSiteRedirect('https://www.empresa.com.br/','https://empresa.com.br/contato'),true);
  assert.equal(isSafeSameSiteRedirect('https://empresa.com.br/','https://outro.com.br/'),false);
  assert.equal(isSafeSameSiteRedirect('https://empresa.com.br/','http://empresa.com.br/'),false);
  assert.equal(isSafeSameSiteRedirect('https://empresa.com.br/','http://127.0.0.1/'),false);
});
