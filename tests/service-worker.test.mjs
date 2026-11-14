import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = [];
const stored = { prospectra_leads_v1: [] };

let releaseStorageWrite;
let signalStorageWrite;
const storageWriteStarted = new Promise((resolve) => { signalStorageWrite = resolve; });
const storageWriteGate = new Promise((resolve) => { releaseStorageWrite = resolve; });

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: {
      addListener(listener) { listeners.push(listener); }
    }
  },
  sidePanel: {
    setPanelBehavior: async () => {}
  },
  storage: {
    local: {
      get: async (key) => ({ [key]: stored[key] || [] }),
      set: async (value) => {
        signalStorageWrite();
        await storageWriteGate;
        Object.assign(stored, value);
      }
    }
  }
};

await import('../service-worker.js?service-worker-regression');

test('registra um único listener para mensagens da extensão', () => {
  assert.equal(listeners.length, 1, 'listeners duplicados podem responder antes da persistência');
});

test('só confirma o lote depois que a gravação no armazenamento termina', async () => {
  let response;
  let resolveResponse;
  const responsePromise = new Promise((resolve) => { resolveResponse = resolve; });

  const keepChannelOpen = listeners[0]({
    type: 'PROSPECTRA_CAPTURE_BATCH',
    taskId: 'regression-task',
    items: [{
      id: 'lead-regression',
      name: 'Clínica de Teste',
      mapsUrl: 'https://www.google.com/maps/place/clinica-de-teste',
      collectedAt: '2026-11-14T12:00:00.000Z'
    }]
  }, {}, (value) => {
    response = value;
    resolveResponse(value);
  });

  assert.equal(keepChannelOpen, true, 'a resposta precisa permanecer aberta durante a gravação');
  await storageWriteStarted;
  assert.equal(response, undefined, 'não deve haver confirmação antes do término da gravação');

  releaseStorageWrite();
  const result = await responsePromise;

  assert.deepEqual(result, { ok: true, saved: 1, total: 1 });
  assert.equal(stored.prospectra_leads_v1.length, 1);
  assert.equal(stored.prospectra_leads_v1[0].name, 'Clínica de Teste');
});
