import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichmentPermissionOrigins } from '../permission-utils.js';

test('requests only public site origins plus DNS-over-HTTPS for MX lookup', () => {
  assert.deepEqual(enrichmentPermissionOrigins([
    {website:'https://www.empresa.com.br/contato'},
    {website:'https://www.empresa.com.br/sobre'},
    {website:'http://oficina.com.br'},
    {website:'http://127.0.0.1/admin'},
    {website:'javascript:alert(1)'}
  ]),[
    'http://oficina.com.br/*',
    'http://www.oficina.com.br/*',
    'https://dns.google/*',
    'https://empresa.com.br/*',
    'https://www.empresa.com.br/*'
  ]);
});
test('does not request optional host permissions for empty or unsafe site lists', () => {
  assert.deepEqual(enrichmentPermissionOrigins([]),[]);
  assert.deepEqual(enrichmentPermissionOrigins([{website:'http://localhost'}]),[]);
});

test('requests both www and apex variants for safe same-site redirects', () => {
  const origins=enrichmentPermissionOrigins([{website:'https://empresa.com.br'}]);
  assert.ok(origins.includes('https://empresa.com.br/*'));
  assert.ok(origins.includes('https://www.empresa.com.br/*'));
});
