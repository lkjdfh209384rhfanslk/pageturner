// PDF 파일(IndexedDB)과 설정(localStorage) 저장.
import { GESTURES } from './gestures.js';

const DB_NAME = 'page-turner';
const STORE = 'pdfs';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export async function addPdf(file) {
  // Blob 대신 ArrayBuffer로 저장: iOS Safari의 IndexedDB Blob 관련 문제를 피한다
  const data = await file.arrayBuffer();
  const item = { id: crypto.randomUUID(), name: file.name.replace(/\.pdf$/i, ''), data, lastPage: 1, pageCount: null, addedAt: Date.now() };
  await tx('readwrite', s => s.put(item));
  return item;
}

export const listPdfs = () => tx('readonly', s => s.getAll());
export const getPdf = id => tx('readonly', s => s.get(id));
export const deletePdf = id => tx('readwrite', s => s.delete(id));

export async function updatePdf(id, patch) {
  const item = await getPdf(id);
  if (item) await tx('readwrite', s => s.put({ ...item, ...patch }));
}

const SETTINGS_KEY = 'page-turner-settings';
const DEFAULTS = {
  nextGesture: 'mouthRight',
  prevGesture: 'mouthLeft',
  holdMs: 400,
  cooldownMs: 1500,
  gestureEnabled: true,
  spread: true,
  thresholds: Object.fromEntries(GESTURES.map(g => [g.id, g.thr])),
};

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...DEFAULTS, ...saved, thresholds: { ...DEFAULTS.thresholds, ...saved.thresholds } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* 저장 실패해도 동작은 유지 */ }
}
