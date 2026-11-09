const DB_NAME = 'prospectra_db';
const DB_VERSION = 1;
const STORE = 'records';
const APP_STATE_KEY = 'app_state_v2';
const LEGACY_KEY = 'prospectra_leads_v1';
const DEFAULT_STATE = {
  schemaVersion: 2, leads: [], activities: [], searches: [], queue: [],
  settings: { owner: '', weights: {}, messageTemplate: '', sheetsUrl: '', sheetsToken: '', supabaseUrl: '', supabaseAnonKey: '', supabaseSession: null },
  doNotContact: [], diagnostics: [], updatedAt: new Date().toISOString()
};
let dbPromise;
let initializationPromise;
function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o banco local.'));
    request.onblocked = () => reject(new Error('O banco local está ocupado por outra janela. Feche e abra o painel novamente.'));
  });
  return dbPromise;
}
async function readRecord(key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(request.error);
  });
}
async function writeRecords(entries) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const [key, value] of entries) store.put({ key, value });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('Falha ao gravar no banco local.'));
    tx.onabort = () => reject(tx.error || new Error('Gravação cancelada.'));
  });
}
async function ensureInitialized() {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const existing = await readRecord(APP_STATE_KEY);
      if (existing && typeof existing === 'object') return;
      const legacy = await chrome.storage.local.get(LEGACY_KEY);
      const state = structuredClone(DEFAULT_STATE);
      if (Array.isArray(legacy[LEGACY_KEY])) state.leads = legacy[LEGACY_KEY];
      state.migratedFromChromeStorage = true;
      await writeRecords([[APP_STATE_KEY, state]]);
    })();
  }
  await initializationPromise;
}
export async function loadAppState() {
  await ensureInitialized();
  const state = await readRecord(APP_STATE_KEY);
  return { ...structuredClone(DEFAULT_STATE), ...(state || {}) };
}
export async function saveAppState(state) {
  await ensureInitialized();
  const normalized = { ...structuredClone(DEFAULT_STATE), ...state, schemaVersion: 2, updatedAt: new Date().toISOString() };
  await writeRecords([[APP_STATE_KEY, normalized]]);
  return normalized;
}
export async function saveLeadBatch(batch, mergeFn) {
  await ensureInitialized();
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const request = store.get(APP_STATE_KEY);
    let result;
    request.onsuccess = () => {
      const state = { ...structuredClone(DEFAULT_STATE), ...(request.result?.value || {}) };
      state.leads = mergeFn(state.leads, batch, 10000);
      state.schemaVersion = 2;
      state.updatedAt = new Date().toISOString();
      result = { saved: batch.length, total: state.leads.length };
      store.put({ key: APP_STATE_KEY, value: state });
    };
    tx.oncomplete = () => resolve(result || { saved: 0, total: 0 });
    tx.onerror = () => reject(tx.error || new Error('Falha ao gravar leads no IndexedDB.'));
    tx.onabort = () => reject(tx.error || new Error('Gravação de leads cancelada.'));
  });
}
export async function clearAppDatabase() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
export async function createBackup(state) {
  const safeState = structuredClone(state);
  safeState.settings = { ...(safeState.settings || {}) };
  // Backups transportem dados comerciais, nunca credenciais ou tokens de sessão.
  safeState.settings.sheetsToken = '';
  safeState.settings.supabaseAnonKey = '';
  safeState.settings.supabaseSession = null;
  const payload = {
    app: 'Prospectra', schemaVersion: 2, exportedAt: new Date().toISOString(),
    counts: { leads: safeState.leads?.length || 0, activities: safeState.activities?.length || 0, searches: safeState.searches?.length || 0 },
    data: safeState
  };
  return JSON.stringify(payload, null, 2);
}
export function validateBackup(value) {
  if (!value || typeof value !== 'object' || value.app !== 'Prospectra' || !value.data || !Array.isArray(value.data.leads)) {
    throw new Error('Arquivo inválido. Selecione um backup JSON exportado pelo Prospectra.');
  }
  if (value.data.leads.length > 100000) throw new Error('O backup excede o limite de 100.000 leads.');
  const restored = { ...structuredClone(DEFAULT_STATE), ...value.data, schemaVersion: 2 };
  restored.settings = { ...structuredClone(DEFAULT_STATE.settings), ...(restored.settings || {}) };
  restored.settings.sheetsToken = '';
  restored.settings.supabaseAnonKey = '';
  restored.settings.supabaseSession = null;
  return restored;
}
