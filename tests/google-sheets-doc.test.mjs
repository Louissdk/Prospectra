import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const docs = await readFile(new URL('../docs/integrations/google-sheets.md', import.meta.url), 'utf8');

test('Google Sheets template exports exact coordinates and protects against formula injection', () => {
  assert.match(docs,/'Latitude', 'Longitude', 'Origem das coordenadas'/);
  assert.match(docs,/lead\.latitude \?\? ''/);
  assert.match(docs,/lead\.longitude \?\? ''/);
  assert.match(docs,/row\.map\(safeCell\)/);
  assert.match(docs,/return \/\^\[\\s\]\*\[=\+\\-@\]\/\.test\(value\)/);
});

test('Apps Script expands narrow sheets and neutralizes formula-like strings', () => {
  assert.ok(docs.includes('sheet.getMaxColumns() < headers.length'));
  assert.ok(docs.includes('sheet.insertColumnsAfter(sheet.getMaxColumns()'));
  assert.match(docs,/return \/\^\[\\s\]\*\[=\+\\-@\]\/\.test\(value\)/);
});

test('Google Sheets integration receives deletion tombstones and removes them by identity', async () => {
  const panel = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  assert.match(panel,/deletedLeadKeys:deletedBatch/);
  assert.match(panel,/const deletions=Array\.isArray\(state\.deletedLeadKeys\)/);
  assert.match(docs,/const deletedLeadKeys = Array\.isArray\(payload\.deletedLeadKeys\)/);
  assert.match(docs,/byIdentity\.delete\(identityKey\)/);
  assert.match(docs,/deleted: deletedLeadKeys\.length/);
});

test('Apps Script serializes read-modify-write requests and validates the action', () => {
  const match = docs.match(/~~~javascript\n([\s\S]*?)\n~~~/);
  assert.ok(match, 'O exemplo completo do Apps Script deve existir.');
  assert.doesNotThrow(() => new vm.Script(match[1]), 'O Apps Script deve ter sintaxe JavaScript válida.');
  assert.match(match[1], /LockService\.getScriptLock\(\)/);
  assert.match(match[1], /lock\.waitLock\(30000\)/);
  assert.match(match[1], /lock\.releaseLock\(\)/);
  assert.match(match[1], /payload\.action !== 'upsert'/);
});
