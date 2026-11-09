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
