import test from 'node:test';
import assert from 'node:assert/strict';
import { captureLeadKey, captureLeadAliases, mergeLeadRecords } from '../capture-utils.js';

test('deduplicates by Maps URL and preserves richer fields', () => {
  const existing = [{
    id: 'lead-1', name: 'Oficina Exemplo',
    mapsUrl: 'https://www.google.com/maps/place/Oficina+Exemplo',
    phone: '', website: '', emails: [],
    collectedAt: '2026-11-01T10:00:00.000Z'
  }];
  const incoming = [{
    id: 'lead-2', name: 'Oficina Exemplo',
    mapsUrl: 'https://www.google.com/maps/place/Oficina+Exemplo',
    phone: '(11) 3333-4444', website: 'https://oficina.example',
    emails: ['CONTATO@OFICINA.EXAMPLE'],
    collectedAt: '2026-11-08T10:00:00.000Z'
  }];
  const merged = mergeLeadRecords(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'lead-1');
  assert.equal(merged[0].phone, '+55 (11) 3333-4444');
  assert.equal(merged[0].website, 'https://oficina.example');
  assert.deepEqual(merged[0].emails, ['contato@oficina.example']);
  assert.equal(merged[0].collectedAt, '2026-11-01T10:00:00.000Z');
});
test('uses a stable name and phone fallback key', () => {
  assert.match(captureLeadKey({ name: 'Empresa X', phone: '(11) 99999-0000' }), /^name-phone:empresa x\|11999990000$/);
});
test('enforces storage cap and keeps most recent records', () => {
  const merged = mergeLeadRecords([], [
    { name: 'Antiga', mapsUrl: 'https://maps.google.com/a', collectedAt: '2026-01-01T00:00:00.000Z' },
    { name: 'Nova', mapsUrl: 'https://maps.google.com/b', collectedAt: '2026-11-01T00:00:00.000Z' }
  ], 1);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'Nova');
});

import { summarizeCapture } from '../capture-utils.js';

test('reports partial collection and remaining target without claiming remaining Maps results', () => {
  const summary = summarizeCapture({
    requested: 73, collected: 26, filteredOut: 0, scanned: 26,
    stopReason: 'O Google Maps não apresentou novos cartões.'
  });
  assert.equal(summary.partial, true);
  assert.equal(summary.remaining, 47);
  assert.equal(summary.scanned, 26);
  assert.match(summary.stopReason, /novos cartões/);
});

test('does not count filtered results as captured leads', () => {
  const summary = summarizeCapture({ requested: 50, collected: 30, filteredOut: 12, scanned: 42 });
  assert.equal(summary.remaining, 20);
  assert.equal(summary.partial, true);
  assert.equal(summary.filteredOut, 12);
});

test('treats zero requested as all available results, without a remaining target', () => {
  const summary = summarizeCapture({ requested: 0, collected: 81, scanned: 93 });
  assert.equal(summary.partial, false);
  assert.equal(summary.reachedTarget, true);
  assert.equal(summary.remaining, null);
});

test('normalizes invalid and negative counters safely', () => {
  const summary = summarizeCapture({ requested: '73', collected: -4, filteredOut: 'x', scanned: 5.9 });
  assert.equal(summary.requested, 73);
  assert.equal(summary.collected, 0);
  assert.equal(summary.filteredOut, 0);
  assert.equal(summary.scanned, 5);
  assert.equal(summary.remaining, 73);
});

test('merges alias matches even when the Maps URL changed', () => {
  const existing=[{id:'old-id',name:'Empresa Exemplo',phone:'(11) 3333-4444',mapsUrl:'https://www.google.com/maps/place/Empresa+Exemplo'}];
  const incoming=[{id:'new-id',name:'Empresa Exemplo',phone:'(11) 3333-4444',mapsUrl:'https://www.google.com/maps/place/Empresa+Exemplo+Unidade+2',website:'https://empresa.example'}];
  const merged=mergeLeadRecords(existing,incoming);
  assert.equal(merged.length,1);
  assert.equal(merged[0].id,'old-id');
  assert.equal(merged[0].website,'https://empresa.example');
  assert.ok(captureLeadAliases(merged[0]).some((key)=>key.startsWith('place:')));
});


test('marks only incomplete checkpoints with a saved query as resumable', async () => {
  const { isResumableCheckpoint, captureResumeLabel } = await import('../capture-utils.js');
  assert.equal(isResumableCheckpoint({status:'interrupted',searchTerm:'clínicas',city:'Guarulhos'}),true);
  assert.equal(isResumableCheckpoint({status:'completed',searchTerm:'clínicas',city:'Guarulhos'}),false);
  assert.equal(isResumableCheckpoint({status:'partial',searchTerm:'',city:'Guarulhos'}),false);
  assert.match(captureResumeLabel({status:'interrupted',searchTerm:'clínicas',city:'Guarulhos',lastPlaceName:'Clínica X',collected:12}),/Clínica X/);
});

test('does not merge separate branches that share a name and phone but have different real Place IDs', () => {
  const branches=mergeLeadRecords([],[
    {id:'branch-1',name:'Rede Exemplo',placeId:'ChIJ-UNIDADE-1',phone:'+551133334444',address:'Rua A, 10',mapsUrl:'https://www.google.com/maps/place/Rede+Unidade+1',updatedAt:'2026-11-09T10:00:00Z'},
    {id:'branch-2',name:'Rede Exemplo',placeId:'ChIJ-UNIDADE-2',phone:'+551133334444',address:'Rua B, 20',mapsUrl:'https://www.google.com/maps/place/Rede+Unidade+2',updatedAt:'2026-11-09T11:00:00Z'}
  ]);
  assert.equal(branches.length,2);
  assert.deepEqual(new Set(branches.map((lead)=>lead.placeId)),new Set(['ChIJ-UNIDADE-1','ChIJ-UNIDADE-2']));
});

test('still merges a record without Place ID into its matching identified branch', () => {
  const merged=mergeLeadRecords(
    [{id:'identified',name:'Rede Exemplo',placeId:'ChIJ-UNIDADE-1',phone:'+551133334444',address:'Rua A, 10'}],
    [{id:'legacy',name:'Rede Exemplo',phone:'+551133334444',address:'Rua A, 10',website:'https://rede.example'}]
  );
  assert.equal(merged.length,1);
  assert.equal(merged[0].id,'identified');
  assert.equal(merged[0].website,'https://rede.example');
});


test('a newer CRM update can remove a do-not-contact flag without stale merges restoring it', () => {
  const olderBlocked = {
    id:'lead-dnc', name:'Empresa DNC', placeId:'ChIJ-DNC',
    doNotContact:true, updatedAt:'2026-11-09T10:00:00.000Z'
  };
  const newerUnblocked = {
    ...olderBlocked, doNotContact:false, updatedAt:'2026-11-09T11:00:00.000Z'
  };
  const merged = mergeLeadRecords([olderBlocked],[newerUnblocked]);
  assert.equal(merged.length,1);
  assert.equal(merged[0].doNotContact,false);

  const staleUnblocked = { ...olderBlocked, doNotContact:false, updatedAt:'2026-11-09T09:00:00.000Z' };
  const mergedAgain = mergeLeadRecords([olderBlocked],[staleUnblocked]);
  assert.equal(mergedAgain[0].doNotContact,true);
});


test('a newer Maps capture without CRM fields does not clear a saved do-not-contact flag', () => {
  const blocked = {
    id:'lead-dnc-2', name:'Empresa DNC 2', placeId:'ChIJ-DNC-2',
    doNotContact:true, updatedAt:'2026-11-09T10:00:00.000Z'
  };
  const freshMapsCapture = {
    id:'lead-dnc-2-new', name:'Empresa DNC 2', placeId:'ChIJ-DNC-2',
    phone:'(11) 3333-4444', updatedAt:'2026-11-09T12:00:00.000Z'
  };
  const merged = mergeLeadRecords([blocked],[freshMapsCapture]);
  assert.equal(merged.length,1);
  assert.equal(merged[0].doNotContact,true);
});
