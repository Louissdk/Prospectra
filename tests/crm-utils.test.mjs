import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CRM_STAGES, classifyEmail, classifyPhone, extractCnpj, extractPlaceId, identityKeyForLead,
  extractPhones, normalizeBrazilPhone, normalizeLeadRecord, parseAddress,
  qualityScore, renderTemplate, validateCnpj
} from '../crm-utils.js';
import { captureLeadKey, mergeLeadRecords, summarizeCapture } from '../capture-utils.js';

test('extracts stable Google Maps identifiers when available', () => {
  assert.equal(extractPlaceId('https://www.google.com/maps/search/?api=1&query=clinic&query_place_id=ChIJ123456789'), 'ChIJ123456789');
  assert.equal(extractPlaceId('https://www.google.com/maps?cid=123456789'), 'cid:123456789');
  assert.match(extractPlaceId('https://www.google.com/maps/place/Clinica+Exemplo/'), /^maps-path:/);
});
test('validates Brazilian CNPJ check digits and extracts only valid values', () => {
  assert.equal(validateCnpj('11.222.333/0001-81'), true);
  assert.equal(validateCnpj('11.222.333/0001-80'), false);
  assert.equal(validateCnpj('12.ABC.345/01DE-35'), true);
  assert.equal(validateCnpj('00.000.000/E08G-12'), true);
  assert.equal(validateCnpj('00.000.000/E08G-13'), false);
  assert.deepEqual(
    extractCnpj('CNPJ 11.222.333/0001-81 · CNPJ 00.000.000/E08G-12 · inválido 11.222.333/0001-80'),
    ['11222333000181','00000000E08G12']
  );
});
test('normalizes and classifies Brazilian phone numbers', () => {
  assert.equal(normalizeBrazilPhone('(11) 99999-0000'), '+55 (11) 99999-0000');
  assert.equal(classifyPhone('(11) 99999-0000'), 'celular');
  assert.equal(classifyPhone('(11) 3333-4444'), 'fixo_ou_comercial');
  assert.ok(extractPhones('Telefone (11) 3333-4444 / WhatsApp (11) 99999-0000').length >= 1);
});
test('classifies institutional email roles', () => {
  assert.equal(classifyEmail('vendas@exemplo.com.br'), 'vendas');
  assert.equal(classifyEmail('financeiro@exemplo.com.br'), 'financeiro');
  assert.equal(classifyEmail('ana@exemplo.com.br'), 'individual_ou_outro');
});
test('parses address fields conservatively', () => {
  const parsed = parseAddress('Rua das Flores, 123, Centro, Guarulhos - SP, 07000-000');
  assert.equal(parsed.street, 'Rua das Flores');
  assert.equal(parsed.postalCode, '07000-000');
  assert.equal(parsed.state, 'SP');
});
test('quality score stays in range and rewards useful contact fields', () => {
  const empty = qualityScore({});
  const complete = qualityScore({ phone:'(11) 99999-0000',website:'https://site.example',emails:['oi@site.example'],rating:'4.8',reviewCount:'120',address:'Rua X',cnpj:'11222333000181',openingHours:'Segunda a sexta',websiteStatus:'online',socialProfiles:{instagram:'https://instagram.com/empresa'} });
  assert.ok(empty >= 0 && empty <= 100);
  assert.ok(complete > empty);
});
test('normalizes lead defaults and creates email/phone metadata', () => {
  const lead=normalizeLeadRecord({name:'Clínica Exemplo',phone:'(11) 99999-0000',emails:['VENDAS@EXEMPLO.COM.BR']});
  assert.equal(lead.stage,'new');
  assert.equal(lead.emailTypes['vendas@exemplo.com.br'],'vendas');
  assert.equal(lead.phones.length,1);
  assert.equal(lead.phoneTypes[0],'celular');
  assert.ok(lead.qualityScore>=0);
});
test('message templates replace only supported variables', () => {
  assert.equal(renderTemplate('Oi {empresa}, {cidade} / {responsavel}',{name:'Clínica X',city:'Guarulhos'},'Luis'),'Oi Clínica X, Guarulhos / Luis');
});
test('pipeline contains the seven commercial stages', () => {
  assert.equal(CRM_STAGES.length,7);
  assert.equal(CRM_STAGES.at(-1).id,'lost');
});
test('deduplicates by Place ID and merges richer data without losing activity history', () => {
  const existing=[{id:'lead-1',name:'Oficina Exemplo',placeId:'ChIJ123',mapsUrl:'https://www.google.com/maps/place/Oficina',phones:['(11) 3333-4444'],emails:[],tags:['prioridade'],activities:[{id:'a1',note:'ligação'}],ratingHistory:[{rating:'4.5'}],collectedAt:'2026-11-01T10:00:00.000Z'}];
  const incoming=[{id:'lead-2',name:'Oficina Exemplo',placeId:'ChIJ123',mapsUrl:'https://www.google.com/maps/place/Oficina',phone:'(11) 99999-0000',website:'https://oficina.example',emails:['CONTATO@OFICINA.EXAMPLE'],tags:['guarulhos'],activities:[{id:'a2',note:'retorno'}],ratingHistory:[{rating:'4.8'}],updatedAt:'2026-11-09T10:00:00.000Z'}];
  const merged=mergeLeadRecords(existing,incoming);
  assert.equal(merged.length,1);
  assert.equal(merged[0].id,'lead-1');
  assert.equal(merged[0].website,'https://oficina.example');
  assert.deepEqual(merged[0].emails,['contato@oficina.example']);
  assert.ok(merged[0].phones.length>=2);
  assert.ok(merged[0].tags.includes('prioridade') && merged[0].tags.includes('guarulhos'));
  assert.equal(merged[0].activities.length,2);
  assert.equal(merged[0].ratingHistory.length,2);
});
test('uses stable fallback keys when Place ID is missing', () => {
  assert.match(captureLeadKey({name:'Empresa X',phone:'(11) 99999-0000'}),/^name-phone:/);
});
test('enforces storage cap and keeps recent records', () => {
  const merged=mergeLeadRecords([],[
    {name:'Antiga',mapsUrl:'https://maps.google.com/a',collectedAt:'2026-01-01T00:00:00.000Z'},
    {name:'Nova',mapsUrl:'https://maps.google.com/b',collectedAt:'2026-11-01T00:00:00.000Z'}
  ],1);
  assert.equal(merged.length,1);
  assert.equal(merged[0].name,'Nova');
});
test('reports partial capture without claiming how many Maps results remain', () => {
  const summary=summarizeCapture({requested:73,collected:26,filteredOut:0,scanned:26,stopReason:'O Google Maps não apresentou novos cartões.'});
  assert.equal(summary.partial,true);
  assert.equal(summary.remaining,47);
  assert.match(summary.stopReason,/novos cartões/);
});
test('filtered results are not counted as captured leads', () => {
  const summary=summarizeCapture({requested:50,collected:30,filteredOut:12,scanned:42});
  assert.equal(summary.remaining,20);
  assert.equal(summary.filteredOut,12);
});
test('zero requested means all available results, without a fixed target', () => {
  const summary=summarizeCapture({requested:0,collected:81,scanned:93});
  assert.equal(summary.partial,false);
  assert.equal(summary.reachedTarget,true);
  assert.equal(summary.remaining,null);
});

test('creates a stable commercial identity key', () => {
  assert.equal(identityKeyForLead({placeId:'ChIJ123'}),'place:ChIJ123');
  assert.match(identityKeyForLead({name:'Empresa X',phone:'(11) 99999-0000'}),/^name-phone:/);
});
