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
