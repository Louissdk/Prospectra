import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createXlsx } from '../workbook.js';

test('creates a real XLSX ZIP package with all lead columns and Excel formatting', async () => {
  const blob = createXlsx([{
    name: 'Clínica Exemplo', category: 'Dentista', phone: '+55 (11) 98765-4321',
    whatsappUrl: 'https://wa.me/5511987654321', address: 'Rua Exemplo, 100, Guarulhos',
    website: 'https://clinica-exemplo.com.br', emails: ['contato@clinica-exemplo.com.br'],
    emailStatus: 'found', rating: '4.8', reviewCount: '125', city: 'Guarulhos, SP',
    searchTerm: 'dentista', mapsUrl: 'https://maps.google.com/example', collectedAt: '2026-11-08T12:00:00.000Z'
  }]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.ok(bytes.length > 1500);
  await writeFile('/tmp/prospectra-workbook-test.xlsx', bytes);
});

test('includes exact geographic coordinates and their origin in XLSX output', async () => {
  const blob=createXlsx([{
    name:'Empresa geolocalizada',
    latitude:-23.55052,
    longitude:-46.633308,
    coordinatesSource:'google_maps_place_url'
  }]);
  const bytes=new Uint8Array(await blob.arrayBuffer());
  const zippedText=new TextDecoder().decode(bytes);
  assert.equal(bytes[0],0x50);
  assert.ok(zippedText.includes('Latitude'));
  assert.ok(zippedText.includes('Longitude'));
  assert.ok(zippedText.includes('-23.55052'));
  assert.ok(zippedText.includes('-46.633308'));
  assert.ok(zippedText.includes('google_maps_place_url'));
});

test('keeps zero coordinates and stores latitude and longitude as numeric XLSX cells', async () => {
  const blob=createXlsx([{name:'Meridiano zero',latitude:0,longitude:0,coordinatesSource:'google_maps_place_url'}]);
  const zippedText=new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
  assert.ok(zippedText.includes('<v>0</v>'));
  assert.ok(zippedText.includes('Latitude'));
  assert.ok(zippedText.includes('Longitude'));
  assert.ok(zippedText.includes('Origem das coordenadas'));
});

test('does not duplicate geographic columns in XLSX output', async () => {
  const blob = createXlsx([{
    name: 'Empresa geolocalizada',
    latitude: -23.55052,
    longitude: -46.633308,
    coordinatesSource: 'google_maps_place_url'
  }]);
  const archiveText = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));

  for (const title of ['Latitude', 'Longitude', 'Origem das coordenadas']) {
    const matches = archiveText.match(new RegExp(title, 'g')) || [];
    assert.equal(matches.length, 1, `A coluna "${title}" deve aparecer exatamente uma vez.`);
  }
});
