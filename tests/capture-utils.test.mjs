import test from 'node:test';
import assert from 'node:assert/strict';
import { captureLeadKey, mergeLeadRecords, normalizeMapsUrl } from '../capture-utils.js';

test('deduplicates by Maps URL and preserves richer fields', () => {
  const existing = [{
    id: 'lead-1', name: 'Oficina Exemplo',
    mapsUrl: 'https://www.google.com/maps/place/Oficina+Exemplo',
    phone: '', website: '', emails: [],
    collectedAt: '2026-11-01T10:00:00.000Z'
  }];
  const incoming = [{
    id: 'lead-2', name: 'Oficina Exemplo',
    mapsUrl: 'https://www.google.com/maps/place/Oficina+Exemplo',
    phone: '(11) 3333-4444', website: 'https://oficina.example',
    emails: ['CONTATO@OFICINA.EXAMPLE'],
    collectedAt: '2026-11-08T10:00:00.000Z'
  }];
  const merged = mergeLeadRecords(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'lead-1');
  assert.equal(merged[0].phone, '(11) 3333-4444');
  assert.equal(merged[0].website, 'https://oficina.example');
  assert.deepEqual(merged[0].emails, ['contato@oficina.example']);
  assert.equal(merged[0].collectedAt, '2026-11-01T10:00:00.000Z');
});
test('normalizes accents and phone formatting in fallback lead keys', () => {
  assert.equal(captureLeadKey({ name: 'Clínica São João', phone: '(11) 99999-0000' }), 'clinica sao joao|11999990000');
});

test('deduplicates Maps links with different tracking parameters and hashes', () => {
  const first = 'https://www.google.com/maps/place/Clinica+Exemplo/?entry=ttu&hl=pt-BR#reviews';
  const second = 'https://www.google.com/maps/place/Clinica+Exemplo?authuser=0&hl=en&entry=ttu';
  assert.equal(captureLeadKey({ mapsUrl: first }), captureLeadKey({ mapsUrl: second }));
});

test('keeps the Maps CID while removing presentation tracking parameters', () => {
  assert.equal(
    normalizeMapsUrl('https://www.google.com/maps?cid=123456&hl=pt-BR&authuser=0'),
    'https://www.google.com/maps?cid=123456'
  );
});
test('enforces storage cap and keeps most recent records', () => {
  const merged = mergeLeadRecords([], [
    { name: 'Antiga', mapsUrl: 'https://maps.google.com/a', collectedAt: '2026-01-01T00:00:00.000Z' },
    { name: 'Nova', mapsUrl: 'https://maps.google.com/b', collectedAt: '2026-11-01T00:00:00.000Z' }
  ], 1);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'Nova');
});

import { summarizeCapture } from '../capture-utils.js';

test('reports partial collection and remaining target without claiming remaining Maps results', () => {
  const summary = summarizeCapture({
    requested: 73, collected: 26, filteredOut: 0, scanned: 26,
    stopReason: 'O Google Maps não apresentou novos cartões.'
  });
  assert.equal(summary.partial, true);
  assert.equal(summary.remaining, 47);
  assert.equal(summary.scanned, 26);
  assert.match(summary.stopReason, /novos cartões/);
});

test('does not count filtered results as captured leads', () => {
  const summary = summarizeCapture({ requested: 50, collected: 30, filteredOut: 12, scanned: 42 });
  assert.equal(summary.remaining, 20);
  assert.equal(summary.partial, true);
  assert.equal(summary.filteredOut, 12);
});

test('treats zero requested as all available results, without a remaining target', () => {
  const summary = summarizeCapture({ requested: 0, collected: 81, scanned: 93 });
  assert.equal(summary.partial, false);
  assert.equal(summary.reachedTarget, true);
  assert.equal(summary.remaining, null);
});

test('normalizes invalid and negative counters safely', () => {
  const summary = summarizeCapture({ requested: '73', collected: -4, filteredOut: 'x', scanned: 5.9 });
  assert.equal(summary.requested, 73);
  assert.equal(summary.collected, 0);
  assert.equal(summary.filteredOut, 0);
  assert.equal(summary.scanned, 5);
  assert.equal(summary.remaining, 73);
});
