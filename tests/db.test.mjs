import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, validateBackup } from '../db.js';

test('backup removes integration credentials and preserves business data', async () => {
  const input = {
    leads: [{ id:'lead-1', name:'Empresa Teste' }],
    activities: [{ id:'activity-1', note:'ligação' }],
    searches: [{ id:'search-1', term:'clínica', city:'Guarulhos' }],
    queue: [],
    settings: {
      owner:'Comercial',
      sheetsUrl:'https://script.google.com/macros/s/example/exec',
      sheetsToken:'token-privado',
      supabaseAnonKey:'anon-key',
      supabaseSession:{ access_token:'access-secret', refresh_token:'refresh-secret' }
    }
  };
  const backup = JSON.parse(await createBackup(input));
  assert.equal(backup.data.leads.length,1);
  assert.equal(backup.data.activities.length,1);
  assert.equal(backup.data.settings.owner,'Comercial');
  assert.equal(backup.data.settings.sheetsToken,'');
  assert.equal(backup.data.settings.supabaseAnonKey,'');
  assert.equal(backup.data.settings.supabaseSession,null);
  assert.equal(JSON.stringify(backup).includes('access-secret'),false);
  assert.equal(JSON.stringify(backup).includes('refresh-secret'),false);
});
test('backup validator accepts a Prospectra backup and rejects arbitrary JSON', () => {
  const valid=validateBackup({app:'Prospectra',schemaVersion:2,data:{leads:[{id:'one'}],activities:[]}});
  assert.equal(valid.leads.length,1);
  assert.throws(()=>validateBackup({leads:[{id:'one'}]}),/Arquivo inválido/);
  const withSecrets=validateBackup({app:'Prospectra',data:{leads:[],settings:{sheetsToken:'token',supabaseAnonKey:'anon',supabaseSession:{access_token:'session'}}}});
  assert.equal(withSecrets.settings.sheetsToken,'');
  assert.equal(withSecrets.settings.supabaseAnonKey,'');
  assert.equal(withSecrets.settings.supabaseSession,null);
});

test('backup preserves deletion tombstones without storing integration secrets', async () => {
  const input = {
    leads: [],
    deletedLeadKeys: [{id:'gone-1',identityKey:'place:ChIJ-1',aliases:['place:ChIJ-1'],deletedAt:'2026-11-09T10:00:00.000Z'}],
    settings: {sheetsToken:'secret',supabaseSession:{access_token:'private'}}
  };
  const backup = JSON.parse(await createBackup(input));
  assert.equal(backup.counts.deletedLeadKeys,1);
  assert.equal(backup.data.deletedLeadKeys[0].identityKey,'place:ChIJ-1');
  const restored = validateBackup(backup);
  assert.equal(restored.deletedLeadKeys.length,1);
});
test('backup validator rejects malformed or excessive deletion history', () => {
  assert.throws(()=>validateBackup({app:'Prospectra',data:{leads:[],deletedLeadKeys:{}}}),/histórico de exclusões/);
  assert.throws(()=>validateBackup({app:'Prospectra',data:{leads:[],deletedLeadKeys:Array.from({length:10001},(_,i)=>({identityKey:String(i),deletedAt:'2026-11-09T10:00:00.000Z'}))}}),/10.000 exclusões/);
});
