import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const docs = await readFile(new URL('../docs/integrations/google-sheets.md', import.meta.url), 'utf8');

test('Google Sheets template exports exact coordinates and protects against formula injection', () => {
  assert.match(docs,/'Latitude', 'Longitude', 'Origem das coordenadas'/);
  assert.match(docs,/lead\.latitude \?\? ''/);
  assert.match(docs,/lead\.longitude \?\? ''/);
  assert.match(docs,/row\.map\(safeCell\)/);
  assert.match(docs,/\^\[\\s\]\*\[=\+\\-@\]/);
});

test('Apps Script expands narrow sheets and neutralizes formula-like strings', () => {
  assert.ok(docs.includes('sheet.getMaxColumns() < headers.length'));
  assert.ok(docs.includes('sheet.insertColumnsAfter(sheet.getMaxColumns()'));
  assert.ok(docs.includes(String.raw`return /^[\s]*[=+\-@]/.test(value)`));
});
