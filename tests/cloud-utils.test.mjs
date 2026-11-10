import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSupabaseProjectUrl, parsePostgrestTotal, buildRangeHeader,
  isGoogleDomain, isGoogleMapsUrl
} from '../cloud-utils.js';

test('accepts only a clean HTTPS Supabase project URL', () => {
  assert.equal(normalizeSupabaseProjectUrl(' https://abc-123.supabase.co/ '),'https://abc-123.supabase.co');
  for (const value of [
    'http://abc.supabase.co',
    'https://abc.supabase.co.attacker.example',
    'https://attacker.example',
    'https://user:pass@abc.supabase.co',
    'https://abc.supabase.co/custom-path',
    'https://abc.supabase.co?redirect=attacker'
  ]) assert.throws(()=>normalizeSupabaseProjectUrl(value),/URL|HTTPS/i,value);
});
test('parses exact PostgREST totals and safely handles unknown totals', () => {
  assert.equal(parsePostgrestTotal('0-999/2450'),2450);
  assert.equal(parsePostgrestTotal('1000-1999/2450'),2450);
  assert.equal(parsePostgrestTotal('*/0'),0);
  assert.equal(parsePostgrestTotal('0-999/*'),null);
  assert.equal(parsePostgrestTotal('invalid'),null);
});
test('builds validated pagination ranges', () => {
  assert.equal(buildRangeHeader(0,1000),'0-999');
  assert.equal(buildRangeHeader(2000,500),'2000-2499');
  assert.throws(()=>buildRangeHeader(-1,1000),/Intervalo/);
  assert.throws(()=>buildRangeHeader(0,0),/Intervalo/);
});
test('recognizes Google Maps URLs without accepting lookalike domains', () => {
  for (const host of ['google.com','www.google.com.br','maps.google.co.uk','google.de']) assert.equal(isGoogleDomain(host),true,host);
  for (const host of ['google.com.attacker.test','google.attacker.com','notgoogle.com','googleusercontent.com']) assert.equal(isGoogleDomain(host),false,host);
  assert.equal(isGoogleMapsUrl('https://www.google.com/maps/search/clinicas'),true);
  assert.equal(isGoogleMapsUrl('https://maps.google.com/maps/place/empresa'),true);
  assert.equal(isGoogleMapsUrl('https://google.com.evil.test/maps/search/x'),false);
  assert.equal(isGoogleMapsUrl('javascript:alert(1)'),false);
});
