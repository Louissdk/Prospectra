import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../content.js', import.meta.url), 'utf8');

test('detail confirmation requires a matching populated heading and a Maps detail route', () => {
  assert.match(source, /matchingHeadingSamples >= 2 && routeReady/);
  assert.match(source, /headingText.length > 1 && expected.length > 1/);
  assert.doesNotMatch(source, /matchingHeadingSamples >= 2 \|\| \(!!targetPath/);
});

test('result navigation only clicks explicit back-to-results controls', () => {
  assert.match(source, /back to results\|back to list\|voltar para resultados/);
  assert.doesNotMatch(source, /retornar aos resultados\|resultados\|\\bback\\b\|\\bvoltar\\b\|\\bclose\\b/);
});

test('progress counts captured leads rather than discarded rating-filter results', () => {
  assert.match(source, /done: collected\.length, total: progressTotal/);
  assert.doesNotMatch(source, /done: collected\.length \+ filteredOut/);
});

test('capture loop uses normalized keys to avoid rescanning tracking variants', () => {
  assert.match(source, /function resultKey\(item = \{\}\)/);
  assert.match(source, /const key = resultKey\(basic\)/);
  assert.match(source, /const nextKey = resultKey\(item\)/);
});

test('feed selection prefers a scrollable container that contains result cards', () => {
  assert.ok(source.includes('ranked.find((item) => item.links > 0 && item.scrollable)?.element'));
  assert.ok(source.includes('Prefer the actual scroll container'));
});
