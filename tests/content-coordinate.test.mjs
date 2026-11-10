import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../content.js', import.meta.url), 'utf8');

test('Google Maps detail extraction attaches only exact place coordinates', () => {
  assert.match(source,/extractPlaceCoordinatesFromMapsUrl\(location\.href\)/);
  assert.match(source,/latitude:\s*coordinates\?\.latitude/);
  assert.match(source,/longitude:\s*coordinates\?\.longitude/);
});

test('panel integrates exact coordinates, coverage visualization and spatial exports', async () => {
  const panel = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../sidepanel.html', import.meta.url), 'utf8');
  assert.match(panel,/buildGeoJSON/);
  assert.match(panel,/buildKML/);
  assert.match(panel,/buildCoverageSvg/);
  assert.match(panel,/exportGeoJsonButton/);
  assert.match(panel,/exportKmlButton/);
  assert.match(html,/id="coverageMap"/);
});
