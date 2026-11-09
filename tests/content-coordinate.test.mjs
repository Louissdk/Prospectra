import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../content.js', import.meta.url), 'utf8');

test('Google Maps detail extraction attaches only exact place coordinates', () => {
  assert.match(source,/extractPlaceCoordinatesFromMapsUrl\(location\.href\)/);
  assert.match(source,/latitude:\s*coordinates\?\.latitude/);
  assert.match(source,/longitude:\s*coordinates\?\.longitude/);
});
