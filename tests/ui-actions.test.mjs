import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');

test('routes queue and saved-search actions before looking up a lead', () => {
  const start=source.indexOf('async function handleLeadAction(action,id)');
  const end=source.indexOf('function renderExportValue',start);
  assert.ok(start>=0 && end>start);
  const handler=source.slice(start,end);
  const leadLookup=handler.indexOf('const lead = leads.find');
  for (const action of ['remove-queue','remove-search','queue-saved']) {
    const route=handler.indexOf("action === '"+action+"'");
    assert.ok(route>=0,action+' route exists');
    assert.ok(route<leadLookup,action+' must be handled before looking for a lead');
  }
});

test('clearing the lead database removes the stale capture checkpoint', () => {
  const start=source.indexOf("$('#clearButton').addEventListener");
  const end=source.indexOf("$('#saveProfileButton')",start);
  const handler=source.slice(start,end);
  assert.match(handler,/state\.queue=\[\]/);
  assert.match(handler,/state\.doNotContact=\[\]/);
  assert.match(handler,/clearLastCaptureCheckpoint\(\)/);
  assert.match(handler,/busy\s*\|\|\s*queueRunning/);
});

test('removing a queue item or clearing the queue invalidates its checkpoint', () => {
  const handlerStart=source.indexOf('async function handleLeadAction(action,id)');
  const handlerEnd=source.indexOf('function renderExportValue',handlerStart);
  const handler=source.slice(handlerStart,handlerEnd);
  assert.match(handler,/lastCaptureCheckpoint\?\.queueItemId === id/);

  const clearStart=source.indexOf("$('#clearQueueButton').addEventListener");
  const clearEnd=source.indexOf("chrome.runtime.onMessage.addListener",clearStart);
  const clearHandler=source.slice(clearStart,clearEnd);
  assert.match(clearHandler,/removedIds/);
  assert.match(clearHandler,/lastCaptureCheckpoint\?\.queueItemId/);
  assert.match(clearHandler,/clearLastCaptureCheckpoint\(\)/);
});

test('coverage panel exposes KML and GeoJSON exports disabled until coordinates exist', async () => {
  const html=await readFile(new URL('../sidepanel.html', import.meta.url),'utf8');
  assert.match(html,/id="coverageMap"/);
  assert.match(html,/id="exportKmlButton"[^>]*disabled/);
  assert.match(html,/id="exportGeoJsonButton"[^>]*disabled/);
  assert.match(source,/\$\('#exportKmlButton'\)/);
  assert.match(source,/\$\('#exportGeoJsonButton'\)/);
  assert.match(source,/getGeolocatedLeads\(leads\)/);
});

test('follow-up reminders are marked notified only after Chrome confirms notification creation', async () => {
  const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  const createAt = worker.indexOf('await chrome.notifications.create');
  const markAt = worker.indexOf('lead.followUpNotifiedAt = new Date().toISOString()',createAt);
  assert.ok(createAt>=0);
  assert.ok(markAt>createAt);
  assert.doesNotMatch(worker.slice(createAt,markAt),/lead\.followUpNotifiedAt\s*=/);
});


test('keeps collection buttons locked until Maps readiness is confirmed', async () => {
  const html=await readFile(new URL('../sidepanel.html', import.meta.url),'utf8');
  assert.match(html,/id="mapsReadiness"/);
  assert.match(html,/id="captureButton"[^>]*disabled/);
  assert.match(html,/id="captureOpenButton"[^>]*disabled/);
  assert.match(source,/function mapsModeReady\(mode\)/);
  assert.match(source,/mapsReadinessState\.status !== 'ready'/);
  assert.match(source,/PROSPECTRA_MAPS_READINESS/);
  assert.match(source,/Pesquisa pronta para coleta/);
});

test('the Maps search action waits for detected business cards instead of reporting immediate success', () => {
  const start=source.indexOf('async function searchMaps()');
  const end=source.indexOf('async function waitForTabReady',start);
  const handler=source.slice(start,end);
  assert.match(handler,/waitForMapsPageReadiness/);
  assert.match(handler,/readiness\.businessLinks/);
  assert.doesNotMatch(handler,/setStatus\('Pesquisa aberta no Google Maps\. Aguarde os resultados aparecerem\.'\s*,\s*'success'\)/);
});

test('Maps readiness watcher is shared so tab events cannot cancel the search check',()=>{
  assert.match(source,/mapsReadinessWatch\?\.tabId===tabId/);
  assert.match(source,/mapsReadinessWatch=\{tabId,token,promise\}/);
  assert.match(source,/force\}/);
});
test('capture uses the connected Maps tab even when the side panel is focused',()=>{
  const start=source.indexOf('async function getActiveMapsTab');
  const end=source.indexOf('async function runCapture',start);
  const handler=source.slice(start,end);
  assert.match(handler,/mapsReadinessState\.tabId/);
  assert.match(handler,/tracked\?\.id && isGoogleMapsUrl/);
});
test('readiness card includes a manual recheck and explicit 3-step guidance',async()=>{
  const html=await readFile(new URL('../sidepanel.html',import.meta.url),'utf8');
  assert.match(html,/id="checkMapsButton"/);
  assert.match(html,/Etapa 1\/3/);
  assert.match(source,/\$\('#checkMapsButton'\)/);
});

