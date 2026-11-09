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
    'https://dns.google/*',
    'http://oficina.com.br/*',
    'https://www.empresa.com.br/*'
  ]);
});
test('does not request optional host permissions for empty or unsafe site lists', () => {
  assert.deepEqual(enrichmentPermissionOrigins([]),[]);
  assert.deepEqual(enrichmentPermissionOrigins([{website:'http://localhost'}]),[]);
});
