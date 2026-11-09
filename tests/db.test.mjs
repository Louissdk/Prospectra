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
