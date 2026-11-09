import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPlaceCoordinates, hasCoordinates, getGeolocatedLeads, buildGeoJSON, buildKML, buildCoverageSvg } from '../geo-utils.js';

test('extracts only exact place coordinates from Google Maps detail URLs', () => {
  assert.deepEqual(
    extractPlaceCoordinates('https://www.google.com/maps/place/Empresa/data=!4m2!3m1!1sabc!3d-23.55052!4d-46.633308'),
    {latitude:-23.55052,longitude:-46.633308,coordinatesSource:'google_maps_place_url'}
  );
  assert.equal(extractPlaceCoordinates('https://www.google.com/maps/@-23.55,-46.63,15z'),null);
  assert.equal(extractPlaceCoordinates('https://www.google.com/maps/place/X/!3d95!4d-46'),null);
});
test('filters leads without exact valid coordinates', () => {
  assert.equal(hasCoordinates({latitude:-23.5,longitude:-46.6}),true);
  assert.equal(hasCoordinates({latitude:null,longitude:null}),false);
  assert.equal(getGeolocatedLeads([{latitude:1,longitude:2},{latitude:null,longitude:null}]).length,1);
});
test('exports KML and GeoJSON with longitude-first coordinate order', () => {
  const leads=[{name:'Empresa & Filhos',category:'Oficina',address:'Rua A',latitude:-23.5,longitude:-46.6,mapsUrl:'https://maps.example'}];
  const geo=buildGeoJSON(leads);
  assert.equal(geo.features.length,1);
  assert.deepEqual(geo.features[0].geometry.coordinates,[-46.6,-23.5]);
  const kml=buildKML(leads);
  assert.match(kml,/<name>Empresa &amp; Filhos<\/name>/);
  assert.match(kml,/<coordinates>-46\.6,-23\.5,0<\/coordinates>/);
});

test('renders an accessible proportional coverage SVG with escaped labels', () => {
  const svg=buildCoverageSvg([
    {name:'Empresa <A>',city:'Guarulhos',latitude:-23.46,longitude:-46.53},
    {name:'Empresa B',city:'São Paulo',latitude:-23.55,longitude:-46.63}
  ]);
  assert.match(svg,/<svg[^>]+role="img"/);
  assert.match(svg,/Empresa &lt;A&gt;/);
  assert.match(svg,/Longitude:/);
  assert.match(svg,/Latitude:/);
  assert.equal(buildCoverageSvg([{name:'Sem coordenadas'}]),'');
});
