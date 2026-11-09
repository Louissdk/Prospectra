import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DELETION_TOMBSTONES, normalizeDeletionTombstone, createDeletionTombstone,
  mergeDeletionTombstones, applyDeletionTombstones,
  pruneSupersededTombstones, buildSupabaseSyncRows
} from '../sync-utils.js';

test('normalizes and merges deletion tombstones by identity and newest deletion time', () => {
  const merged = mergeDeletionTombstones(
    [{id:'old',identityKey:'place:1',aliases:['place:1','phone:111'],deletedAt:'2026-11-01T10:00:00Z'}],
    [{id:'new',identity_key:'place:1',aliases:['place:1','phone:222'],deleted_at:'2026-11-02T10:00:00Z'}]
  );
  assert.equal(merged.length,1);
  assert.equal(merged[0].id,'new');
  assert.equal(merged[0].deletedAt,'2026-11-02T10:00:00.000Z');
  assert.deepEqual(new Set(merged[0].aliases),new Set(['place:1','phone:111','phone:222']));
});

test('tombstones remove stale remote leads but allow a genuinely newer re-created lead', () => {
  const tombstone=normalizeDeletionTombstone({
    id:'deleted-1',identityKey:'place:1',aliases:['place:1','phone:111'],
    deletedAt:'2026-11-05T10:00:00Z'
  });
  const stale={id:'lead-old',identityKey:'place:1',placeId:'ChIJ-1',phone:'111',updatedAt:'2026-11-04T10:00:00Z'};
  const recreated={...stale,id:'lead-new',updatedAt:'2026-11-06T10:00:00Z'};
  assert.deepEqual(applyDeletionTombstones([stale,recreated],[tombstone]),[recreated]);
  assert.deepEqual(pruneSupersededTombstones([recreated],[tombstone]),[]);
});

test('builds PostgREST rows for active leads and soft deletions', () => {
  const rows=buildSupabaseSyncRows(
    [{id:'lead-1',identityKey:'place:1',name:'Empresa',updatedAt:'2026-11-09T11:00:00Z'}],
    [{id:'lead-2',identityKey:'place:2',aliases:['place:2'],deletedAt:'2026-11-09T12:00:00Z'}],
    'user-123'
  );
  assert.equal(rows.length,2);
  assert.equal(rows[0].deleted_at,null);
  assert.equal(rows[1].deleted_at,'2026-11-09T12:00:00.000Z');
  assert.equal(rows[1].payload.deleted,true);
  assert.equal(rows[1].user_id,'user-123');
});

test('rejects invalid tombstones and caps the tombstone history', () => {
  assert.equal(normalizeDeletionTombstone({identityKey:'x',deletedAt:'invalid'}),null);
  assert.equal(mergeDeletionTombstones([{identityKey:'x',deletedAt:'2026-11-09T10:00:00Z'}]).length,1);
  assert.equal(MAX_DELETION_TOMBSTONES,10000);
});

test('creates deletion tombstones with the lead identity and aliases', () => {
  const tombstone = createDeletionTombstone({
    id:'lead-9',identityKey:'place:ChIJ-9',placeId:'ChIJ-9',name:'Empresa 9',phone:'+5511999999999'
  },'2026-11-09T12:00:00Z');
  assert.equal(tombstone.id,'lead-9');
  assert.equal(tombstone.identityKey,'place:ChIJ-9');
  assert.ok(tombstone.aliases.includes('place:ChIJ-9'));
  assert.equal(tombstone.deletedAt,'2026-11-09T12:00:00.000Z');
});

test('a deletion tombstone never removes a different branch sharing name and phone', () => {
  const deletedBranch={
    id:'branch-1',identityKey:'place:ChIJ-UNIDADE-1',placeId:'ChIJ-UNIDADE-1',
    name:'Rede Exemplo',phone:'+551133334444',address:'Rua A, 10',
    updatedAt:'2026-11-09T10:00:00Z'
  };
  const otherBranch={
    id:'branch-2',identityKey:'place:ChIJ-UNIDADE-2',placeId:'ChIJ-UNIDADE-2',
    name:'Rede Exemplo',phone:'+551133334444',address:'Rua B, 20',
    updatedAt:'2026-11-09T10:00:00Z'
  };
  const tombstone=createDeletionTombstone(deletedBranch,'2026-11-09T11:00:00Z');
  assert.deepEqual(applyDeletionTombstones([deletedBranch,otherBranch],[tombstone]),[otherBranch]);
});
