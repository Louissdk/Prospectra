import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

test('migrates legacy leads and preserves data across app state, batches and checkpoints', async () => {
  const legacyLeads = [
    { id:'legacy-1', name:'Empresa Legada', phone:'(11) 3333-4444', mapsUrl:'https://www.google.com/maps/place/Empresa+Legada' }
  ];
  let legacyReads=0;
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          legacyReads++;
          return key === 'prospectra_leads_v1' ? { prospectra_leads_v1:legacyLeads } : {};
        }
      }
    }
  };

  const db = await import('../db.js');
  const { mergeLeadRecords } = await import('../capture-utils.js');

  const migrated = await db.loadAppState();
  assert.equal(migrated.leads.length,1);
  assert.equal(migrated.leads[0].id,'legacy-1');
  assert.equal(migrated.migratedFromChromeStorage,true);
  assert.equal(legacyReads,1);

  migrated.activities=[{id:'activity-1',leadId:'legacy-1',note:'Ligação'}];
  migrated.searches=[{id:'search-1',term:'clínicas',city:'Guarulhos'}];
  await db.saveAppState(migrated);

  const batchResult=await db.saveLeadBatch([{
    id:'legacy-2',name:'Empresa Nova',phone:'(11) 99999-0000',
    mapsUrl:'https://www.google.com/maps/place/Empresa+Nova'
  }],mergeLeadRecords);
  assert.equal(batchResult.saved,1);
  const afterBatch=await db.loadAppState();
  assert.deepEqual(afterBatch.leads.map((lead)=>lead.id).sort(),['legacy-1','legacy-2']);
  assert.equal(afterBatch.activities.length,1);
  assert.equal(afterBatch.searches.length,1);

  await db.saveCaptureCheckpoint({
    status:'interrupted',taskId:'task-1',queueItemId:'queue-1',
    searchTerm:'clínicas',city:'Guarulhos',requested:73,minRating:4,
    collected:2,filteredOut:1,scanned:3,lastPlaceName:'Empresa Nova'
  });
  const savedCheckpoint=await db.loadCaptureCheckpoint();
  assert.equal(savedCheckpoint.lastPlaceName,'Empresa Nova');
  assert.equal(savedCheckpoint.queueItemId,'queue-1');

  await db.saveAppState({...afterBatch,settings:{...afterBatch.settings,owner:'Equipe'}});
  const afterCheckpoint=await db.loadAppState();
  assert.equal(afterCheckpoint.leads.length,2);
  assert.equal(afterCheckpoint.activities.length,1);
  assert.equal((await db.loadCaptureCheckpoint()).taskId,'task-1');

  await db.clearCaptureCheckpoint();
  assert.equal(await db.loadCaptureCheckpoint(),null);
  await db.clearAppDatabase();

  const empty=await db.loadAppState();
  assert.equal(empty.leads.length,0);
  assert.equal(empty.activities.length,0);
  assert.equal(empty.searches.length,0);
  assert.equal(legacyReads,1,'legacy data must not silently re-import after the user clears the database');
});
