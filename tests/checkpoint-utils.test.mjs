import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCaptureCheckpoint } from '../checkpoint-utils.js';

test('normalizes and limits capture checkpoint data', () => {
  const checkpoint=normalizeCaptureCheckpoint({
    status:'interrupted',taskId:'task',queueItemId:'queue',
    searchTerm:'  clínicas  ',city:' Guarulhos ',
    requested:800,minRating:7,collected:12.9,filteredOut:-3,scanned:'15',
    lastPlaceName:'Empresa Teste',lastPlaceId:'place-1',
    lastMapsUrl:'https://www.google.com/maps/place/Empresa',
    stopReason:'Cancelada'
  },'2026-11-09T05:00:00.000Z');
  assert.equal(checkpoint.status,'interrupted');
  assert.equal(checkpoint.searchTerm,'clínicas');
  assert.equal(checkpoint.city,'Guarulhos');
  assert.equal(checkpoint.requested,500);
  assert.equal(checkpoint.minRating,5);
  assert.equal(checkpoint.collected,12);
  assert.equal(checkpoint.filteredOut,0);
  assert.equal(checkpoint.scanned,15);
  assert.equal(checkpoint.updatedAt,'2026-11-09T05:00:00.000Z');
});
test('rejects malformed checkpoint values', () => {
  assert.throws(()=>normalizeCaptureCheckpoint(null),/Checkpoint/);
  assert.throws(()=>normalizeCaptureCheckpoint([]),/Checkpoint/);
});
